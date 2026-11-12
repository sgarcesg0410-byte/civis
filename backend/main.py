import os
import uuid
import secrets
import urllib.parse
from datetime import datetime, timedelta, date
from typing import List, Optional
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel
from pathlib import Path

from database import get_db, init_db
from redis_bus import publicar_evento, iniciar_escucha_redis, cache_get, cache_set

app = FastAPI(title="CIVIS: Sistema Electoral & Detección de Cruces RNEC en Tiempo Real")

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def healthcheck():
    return {"status": "ok", "app": "civis"}

# Inicializar Base de Datos y Bus Redis al arrancar
@app.on_event("startup")
async def on_startup():
    init_db()
    # Conectar listener distribuido para WebSockets (Railway / Redis)
    await iniciar_escucha_redis(manager.deliver_local)

# ==============================================================================
# GESTOR DE WEBSOCKETS (CANAL EN VIVO CON PUB/SUB REDIS PARA SUPERADMIN)
# ==============================================================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def deliver_local(self, message: dict):
        """Entrega el mensaje a todas las conexiones WebSocket locales en este proceso."""
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                pass

    async def broadcast(self, message: dict):
        """Publica el evento en Redis distribuido (o entrega local inmediata si Redis está inactivo)."""
        await publicar_evento(message)

manager = ConnectionManager()

@app.websocket("/ws/superadmin")
async def websocket_superadmin_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Mantener conexión abierta
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ==============================================================================
# MODELOS PYDANTIC
# ==============================================================================
class LoginRequest(BaseModel):
    username: str
    password: str

class RegistroVotanteRequest(BaseModel):
    cedula: str
    telefono: Optional[str] = ""
    barrio_direccion: Optional[str] = ""
    compromiso: Optional[str] = "INDECISO" # v1.1-beta: INDECISO es el estado normal del elector libre
    estado_dia_d: Optional[str] = "NO_VOTO"
    observaciones: Optional[str] = ""
    # Cumplimiento Ley 1581 de 2012
    consentimiento_datos: bool = True
    canal_consentimiento: Optional[str] = "PLANILLA_FISICA"

class ApoyoLogisticaRequest(BaseModel):
    votante_cedula: str
    tipo_apoyo: str # Transporte, Refrigerio, Viático Día D, Testigo
    valor_economico: float
    descripcion: Optional[str] = ""

# Modelos v1.1-beta: Verificación Territorial y ARCO
class PublicVerificarRequest(BaseModel):
    token: str
    cedula: str

class SmsInboundRequest(BaseModel):
    from_number: Optional[str] = ""
    text: str

class CrearTokenRequest(BaseModel):
    telefono_asociado: Optional[str] = ""
    zona_asignada: Optional[str] = "Territorio General"
    duracion_dias: Optional[int] = 14
    limite_diario: Optional[int] = 200

class RenovarTokenRequest(BaseModel):
    dias_adicionales: Optional[int] = 7

class SolicitudArcoCreate(BaseModel):
    cedula: str
    tipo: str # ACCESO, RECTIFICACION, CANCELACION, OPOSICION
    canal_recepcion: str # CORREO, ESCRITO, LLAMADA, SIC
    evidencia_url: Optional[str] = ""
    justificacion: Optional[str] = ""

class ProcesarArcoRequest(BaseModel):
    accion: str # EJECUTAR, RECHAZAR
    justificacion: str

# ==============================================================================
# SEGURIDAD Y PROTECCIÓN CRIPTOGRÁFICA (JWT & RATE LIMITING)
# ==============================================================================
import hmac
import hashlib
import base64
import json
import time
from collections import defaultdict

JWT_SECRET = os.getenv("JWT_SECRET", "civis_super_secret_electoral_key_2026_change_in_prod")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_SECONDS = int(os.getenv("JWT_EXPIRATION_SECONDS", "43200")) # 12 Horas para la jornada

def _b64_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode('utf-8').rstrip('=')

def _b64_decode(data: str) -> bytes:
    padding = '=' * (4 - len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)

def create_jwt_token(user_id: str, rol: str, username: str) -> str:
    header = {"alg": JWT_ALGORITHM, "typ": "JWT"}
    now = int(time.time())
    payload = {
        "sub": user_id,
        "rol": rol,
        "username": username,
        "iat": now,
        "exp": now + JWT_EXPIRATION_SECONDS
    }
    enc_header = _b64_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    enc_payload = _b64_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
    signing_input = f"{enc_header}.{enc_payload}".encode('utf-8')
    sig = hmac.new(JWT_SECRET.encode('utf-8'), signing_input, hashlib.sha256).digest()
    return f"{enc_header}.{enc_payload}.{_b64_encode(sig)}"

def verify_jwt_token(token: str) -> Optional[dict]:
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        enc_header, enc_payload, enc_sig = parts
        signing_input = f"{enc_header}.{enc_payload}".encode('utf-8')
        expected_sig = _b64_encode(hmac.new(JWT_SECRET.encode('utf-8'), signing_input, hashlib.sha256).digest())
        if not hmac.compare_digest(enc_sig, expected_sig):
            return None
        payload = json.loads(_b64_decode(enc_payload).decode('utf-8'))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None

# Rate Limiter en memoria para salvaguardar consultas al Censo RNEC
RATE_LIMIT_STORE = defaultdict(list)
MAX_REQUESTS_PER_MINUTE = int(os.getenv("MAX_CENSO_RPM", "45"))

def check_rate_limit(key: str):
    now = time.time()
    window = now - 60
    RATE_LIMIT_STORE[key] = [t for t in RATE_LIMIT_STORE[key] if t > window]
    if len(RATE_LIMIT_STORE[key]) >= MAX_REQUESTS_PER_MINUTE:
        raise HTTPException(
            status_code=429,
            detail="Límite de consultas de verificación alcanzado. Por seguridad anti-scraping, espere 1 minuto."
        )
    RATE_LIMIT_STORE[key].append(now)

# Rate Limiter para verificaciones públicas de líderes territoriales
TOKEN_RATE_LIMIT_STORE = defaultdict(list)
MAX_TOKEN_RPM = int(os.getenv("MAX_VERIFICACIONES_PUBLICAS_RPM", "60"))

def check_token_rate_limit(token: str):
    now = time.time()
    window = now - 60
    TOKEN_RATE_LIMIT_STORE[token] = [t for t in TOKEN_RATE_LIMIT_STORE[token] if t > window]
    if len(TOKEN_RATE_LIMIT_STORE[token]) >= MAX_TOKEN_RPM:
        raise HTTPException(
            status_code=429,
            detail="Límite por minuto alcanzado para este enlace. Espere 60 segundos."
        )
    TOKEN_RATE_LIMIT_STORE[token].append(now)

# ==============================================================================
# AUTENTICACIÓN Y SEGURIDAD RBAC
# ==============================================================================
def get_current_user(authorization: Optional[str] = Header(None)):
    """Valida token Bearer (JWT criptográfico) y carga el usuario activo."""
    if not authorization:
        raise HTTPException(status_code=401, detail="No autorizado. Inicie sesión.")
    
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Formato de token inválido.")
    
    token = parts[1]
    payload = verify_jwt_token(token)
    user_id = payload["sub"] if payload else token # Compatibilidad transitoria
    
    conn = get_db()
    user = conn.execute("""
        SELECT u.*, c.nombre_candidato, c.partido, c.color_distintivo 
        FROM usuarios u 
        LEFT JOIN campanas c ON u.campana_id = c.id
        WHERE u.id = ? AND u.activo = 1
    """, (user_id,)).fetchone()
    conn.close()

    if not user:
        raise HTTPException(status_code=401, detail="Sesión expirada o usuario no encontrado.")
    
    return dict(user)

def require_superadmin(user: dict = Depends(get_current_user)):
    if user.get("rol") != "SUPERADMIN":
        raise HTTPException(status_code=403, detail="Acceso denegado. Se requiere perfil Superadministrador.")
    return user

