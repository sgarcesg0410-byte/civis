import os
import sys
import sqlite3
import re
from pathlib import Path
from dotenv import load_dotenv

# Asegurar codificación segura de salida en Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Cargar variables de entorno desde .env si existe
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

DB_PATH = BASE_DIR / "electoral.db"
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

# Normalizar URLs con formato antiguo (postgres:// -> postgresql://)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

IS_POSTGRES = DATABASE_URL.startswith("postgresql://")

# Pool global de conexiones para PostgreSQL
pg_pool = None

if IS_POSTGRES:
    try:
        import psycopg2
        from psycopg2 import pool
        from psycopg2.extras import RealDictCursor
        
        # Iniciar pool de conexiones seguras (1 a 20 conexiones concurrentes)
        pg_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=20,
            dsn=DATABASE_URL
        )
        print(" [Civis DB] Conectado exitosamente a PostgreSQL Administrado en la nube (Pool activo).")
    except Exception as e:
        print(f"⚠️ [Civis DB] Error al conectar con PostgreSQL ({e}). Usando SQLite local como respaldo.")
        IS_POSTGRES = False


# ==============================================================================
# ADAPTADORES TRANSPARENTES PARA POSTGRESQL (MANTIENE COMPATIBILIDAD CON MAIN.PY)
# ==============================================================================
class PostgresCursorWrapper:
    """Envuelve el cursor de psycopg2 para emular la interfaz de sqlite3 en FastAPI."""
    def __init__(self, raw_cursor, conn_wrapper):
        self._raw = raw_cursor
        self._conn = conn_wrapper

    def _convert_query(self, query: str) -> str:
        # Convierte marcadores '?' de SQLite a '%s' de PostgreSQL de forma segura
        return query.replace("?", "%s")

    def execute(self, query: str, params=None):
        sql = self._convert_query(query)
        if params is not None:
            # Asegurar que params sea tupla o lista
            if not isinstance(params, (tuple, list)):
                params = tuple(params)
            self._raw.execute(sql, params)
        else:
            self._raw.execute(sql)
        return self  # Permite encadenar .execute().fetchone()

    def executemany(self, query: str, seq_of_params):
        sql = self._convert_query(query)
        self._raw.executemany(sql, seq_of_params)
        return self

    def fetchone(self):
        row = self._raw.fetchone()
        if row is None:
            return None
        return dict(row)

    def fetchall(self):
        rows = self._raw.fetchall()
        return [dict(r) for r in rows]

    def fetchmany(self, size=None):
        rows = self._raw.fetchmany(size) if size else self._raw.fetchmany()
        return [dict(r) for r in rows]

    @property
    def rowcount(self):
        return self._raw.rowcount

    @property
    def description(self):
        return self._raw.description

    def close(self):
        self._raw.close()

    def __iter__(self):
        for row in self._raw:
            yield dict(row)


class PostgresConnectionWrapper:
    """Envuelve la conexión de psycopg2 para devolver conexiones al pool de forma transparente."""
    def __init__(self, raw_conn, pool_ref):
        self._conn = raw_conn
        self._pool = pool_ref
        self._closed = False

    def cursor(self):
        from psycopg2.extras import RealDictCursor
        raw_cur = self._conn.cursor(cursor_factory=RealDictCursor)
        return PostgresCursorWrapper(raw_cur, self)

    def execute(self, query: str, params=None):
        cur = self.cursor()
        return cur.execute(query, params)

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        if not self._closed:
            self._closed = True
            if self._pool:
                self._pool.putconn(self._conn)
            else:
                self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.rollback()
        else:
            self.commit()
        self.close()


# ==============================================================================
# OBTENCIÓN DE CONEXIÓN (GET_DB)
# ==============================================================================
def get_db():
    """Retorna una conexión activa (PostgreSQL Administrado o SQLite local)."""
    global IS_POSTGRES, pg_pool
    if IS_POSTGRES and pg_pool:
        raw_conn = pg_pool.getconn()
        return PostgresConnectionWrapper(raw_conn, pg_pool)
    
    # Modo Local SQLite
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


