# CIVIS v1.1 — Especificación Técnica Consolidada

> **Documento complementario a `DOCUMENTACION_COMPLETA.md` (v1.0-beta)**
> **Versión:** `v1.1-beta`
> **Alcance:** Rediseño del modelo operativo, arquitectura de verificación territorial sin acceso a plataforma, cumplimiento Ley 1581/2012 y flujo completo de cruces.
> **Marco Normativo:** Constitución Política Art. 107, Ley Estatutaria 1581 de 2012, Ley 1475 de 2011, directrices CNE.

---

## 1. Resumen de cambios respecto a v1.0-beta

| Dimensión | v1.0-beta | v1.1-beta (este documento) |
|---|---|---|
| Roles de usuario | `SUPERADMIN`, `CANDIDATO`, `LIDER` | `SUPERADMIN`, `CANDIDATO` (eliminado `LIDER`) |
| Acceso del líder territorial | Login completo en la SPA | **Sin acceso a plataforma**. Verificación vía link público + SMS. |
| Endpoints Habeas Data | Públicos `/habeas-data/*` | Eliminados. Sustituidos por endpoints internos `/superadmin/arco/*` procesados por directivos. |
| Control del votante sobre sus datos | Portal de autogestión | Sin portal. Solicitudes ARCO por canal externo, procesadas en 10 días hábiles (Ley 1581 Art. 11). |
| Detección de cruces | Notifica a ambas partes con detalle completo | Mantiene notificación bilateral pero **minimiza información expuesta al líder consultante**. |
| `consentimiento_datos` | `DEFAULT TRUE` | `DEFAULT FALSE`, `NOT NULL`, con `CHECK` que exige evidencia si es `TRUE`. |
| Tabla `alertas_cruces` | Mantiene nombre | Mantiene nombre por compatibilidad, pero doctrina reformulada como "Contacto Multipartidista Previo". |
| Canal offline para líderes | No definido | SMS gateway + PWA con cola local. |

---

## 2. Modelo operativo definitivo

### 2.1 Roles y responsabilidades

| Rol | Es usuario del sistema | Accesos |
|---|---|---|
| **SuperAdmin / Directivo (War Room)** | Sí, con login JWT | Visión total, gestión de usuarios, ARCO, auditoría, KPIs, mapa global. |
| **Candidato** | Sí, con login JWT | Scope a su campaña. Carga de listados, monitoreo, asignación logística. |
| **Líder territorial** | **No** | Recoge cédulas en físico. Verifica estado vía link público o SMS. Entrega listado a la central. |

### 2.2 Flujo operativo end-to-end

```
1. LÍDER en territorio
   ├─ Recoge cédulas en planilla física.
   ├─ Antes de entregar cada cédula, verifica vía link o SMS:
   │     🟢 LIBRE → la entrega a la central.
   │     🟡 YA EN SU CAMPAÑA → descarta (evita duplicado interno).
   │     🔴 EN OTRA CAMPAÑA → descarta (evita cruce).
   └─ Entrega listado filtrado al directivo/candidato.

2. DIRECTIVO/CANDIDATO en central
   ├─ Recibe listado físico del líder.
   ├─ Carga cada cédula vía POST /api/v1/votantes.
   ├─ Si cédula ya estaba en otra campaña:
   │     → Sistema bloquea registro.
   │     → Dispara alerta WebSocket al directivo titular original.
   │     → Registra en alertas_cruces y auditoria_intentos_duplicados.
   └─ Si cédula estaba libre: registro exitoso, queda en votantes_campana.

3. VOTANTE
   ├─ No toca el software.
   ├─ Si ejerce derechos ARCO, lo hace por canal externo
   │   (correo, escrito, llamada) a la campaña.
   └─ Directivo procesa vía /superadmin/arco/* en 10 días hábiles.
```

---

## 3. Arquitectura de verificación territorial (sin acceso a plataforma)

### 3.1 Componentes