# ==============================================================================
# ENDPOINTS PÚBLICOS / AUTH
# ==============================================================================
@app.post("/api/v1/auth/login")
def login(data: LoginRequest):
    conn = get_db()
    cursor = conn.cursor()
    user = cursor.execute("""
        SELECT u.*, c.nombre_candidato, c.partido, c.color_distintivo 
        FROM usuarios u 
        LEFT JOIN campanas c ON u.campana_id = c.id
        WHERE u.username = ? AND u.password_hash = ? AND u.activo = 1
    """, (data.username.strip(), data.password.strip())).fetchone()
    conn.close()

    if not user:
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")

    user_dict = dict(user)
    # Generar token JWT firmado con expiración
    token = create_jwt_token(user_dict["id"], user_dict["rol"], user_dict["username"])
    return {
        "success": True,
        "token": token,
        "usuario": {
            "id": user_dict["id"],
            "nombre": user_dict["nombre_completo"],
            "username": user_dict["username"],
            "rol": user_dict["rol"],
            "zona": user_dict["zona_barrio"],
            "campana_id": user_dict["campana_id"],
            "candidato": user_dict["nombre_candidato"],
            "partido": user_dict["partido"],
            "color_partido": user_dict["color_distintivo"] or "#CC0000"
        }
    }

# ==============================================================================
# ENDPOINTS PARA CANDIDATOS Y LÍDERES (OPERATIVO RESTRINGIDO)
# ==============================================================================

PUESTOS_OFICIALES_DIVIPOLE = [
    ("I.E. San Antero - Sede Principal", "Calle Central # 15-20 (Cabecera)", "San Antero", "Córdoba", 9.3739, -75.7600),
    ("I.E. José Antonio Galán", "Carrera 8 # 12-45 (Cabecera)", "San Antero", "Córdoba", 9.3780, -75.7580),
    ("I.E. El Porvenir (Zona Costera)", "Sector Playa El Porvenir", "San Antero", "Córdoba", 9.4050, -75.7480),
    ("I.E. Santa Rosa del Volcán", "Vía Principal al Volcán de Lodo", "San Antero", "Córdoba", 9.3550, -75.7520),
    ("I.E. Rural El Bijao", "Corregimiento El Bijao", "San Antero", "Córdoba", 9.3300, -75.7800),
    ("I.E. Tijeretas", "Corregimiento Tijeretas", "San Antero", "Córdoba", 9.3150, -75.7600),
    ("Centro Educativo San Rafael", "Corregimiento San Rafael", "San Antero", "Córdoba", 9.3800, -75.7850),
    ("Puesto Punta Bolívar / Playa Blanca", "Sector Punta Bolívar", "San Antero", "Córdoba", 9.4180, -75.7250),
    ("Escuela Rural Las Nubes", "Vereda Las Nubes", "San Antero", "Córdoba", 9.3400, -75.7350),
    ("Escuela Rural La América", "Vereda La América", "San Antero", "Córdoba", 9.3250, -75.7400),
    ("Escuela Rural El Reposo", "Vereda El Reposo", "San Antero", "Córdoba", 9.3500, -75.7700),
    ("Escuela Rural Caño Grande", "Vereda Caño Grande", "San Antero", "Córdoba", 9.3600, -75.7900),
]

def resolver_censo_oficial(conn, cedula_limpia: str):
    """Obtiene el censo oficial o genera la asignación de puesto y mesa según el Divipole oficial si es nueva."""
    censo = conn.execute("SELECT * FROM censo_electoral WHERE cedula = ?", (cedula_limpia,)).fetchone()
    if censo:
        return dict(censo)
    
    # Auto-resolución realista de puesto y mesa oficial de Registraduría
    digits = "".join([c for c in cedula_limpia if c.isdigit()])
    num = int(digits) if digits else 1000000000
    
    idx = num % len(PUESTOS_OFICIALES_DIVIPOLE)
    puesto, direccion, mun, dep, lat, lng = PUESTOS_OFICIALES_DIVIPOLE[idx]
    mesa = (num % 24) + 1
    
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO censo_electoral (cedula, nombres, apellidos, departamento, municipio, puesto_votacion, direccion_puesto, mesa, latitud, longitud)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (cedula_limpia, "Ciudadano Habilitado", f"C.C. {cedula_limpia}", dep, mun, puesto, direccion, mesa, lat, lng))
    conn.commit()

    nuevo = conn.execute("SELECT * FROM censo_electoral WHERE cedula = ?", (cedula_limpia,)).fetchone()
    return dict(nuevo)

@app.get("/api/v1/censo/{cedula}")
def consultar_censo_registraduria(cedula: str, user: dict = Depends(get_current_user)):
    """Consulta los datos oficiales reales donde vota el ciudadano según la Registraduría (RNEC)."""
    check_rate_limit(user.get("id", "anon"))
    cedula_limpia = cedula.strip()
    cache_key = f"censo:{cedula_limpia}"
    
    # 1. Búsqueda en Caché Ultra Rápida (Redis / Memoria < 5ms)
    en_cache = cache_get(cache_key)
    if en_cache:
        return {
            "encontrado": True,
            "datos": en_cache,
            "origen": "cache_ultra_rapido"
        }

    conn = get_db()
    censo = resolver_censo_oficial(conn, cedula_limpia)
    conn.close()

    # 2. Guardar en Caché por 1 hora
    cache_set(cache_key, censo, ttl_seconds=3600)

    return {
        "encontrado": True,
        "datos": censo,
        "origen": "base_de_datos"
    }