# ==============================================================================
# INICIALIZACIÓN DE ESQUEMA E ÍNDICES DE ALTO RENDIMIENTO
# ==============================================================================
def init_db():
    """Inicializa tablas e índices de alto rendimiento en PostgreSQL o SQLite."""
    conn = get_db()
    cursor = conn.cursor()

    if IS_POSTGRES:
        print("⚡ [Civis DB] Configurando esquema e índices optimizados en PostgreSQL...")
        
        # 1. Tablas en PostgreSQL
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS censo_electoral (
            cedula VARCHAR(30) PRIMARY KEY,
            nombres VARCHAR(120) NOT NULL,
            apellidos VARCHAR(120) NOT NULL,
            departamento VARCHAR(100) NOT NULL,
            municipio VARCHAR(100) NOT NULL,
            puesto_votacion VARCHAR(255) NOT NULL,
            direccion_puesto VARCHAR(255) NOT NULL,
            mesa INTEGER NOT NULL,
            latitud DOUBLE PRECISION,
            longitud DOUBLE PRECISION
        );

        CREATE TABLE IF NOT EXISTS campanas (
            id VARCHAR(50) PRIMARY KEY,
            nombre_candidato VARCHAR(150) NOT NULL,
            partido VARCHAR(100) NOT NULL,
            color_distintivo VARCHAR(20) DEFAULT '#CC0000',
            cargo_aspirado VARCHAR(100) NOT NULL,
            municipio VARCHAR(100) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS usuarios (
            id VARCHAR(50) PRIMARY KEY,
            campana_id VARCHAR(50),
            cedula VARCHAR(30) NOT NULL,
            nombre_completo VARCHAR(150) NOT NULL,
            telefono VARCHAR(50),
            username VARCHAR(80) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            rol VARCHAR(50) NOT NULL,
            zona_barrio VARCHAR(150),
            activo INTEGER DEFAULT 1,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS votantes_campana (
            id VARCHAR(50) PRIMARY KEY,
            campana_id VARCHAR(50) NOT NULL,
            lider_id VARCHAR(50) NOT NULL,
            cedula VARCHAR(30) NOT NULL,
            telefono VARCHAR(50),
            barrio_direccion VARCHAR(255),
            compromiso VARCHAR(50) DEFAULT 'SEGURO',
            estado_dia_d VARCHAR(50) DEFAULT 'PENDIENTE',
            observaciones TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
            FOREIGN KEY (lider_id) REFERENCES usuarios(id) ON DELETE CASCADE,
            UNIQUE (campana_id, cedula)
        );

        CREATE TABLE IF NOT EXISTS alertas_cruces (
            id VARCHAR(50) PRIMARY KEY,
            cedula VARCHAR(30) NOT NULL,
            campana_origen_id VARCHAR(50) NOT NULL,
            campana_conflicto_id VARCHAR(50) NOT NULL,
            lider_origen_id VARCHAR(50),
            lider_conflicto_id VARCHAR(50),
            tipo_cruce VARCHAR(100) NOT NULL,
            fecha_deteccion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            resuelto INTEGER DEFAULT 0,
            FOREIGN KEY (campana_origen_id) REFERENCES campanas(id),
            FOREIGN KEY (campana_conflicto_id) REFERENCES campanas(id)
        );

        CREATE TABLE IF NOT EXISTS apoyos_logistica (
            id VARCHAR(50) PRIMARY KEY,
            campana_id VARCHAR(50) NOT NULL,
            lider_id VARCHAR(50) NOT NULL,
            votante_cedula VARCHAR(30) NOT NULL,
            tipo_apoyo VARCHAR(100) NOT NULL,
            valor_economico DOUBLE PRECISION DEFAULT 0.0,
            descripcion TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
            FOREIGN KEY (lider_id) REFERENCES usuarios(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS auditoria_intentos_duplicados (
            id VARCHAR(50) PRIMARY KEY,
            cedula VARCHAR(30) NOT NULL,
            nombre_votante VARCHAR(150),
            puesto_mesa VARCHAR(255),
            operador_nombre VARCHAR(150) NOT NULL,
            operador_username VARCHAR(80),
            operador_rol VARCHAR(50),
            operador_partido VARCHAR(100),
            propietario_nombre VARCHAR(150),
            propietario_partido VARCHAR(100),
            telefono_notificado VARCHAR(50),
            tipo_evento VARCHAR(100) NOT NULL,
            accion_tomada VARCHAR(100) NOT NULL,
            fecha_hora TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );

        -- 2. Índices de Alto Rendimiento para Millones de Registros
        CREATE INDEX IF NOT EXISTS idx_censo_cedula ON censo_electoral(cedula);
        CREATE INDEX IF NOT EXISTS idx_censo_mpio_puesto ON censo_electoral(municipio, puesto_votacion);
        CREATE INDEX IF NOT EXISTS idx_censo_apellidos_nombres ON censo_electoral(apellidos, nombres);
        CREATE INDEX IF NOT EXISTS idx_votantes_campana_cedula ON votantes_campana(campana_id, cedula);
        CREATE INDEX IF NOT EXISTS idx_votantes_lider ON votantes_campana(lider_id);
        CREATE INDEX IF NOT EXISTS idx_alertas_cedula ON alertas_cruces(cedula);
        CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria_intentos_duplicados(fecha_hora DESC);
        CREATE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username);
        """)
        conn.commit()

        # Verificar si hay que poblar datos iniciales
        cursor.execute("SELECT COUNT(*) as total FROM usuarios")
        res = cursor.fetchone()
        total_usr = res.get("total", 0) if isinstance(res, dict) else res[0]

        if total_usr == 0:
            print("🌱 [Civis DB] Poblando datos iniciales en PostgreSQL...")
            poblar_datos_semilla(cursor, is_pg=True)
            conn.commit()

    else:
        # Modo SQLite
        cursor.executescript("""
        CREATE TABLE IF NOT EXISTS censo_electoral (
            cedula TEXT PRIMARY KEY,
            nombres TEXT NOT NULL,
            apellidos TEXT NOT NULL,
            departamento TEXT NOT NULL,
            municipio TEXT NOT NULL,
            puesto_votacion TEXT NOT NULL,
            direccion_puesto TEXT NOT NULL,
            mesa INTEGER NOT NULL,
            latitud REAL,
            longitud REAL
        );

        CREATE TABLE IF NOT EXISTS campanas (
            id TEXT PRIMARY KEY,
            nombre_candidato TEXT NOT NULL,
            partido TEXT NOT NULL,
            color_distintivo TEXT DEFAULT '#CC0000',
            cargo_aspirado TEXT NOT NULL,
            municipio TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS usuarios (
            id TEXT PRIMARY KEY,
            campana_id TEXT,
            cedula TEXT NOT NULL,
            nombre_completo TEXT NOT NULL,
            telefono TEXT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            rol TEXT NOT NULL,
            zona_barrio TEXT,
            activo INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS votantes_campana (
            id TEXT PRIMARY KEY,
            campana_id TEXT NOT NULL,
            lider_id TEXT NOT NULL,
            cedula TEXT NOT NULL,
            telefono TEXT,
            barrio_direccion TEXT,
            compromiso TEXT DEFAULT 'SEGURO',
            estado_dia_d TEXT DEFAULT 'PENDIENTE',
            observaciones TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
            FOREIGN KEY (lider_id) REFERENCES usuarios(id) ON DELETE CASCADE,
            UNIQUE (campana_id, cedula)
        );

        CREATE TABLE IF NOT EXISTS alertas_cruces (
            id TEXT PRIMARY KEY,
            cedula TEXT NOT NULL,
            campana_origen_id TEXT NOT NULL,
            campana_conflicto_id TEXT NOT NULL,
            lider_origen_id TEXT,
            lider_conflicto_id TEXT,
            tipo_cruce TEXT NOT NULL,
            fecha_deteccion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resuelto INTEGER DEFAULT 0,
            FOREIGN KEY (campana_origen_id) REFERENCES campanas(id),
            FOREIGN KEY (campana_conflicto_id) REFERENCES campanas(id)
        );

        CREATE TABLE IF NOT EXISTS apoyos_logistica (
            id TEXT PRIMARY KEY,
            campana_id TEXT NOT NULL,
            lider_id TEXT NOT NULL,
            votante_cedula TEXT NOT NULL,
            tipo_apoyo TEXT NOT NULL,
            valor_economico REAL DEFAULT 0.0,
            descripcion TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
            FOREIGN KEY (lider_id) REFERENCES usuarios(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS auditoria_intentos_duplicados (
            id TEXT PRIMARY KEY,
            cedula TEXT NOT NULL,
            nombre_votante TEXT,
            puesto_mesa TEXT,
            operador_nombre TEXT NOT NULL,
            operador_username TEXT,
            operador_rol TEXT,
            operador_partido TEXT,
            propietario_nombre TEXT,
            propietario_partido TEXT,
            telefono_notificado TEXT,
            tipo_evento TEXT NOT NULL,
            accion_tomada TEXT NOT NULL,
            fecha_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_censo_cedula ON censo_electoral(cedula);
        CREATE INDEX IF NOT EXISTS idx_censo_mpio ON censo_electoral(municipio);
        CREATE INDEX IF NOT EXISTS idx_votantes_campana_cedula ON votantes_campana(campana_id, cedula);
        """)
        conn.commit()

        cursor.execute("SELECT COUNT(*) as total FROM censo_electoral WHERE cedula = '1063165499'")
        falta_cedula = cursor.fetchone()["total"] == 0

        cursor.execute("SELECT COUNT(*) as total FROM usuarios WHERE username = 'candidata.la-u'")
        falta_partido_u = cursor.fetchone()["total"] == 0

        if falta_cedula or falta_partido_u:
            poblar_datos_semilla(cursor, is_pg=False)
            conn.commit()

    conn.close()


def poblar_datos_semilla(cursor, is_pg=False):
    """Inserta datos electorales oficiales de SAN ANTERO, CÓRDOBA con todos sus corregimientos y veredas."""
    
    censos_san_antero = [
        ('1063165499', 'Sebastián', 'Martínez Gómez', 'Córdoba', 'San Antero', 'I.E. San Antero - Sede Principal', 'Calle Central # 15-20', 7, 9.3739, -75.7600),
        ('1063889900', 'Dairo José', 'Peñata Polo', 'Córdoba', 'San Antero', 'I.E. José Antonio Galán', 'Carrera 8 # 12-45', 5, 9.3780, -75.7580),
        ('1005112233', 'Carlos Mario', 'Reyes Pacheco', 'Córdoba', 'San Antero', 'I.E. San Antero - Sede Principal', 'Calle Central # 15-20', 3, 9.3739, -75.7600),
        ('1002345678', 'Pedro Antonio', 'Martínez Gómez', 'Córdoba', 'San Antero', 'I.E. El Porvenir (Zona Costera)', 'Sector Playa El Porvenir', 2, 9.4050, -75.7480),
        ('1007445566', 'Rosa Elena', 'Duque Herrera', 'Córdoba', 'San Antero', 'I.E. El Porvenir (Zona Costera)', 'Sector Muelle El Porvenir', 4, 9.4050, -75.7480),
        ('1003456789', 'Luis Fernando', 'Morales Soto', 'Córdoba', 'San Antero', 'I.E. Santa Rosa del Volcán', 'Vía Principal al Volcán de Lodo', 1, 9.3550, -75.7520),
        ('1003987654', 'Ana Milena', 'Suárez Vargas', 'Córdoba', 'San Antero', 'I.E. Rural El Bijao', 'Corregimiento El Bijao', 4, 9.3300, -75.7800),
        ('1009887766', 'Javier Andrés', 'Castaño Ortiz', 'Córdoba', 'San Antero', 'I.E. Tijeretas', 'Vía Principal Tijeretas', 2, 9.3150, -75.7600),
        ('50890123', 'Marta Cecilia', 'López Rivera', 'Córdoba', 'San Antero', 'Centro Educativo San Rafael', 'Corregimiento San Rafael', 2, 9.3800, -75.7850),
        ('15432987', 'Jorge Eliécer', 'Gaitán Moreno', 'Córdoba', 'San Antero', 'Puesto Punta Bolívar / Playa Blanca', 'Sector Punta Bolívar', 1, 9.4180, -75.7250),
        ('1063223344', 'Camila Andrea', 'Polo Díaz', 'Córdoba', 'San Antero', 'Escuela Rural Las Nubes', 'Vereda Las Nubes', 1, 9.3400, -75.7350),
        ('1063556677', 'Mateo David', 'Ramos Sierra', 'Córdoba', 'San Antero', 'Escuela Rural La América', 'Vereda La América', 1, 9.3250, -75.7400),
        ('1063991122', 'Luz Dary', 'Herrera Buelvas', 'Córdoba', 'San Antero', 'Escuela Rural El Reposo', 'Vereda El Reposo', 1, 9.3500, -75.7700),
        ('1063774411', 'Ever José', 'Palencia Correa', 'Córdoba', 'San Antero', 'Escuela Rural Caño Grande', 'Vereda Caño Grande', 1, 9.3600, -75.7900)
    ]

    campanas = [
        ('camp-01', 'Dr. Roberto Mendoza', 'Partido Liberal', '#CC0000', 'Alcaldía Municipal', 'San Antero'),
        ('camp-02', 'Ing. Gabriel Montoya', 'Partido Conservador', '#0033A0', 'Alcaldía Municipal', 'San Antero'),
        ('camp-03', 'Dra. María Patricia Cruz', 'Partido de la U', '#FF8200', 'Concejo Municipal', 'San Antero')
    ]

    usuarios = [
        ('usr-admin-1', None, '1063165499', 'Sebastián - Administrador General & Propietario', '3001112233', 'superadmin', '123456', 'SUPERADMIN', 'San Antero - Comando Central'),
        ('usr-admin-2', None, '1000000002', 'Ing. Carlos Restrepo (Auditor General de Datos)', '3102223344', 'admin.carlos', '123456', 'SUPERADMIN', 'Auditoría Técnica'),
        ('usr-admin-3', None, '1000000003', 'Dra. Claudia Gómez (Coordinadora Electoral)', '3153334455', 'admin.claudia', '123456', 'SUPERADMIN', 'Monitoreo CNE'),
        ('usr-cand-lib', 'camp-01', '1000000010', 'Dr. Roberto Mendoza (Candidato Alcaldía)', '3104567890', 'candidato.liberal', '123456', 'CANDIDATO', 'San Antero Cabecera'),
        ('usr-lider-lib', 'camp-01', '1000000011', 'Rosaura Benítez (Líder Liberal)', '3157891234', 'lider.rosa', '123456', 'LIDER', 'Corregimiento El Porvenir'),
        ('usr-cand-con', 'camp-02', '1000000020', 'Ing. Gabriel Montoya (Candidato Alcaldía)', '3119876543', 'candidato.conservador', '123456', 'CANDIDATO', 'San Antero Rural'),
        ('usr-lider-con', 'camp-02', '1000000021', 'Carlos Meza (Líder Conservador)', '3182233445', 'lider.carlos', '123456', 'LIDER', 'Santa Rosa del Volcán'),
        ('usr-cand-u', 'camp-03', '1000000030', 'Dra. María Patricia Cruz (Candidata Concejo)', '3135557788', 'candidata.la-u', '123456', 'CANDIDATO', 'San Antero Zona Urbana'),
        ('usr-lider-u', 'camp-03', '1000000031', 'Manuel Pacheco (Líder La U)', '3146668899', 'lider.manuel', '123456', 'LIDER', 'Corregimiento Tijeretas')
    ]

    votantes = [
        ('vot-01', 'camp-02', 'usr-lider-con', '1002345678', '3004561234', 'Sector Playa El Porvenir', 'SEGURO', 'PENDIENTE', 'Registrado en Corregimiento El Porvenir'),
        ('vot-02', 'camp-01', 'usr-lider-lib', '1003456789', '3129988776', 'Vía Principal Volcán', 'DUDOSO', 'REQUIERE_TRANSPORTE', 'Registrado en Santa Rosa del Volcán')
    ]

    if is_pg:
        # Inserción idempotente en PostgreSQL
        for c in censos_san_antero:
            cursor.execute("""
                INSERT INTO censo_electoral (cedula, nombres, apellidos, departamento, municipio, puesto_votacion, direccion_puesto, mesa, latitud, longitud)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (cedula) DO NOTHING
            """, c)

        for camp in campanas:
            cursor.execute("""
                INSERT INTO campanas (id, nombre_candidato, partido, color_distintivo, cargo_aspirado, municipio)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
            """, camp)

        for u in usuarios:
            cursor.execute("""
                INSERT INTO usuarios (id, campana_id, cedula, nombre_completo, telefono, username, password_hash, rol, zona_barrio)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
            """, u)

        for v in votantes:
            cursor.execute("""
                INSERT INTO votantes_campana (id, campana_id, lider_id, cedula, telefono, barrio_direccion, compromiso, estado_dia_d, observaciones)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (campana_id, cedula) DO NOTHING
            """, v)
    else:
        # Inserción en SQLite
        cursor.executemany("""
            INSERT OR REPLACE INTO censo_electoral (cedula, nombres, apellidos, departamento, municipio, puesto_votacion, direccion_puesto, mesa, latitud, longitud)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, censos_san_antero)

        cursor.executemany("""
            INSERT OR REPLACE INTO campanas (id, nombre_candidato, partido, color_distintivo, cargo_aspirado, municipio)
            VALUES (?, ?, ?, ?, ?, ?)
        """, campanas)

        cursor.executemany("""
            INSERT OR REPLACE INTO usuarios (id, campana_id, cedula, nombre_completo, telefono, username, password_hash, rol, zona_barrio)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, usuarios)

        cursor.executemany("""
            INSERT OR REPLACE INTO votantes_campana (id, campana_id, lider_id, cedula, telefono, barrio_direccion, compromiso, estado_dia_d, observaciones)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, votantes)
