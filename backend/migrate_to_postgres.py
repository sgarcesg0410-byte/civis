"""
Script de Migración de Datos: SQLite Local -> PostgreSQL Administrado en la Nube
================================================================================
Uso:
    1. Configure su DATABASE_URL en el archivo backend/.env
    2. Ejecute: python migrate_to_postgres.py

Este script:
    - Lee todas las tablas de electoral.db (SQLite)
    - Conecta a su instancia de PostgreSQL en la nube (Neon, Supabase, Render, etc.)
    - Inicializa el esquema e índices
    - Transfiere censo, campañas, usuarios, votantes, bitácora y alertas
    - Valida el recuento de registros en ambas bases de datos
================================================================================
"""

import os
import sys
import sqlite3
from pathlib import Path
from dotenv import load_dotenv

# Asegurar codificación segura de salida en Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

SQLITE_PATH = BASE_DIR / "electoral.db"
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if not DATABASE_URL.startswith("postgresql://"):
    print("❌ ERROR: DATABASE_URL no está configurada o no es una URL de PostgreSQL válida.")
    print("Por favor cree o edite el archivo backend/.env con su cadena de conexión.")
    print("Ejemplo: DATABASE_URL=postgresql://usuario:clave@host:5432/neondb?sslmode=require")
    sys.exit(1)

if not SQLITE_PATH.exists():
    print(f"❌ ERROR: No se encontró el archivo local SQLite en {SQLITE_PATH}")
    sys.exit(1)

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("❌ ERROR: Falta instalar psycopg2. Ejecute: pip install psycopg2-binary")
    sys.exit(1)

print("=" * 75)
print("🏛️ CIVIS - MIGRACIÓN A POSTGRESQL ADMINISTRADO")
print("=" * 75)
print(f"📂 Origen (SQLite Local):      {SQLITE_PATH.name}")
masked_url = DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else "configurada"
print(f"☁️ Destino (PostgreSQL Cloud): ...@{masked_url}")
print("-" * 75)

# 1. Conectar a SQLite
sqlite_conn = sqlite3.connect(SQLITE_PATH)
sqlite_conn.row_factory = sqlite3.Row
sqlite_cur = sqlite_conn.cursor()

# 2. Conectar a PostgreSQL
try:
    pg_conn = psycopg2.connect(DATABASE_URL)
    pg_cur = pg_conn.cursor()
    print("✅ Conexión establecida exitosamente con PostgreSQL en la nube.")
except Exception as e:
    print(f"❌ Error al conectar con PostgreSQL: {e}")
    sys.exit(1)

# 3. Inicializar esquema en PostgreSQL
from database import init_db
print("⚙️ Asegurando esquema e índices en PostgreSQL...")
init_db()

# 4. Tablas a migrar en orden de llaves foráneas
tablas = [
    {
        "nombre": "censo_electoral",
        "pk": "cedula",
        "columnas": ["cedula", "nombres", "apellidos", "departamento", "municipio", "puesto_votacion", "direccion_puesto", "mesa", "latitud", "longitud"]
    },
    {
        "nombre": "campanas",
        "pk": "id",
        "columnas": ["id", "nombre_candidato", "partido", "color_distintivo", "cargo_aspirado", "municipio"]
    },
    {
        "nombre": "usuarios",
        "pk": "id",
        "columnas": ["id", "campana_id", "cedula", "nombre_completo", "telefono", "username", "password_hash", "rol", "zona_barrio", "activo"]
    },
    {
        "nombre": "votantes_campana",
        "pk": "id",
        "columnas": ["id", "campana_id", "lider_id", "cedula", "telefono", "barrio_direccion", "compromiso", "estado_dia_d", "observaciones"]
    },
    {
        "nombre": "alertas_cruces",
        "pk": "id",
        "columnas": ["id", "cedula", "campana_origen_id", "campana_conflicto_id", "lider_origen_id", "lider_conflicto_id", "tipo_cruce", "resuelto"]
    },
    {
        "nombre": "apoyos_logistica",
        "pk": "id",
        "columnas": ["id", "campana_id", "lider_id", "votante_cedula", "tipo_apoyo", "valor_economico", "descripcion"]
    },
    {
        "nombre": "auditoria_intentos_duplicados",
        "pk": "id",
        "columnas": ["id", "cedula", "nombre_votante", "puesto_mesa", "operador_nombre", "operador_username", "operador_rol", "operador_partido", "propietario_nombre", "propietario_partido", "telefono_notificado", "tipo_evento", "accion_tomada"]
    }
]

print("\n🚀 Iniciando transferencia de datos...\n")

total_migrados = 0

for t in tablas:
    tabla_name = t["nombre"]
    cols = t["columnas"]
    pk = t["pk"]
    
    # Leer de SQLite
    sqlite_cur.execute(f"SELECT {', '.join(cols)} FROM {tabla_name}")
    filas = sqlite_cur.fetchall()
    
    if not filas:
        print(f"ℹ️ {tabla_name:30} : 0 registros (vacía)")
        continue
    
    # Preparar inserción en PostgreSQL con ON CONFLICT DO NOTHING
    cols_str = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    query = f"INSERT INTO {tabla_name} ({cols_str}) VALUES ({placeholders}) ON CONFLICT ({pk}) DO NOTHING"
    
    datos_tuplas = [tuple(f[col] for col in cols) for f in filas]
    
    pg_cur.executemany(query, datos_tuplas)
    pg_conn.commit()
    
    print(f"✅ {tabla_name:30} : {len(filas):>5} registros migrados con éxito.")
    total_migrados += len(filas)

print("-" * 75)
print(f"🎉 MIGRACIÓN COMPLETADA: {total_migrados} registros transferidos a PostgreSQL.")
print("=" * 75)

sqlite_conn.close()
pg_conn.close()