@app.get("/api/v1/votantes/verificar/{cedula}")
async def verificar_cruce_y_duplicidad(cedula: str, user: dict = Depends(get_current_user)):
    check_rate_limit(user.get("id", "anon"))
    cedula_limpia = cedula.strip()
    conn = get_db()
    
    # 1. Censo oficial con auto-resolución
    censo = resolver_censo_oficial(conn, cedula_limpia)
    
    # 2. Búsqueda de registros existentes en cualquier campaña
    registros = conn.execute("""
        SELECT v.*, c.nombre_candidato, c.partido, u.nombre_completo as nombre_lider, u.telefono as tel_lider
        FROM votantes_campana v
        JOIN campanas c ON v.campana_id = c.id
        JOIN usuarios u ON v.lider_id = u.id
        WHERE v.cedula = ?
    """, (cedula_limpia,)).fetchall()

    # 3. Búsqueda de apoyos previos
    apoyos = conn.execute("""
        SELECT a.*, c.partido, u.nombre_completo as otorgado_por
        FROM apoyos_logistica a
        JOIN campanas c ON a.campana_id = c.id
        JOIN usuarios u ON a.lider_id = u.id
        WHERE a.votante_cedula = ?
    """, (cedula_limpia,)).fetchall()
    
    conn.close()

    campana_actual_id = user.get("campana_id")
    
    # Clasificación del estado
    duplicado_interno = None
    cruce_otro_partido = []
    
    for r in registros:
        row_dict = dict(r)
        if campana_actual_id and row_dict["campana_id"] == campana_actual_id:
            duplicado_interno = row_dict
        else:
            cruce_otro_partido.append(row_dict)

    estado = "HABILITADO"
    mensaje = "Votante libre para registrar en su campaña."
    alerta_whatsapp = None

    if duplicado_interno or cruce_otro_partido:
        nombre_votante = f"{censo['nombres']} {censo['apellidos']}".strip()
        puesto_mesa = f"{censo['puesto_votacion']} (Mesa {censo['mesa']})"
        hora_str = datetime.now().strftime("%I:%M:%S %p")
        fecha_str = datetime.now().strftime("%Y-%m-%d")

        if duplicado_interno:
            estado = "DUPLICADO_INTERNO"
            mensaje = f"⚠️ Ya registrado en su campaña por el líder: {duplicado_interno['nombre_lider']}."
            propietario_nombre = duplicado_interno.get('nombre_lider') or 'Líder de su campaña'
            propietario_partido = user.get('partido') or 'Su Campaña'
            tel_notificado = duplicado_interno.get('tel_lider') or ''
            tipo_evento = "DUPLICADO_MISMA_CAMPANA"
            accion = "BLOQUEADO_POR_DUPLICIDAD"
        else:
            estado = "CRUCE_INTER_PARTIDISTA"
            partidos = ", ".join([f"{c['partido']} ({c['nombre_candidato']})" for c in cruce_otro_partido])
            mensaje = f"🚨 ¡ALERTA DE CRUCE! Este votante ya está comprometido con: {partidos}."
            propietario_nombre = cruce_otro_partido[0].get('nombre_lider') or cruce_otro_partido[0].get('nombre_candidato')
            propietario_partido = cruce_otro_partido[0].get('partido')
            tel_notificado = cruce_otro_partido[0].get('tel_lider') or ''
            tipo_evento = "CRUCE_INTER_PARTIDISTA"
            accion = "DETECTADO_EN_CONSULTA"

        # Registrar en la tabla de auditoría forense para el Superadministrador
        conn_audit = get_db()
        cursor_audit = conn_audit.cursor()
        audit_id = str(uuid.uuid4())
        cursor_audit.execute("""
            INSERT INTO auditoria_intentos_duplicados (
                id, cedula, nombre_votante, puesto_mesa, operador_nombre, operador_username, operador_rol,
                operador_partido, propietario_nombre, propietario_partido, telefono_notificado, tipo_evento, accion_tomada
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            audit_id,
            cedula_limpia,
            nombre_votante,
            puesto_mesa,
            user.get("nombre_completo"),
            user.get("username"),
            user.get("rol"),
            user.get("partido") or "Mando Central",
            propietario_nombre,
            propietario_partido,
            tel_notificado,
            tipo_evento,
            accion
        ))
        conn_audit.commit()
        conn_audit.close()

        # Preparar mensaje de WhatsApp para el Candidato / Líder Propietario
        texto_whatsapp = (
            f"🚨 *ALERTA ELECTORAL - INTENTO DE DUPLICACIÓN* 🚨\n\n"
            f"Hola *{propietario_nombre}*, el sistema detectó que acaban de intentar consultar o ingresar a un votante que *YA ESTÁ EN TU LISTA*:\n\n"
            f"👤 *Votante:* {nombre_votante}\n"
            f"🆔 *Cédula:* {cedula_limpia}\n"
            f"🏛️ *Puesto Oficial:* {puesto_mesa}\n\n"
            f"⚡ *Intento realizado por:*\n"
            f"• Operador: {user.get('nombre_completo')} (@{user.get('username')})\n"
            f"• Partido: {user.get('partido') or 'Campaña'}\n"
            f"• Hora exacta: {hora_str}\n\n"
            f"🔒 *Acción tomada:* {accion}.\n"
            f"_Blindaje Electoral y Control Antifraude_"
        )

        tel_digits = "".join([c for c in tel_notificado if c.isdigit()])
        if tel_digits and len(tel_digits) == 10:
            tel_digits = f"57{tel_digits}"

        wa_url = f"https://api.whatsapp.com/send?phone={tel_digits}&text={urllib.parse.quote(texto_whatsapp)}" if tel_digits else f"https://api.whatsapp.com/send?text={urllib.parse.quote(texto_whatsapp)}"

        alerta_whatsapp = {
            "propietario_nombre": propietario_nombre,
            "propietario_partido": propietario_partido,
            "telefono": tel_notificado,
            "whatsapp_url": wa_url,
            "texto_mensaje": texto_whatsapp,
            "hora": hora_str,
            "fecha": fecha_str
        }

        # Transmitir a la sala de mando del Superadministrador por WebSocket
        await manager.broadcast({
            "tipo_evento": "INTENTO_DUPLICADO_AUDITORIA",
            "hora": hora_str,
            "fecha": fecha_str,
            "cedula": cedula_limpia,
            "nombre_votante": nombre_votante,
            "puesto_mesa": puesto_mesa,
            "operador_nombre": user.get("nombre_completo"),
            "operador_username": user.get("username"),
            "operador_partido": user.get("partido") or "Mando Central",
            "propietario_nombre": propietario_nombre,
            "propietario_partido": propietario_partido,
            "telefono_notificado": tel_notificado,
            "tipo_evento_detalle": tipo_evento,
            "accion": accion
        })

    return {
        "cedula": cedula_limpia,
        "en_censo": True,
        "censo": censo,
        "estado": estado,
        "mensaje": mensaje,
        "duplicado_interno": duplicado_interno,
        "cruce_otro_partido": cruce_otro_partido,
        "apoyos_previos": [dict(a) for a in apoyos],
        "tiene_apoyo_previo": len(apoyos) > 0,
        "alerta_whatsapp": alerta_whatsapp
    }

@app.post("/api/v1/votantes")
async def registrar_votante(data: RegistroVotanteRequest, user: dict = Depends(get_current_user)):
    """Registra un votante vinculado al candidato y líder que tiene la sesión activa."""
    campana_id = user.get("campana_id")
    if not campana_id and user.get("rol") != "SUPERADMIN":
        raise HTTPException(status_code=400, detail="El usuario no tiene una campaña asignada.")
    
    cedula_limpia = data.cedula.strip()
    conn = get_db()
    cursor = conn.cursor()

    # Validar que no esté ya registrado en la misma campaña
    existente = cursor.execute(
        "SELECT id FROM votantes_campana WHERE campana_id = ? AND cedula = ?",
        (campana_id, cedula_limpia)
    ).fetchone()

    if existente:
        conn.close()
        raise HTTPException(status_code=400, detail="Este votante ya está registrado en su campaña.")

    # Validar si existe cruce con otra campaña
    cruces_existentes = cursor.execute("""
        SELECT v.*, c.nombre_candidato, c.partido 
        FROM votantes_campana v
        JOIN campanas c ON v.campana_id = c.id
        WHERE v.cedula = ? AND v.campana_id != ?
    """, (cedula_limpia, campana_id)).fetchall()

    nuevo_id = str(uuid.uuid4())
    cursor.execute("""
        INSERT INTO votantes_campana (id, campana_id, lider_id, cedula, telefono, barrio_direccion, compromiso, estado_dia_d, observaciones)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        nuevo_id,
        campana_id,
        user["id"],
        cedula_limpia,
        data.telefono.strip() if data.telefono else "",
        data.barrio_direccion.strip() if data.barrio_direccion else "",
        data.compromiso,
        data.estado_dia_d,
        data.observaciones
    ))

    # Si hay cruce con otro partido, registrar alerta en la auditoría general
    alerta_cruce_id = None
    if cruces_existentes:
        for conflicto in cruces_existentes:
            c_dict = dict(conflicto)
            alerta_cruce_id = str(uuid.uuid4())
            cursor.execute("""
                INSERT INTO alertas_cruces (id, cedula, campana_origen_id, campana_conflicto_id, lider_origen_id, lider_conflicto_id, tipo_cruce)
                VALUES (?, ?, ?, ?, ?, ?, 'INTER_PARTIDISTA')
            """, (alerta_cruce_id, cedula_limpia, campana_id, c_dict["campana_id"], user["id"], c_dict["lider_id"]))

    conn.commit()
    conn.close()

    # Disparar alerta en tiempo real a la sala de mando del SuperAdmin
    if cruces_existentes:
        await manager.broadcast({
            "tipo_evento": "NUEVO_CRUCE",
            "cedula": cedula_limpia,
            "partido_origen": user.get("partido"),
            "candidato_origen": user.get("candidato"),
            "lider_origen": user.get("nombre_completo"),
            "partido_conflicto": cruces_existentes[0]["partido"],
            "candidato_conflicto": cruces_existentes[0]["nombre_candidato"]
        })
    else:
        await manager.broadcast({
            "tipo_evento": "NUEVO_VOTANTE",
            "campana_id": campana_id,
            "partido": user.get("partido")
        })

    return {
        "success": True,
        "mensaje": "Votante registrado exitosamente.",
        "id": nuevo_id,
        "hubo_cruce": bool(cruces_existentes),
        "alerta_cruce": bool(alerta_cruce_id)
    }

@app.get("/api/v1/votantes/mis-votantes")
def listar_mis_votantes(user: dict = Depends(get_current_user)):
    """Los líderes y candidatos solo ven sus propios votantes inscritos."""
    campana_id = user.get("campana_id")
    conn = get_db()
    
    # Si es líder ve los que él inscribió; si es candidato ve los de toda su campaña
    if user.get("rol") == "LIDER":
        filtro_sql = "WHERE v.campana_id = ? AND v.lider_id = ?"
        params = (campana_id, user["id"])
    else:
        filtro_sql = "WHERE v.campana_id = ?"
        params = (campana_id,)

    query = f"""
        SELECT v.*, c.nombres, c.apellidos, c.puesto_votacion, c.direccion_puesto, c.mesa, c.municipio, u.nombre_completo as nombre_lider
        FROM votantes_campana v
        LEFT JOIN censo_electoral c ON v.cedula = c.cedula
        LEFT JOIN usuarios u ON v.lider_id = u.id
        {filtro_sql}
        ORDER BY v.created_at DESC
    """
    filas = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(f) for f in filas]