```
┌──────────────────────────────────────────────────────────────┐
│  LÍDER EN TERRITORIO (sin login)                             │
│                                                              │
│  Vía web (con datos):                                        │
│    https://civis.camp2026.com/v/{token}                      │
│    → PWA de una sola pantalla: input cédula + botón          │
│    → Respuesta visual: 🟢 / 🟡 / 🔴                          │
│                                                              │
│  Vía SMS (sin datos, solo celular):                          │
│    SMS al shortcode 8787:                                    │
│    "CIVIS {token} {cedula}"                                  │
│    → Respuesta SMS en 2-5 segundos                           │
└──────────────────────────────────────────────────────────────┘
                     │                            │
                     │ HTTPS                      │ SMS Gateway
                     ▼                            ▼
              ┌─────────────────────────────────────────┐
              │  FastAPI Endpoint Público                │
              │  POST /api/v1/public/verificar           │
              │  POST /api/v1/public/sms-inbound         │
              │  - Sin JWT                               │
              │  - Autentica por token                   │
              │  - Rate limit 60/hora por token          │
              │  - Auditado en auditoria_verificaciones  │
              └─────────────────────────────────────────┘
                     │
                     ▼
              Backend consulta votantes_campana
              → devuelve solo color + mensaje genérico
              → NO revela partido rival, líder rival,
                nombre del votante, ni datos censales
```

### 3.2 PWA Magic Link

- **Ruta servida:** `GET /v/{token}` → HTML mínimo de una pantalla (~5KB).
- **Service Worker** cachea el shell (HTML/CSS/JS) para carga sin conexión.
- **IndexedDB** mantiene cola de verificaciones pendientes cuando no hay datos.
- **Retry automático** cuando vuelve la señal.
- **NO cachea datos de votantes** — cada verificación consulta al servidor.

### 3.3 SMS Gateway (canal offline primario)

- **Proveedor recomendado:** Hablame (Colombia) como primario, Twilio como fallback (ver justificación en §10.1).
- **Shortcode:** 8787 (a contratar con proveedor).
- **Formato inbound:** `CIVIS {token} {cedula}`.
- **Validación:** el `from` del SMS debe coincidir con `telefono_asociado` del token.
- **Respuesta outbound:** texto mínimo con emoji de color.
- **Webhook inbound:** `POST /api/v1/public/sms-inbound` recibe payload del proveedor.

---

## 4. Esquema de base de datos actualizado

### 4.1 Tabla `usuarios` (modificada)

```sql
CREATE TABLE usuarios (
    id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre_completo VARCHAR(150) NOT NULL,
    telefono VARCHAR(20),
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('SUPERADMIN', 'CANDIDATO')),
    campana_id VARCHAR(50) REFERENCES campanas(id) ON DELETE SET NULL,
    zona_asignada VARCHAR(100),
    activo BOOLEAN DEFAULT TRUE,
    mfa_enabled BOOLEAN DEFAULT FALSE,         -- nuevo: MFA obligatorio para SUPERADMIN
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Cambios:** eliminado `LIDER` del `CHECK`. Agregado `mfa_enabled`.

### 4.2 Tabla `votantes_campana` (modificada)

```sql
CREATE TABLE votantes_campana (
    id VARCHAR(50) PRIMARY KEY,
    cedula VARCHAR(20) NOT NULL,
    nombre_completo VARCHAR(150) NOT NULL,
    telefono VARCHAR(20),
    campana_id VARCHAR(50) NOT NULL REFERENCES campanas(id) ON DELETE CASCADE,
    directivo_id VARCHAR(50) NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    departamento VARCHAR(50),
    municipio VARCHAR(50),
    puesto_votacion VARCHAR(150),
    mesa INT,
    direccion_residencia VARCHAR(200),
    barrio VARCHAR(100),
    nivel_compromiso VARCHAR(20) DEFAULT 'INDECISO',
    estado_dia_d VARCHAR(20) DEFAULT 'NO_VOTO',
    es_contacto_previo BOOLEAN DEFAULT FALSE,         -- antes: es_cruce
    consentimiento_datos BOOLEAN NOT NULL DEFAULT FALSE,
    canal_consentimiento VARCHAR(50),                 -- NULL si consentimiento_datos=FALSE
    fecha_consentimiento TIMESTAMP,
    latitud DOUBLE PRECISION,
    longitud DOUBLE PRECISION,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (consentimiento_datos = TRUE
         AND canal_consentimiento IS NOT NULL
         AND fecha_consentimiento IS NOT NULL)
        OR consentimiento_datos = FALSE
    )
);

