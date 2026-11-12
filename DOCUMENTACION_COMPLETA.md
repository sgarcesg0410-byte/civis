# 🗳️ CIVIS - Plataforma de Inteligencia Electoral, Censo RNEC & Validación Territorial

> **Documento Maestro de Arquitectura, Seguridad, Cumplimiento Legal y Operaciones**  
> **Versión:** `v1.0-beta` (Entorno de Pre-Campaña / Staging Controlado)  
> **Repositorio Oficial:** `https://github.com/sgarcesg0410-byte/civis.git`  
> **Marco Normativo Principal:** Constitución Política de Colombia (Art. 107), Ley Estatutaria 1581 de 2012 (Protección de Datos Personales), Ley 1475 de 2011 y directrices del Consejo Nacional Electoral (CNE).

---

## 1. ⚖️ Dimensión Ética, Constitucional y Marco Jurídico Colombiano

### 1.1 Naturaleza del Dato Político y Ley 1581 de 2012
De conformidad con el **Artículo 5 de la Ley Estatutaria 1581 de 2012**, los datos que revelan la convicción religiosa, filosófica o la **afiliación/preferencia política** de un ciudadano son catalogados expresamente como **DATOS SENSIBLES**.

* **Prohibición General:** Está prohibido el tratamiento de datos sensibles salvo que medie **autorización explícita, previa e informada** del titular (Art. 6).
* **Consentimiento Informado Requerido:** Ningún líder territorial, brigadista o candidato puede ingresar datos de un ciudadano a la plataforma sin contar con el consentimiento del votante (físico en planilla firmada, digital vía SMS/WhatsApp, o acta testimonial).
* **Principio de Libertad y Finalidad:** El ciudadano debe ser informado exactamente de para qué se usarán sus datos (coordinación logística el Día D, verificación del puesto de votación y contacto informativo de la campaña).

### 1.2 Reformulación Doctrinal: "Interacción Multipartidista" vs. "Cruce de Votantes"
En el marco de la democracia constitucional colombiana (Art. 107 C.P.), **el ciudadano no es propiedad ni un activo de ninguna campaña política**.

* **Libertad de Interacción:** Un ciudadano tiene el derecho irrenunciable a escuchar múltiples propuestas, recibir a líderes de diferentes partidos y modificar su intención de voto en cualquier momento.
* **El estado `INDECISO` es la norma:** El sistema considera el estado `INDECISO` como el ejercicio natural y legítimo de la libertad del elector, nunca como una anomalía o falla.
* **Reclasificación de la Alerta:** El término antes denominado *"Alerta de Cruce / Infracción"* se define normativamente como **"Contacto Multipartidista Previo"**. Su propósito no es sancionar al ciudadano ni disputar su pertenencia, sino advertir a la campaña sobre la necesidad de verificar si el ciudadano efectivamente otorgó su consentimiento voluntario y cuál es su voluntad real para el Día D.

### 1.3 Módulo de Habeas Data y Ejercicio de Derechos ARCO
La plataforma expone endpoints públicos para que cualquier ciudadano ejerza sus derechos de **Acceso, Rectificación, Cancelación y Oposición**:
* **`GET /api/v1/habeas-data/consultar/{cedula}`:** Permite al titular conocer si reposa en el padrón interno de la campaña.
* **`POST /api/v1/habeas-data/revocar/{cedula}`:** Permite al titular revocar de forma inmediata su autorización, borrando sus datos de las listas de movilización conforme a los Arts. 8 y 9 de la Ley 1581.

---

## 2. 🏛️ Arquitectura del Sistema y Prevención de Split-Brain

```
                        ┌────────────────────────────────────────────────────────┐
                        │             CLIENTE WEB (SPA / PWA)                   │
                        │   Vanilla JS (ES6+) • CSS3 Modular • Leaflet.js        │
                        └──────────┬─────────────────────────────────▲───────────┘
                                   │ HTTPS (JWT Criptográfico)       │ WebSockets (WSS)
                                   ▼                                 │
                        ┌────────────────────────────────────────────┴───────────┐
                        │               BACKEND FASTAPI (PYTHON)                 │
                        │  - Motor RBAC con Tokens Firmados HS256                │
                        │  - Rate Limiting Anti-Scraping en Censo RNEC           │
                        │  - Conexión Controlada Fail-Fast (Anti Split-Brain)    │
                        └──────────┬─────────────────────────────────▲───────────┘
                                   │ Pool Seguro SSL                 │ Pub/Sub
                                   ▼                                 │
    ┌──────────────────────────────────────────────┐  ┌──────────────┴───────────┐
    │       NEON CLOUD POSTGRESQL (Autoritativa)   │  │ REDIS CLOUD DISTRIBUIDO  │
    │  - Fuente única de la verdad en Producción   │  │  - Difusión de eventos   │
    │  - PITR (Point-in-Time Recovery) hasta 30 d  │  │  - Caché de consultas    │
    │  - Bloqueo de fallback silencioso a SQLite   │  │  - Escalado multi-nodo   │
    └──────────────────────────────────────────────┘  └──────────────────────────┘
```