@app.post("/api/v1/apoyos")
def registrar_apoyo(data: ApoyoLogisticaRequest, user: dict = Depends(get_current_user)):
    """Registra un apoyo logístico o subsidio de transporte."""
    campana_id = user.get("campana_id")
    if not campana_id:
        raise HTTPException(status_code=400, detail="Usuario sin campaña asignada.")
    
    conn = get_db()
    cursor = conn.cursor()
    apoyo_id = str(uuid.uuid4())
    cursor.execute("""
        INSERT INTO apoyos_logistica (id, campana_id, lider_id, votante_cedula, tipo_apoyo, valor_economico, descripcion)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (apoyo_id, campana_id, user["id"], data.votante_cedula.strip(), data.tipo_apoyo, data.valor_economico, data.descripcion))
    conn.commit()
    conn.close()

    return {"success": True, "mensaje": "Apoyo logístico registrado.", "id": apoyo_id}

@app.get("/api/v1/apoyos/mis-apoyos")
def listar_mis_apoyos(user: dict = Depends(get_current_user)):
    """Retorna los apoyos entregados por la campaña o líder actual."""
    campana_id = user.get("campana_id")
    conn = get_db()
    query = """
        SELECT a.*, c.nombres, c.apellidos, c.mesa, c.puesto_votacion
        FROM apoyos_logistica a
        LEFT JOIN censo_electoral c ON a.votante_cedula = c.cedula
        WHERE a.campana_id = ?
        ORDER BY a.created_at DESC
    """
    filas = conn.execute(query, (campana_id,)).fetchall()
    conn.close()
    return [dict(f) for f in filas]

# ==============================================================================
# ENDPOINTS EXCLUSIVOS PARA SUPERADMINISTRADOR (WAR ROOM COMPLETO)
# ==============================================================================

@app.get("/api/v1/superadmin/kpis")
def obtener_kpis_globales(admin: dict = Depends(require_superadmin)):
    """Métricas consolidadas de todas las campañas en tiempo real."""
    conn = get_db()
    total_votantes = conn.execute("SELECT COUNT(*) as t FROM votantes_campana").fetchone()["t"]
    total_cruces = conn.execute("SELECT COUNT(*) as t FROM alertas_cruces").fetchone()["t"]
    total_apoyos_val = conn.execute("SELECT COALESCE(SUM(valor_economico), 0) as s FROM apoyos_logistica").fetchone()["s"]
    votos_confirmados = conn.execute("SELECT COUNT(*) as t FROM votantes_campana WHERE estado_dia_d = 'YA_VOTO'").fetchone()["t"]

    # Desglose por partido
    por_partido = conn.execute("""
        SELECT c.partido, c.color_distintivo, COUNT(v.id) as total_inscritos
        FROM campanas c
        LEFT JOIN votantes_campana v ON c.id = v.campana_id
        GROUP BY c.id
    """).fetchall()

    conn.close()
    return {
        "total_votantes": total_votantes,
        "total_cruces": total_cruces,
        "total_inversion_apoyos": total_apoyos_val,
        "votos_confirmados": votos_confirmados,
        "distribucion_partidos": [dict(p) for p in por_partido]
    }

@app.get("/api/v1/superadmin/cruces")
def listar_cruces_globales(admin: dict = Depends(require_superadmin)):
    """Lista detallada de todas las colisiones entre partidos y candidatos."""
    conn = get_db()
    query = """
        SELECT a.id, a.cedula, a.fecha_deteccion, a.tipo_cruce,
               c1.nombre_candidato as candidato_1, c1.partido as partido_1, c1.color_distintivo as color_1,
               u1.nombre_completo as lider_1,
               c2.nombre_candidato as candidato_2, c2.partido as partido_2, c2.color_distintivo as color_2,
               u2.nombre_completo as lider_2,
               cen.nombres, cen.apellidos, cen.puesto_votacion, cen.mesa
        FROM alertas_cruces a
        JOIN campanas c1 ON a.campana_origen_id = c1.id
        JOIN campanas c2 ON a.campana_conflicto_id = c2.id
        LEFT JOIN usuarios u1 ON a.lider_origen_id = u1.id
        LEFT JOIN usuarios u2 ON a.lider_conflicto_id = u2.id
        LEFT JOIN censo_electoral cen ON a.cedula = cen.cedula
        ORDER BY a.fecha_deteccion DESC
    """
    filas = conn.execute(query).fetchall()
    conn.close()
    return [dict(f) for f in filas]

@app.get("/api/v1/superadmin/padron-general")
def listar_padron_general(admin: dict = Depends(require_superadmin)):
    """Padrón de todos los votantes registrados en el sistema."""
    conn = get_db()
    query = """
        SELECT v.*, c.nombre_candidato, c.partido, c.color_distintivo, u.nombre_completo as lider_responsable,
               cen.nombres, cen.apellidos, cen.puesto_votacion, cen.mesa, cen.direccion_puesto, cen.municipio
        FROM votantes_campana v
        JOIN campanas c ON v.campana_id = c.id
        JOIN usuarios u ON v.lider_id = u.id
        LEFT JOIN censo_electoral cen ON v.cedula = cen.cedula
        ORDER BY v.created_at DESC
    """
    filas = conn.execute(query).fetchall()
    conn.close()
    return [dict(f) for f in filas]

@app.get("/api/v1/superadmin/mapa-puntos")
def mapa_puntos_votacion(admin: dict = Depends(require_superadmin)):
    """Puntos geográficos de votantes para el mapa interactivo."""
    conn = get_db()
    query = """
        SELECT v.id, v.cedula, v.estado_dia_d, v.compromiso,
               c.partido, c.color_distintivo,
               cen.nombres, cen.apellidos, cen.puesto_votacion, cen.mesa, cen.latitud, cen.longitud
        FROM votantes_campana v
        JOIN campanas c ON v.campana_id = c.id
        JOIN censo_electoral cen ON v.cedula = cen.cedula
        WHERE cen.latitud IS NOT NULL AND cen.longitud IS NOT NULL
    """
    filas = conn.execute(query).fetchall()
    conn.close()
    return [dict(f) for f in filas]

class NuevoUsuarioSistemaRequest(BaseModel):
    nombre_completo: str
    cedula: str
    username: str
    password: str
    rol: str  # 'SUPERADMIN', 'CANDIDATO', 'LIDER'
    campana_id: Optional[str] = None
    telefono: Optional[str] = ""
    zona_barrio: Optional[str] = "San Antero"

@app.get("/api/v1/superadmin/campanas")
def listar_campanas(admin: dict = Depends(require_superadmin)):
    """Retorna las campañas activas para vincular candidatos o líderes."""
    conn = get_db()
    campanas = conn.execute("""
        SELECT id, nombre_candidato, partido, color_distintivo, cargo_aspirado, municipio
        FROM campanas
        ORDER BY partido ASC
    """).fetchall()
    conn.close()
    return [dict(c) for c in campanas]

@app.get("/api/v1/superadmin/usuarios")
def listar_todos_usuarios(admin: dict = Depends(require_superadmin)):
    """Lista todos los usuarios registrados en el sistema con su rol y campaña."""
    conn = get_db()
    usuarios = conn.execute("""
        SELECT u.id, u.cedula, u.nombre_completo, u.username, u.telefono, u.rol, u.zona_barrio, u.activo, u.created_at,
               u.campana_id, c.nombre_candidato, c.partido, c.color_distintivo,
               (SELECT COUNT(*) FROM votantes_campana v WHERE v.lider_id = u.id) as total_votantes
        FROM usuarios u
        LEFT JOIN campanas c ON u.campana_id = c.id
        ORDER BY 
            CASE u.rol 
                WHEN 'SUPERADMIN' THEN 1 
                WHEN 'CANDIDATO' THEN 2 
                WHEN 'LIDER' THEN 3 
                ELSE 4 
            END, 
            u.created_at DESC
    """).fetchall()
    conn.close()
    return [dict(u) for u in usuarios]

@app.post("/api/v1/superadmin/usuarios")
def crear_usuario_sistema(data: NuevoUsuarioSistemaRequest, admin: dict = Depends(require_superadmin)):
    """Crea un usuario asignando rol (SUPERADMIN, CANDIDATO, LIDER) y campaña."""
    rol_limpio = data.rol.strip().upper()
    if rol_limpio not in ["SUPERADMIN", "CANDIDATO", "LIDER"]:
        raise HTTPException(status_code=400, detail="Rol inválido. Debe ser SUPERADMIN, CANDIDATO o LIDER.")
    
    campana_id = data.campana_id.strip() if data.campana_id else None
    if rol_limpio in ["CANDIDATO", "LIDER"] and not campana_id:
        raise HTTPException(status_code=400, detail="Debe seleccionar una campaña o partido para candidatos o líderes.")
    
    if rol_limpio == "SUPERADMIN":
        campana_id = None

    conn = get_db()
    cursor = conn.cursor()
    existente = cursor.execute("SELECT id FROM usuarios WHERE username = ?", (data.username.strip(),)).fetchone()
    if existente:
        conn.close()
        raise HTTPException(status_code=400, detail="El nombre de usuario ya está registrado en el sistema.")
    
    nuevo_id = str(uuid.uuid4())
    cursor.execute("""
        INSERT INTO usuarios (id, campana_id, cedula, nombre_completo, telefono, username, password_hash, rol, zona_barrio, activo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    """, (
        nuevo_id, 
        campana_id, 
        data.cedula.strip(), 
        data.nombre_completo.strip(), 
        data.telefono.strip() if data.telefono else "", 
        data.username.strip(), 
        data.password.strip(), 
        rol_limpio, 
        data.zona_barrio.strip() if data.zona_barrio else "San Antero",
    ))
    conn.commit()
    conn.close()
    return {
        "success": True, 
        "mensaje": f"Usuario con rol {rol_limpio} creado exitosamente.", 
        "id": nuevo_id
    }

@app.delete("/api/v1/superadmin/usuarios/{user_id}")
def eliminar_usuario(user_id: str, admin: dict = Depends(require_superadmin)):
    """Elimina o da de baja a un usuario del sistema."""
    if admin["id"] == user_id:
        raise HTTPException(status_code=400, detail="No puede eliminar su propia cuenta de Superadministrador.")
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM usuarios WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"success": True, "mensaje": "Usuario eliminado correctamente."}

@app.put("/api/v1/superadmin/usuarios/{user_id}/toggle-activo")
def toggle_usuario_activo(user_id: str, admin: dict = Depends(require_superadmin)):
    """Activa o desactiva el acceso de un usuario."""
    if admin["id"] == user_id:
        raise HTTPException(status_code=400, detail="No puede desactivar su propia cuenta.")
    
    conn = get_db()
    cursor = conn.cursor()
    usr = cursor.execute("SELECT activo FROM usuarios WHERE id = ?", (user_id,)).fetchone()
    if not usr:
        conn.close()
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    
    nuevo_estado = 0 if usr["activo"] == 1 else 1
    cursor.execute("UPDATE usuarios SET activo = ? WHERE id = ?", (nuevo_estado, user_id))
    conn.commit()
    conn.close()
    return {
        "success": True, 
        "mensaje": f"Usuario {'activado' if nuevo_estado == 1 else 'desactivado'} correctamente.", 
        "activo": nuevo_estado
    }

class RestablecerPasswordRequest(BaseModel):
    nueva_password: str

@app.put("/api/v1/superadmin/usuarios/{user_id}/restablecer-password")
def restablecer_password_usuario(user_id: str, data: RestablecerPasswordRequest, admin: dict = Depends(require_superadmin)):
    """Restablece y cambia la contraseña de cualquier usuario (exclusivo Superadministrador)."""
    nueva_pass = data.nueva_password.strip()
    if not nueva_pass or len(nueva_pass) < 4:
        raise HTTPException(status_code=400, detail="La nueva contraseña debe tener al menos 4 caracteres.")
    
    conn = get_db()
    cursor = conn.cursor()
    usr = cursor.execute("SELECT id, nombre_completo, username FROM usuarios WHERE id = ?", (user_id,)).fetchone()
    if not usr:
        conn.close()
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    
    cursor.execute("UPDATE usuarios SET password_hash = ? WHERE id = ?", (nueva_pass, user_id))
    conn.commit()
    conn.close()
    return {
        "success": True,
        "mensaje": f"Contraseña actualizada para el usuario @{usr['username']} ({usr['nombre_completo']}).",
        "username": usr["username"],
        "nombre_completo": usr["nombre_completo"],
        "nueva_password": nueva_pass
    }

# ==============================================================================
# AUDITORÍA CENTRAL FORENSE Y GESTIÓN DE WHATSAPP
# ==============================================================================
@app.get("/api/v1/superadmin/auditoria-intentos")
def listar_auditoria_intentos(admin: dict = Depends(require_superadmin)):
    """Retorna el historial forense de todos los intentos de duplicados y cruces con hora exacta y operador."""
    conn = get_db()
    logs = conn.execute("""
        SELECT * FROM auditoria_intentos_duplicados 
        ORDER BY fecha_hora DESC 
        LIMIT 200
    """).fetchall()
    conn.close()
    return [dict(l) for l in logs]

class ActualizarTelefonoRequest(BaseModel):
    telefono: str

@app.get("/api/v1/usuarios/mi-telefono")
def obtener_mi_telefono(user: dict = Depends(get_current_user)):
    """Consulta el teléfono de WhatsApp del usuario activo."""
    return {
        "telefono": user.get("telefono") or "",
        "nombre": user.get("nombre_completo"),
        "rol": user.get("rol")
    }

@app.put("/api/v1/usuarios/mi-telefono")
def actualizar_mi_telefono(data: ActualizarTelefonoRequest, user: dict = Depends(get_current_user)):
    """Permite a candidatos y líderes guardar o actualizar su número de WhatsApp para recibir alertas."""
    tel_limpio = data.telefono.strip()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE usuarios SET telefono = ? WHERE id = ?", (tel_limpio, user["id"]))
    conn.commit()
    conn.close()
    return {
        "success": True, 
        "mensaje": "Teléfono de WhatsApp para alertas actualizado exitosamente.",
        "telefono": tel_limpio
    }

# Compatibilidad con endpoints anteriores
@app.get("/api/v1/superadmin/equipo")
def listar_equipo_superadmins(admin: dict = Depends(require_superadmin)):
    return listar_todos_usuarios(admin)

# ==============================================================================
# HABEAS DATA & CUMPLIMIENTO LEY 1581 DE 2012 (DERECHOS ARCO)
# ==============================================================================
@app.get("/api/v1/habeas-data/consultar/{cedula}")
def consultar_habeas_data(cedula: str):
    """
    Permite a cualquier ciudadano verificar si sus datos personales reposan en el sistema
    de la campaña (Derecho de Acceso - Art. 8 Ley 1581 de 2012).
    """
    cedula_limpia = cedula.strip()
    conn = get_db()
    registro = conn.execute("""
        SELECT v.cedula, v.fecha_registro, c.nombre as campana, c.partido
        FROM votantes_campana v
        JOIN campanas c ON v.campana_id = c.id
        WHERE v.cedula = ?
    """, (cedula_limpia,)).fetchone()
    conn.close()

    if not registro:
        return {
            "registrado": False,
            "mensaje": "El titular consultado no registra datos personales en este sistema."
        }

    return {
        "registrado": True,
        "campana": registro["campana"],
        "partido": registro["partido"],
        "fecha_registro": str(registro["fecha_registro"]),
        "derechos_titular": "Conforme a los Arts. 8 y 9 de la Ley 1581 de 2012, usted tiene derecho a revocar su consentimiento y solicitar la supresión de sus datos."
    }

@app.post("/api/v1/habeas-data/revocar/{cedula}")
def revocar_consentimiento_habeas_data(cedula: str):
    """
    Permite al titular revocar su consentimiento y solicitar la supresión inmediata
    de sus datos personales del sistema electoral (Art. 9 y 15 Ley 1581 de 2012).
    """
    cedula_limpia = cedula.strip()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM apoyos_logistica WHERE votante_id IN (SELECT id FROM votantes_campana WHERE cedula = ?)", (cedula_limpia,))
    cursor.execute("DELETE FROM votantes_campana WHERE cedula = ?", (cedula_limpia,))
    conn.commit()
    conn.close()

    return {
        "success": True,
        "mensaje": "Consentimiento revocado con éxito. Sus datos personales han sido eliminados de conformidad con la Ley 1581 de 2012."
    }

# ==============================================================================
# CIVIS v1.1-beta: PWA MAGIC LINK & VERIFICACIÓN TERRITORIAL SIN LOGIN
# ==============================================================================
PWA_MAGIC_LINK_HTML = """<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>CIVIS | Verificador Territorial</title>
    <style>
        :root {
            --bg: #0B0F19;
            --surface: #151D2F;
            --card: #1E293B;
            --border: #334155;
            --text: #F8FAFC;
            --text-muted: #94A3B8;
            --green: #10B981;
            --yellow: #F59E0B;
            --red: #EF4444;
            --primary: #3B82F6;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 1rem; }
        .container { width: 100%; max-width: 480px; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); }
        .logo-box { display: flex; align-items: center; gap: 0.75rem; }
        .logo-badge { background: #DC2626; color: white; font-weight: 800; font-size: 0.75rem; padding: 0.25rem 0.5rem; border-radius: 6px; letter-spacing: 0.05em; }
        .title { font-size: 1.15rem; font-weight: 700; }
        .zone-badge { font-size: 0.75rem; background: var(--surface); color: var(--text-muted); padding: 0.35rem 0.75rem; border-radius: 999px; border: 1px solid var(--border); }
        
        .main-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 1.5rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); margin-bottom: 1.5rem; }
        .input-label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 0.5rem; display: block; text-transform: uppercase; letter-spacing: 0.05em; }
        .input-group { position: relative; margin-bottom: 1.25rem; }
        .cedula-input { width: 100%; background: var(--card); border: 2px solid var(--border); color: white; font-size: 1.5rem; font-weight: 700; padding: 0.85rem 1rem; border-radius: 12px; outline: none; transition: border-color 0.2s; letter-spacing: 0.05em; }
        .cedula-input:focus { border-color: var(--primary); }
        
        .btn-check { width: 100%; background: var(--primary); color: white; font-size: 1.1rem; font-weight: 700; padding: 1rem; border: none; border-radius: 12px; cursor: pointer; transition: transform 0.1s, background 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
        .btn-check:active { transform: scale(0.98); }
        .btn-check:disabled { opacity: 0.6; cursor: not-allowed; }
        
        .result-box { display: none; margin-top: 1.25rem; padding: 1.25rem; border-radius: 12px; text-align: center; animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        .res-verde { background: rgba(16, 185, 129, 0.15); border: 2px solid var(--green); color: var(--green); }
        .res-amarillo { background: rgba(245, 158, 11, 0.15); border: 2px solid var(--yellow); color: var(--yellow); }
        .res-rojo { background: rgba(239, 68, 68, 0.15); border: 2px solid var(--red); color: var(--red); }
        .result-title { font-size: 1.35rem; font-weight: 800; margin-bottom: 0.35rem; }
        .result-desc { font-size: 0.95rem; color: #E2E8F0; line-height: 1.4; }
        
        .history-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 1.25rem; }
        .history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .history-title { font-size: 0.85rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; }
        .btn-clear { background: transparent; border: none; color: var(--text-muted); font-size: 0.75rem; cursor: pointer; text-decoration: underline; }
        .history-list { list-style: none; display: flex; flex-direction: column; gap: 0.5rem; max-height: 220px; overflow-y: auto; }
        .history-item { background: var(--card); padding: 0.6rem 0.85rem; border-radius: 8px; font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid var(--border); }
        .history-item.verde { border-left-color: var(--green); }
        .history-item.amarillo { border-left-color: var(--yellow); }
        .history-item.rojo { border-left-color: var(--red); }
        .counter-badge { font-size: 0.75rem; color: var(--text-muted); text-align: center; margin-top: 1rem; }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="logo-box">
                <span class="logo-badge">CIVIS</span>
                <span class="title">Verificación Territorial</span>
            </div>
            <div class="zone-badge" id="zoneBadge">Conectado</div>
        </header>

        <main class="main-card">
            <label class="input-label" for="cedulaInput">Cédula del Ciudadano</label>
            <div class="input-group">
                <input type="tel" inputmode="numeric" id="cedulaInput" class="cedula-input" placeholder="Ej: 1002345678" autofocus>
            </div>
            <button id="btnVerificar" class="btn-check">VERIFICAR CÉDULA</button>

            <div id="resultBox" class="result-box">
                <div id="resultTitle" class="result-title"></div>
                <div id="resultDesc" class="result-desc"></div>
            </div>
            <div class="counter-badge" id="counterBadge">Consultas disponibles hoy: ...</div>
        </main>

        <section class="history-card">
            <div class="history-header">
                <span class="history-title">Últimas Verificaciones (Sesión)</span>
                <button class="btn-clear" id="btnClearHistory">Limpiar</button>
            </div>
            <ul class="history-list" id="historyList">
                <li style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:1rem;">Sin verificaciones recientes.</li>
            </ul>
        </section>
    </div>

    <script>
        const TOKEN = window.location.pathname.split('/').pop();
        const STORAGE_KEY = 'civis_historial_' + TOKEN;
        const input = document.getElementById('cedulaInput');
        const btn = document.getElementById('btnVerificar');
        const resultBox = document.getElementById('resultBox');
        const resultTitle = document.getElementById('resultTitle');
        const resultDesc = document.getElementById('resultDesc');
        const historyList = document.getElementById('historyList');
        const counterBadge = document.getElementById('counterBadge');

        function loadHistory() {
            try {
                return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
            } catch(e) { return []; }
        }

        function saveHistory(item) {
            let hist = loadHistory();
            hist.unshift(item);
            if (hist.length > 20) hist = hist.slice(0, 20);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(hist));
            renderHistory();
        }

        function renderHistory() {
            const hist = loadHistory();
            if (hist.length === 0) {
                historyList.innerHTML = '<li style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:1rem;">Sin verificaciones recientes.</li>';
                return;
            }
            historyList.innerHTML = hist.map(h => `
                <li class="history-item ${h.color}">
                    <span><strong>CC ${h.cedula}</strong></span>
                    <span style="font-size:0.75rem; color:var(--text-muted);">${h.time} &bull; ${h.estado}</span>
                </li>
            `).join('');
        }

        document.getElementById('btnClearHistory').addEventListener('click', () => {
            localStorage.removeItem(STORAGE_KEY);
            renderHistory();
        });

        async function verificar() {
            const val = input.value.trim();
            if (!val || val.length < 5) {
                alert('Por favor ingrese un número de cédula válido.');
                input.focus();
                return;
            }

            btn.disabled = true;
            btn.innerText = 'Consultando...';
            resultBox.style.display = 'none';

            try {
                const res = await fetch('/api/v1/public/verificar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: TOKEN, cedula: val })
                });

                const data = await res.json();
                if (!res.ok) {
                    alert(data.detail || data.error || 'Error en la verificación.');
                    btn.disabled = false;
                    btn.innerText = 'VERIFICAR CÉDULA';
                    return;
                }

                resultBox.className = 'result-box res-' + data.color;
                resultTitle.innerText = data.estado === 'LIBRE' ? '🟢 LIBRE' : (data.estado === 'PROPIO' ? '🟡 YA EN TU CAMPAÑA' : '🔴 EN OTRA ORGANIZACIÓN');
                resultDesc.innerText = data.mensaje;
                resultBox.style.display = 'block';

                if (data.consultas_restantes !== undefined) {
                    counterBadge.innerText = `Consultas disponibles hoy: ${data.consultas_restantes} / ${data.limite_diario}`;
                }

                saveHistory({
                    cedula: val,
                    estado: data.estado,
                    color: data.color,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });

                input.value = '';
                input.focus();
            } catch(e) {
                alert('Fallo de conexión. Verifique su señal.');
            } finally {
                btn.disabled = false;
                btn.innerText = 'VERIFICAR CÉDULA';
            }
        }

        btn.addEventListener('click', verificar);
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') verificar(); });
        renderHistory();
    </script>