CREATE INDEX idx_votantes_cedula ON votantes_campana(cedula);
CREATE INDEX idx_votantes_campana ON votantes_campana(campana_id);
CREATE INDEX idx_votantes_directivo ON votantes_campana(directivo_id);
-- Índice único compuesto: una cédula solo puede estar una vez por campaña
CREATE UNIQUE INDEX idx_votantes_unicos_por_campana
    ON votantes_campana(cedula, campana_id);
```

**Cambios:**
- `lider_id` → `directivo_id`.
- `es_cruce` → `es_contacto_previo` (alineado con doctrina).
- `consentimiento_datos` ahora `NOT NULL DEFAULT FALSE` con `CHECK` que exige evidencia.
- `nivel_compromiso` default `'INDECISO'` (estado normal del elector libre).
- Índice único `(cedula, campana_id)` para prevenir doble registro a nivel de BD.

### 4.3 Tablas nuevas

```sql
-- Tokens de verificación para líderes (sin acceso a plataforma)
CREATE TABLE tokens_verificacion (
    token VARCHAR(64) PRIMARY KEY,
    directivo_creador_id VARCHAR(50) NOT NULL REFERENCES usuarios(id),
    campana_id VARCHAR(50) NOT NULL REFERENCES campanas(id),
    zona_asignada VARCHAR(100),
    telefono_asociado VARCHAR(20),
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_expiracion TIMESTAMP NOT NULL,
    consultas_hoy INT DEFAULT 0,
    limite_diario INT DEFAULT 200,
    fecha_ultimo_reset DATE DEFAULT CURRENT_DATE
);

CREATE INDEX idx_tokens_campana ON tokens_verificacion(campana_id);
CREATE INDEX idx_tokens_activos ON tokens_verificacion(activo) WHERE activo = TRUE;