### 2.1 Política Estricta contra "Split-Brain" (Divergencia de Datos)
En versiones preliminares, si la conexión con PostgreSQL fallaba, el sistema degradaba silenciosamente a un archivo SQLite local (`electoral.db`). **Esto constituía un riesgo operativo crítico**: en la jornada electoral, diferentes terminales hubiesen escrito en archivos locales aislados sin posibilidad de reconciliación determinista.

* **Regla de Producción:** Cuando `DATABASE_URL` está configurada, el parámetro `ALLOW_SQLITE_FALLBACK` permanece en `false` por defecto. Si el cluster PostgreSQL se interrumpe, el sistema **falla de forma segura e inmediata (Fail-Fast)** reportando error de conexión al usuario, evitando la fragmentación oculta del padrón.
* **Modo Aislado Offline:** Solo se activa SQLite local si se define explícitamente `ALLOW_SQLITE_FALLBACK=true` para demostraciones locales de desarrollo desconectadas de internet.

### 2.2 Estrategia de Respaldo y Recuperación (Backups)
* **Point-in-Time Recovery (PITR):** Neon PostgreSQL mantiene bitácora WAL continua que permite restaurar el estado de la base de datos a cualquier segundo específico de los últimos 7 a 30 días.
* **Volcados Lógicos Periódicos:** Automatización mediante cron job previo a la jornada electoral:
  ```bash
  pg_dump "$DATABASE_URL" --format=custom --file="backup_civis_$(date +%Y%m%d_%H%M%S).dump"
  ```

---

## 3. 🛡️ Modelo de Seguridad y Protección de Datos

### 3.1 Autenticación Criptográfica JWT (HS256)
* El sistema ya no utiliza identificadores planos como tokens de sesión.
* Cada inicio de sesión exitoso emite un token **JSON Web Token (JWT)** con firma HMAC-SHA256 utilizando una clave secreta configurable (`JWT_SECRET`).
* **Claims obligatorios:**
  * `sub`: ID único del usuario autenticado.
  * `rol`: Rol verificado (`SUPERADMIN`, `CANDIDATO`, `LIDER`).
  * `iat`: Marca de tiempo de emisión.
  * `exp`: Tiempo de expiración estricto (12 horas por defecto para cubrir la jornada de votación completa).

### 3.2 Rate Limiting Anti-Enumeración
* Para proteger la privacidad del censo electoral y evitar ataques de scraping masivo automatizado sobre cédulas ciudadanas, los endpoints de consulta:
  * `/api/v1/censo/{cedula}`
  * `/api/v1/votantes/verificar/{cedula}`
  cuentan con un limitador de tasa (*Rate Limiter*) configurable (`MAX_CENSO_RPM`, por defecto 45 consultas/minuto por operador). Solicitudes en ráfaga son rechazadas con código `HTTP 429 Too Many Requests`.

### 3.3 Gestión de Secretos y Repositorios
* El archivo `.env` está estrictamente excluido del control de versiones mediante `.gitignore`.
* Ninguna credencial de producción ni cadena de conexión a base de datos debe ser versionada en repositorios públicos.
* Las contraseñas de usuarios deben generarse aleatoriamente mediante interfaces administrativas protegidas y almacenarse aplicando funciones criptográficas de derivación de claves (*KDF*).

---

## 4. 🗄️ Diccionario y Esquema Relacional de Base de Datos