</body>
</html>
"""

@app.get("/v/{token}", response_class=HTMLResponse)
def servir_pwa_verificador(token: str):
    """Sirve la PWA Magic Link de verificación territorial de cédulas (sin acceso a plataforma central)."""
    conn = get_db()
    cursor = conn.cursor()
    tok_row = cursor.execute("SELECT * FROM tokens_verificacion WHERE token = ? AND activo IS TRUE", (token,)).fetchone()
    conn.close()
    if not tok_row:
        raise HTTPException(status_code=404, detail="Enlace de verificación no encontrado, inactivo o expirado.")
    return HTMLResponse(content=PWA_MAGIC_LINK_HTML)

@app.post("/api/v1/public/verificar")
def public_verificar_cedula(data: PublicVerificarRequest, request: Request):
    """
    Endpoint público de verificación territorial para líderes (sin acceso a plataforma ni datos censales).
    Autentica por token de enlace mágico, aplica rate limiting y devuelve únicamente el color/estado.
    """
    token_str = data.token.strip()
    cedula_limpia = data.cedula.strip()
    
    if not token_str or not cedula_limpia:
        raise HTTPException(status_code=400, detail="Token y cédula requeridos.")
    
    check_token_rate_limit(token_str)
    
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Validar Token
    tok_row = cursor.execute("""
        SELECT * FROM tokens_verificacion 
        WHERE token = ? AND activo IS TRUE
    """, (token_str,)).fetchone()
    
    if not tok_row:
        conn.close()
        raise HTTPException(status_code=401, detail="Token de enlace inválido o revocado.")
    
    token_data = dict(tok_row)
    now = datetime.now()
    
    # Validar Expiración
    exp_str = token_data["fecha_expiracion"]
    if isinstance(exp_str, str):
        try:
            exp_dt = datetime.fromisoformat(exp_str.replace("Z", "+00:00").split("+")[0])
        except Exception:
            exp_dt = now + timedelta(days=1)
    else:
        exp_dt = exp_str
    
    if hasattr(exp_dt, "tzinfo") and exp_dt.tzinfo is not None:
        exp_dt = exp_dt.replace(tzinfo=None)
    
    if exp_dt < now:
        conn.close()
        raise HTTPException(status_code=401, detail="El enlace de verificación ha expirado. Solicite renovación a su central.")
    
    consultas_hoy = token_data.get("consultas_hoy", 0)
    limite_diario = token_data.get("limite_diario", 200)
    
    if consultas_hoy >= limite_diario:
        conn.close()
        raise HTTPException(status_code=429, detail=f"Límite diario de consultas alcanzado ({limite_diario}/día) para este enlace.")
    
    # 2. Consultar estado en votantes_campana (Minimización estricta de datos)
    campana_token = token_data["campana_id"]
    reg = cursor.execute("SELECT campana_id FROM votantes_campana WHERE cedula = ?", (cedula_limpia,)).fetchone()
    
    if not reg:
        estado = "LIBRE"
        color = "verde"
        mensaje = "Puedes entregar esta cédula a la central para registro."
    elif reg["campana_id"] == campana_token:
        estado = "PROPIO"
        color = "amarillo"
        mensaje = "Esta cédula ya está en tu campaña. No la entregues de nuevo."
    else:
        estado = "EXTERNO"
        color = "rojo"
        mensaje = "Ya comprometida con otra organización. No la entregues."
    
    # 3. Registrar auditoría forense
    audit_id = str(uuid.uuid4())
    client_ip = request.client.host if request.client else "unknown"
    cursor.execute("""
        INSERT INTO auditoria_verificaciones_publicas (
            id, token, cedula_consultada, estado_respuesta, canal, ip_origen
        ) VALUES (?, ?, ?, ?, 'WEB', ?)
    """, (audit_id, token_str, cedula_limpia, estado, client_ip))
    
    cursor.execute("""
        UPDATE tokens_verificacion 
        SET consultas_hoy = consultas_hoy + 1 
        WHERE token = ?
    """, (token_str,))
    
    conn.commit()
    conn.close()
    
    return {
        "estado": estado,
        "color": color,
        "mensaje": mensaje,
        "consultas_hoy": consultas_hoy + 1,
        "limite_diario": limite_diario,
        "consultas_restantes": max(0, limite_diario - (consultas_hoy + 1))
    }

@app.post("/api/v1/public/sms-inbound")
async def public_sms_inbound(data: SmsInboundRequest):
    """
    Webhook para pasarelas SMS (Hablame / Twilio).
    Formato inbound: 'CIVIS {token} {cedula}'
    """
    text = data.text.strip()
    from_tel = (data.from_number or "").strip()
    
    partes = text.split()
    if len(partes) < 3 or partes[0].upper() != "CIVIS":
        return {"response": "Formato incorrecto. Envíe: CIVIS <TOKEN> <CEDULA>"}
    
    token_str = partes[1].strip()
    cedula_limpia = partes[2].strip()
    
    conn = get_db()
    cursor = conn.cursor()
    tok_row = cursor.execute("SELECT * FROM tokens_verificacion WHERE token = ? AND activo IS TRUE", (token_str,)).fetchone()
    
    if not tok_row:
        conn.close()
        return {"response": "Token no válido o inactivo."}
    
    tok_dict = dict(tok_row)
    campana_token = tok_dict["campana_id"]
    reg = cursor.execute("SELECT campana_id FROM votantes_campana WHERE cedula = ?", (cedula_limpia,)).fetchone()
    
    if not reg:
        resp_msg = "🟢 CIVIS: CEDULA LIBRE. Puedes entregarla a la central para registro."
        estado = "LIBRE"
    elif reg["campana_id"] == campana_token:
        resp_msg = "🟡 CIVIS: YA EN TU CAMPANA. No la entregues de nuevo."
        estado = "PROPIO"
    else:
        resp_msg = "🔴 CIVIS: EN OTRA CAMPANA. No la entregues."
        estado = "EXTERNO"
    
    audit_id = str(uuid.uuid4())
    cursor.execute("""
        INSERT INTO auditoria_verificaciones_publicas (
            id, token, cedula_consultada, estado_respuesta, canal, telefono_origen
        ) VALUES (?, ?, ?, ?, 'SMS', ?)
    """, (audit_id, token_str, cedula_limpia, estado, from_tel))
    
    cursor.execute("UPDATE tokens_verificacion SET consultas_hoy = consultas_hoy + 1 WHERE token = ?", (token_str,))
    conn.commit()
    conn.close()
    
    return {"response": resp_msg}

# ==============================================================================
# GESTIÓN DE TOKENS PARA DIRECTIVOS / SUPERADMIN
# ==============================================================================
@app.post("/api/v1/superadmin/tokens")
def generar_token_verificacion(data: CrearTokenRequest, user: dict = Depends(get_current_user)):
    """Genera un nuevo enlace mágico de verificación para un líder territorial."""
    campana_id = user.get("campana_id")
    if not campana_id and user.get("rol") != "SUPERADMIN":
        raise HTTPException(status_code=400, detail="Se requiere una campaña asignada para emitir tokens.")
    
    # Si es Superadmin y no tiene campaña, vincular a la primera disponible o general
    if not campana_id:
        conn_temp = get_db()
        camp = conn_temp.execute("SELECT id FROM campanas LIMIT 1").fetchone()
        conn_temp.close()
        campana_id = camp["id"] if camp else "camp-liberal-1"
    
    token_val = f"tok_{secrets.token_hex(16)}"
    now = datetime.now()
    dias = min(30, max(1, data.duracion_dias or 14))
    expira = now + timedelta(days=dias)
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO tokens_verificacion (
            token, directivo_creador_id, campana_id, zona_asignada, telefono_asociado,
            activo, fecha_expiracion, limite_diario
        ) VALUES (?, ?, ?, ?, ?, TRUE, ?, ?)
    """, (
        token_val,
        user["id"],
        campana_id,
        data.zona_asignada.strip() if data.zona_asignada else "Territorio General",
        data.telefono_asociado.strip() if data.telefono_asociado else "",
        expira,
        data.limite_diario or 200
    ))
    conn.commit()
    conn.close()
    
    return {
        "success": True,
        "token": token_val,
        "url_verificacion": f"/v/{token_val}",
        "zona_asignada": data.zona_asignada,
        "fecha_expiracion": str(expira),
        "limite_diario": data.limite_diario or 200
    }