-- Auditoría de verificaciones públicas (líderes + SMS)
CREATE TABLE auditoria_verificaciones_publicas (
    id VARCHAR(50) PRIMARY KEY,
    token VARCHAR(64) NOT NULL REFERENCES tokens_verificacion(token),
    cedula_consultada VARCHAR(20) NOT NULL,
    estado_respuesta VARCHAR(20),      -- 'LIBRE', 'PROPIO', 'EXTERNO'
    canal VARCHAR(20),                 -- 'WEB', 'SMS'
    ip_origen VARCHAR(45),
    telefono_origen VARCHAR(20),
    fecha_consulta TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auditoria_verif_token ON auditoria_verificaciones_publicas(token);
CREATE INDEX idx_auditoria_verif_cedula ON auditoria_verificaciones_publicas(cedula_consultada);

-- Solicitudes ARCO recibidas por canal externo
CREATE TABLE solicitudes_arco (
    id VARCHAR(50) PRIMARY KEY,
    cedula VARCHAR(20) NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('ACCESO','RECTIFICACION','CANCELACION','OPOSICION')),
    canal_recepcion VARCHAR(20) NOT NULL,    -- 'CORREO','ESCRITO','LLAMADA','SIC'
    fecha_recepcion TIMESTAMP NOT NULL,
    fecha_limite_respuesta TIMESTAMP NOT NULL, -- recepcion + 10 días hábiles
    evidencia_url VARCHAR(500),               -- scan del documento
    estado VARCHAR(20) DEFAULT 'PENDIENTE',   -- 'PENDIENTE','EJECUTADA','RECHAZADA'
    directivo_procesa_id VARCHAR(50) REFERENCES usuarios(id),
    fecha_procesamiento TIMESTAMP,
    justificacion TEXT
);
```

### 4.4 Tabla `alertas_cruces` (mantiene nombre, ajusta semántica)

```sql
CREATE TABLE alertas_cruces (
    id VARCHAR(50) PRIMARY KEY,
    cedula VARCHAR(20) NOT NULL,
    campana_origen_id VARCHAR(50) NOT NULL REFERENCES campanas(id),
    directivo_origen_id VARCHAR(50) NOT NULL REFERENCES usuarios(id),
    campana_nueva_id VARCHAR(50) NOT NULL REFERENCES campanas(id),
    directivo_nuevo_id VARCHAR(50) NOT NULL REFERENCES usuarios(id),
    fecha_cruce TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resuelto BOOLEAN DEFAULT FALSE,
    observaciones TEXT
);
```

**Nota:** se mantiene el nombre `alertas_cruces` por compatibilidad con código existente, pero la doctrina documental lo refiere como "Contacto Multipartidista Previo". Los campos `lider_origen_id` y `lider_nuevo_id` se renombran a `directivo_origen_id` y `directivo_nuevo_id`.

---

## 5. Catálogo API actualizado

### 5.1 Autenticación y perfil (sin cambios estructurales)
- `POST /api/v1/auth/login` — emite JWT HS256 con exp=12h. Para `SUPERADMIN`, requiere MFA TOTP si `mfa_enabled=TRUE`.

### 5.2 Endpoints públicos (sin JWT, autenticación por token)

**`POST /api/v1/public/verificar`**
```json
Request:
{ "token": "tok_a8f3b2c1d9e7...", "cedula": "1002345678" }

Response 200 (cédula libre):
{ "estado": "LIBRE", "color": "verde",
  "mensaje": "Puedes entregar esta cédula a la central para registro." }

Response 200 (cédula ya en la campaña del token):
{ "estado": "PROPIO", "color": "amarillo",
  "mensaje": "Esta cédula ya está en tu campaña. No la entregues de nuevo." }

Response 200 (cédula en otra campaña):
{ "estado": "EXTERNO", "color": "rojo",
  "mensaje": "Ya comprometida con otra organización. No la entregues." }

Response 429: { "error": "Límite excedido. Intenta en N minutos." }
Response 401: { "error": "Token inválido o expirado." }
```

**`POST /api/v1/public/sms-inbound`** — webhook del proveedor SMS.
```json
Request (varía según proveedor; ejemplo Hablame):
{ "from": "+573001234567", "text": "CIVIS tok_a8f3... 1002345678" }