```sql
-- 1. Censo Electoral Oficial (Base de Puestos y Mesas RNEC)
CREATE TABLE censo_electoral (
    cedula VARCHAR(20) PRIMARY KEY,
    nombre_completo VARCHAR(150) NOT NULL,
    departamento VARCHAR(50) NOT NULL,
    municipio VARCHAR(50) NOT NULL,
    puesto_votacion VARCHAR(150) NOT NULL,
    direccion_puesto VARCHAR(200),
    mesa INT NOT NULL
);

-- 2. Organizaciones Políticas y Campañas Electorales
CREATE TABLE campanas (
    id VARCHAR(50) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    candidato VARCHAR(150) NOT NULL,
    partido VARCHAR(100) NOT NULL,
    color_hex VARCHAR(10) DEFAULT '#0d6efd',
    meta_votos INT DEFAULT 0,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Usuarios del Sistema y Roles Operativos (RBAC)
CREATE TABLE usuarios (
    id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre_completo VARCHAR(150) NOT NULL,
    telefono VARCHAR(20),
    rol VARCHAR(20) NOT NULL, -- 'SUPERADMIN', 'CANDIDATO', 'LIDER'
    campana_id VARCHAR(50) REFERENCES campanas(id) ON DELETE SET NULL,
    zona_asignada VARCHAR(100),
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Padrón Territorial de Votantes Fidelizados
CREATE TABLE votantes_campana (
    id VARCHAR(50) PRIMARY KEY,
    cedula VARCHAR(20) NOT NULL,
    nombre_completo VARCHAR(150) NOT NULL,
    telefono VARCHAR(20),
    campana_id VARCHAR(50) NOT NULL REFERENCES campanas(id) ON DELETE CASCADE,
    lider_id VARCHAR(50) NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    departamento VARCHAR(50),
    municipio VARCHAR(50),
    puesto_votacion VARCHAR(150),
    mesa INT,
    direccion_residencia VARCHAR(200),
    barrio VARCHAR(100),
    nivel_compromiso VARCHAR(20) DEFAULT 'INDECISO', -- 'ALTO', 'MEDIO', 'INDECISO'
    estado_dia_d VARCHAR(20) DEFAULT 'NO_VOTO',      -- 'NO_VOTO', 'VOTO_CONFIRMADO', 'PROBLEMA'
    es_cruce BOOLEAN DEFAULT FALSE,
    consentimiento_datos BOOLEAN DEFAULT TRUE,      -- Ley 1581 de 2012
    canal_consentimiento VARCHAR(50) DEFAULT 'PLANILLA_FISICA',
    latitud DOUBLE PRECISION,
    longitud DOUBLE PRECISION,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Registro de Interacciones Multipartidistas
CREATE TABLE alertas_cruces (
    id VARCHAR(50) PRIMARY KEY,
    cedula VARCHAR(20) NOT NULL,
    campana_origen_id VARCHAR(50) NOT NULL REFERENCES campanas(id),
    lider_origen_id VARCHAR(50) NOT NULL REFERENCES usuarios(id),
    campana_nueva_id VARCHAR(50) NOT NULL REFERENCES campanas(id),
    lider_nuevo_id VARCHAR(50) NOT NULL REFERENCES usuarios(id),
    fecha_cruce TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resuelto BOOLEAN DEFAULT FALSE,
    observaciones TEXT
);

-- 6. Logística del Día D
CREATE TABLE apoyos_logistica (
    id VARCHAR(50) PRIMARY KEY,
    votante_id VARCHAR(50) NOT NULL REFERENCES votantes_campana(id) ON DELETE CASCADE,
    lider_id VARCHAR(50) NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    campana_id VARCHAR(50) NOT NULL REFERENCES campanas(id) ON DELETE CASCADE,
    tipo_apoyo VARCHAR(50) NOT NULL, -- 'TRANSPORTE', 'REFRIGERIO', 'TESTIGO_ELECTORAL'
    descripcion TEXT,
    fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Auditoría Forense y Trazabilidad
CREATE TABLE auditoria_intentos_duplicados (
    id VARCHAR(50) PRIMARY KEY,
    cedula_consultada VARCHAR(20) NOT NULL,
    lider_id VARCHAR(50) NOT NULL REFERENCES usuarios(id),
    campana_id VARCHAR(50) NOT NULL REFERENCES campanas(id),
    tipo_incidente VARCHAR(50) NOT NULL,
    fecha_intento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    detalles TEXT
);
```

---

## 5. 👥 Matriz de Roles y Responsabilidades (RBAC)

| Módulo / Capacidad | Superadministrador (War Room) | Candidato | Líder Territorial |
| :--- | :---: | :---: | :---: |
| **KPIs Consolidados Globales** | ✅ Vista Macro Total | ⚠️ Solo su Campaña | ❌ Sin acceso |
| **Monitoreo Multipartidista (WebSockets)** | ✅ Notificación Global | ⚠️ Solo su Campaña | ❌ Sin acceso |
| **Padrón y Exportación** | ✅ Consolidado Nacional | ⚠️ Solo su Campaña | ❌ Sin acceso |
| **Mapa Térmico GPS** | ✅ Cobertura Global | ⚠️ Cobertura de Campaña | ❌ Sin acceso |
| **Gestión de Cuentas y Accesos** | ✅ Altas, bajas y reseteo | ❌ Sin acceso | ❌ Sin acceso |
| **Consulta Censo RNEC** | ✅ Con Rate Limiting | ✅ Con Rate Limiting | ✅ Flujo Guiado Paso 1 |
| **Registro de Votantes con Consentimiento** | ✅ Habilitado | ✅ Habilitado | ✅ Flujo Guiado Paso 3 |
| **Asignación Logística Día D** | ✅ Auditoría General | ✅ Auditoría de Campaña | ✅ Asignar a sus Votantes |
| **Control de Asistencia en Puerta** | ✅ Panel de Aforo | ✅ Monitoreo de Evento | ✅ Operador de Escáner |