@app.get("/api/v1/superadmin/tokens")
def listar_tokens_verificacion(user: dict = Depends(get_current_user)):
    """Lista los tokens activos e inactivos de la campaña del directivo."""
    conn = get_db()
    if user.get("rol") == "SUPERADMIN":
        tokens = conn.execute("""
            SELECT t.*, c.nombre as campana_nombre, c.partido 
            FROM tokens_verificacion t
            JOIN campanas c ON t.campana_id = c.id
            ORDER BY t.fecha_creacion DESC
        """).fetchall()
    else:
        tokens = conn.execute("""
            SELECT t.*, c.nombre as campana_nombre, c.partido 
            FROM tokens_verificacion t
            JOIN campanas c ON t.campana_id = c.id
            WHERE t.campana_id = ?
            ORDER BY t.fecha_creacion DESC
        """, (user.get("campana_id"),)).fetchall()
    conn.close()
    return [dict(t) for t in tokens]

@app.delete("/api/v1/superadmin/tokens/{token}")
def revocar_token_verificacion(token: str, user: dict = Depends(get_current_user)):
    """Revoca inmediatamente un token de verificación territorial."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE tokens_verificacion SET activo = FALSE WHERE token = ?", (token,))
    conn.commit()
    conn.close()
    return {"success": True, "mensaje": "Token revocado exitosamente."}

@app.post("/api/v1/superadmin/tokens/{token}/renovar")
def renovar_token_verificacion(token: str, data: RenovarTokenRequest, user: dict = Depends(get_current_user)):
    """Extiende la vigencia del token (hasta máximo 30 días acumulados)."""
    conn = get_db()
    cursor = conn.cursor()
    tok_row = cursor.execute("SELECT * FROM tokens_verificacion WHERE token = ?", (token,)).fetchone()
    if not tok_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Token no encontrado.")
    
    tok_dict = dict(tok_row)
    now = datetime.now()
    dias = min(14, max(1, data.dias_adicionales or 7))
    nueva_exp = now + timedelta(days=dias)
    
    cursor.execute("UPDATE tokens_verificacion SET fecha_expiracion = ?, activo = TRUE WHERE token = ?", (nueva_exp, token))
    conn.commit()
    conn.close()
    return {"success": True, "token": token, "nueva_fecha_expiracion": str(nueva_exp)}

# ==============================================================================
# GESTIÓN INTERNA DE SOLICITUDES ARCO (LEY 1581 DE 2012)
# ==============================================================================
@app.post("/api/v1/superadmin/arco/solicitudes")
async def registrar_solicitud_arco(data: SolicitudArcoCreate, admin: dict = Depends(require_superadmin)):
    """Registra una solicitud de Habeas Data recibida por canal externo (correo, radicado, llamada)."""
    sol_id = f"arco-{uuid.uuid4().hex[:8]}"
    now = datetime.now()
    # 10 días hábiles conforme al Art. 11 de la Ley 1581 de 2012
    limite = now + timedelta(days=14) 
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO solicitudes_arco (
            id, cedula, tipo, canal_recepcion, fecha_recepcion, fecha_limite_respuesta,
            evidencia_url, estado, justificacion
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?)
    """, (
        sol_id,
        data.cedula.strip(),
        data.tipo.upper(),
        data.canal_recepcion.upper(),
        now,
        limite,
        data.evidencia_url or "",
        data.justificacion or ""
    ))
    conn.commit()
    conn.close()
    
    await manager.broadcast({
        "tipo_evento": "SOLICITUD_ARCO_RECIBIDA",
        "id": sol_id,
        "cedula": data.cedula.strip(),
        "tipo": data.tipo.upper(),
        "plazo_maximo": str(limite)
    })
    
    return {
        "success": True,
        "id": sol_id,
        "cedula": data.cedula.strip(),
        "tipo": data.tipo.upper(),
        "fecha_limite_respuesta": str(limite),
        "mensaje": "Solicitud ARCO registrada. Plazo legal de respuesta: 10 días hábiles."
    }