Lógica:
1. Validar from == tokens_verificacion.telefono_asociado
2. Parsear token y cédula
3. Ejecutar verificación
4. Responder SMS outbound: "🟢 LIBRE" / "🟡 YA EN TU CAMPAÑA" / "🔴 EN OTRA - NO ENTREGUES"
```

### 5.3 Operativa electoral (cambios menores)
- `GET /api/v1/censo/{cedula}` — sin cambios. Rate limit 45 RPM.
- `GET /api/v1/votantes/verificar/{cedula}` — **modificado**: ya no devuelve `partido_origen` ni `lider_origen` al consultante. Solo booleano de estado.
- `POST /api/v1/votantes` — requiere `consentimiento_datos=TRUE` y `canal_consentimiento` válido. Si `FALSE`, rechaza con 400.
- `GET /api/v1/votantes/mis-votantes` — sin cambios.

### 5.4 Endpoints internos ARCO (reemplazan a `/habeas-data/*` públicos)
- `POST /api/v1/superadmin/arco/solicitudes` — registra solicitud ARCO recibida por canal externo.
- `GET /api/v1/superadmin/arco/solicitudes` — lista solicitudes pendientes/procesadas.
- `POST /api/v1/superadmin/arco/solicitudes/{id}/procesar` — ejecuta o rechaza, registra justificación.
- `GET /api/v1/superadmin/arco/solicitudes/vencidas` — alerta de solicitudes cerca del plazo de 10 días.

### 5.5 Endpoints de gestión de tokens
- `POST /api/v1/superadmin/tokens` — directivo genera nuevo token para un líder.
  - Body: `{ telefono_asociado, zona_asignada, duracion_dias }`
  - Retorna: `{ token, url_verificacion, fecha_expiracion }`
- `GET /api/v1/superadmin/tokens` — lista tokens activos.
- `DELETE /api/v1/superadmin/tokens/{token}` — revoca token inmediatamente.
- `POST /api/v1/superadmin/tokens/{token}/renovar` — extiende expiración.

### 5.6 Centro de mando (sin cambios estructurales)
- `GET /api/v1/superadmin/kpis`
- `GET /api/v1/superadmin/cruces` — ahora muestra "Contactos Multipartidistas Previos".
- `GET /api/v1/superadmin/padron-general`
- `GET /api/v1/superadmin/mapa-puntos`
- `GET /api/v1/superadmin/usuarios`
- `POST /api/v1/superadmin/usuarios`
- `DELETE /api/v1/superadmin/usuarios/{id}` — solo baja lógica (`activo=FALSE`).
- `PUT /api/v1/superadmin/usuarios/{id}/toggle-activo`
- `PUT /api/v1/superadmin/usuarios/{id}/restablecer-password`
- `GET /api/v1/superadmin/auditoria-intentos`
- `GET /api/v1/superadmin/verificaciones-publicas` — auditoría de verificaciones de líderes.

### 5.7 WebSocket
- `wss://<host>/ws/superadmin` — autenticación con JWT en primer mensaje tras conectar.
- Eventos: `ALERTA_CRUCE`, `VERIFICACION_PUBLICA`, `SOLICITUD_ARCO_RECIBIDA`.

---

## 6. Flujo completo de cruces (notificación bilateral minimizada)

### 6.1 Tabla de eventos y respuestas

| Evento | Quién lo dispara | Qué ve el consultante | Qué ve el titular original | Qué ve SuperAdmin |
|---|---|---|---|---|
| Líder verifica cédula vía link/SMS | Endpoint público `/verificar` | Solo color 🟢/🟡/🔴 + mensaje genérico | **No se notifica** (no es intento de registro) | Auditoría silenciosa |
| Directivo carga cédula que ya está en otra campaña | `POST /api/v1/votantes` | n/a | **WebSocket push completo** con partido y líder del intento | Alerta en vivo + entrada en `alertas_cruces` |
| Directivo carga cédula que ya está en su propia campaña | `POST /api/v1/votantes` | n/a | Rechazo 409 + mensaje "ya en tu campaña" | Auditoría de intento duplicado interno |
| Ciudadano envía solicitud ARCO externa | Directivo la registra | n/a | n/a | Notificación WebSocket `SOLICITUD_ARCO_RECIBIDA` + plazo de 10 días |

### 6.2 Payload de la alerta de cruce (al directivo titular original)

```json
{
  "tipo": "ALERTA_CONTACTO_MULTIPARTIDISTA",
  "cedula": "1002345678",
  "votante": "Juan Carlos Pérez",
  "campana_origen": "Partido Liberal",
  "directivo_origen": "Rosa Murillo",
  "campana_nueva": "Partido Conservador",
  "directivo_nuevo": "Carlos Gómez",
  "estado_registro": "BLOQUEADO",
  "timestamp": "2026-11-12T15:42:00Z"
}
```

**Solo el directivo titular original y el SuperAdmin ven este payload completo.** El directivo que intentó registrar recibe un 409 genérico sin identificar al partido rival.

### 6.3 Mecanismo de salida del votante

Dado que el votante no tiene portal, el flujo de salida es:

1. Votante envía solicitud ARCO (cancelación) por correo/escrito a la campaña.
2. Directivo registra en `/superadmin/arco/solicitudes`.
3. Directivo procesa: marca `consentimiento_datos=FALSE`, `fecha_procesamiento=NOW()`.
4. Sistema marca la cédula como liberada para nueva vinculación.
5. Si otra campaña intenta registrar la cédula, ahora el sistema lo permite.
6. Plazo legal máximo: 10 días hábiles (Art. 11 Ley 1581).

---

## 7. Configuración de entorno `.env` actualizada

```ini
# === Base de datos ===
DATABASE_URL=postgresql://<user>:<pass>@<host>/<db>?sslmode=require
ALLOW_SQLITE_FALLBACK=false

# === JWT ===
JWT_SECRET=generar_clave_segura_con_openssl_rand_hex_32
JWT_EXPIRATION_SECONDS=43200

# === Rate limiting ===
MAX_CENSO_RPM=45
MAX_VERIFICACIONES_PUBLICAS_RPM=60

# === SMS Gateway ===
SMS_PROVIDER=hablame                    # hablame | twilio | infobip
SMS_SHORTCODE=8787
SMS_HABLAME_API_KEY=...
SMS_HABLAME_URL=https://api.hablame.co
SMS_FALLBACK_PROVIDER=twilio            # activo si el primario falla
SMS_TWILIO_ACCOUNT_SID=...
SMS_TWILIO_AUTH_TOKEN=...
SMS_TWILIO_FROM=+57300XXXXXXX

# === Tokens de verificación ===
TOKEN_VERIFICACION_DURACION_DIAS=14
TOKEN_VERIFICACION_LIMITE_DIARIO=200
TOKEN_VERIFICACION_MAX_RENOVACIONES=3
TOKEN_VERIFICACION_DURACION_MAXIMA_DIAS=30

# === MFA ===
MFA_OBLIGATORIO_ROLES=SUPERADMIN       # roles que requieren TOTP

# === Redis (multi-nodo) ===
# REDIS_URL=redis://default:<token>@<host>:<port>

# === Puerto HTTP ===
PORT=8000
```

---

## 8. Seguridad

### 8.1 Endurecimiento aplicado
- **JWT HS256** con expiración estricta 12h, claims `sub`, `rol`, `iat`, `exp`.
- **MFA TOTP** obligatorio para `SUPERADMIN` (configurable para `CANDIDATO`).
- **Rate limiting** en endpoints sensibles:
  - `/api/v1/censo/{cedula}` — 45 RPM por usuario.
  - `/api/v1/public/verificar` — 60/hora por token; 200/día por token.
- **Fail-fast SQLite**: `ALLOW_SQLITE_FALLBACK=false` por defecto. Sin split-brain.
- **`.env` en `.gitignore`**. Sin credenciales en repo.
- **Cifrado en tránsito** SSL forzado. **Cifrado en reposo** a nivel columna para `cedula`, `telefono`, `latitud`, `longitud` (pendiente de implementar — ver §11).
- **Auditoría completa**: verificaciones públicas, intentos duplicados, alertas de cruce, solicitudes ARCO.

### 8.2 Mitigación de enumeración
- El endpoint `/api/v1/public/verificar` devuelve solo color, sin nombres ni partidos.
- Tokens con límite diario estricto (200 consultas/día).
- Posible adición de CAPTCHA si se detecta patrón de enumeración (umbral configurable).

### 8.3 Pendiente de implementar
- **Cifrado columna** con `pgcrypto` para `cedula`, `telefono`, coordenadas GPS.
- **CSP y security headers** en respuestas HTTP.
- **Penetration testing** externo antes de go-live.
- **Política de retención post-elección**: definición de plazo para anonimización/borrado de `votantes_campana` una vez finalizada la jornada.

---

## 9. Cumplimiento legal (Ley 1581 de 2012)

### 9.1 Fundamento normativo
- **Art. 5**: datos políticos son sensibles.
- **Art. 6**: consentimiento previo, expreso e informado del titular.
- **Art. 8**: derechos de acceso, rectificación, cancelación, oposición (ARCO).
- **Art. 11**: respuesta a solicitudes ARCO en máximo 10 días hábiles.
- **Art. 15**: deber de seguridad — implementar medidas técnicas razonables.
- **Art. 107 C.P.**: libertad de sufragio y multipartidismo.

### 9.2 Implementación en CIVIS
- `consentimiento_datos BOOLEAN NOT NULL DEFAULT FALSE` con `CHECK` que exige `canal_consentimiento` y `fecha_consentimiento` si es `TRUE`.
- Sin portal de autogestión del votante (decisión de producto), pero **procedimiento interno documentado** para atender ARCO en plazo legal.
- Auditoría forense de solicitudes ARCO con plazos y justificaciones.
- Doctrina reformulada: `INDECISO` es el estado normal del votante libre; "cruce" → "contacto multipartidista previo".
- Notificación al votante por canal externo cuando se recibe solicitud ARCO (acuse de recibo).

### 9.3 Documentación que debe mantener la campaña (externa al software)
- Registro ante el Registro Nacional de Bases de Datos (RNBD) de la SIC.
- Política de tratamiento de datos pública.
- Persona responsable del tratamiento de datos (DPO).
- Procedimiento de atención de solicitudes ARCO por canal externo.
- Contratos de encargado con proveedores (Neon, Redis, SMS gateway).

---

## 10. Respuestas a las decisiones operativas pendientes

### 10.1 SMS Gateway — Recomendación: Hablame primario + Twilio fallback

**Justificación:**

| Criterio | Hablame | Twilio | Infobip |
|---|---|---|---|
| Costo por SMS Colombia | ~$20-30 COP | ~$50-80 COP | ~$35-50 COP |
| Relaciones directas con carriers locales | Sí | No (vía interconexión) | Parcial |
| Latencia en zonas rurales | Baja (carriers locales) | Media | Media |
| Calidad de API | Aceptable | Excelente | Buena |
| Soporte en español | Nativo | Limitado | Sí |
| Estabilidad global | Media | Muy alta | Alta |
| Capacidad de volumen alto | Sí con contrato | Sí | Sí |

**Decisión recomendada:**
- **Primario:** Hablame. Costo 10.000 SMS/día × $25 = $250.000 COP/día vs. $600.000 COP/día de Twilio. Para una campaña de 60 días, ahorro ≈ $21M COP.
- **Fallback automático:** Twilio. Si Hablame no entrega en 10 segundos, reintentar por Twilio. Costo solo en casos de falla.
- **Shortcode 8787:** contratar directamente con Hablame; proceso toma ~3 semanas ante CRC.

**Riesgo a mitigar:** Hablame es empresa más pequeña. Exige en contrato SLA del 99% y derecho a auditoría. Ten el plan de migración a Twilio documentado.

### 10.2 Caducidad del token — Recomendación: 14 días renovable, máximo 30 días

**Justificación:**

| Duración | Pros | Contras |
|---|---|---|
| 7 días | Alta rotación de seguridad | Fricción operativa alta para directivos (re-emisión constante) |
| **14 días** | **Balance: seguridad + operación** | Re-emisión cada 2 semanas |
| 30 días | Baja fricción | Token comprometido puede usarse 1 mes |
| Sin caducidad | Cero fricción | Inaceptable desde seguridad |

**Decisión recomendada:**
- **Duración inicial:** 14 días desde la emisión.
- **Renovación automática:** si el token se usa en las últimas 24h antes de expirar, se extiende 7 días más (hasta máximo 30 días desde la emisión original).
- **Límite duro:** 30 días desde creación. Después, obligatorio re-emisión con validación del directivo.
- **Revocación manual:** el directivo puede revocar anytime (líder se retira de la campaña, teléfono robado, etc.).
- **Configurable vía `.env`:** `TOKEN_VERIFICACION_DURACION_DIAS=14`.

**Riesgo a mitigar:** si un teléfono del líder se roba, el token sigue activo hasta 14 días. Por eso el rate limit diario (200) acota el daño.

### 10.3 Histórico de verificaciones del líder — Recomendación: últimas 20 verificaciones en sesión local, sin sync

**Justificación:**

| Opción | Pros | Contras |
|---|---|---|
| Sin histórico | Máxima privacidad | Líder no sabe si ya verificó una cédula (verifica dos veces) |
| Última respuesta solo | Simple | Líder no puede diferenciar cédulas ya chequeadas hoy |
| **Últimas 20 en sesión local** | **Permite "ya verifiqué esta" sin sync** | Limitado pero suficiente |
| Histórico completo en la nube | Operativamente útil | Líder podría reconstruir patrones; viola minimización |
| Histórico completo en dispositivo | Sin sync | Si roban teléfono, filtran patrón de verificación |

**Decisión recomendada:**
- **PWA (IndexedDB):** guarda las últimas 20 verificaciones de la sesión actual con `{cedula, estado, timestamp}`.
- **No se sincroniza** con la nube desde la PWA. La auditoría completa vive en el servidor (`auditoria_verificaciones_publicas`) accesible solo a directivos.
- **Limpieza automática:** al cerrar la sesión del navegador o tras 24h, se borra el IndexedDB local.
- **Sin acceso del líder a su propio histórico vía API** — por diseño, el líder no puede consultar "todas las cédulas que he verificado". Eso reduce el valor de un token comprometido.

**Riesgo a mitigar:** si el líder necesita verificar la misma cédula dos veces (re-verificación después de unas horas), puede hacerlo. El sistema no bloquea re-verificaciones dentro del rate limit.

---

## 11. Lo que falta decidir / implementar

| Item | Estado | Owner |
|---|---|---|
| Contratación shortcode 8787 con Hablame | Pendiente | Directivo de campaña |
| Cifrado columna con `pgcrypto` | Pendiente implementar | Dev backend |
| MFA TOTP para SUPERADMIN | Pendiente implementar | Dev backend |
| Política de retención post-elección | Pendiente definir | Legal + Dev |
| Penetration testing externo | Pendiente contratar | Directivo |
| Registro RNBD ante SIC | Pendiente | Legal |
| Política de tratamiento de datos pública | Pendiente redactar | Legal |
| Designación DPO | Pendiente | Directivo |
| Migración de campos renombrados (`lider_id` → `directivo_id`, `es_cruce` → `es_contacto_previo`) | Pendiente script SQL | Dev backend |
| Renombrar endpoint `/votantes/verificar/{cedula}` para no exponer partido rival | Pendiente implementar | Dev backend |
| Documentación de procedimiento ARCO externo | Pendiente redactar | Legal + Directivo |

---

## 12. Próximos pasos sugeridos

1. **Aprobar las 3 decisiones operativas** de la §10 (Hablame+Twilio, 14 días, últimas 20 local).
2. **Encargar a desarrollo backend** la implementación de:
   - Schema migrations (§4).
   - Endpoint público `/api/v1/public/verificar`.
   - Renombramiento de campos.
   - Cifrado columna.
   - MFA TOTP.
3. **Encargar a legal** la redacción de:
   - Política de tratamiento de datos.
   - Procedimiento ARCO externo.
   - Registro RNBD.
4. **Contratar Hablame + shortcode** (lead time ~3 semanas).
5. **Penetration testing** antes de cualquier prueba con líderes reales en territorio.
6. **Revisión final** de esta especificación con un abogado experto en datos personales y derecho electoral.

---

*Documento generado como especificación técnica consolidada. No constituye asesoría jurídica; la implementación final debe validarse con un abogado experto en protección de datos personales y derecho electoral colombiano.*