---

## 6. 📡 Catálogo de la API REST y WebSockets

### Autenticación y Perfil
* `POST /api/v1/auth/login`: Autentica credenciales y emite token JWT con 12 horas de vigencia.

### Operativa Electoral y Censo
* `GET /api/v1/censo/{cedula}`: Retorna puesto, mesa y coordenadas oficiales de votación. Protegido con limitador de tasa.
* `GET /api/v1/votantes/verificar/{cedula}`: Determina el estado del ciudadano (Libre, Registrado previamente en la misma campaña o con Contacto en otra fuerza política).
* `POST /api/v1/votantes`: Registra un votante requiriendo la confirmación del consentimiento informado conforme a la Ley 1581/2012.
* `GET /api/v1/votantes/mis-votantes`: Lista los votantes fidelizados por el operador autenticado.

### Habeas Data (Ciudadanía)
* `GET /api/v1/habeas-data/consultar/{cedula}`: Consulta de existencia de datos personales en el sistema.
* `POST /api/v1/habeas-data/revocar/{cedula}`: Revocatoria del consentimiento y supresión inmediata de registros.

### Logística Día D
* `POST /api/v1/apoyos`: Asignación individual de apoyos logísticos (transporte, refrigerio).
* `GET /api/v1/apoyos/mis-apoyos`: Consolidado de apoyos registrados por el operador.

### Centro de Mando (Superadmin)
* `GET /api/v1/superadmin/kpis`: Métricas ejecutivas en tiempo real.
* `GET /api/v1/superadmin/cruces`: Matriz de contactos compartidos entre organizaciones políticas.
* `GET /api/v1/superadmin/padron-general`: Listado maestro consolidado.
* `GET /api/v1/superadmin/mapa-puntos`: Capa geoespacial para mapas de calor.
* `GET /api/v1/superadmin/usuarios`: Administración de operadores de campo.
* `POST /api/v1/superadmin/usuarios`: Alta de nuevos líderes y operadores.
* `DELETE /api/v1/superadmin/usuarios/{id}`: Baja lógica o física de usuarios.
* `PUT /api/v1/superadmin/usuarios/{id}/toggle-activo`: Suspensión preventiva de accesos.
* `PUT /api/v1/superadmin/usuarios/{id}/restablecer-password`: Actualización de contraseña administrativa.
* `GET /api/v1/superadmin/auditoria-intentos`: Bitácora inmutable de intentos de doble registro.

### Canal en Vivo
* `ws://<servidor>/ws/superadmin` (o `wss://`): Notificaciones push al instante de eventos territoriales.

---

## 7. ⚙️ Parámetros de Configuración del Entorno (`.env`)

```ini
# Base de Datos de Producción (PostgreSQL en Neon Cloud / Supabase / AWS RDS)
DATABASE_URL=postgresql://<usuario>:<password>@<host>/<database>?sslmode=require

# Prevención de Split-Brain (Debe ser false en producción para evitar escrituras desincronizadas en SQLite)
ALLOW_SQLITE_FALLBACK=false

# Clave Secreta para Firma Criptográfica de JWT (Generar una cadena aleatoria robusta)
JWT_SECRET=generar_clave_segura_con_openssl_rand_hex_32

# Duración de Sesión en Segundos (43200 = 12 Horas para la Jornada Electoral)
JWT_EXPIRATION_SECONDS=43200

# Límite de Seguridad Anti-Scraping sobre el Censo (Peticiones por minuto por usuario)
MAX_CENSO_RPM=45

# Bus Distribuido para Servidores Múltiples (Opcional)
# REDIS_URL=redis://default:<token>@<host>:<port>

# Puerto HTTP de Servicio
PORT=8000
```

---

## 8. 🚀 Procedimiento de Despliegue Seguro

1. **Entorno de Prueba / Pre-Campaña:**
   * Utilizar certificados SSL válidos vinculados a un dominio institucional propio (e.g. `civis.campana2026.com`) gestionado con Cloudflare DNS con proxies activos y WAF habilitado.
   * Descartar túneles efímeros no autenticados para operaciones reales.
2. **Puesta en Marcha:**
   * Desplegar el backend vía contenedor o Nixpacks en Railway/Render con variables de entorno inyectadas directamente en el panel cloud seguro.
   * Realizar una auditoría inicial de cuentas eliminando cualquier usuario o contraseña por defecto antes de conectar a líderes reales en territorio.