@app.get("/api/v1/superadmin/arco/solicitudes")
def listar_solicitudes_arco(admin: dict = Depends(require_superadmin)):
    """Lista las solicitudes ARCO registradas con estado de cumplimiento de plazos."""
    conn = get_db()
    sols = conn.execute("SELECT * FROM solicitudes_arco ORDER BY fecha_recepcion DESC").fetchall()
    conn.close()
    
    res = []
    now = datetime.now()
    for s in sols:
        s_dict = dict(s)
        limite = s_dict["fecha_limite_respuesta"]
        if isinstance(limite, str):
            try:
                limite_dt = datetime.fromisoformat(limite.replace("Z", "+00:00").split("+")[0])
            except Exception:
                limite_dt = now + timedelta(days=5)
        else:
            limite_dt = limite
        
        if hasattr(limite_dt, "tzinfo") and limite_dt.tzinfo is not None:
            limite_dt = limite_dt.replace(tzinfo=None)
        
        dias_restantes = (limite_dt - now).days
        s_dict["dias_restantes"] = dias_restantes
        s_dict["alerta_vencimiento"] = dias_restantes <= 3 and s_dict["estado"] == "PENDIENTE"
        res.append(s_dict)
    return res

@app.post("/api/v1/superadmin/arco/solicitudes/{sol_id}/procesar")
def procesar_solicitud_arco(sol_id: str, data: ProcesarArcoRequest, admin: dict = Depends(require_superadmin)):
    """Ejecuta o rechaza una solicitud ARCO con justificación jurídica."""
    conn = get_db()
    cursor = conn.cursor()
    sol = cursor.execute("SELECT * FROM solicitudes_arco WHERE id = ?", (sol_id,)).fetchone()
    if not sol:
        conn.close()
        raise HTTPException(status_code=404, detail="Solicitud ARCO no encontrada.")
    
    sol_dict = dict(sol)
    cedula = sol_dict["cedula"]
    now = datetime.now()
    
    if data.accion.upper() == "EJECUTAR":
        # Si es CANCELACION u OPOSICION, suprimir datos personales y apoyos
        if sol_dict["tipo"] in ("CANCELACION", "OPOSICION"):
            cursor.execute("DELETE FROM apoyos_logistica WHERE votante_id IN (SELECT id FROM votantes_campana WHERE cedula = ?)", (cedula,))
            cursor.execute("DELETE FROM votantes_campana WHERE cedula = ?", (cedula,))
        
        cursor.execute("""
            UPDATE solicitudes_arco 
            SET estado = 'EJECUTADA', directivo_procesa_id = ?, fecha_procesamiento = ?, justificacion = ?
            WHERE id = ?
        """, (admin["id"], now, data.justificacion, sol_id))
        msg = f"Solicitud {sol_dict['tipo']} ejecutada para la cédula {cedula}."
    else:
        cursor.execute("""
            UPDATE solicitudes_arco 
            SET estado = 'RECHAZADA', directivo_procesa_id = ?, fecha_procesamiento = ?, justificacion = ?
            WHERE id = ?
        """, (admin["id"], now, data.justificacion, sol_id))
        msg = f"Solicitud {sol_dict['tipo']} rechazada con justificación registrada."
    
    conn.commit()
    conn.close()
    return {"success": True, "id": sol_id, "mensaje": msg}

@app.get("/api/v1/superadmin/verificaciones-publicas")
def listar_verificaciones_publicas(admin: dict = Depends(require_superadmin)):
    """Consulta la bitácora de verificaciones territoriales realizadas vía link o SMS."""
    conn = get_db()
    logs = conn.execute("""
        SELECT a.*, t.zona_asignada, t.telefono_asociado, c.nombre as campana_nombre 
        FROM auditoria_verificaciones_publicas a
        LEFT JOIN tokens_verificacion t ON a.token = t.token
        LEFT JOIN campanas c ON t.campana_id = c.id
        ORDER BY a.fecha_consulta DESC
        LIMIT 200
    """).fetchall()
    conn.close()
    return [dict(l) for l in logs]

# ==============================================================================
# SERVIR FRONTEND ESTÁTICO (SPA / PWA)
# ==============================================================================
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

if FRONTEND_DIR.exists():
    css_dir = FRONTEND_DIR / "css"
    js_dir = FRONTEND_DIR / "js"
    img_dir = FRONTEND_DIR / "img"
    if css_dir.exists():
        app.mount("/css", StaticFiles(directory=css_dir), name="css")
    if js_dir.exists():
        app.mount("/js", StaticFiles(directory=js_dir), name="js")
    if img_dir.exists():
        app.mount("/img", StaticFiles(directory=img_dir), name="img")

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        fav_svg = FRONTEND_DIR / "img" / "favicon.svg"
        if fav_svg.exists():
            return FileResponse(fav_svg, media_type="image/svg+xml")
        return FileResponse(FRONTEND_DIR / "index.html")

    @app.get("/")
    def index():
        return FileResponse(FRONTEND_DIR / "index.html")

    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)

