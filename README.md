# 🗳️ Sistema Electoral: Control de Cruces & Censo RNEC en Tiempo Real

Plataforma electoral integral diseñada para **campañas políticas**, con detección automática de votantes duplicados o cruzados entre candidatos de distintos partidos, consulta oficial del **Censo Electoral de la Registraduría (RNEC)**, asignación de apoyos logísticos en el Día D y control estricto de accesos por roles (RBAC).

---

## 🎯 Separación Estricta de Roles

* **Superadministrador (War Room):**
  * Acceso total a todas las campañas y partidos políticos.
  * Tablero de control y KPIs consolidados en tiempo real.
  * **Matriz de Cruces en Vivo:** Notificaciones instantáneas por WebSockets cuando un votante es disputado por dos o más organizaciones políticas.
  * Padrón Nacional consolidado con exportación a Excel.
  * Mapa de calor GPS con clustering de votantes.
* **Candidatos y Líderes (Consola Operativa Guiada):**
  * Flujo intuitivo en 3 pasos: **imposible perderse**.
  * **Paso 1:** Consulta de cédula con semáforo visual inmediato (🟢 Libre, 🚨 Cruce con otro partido, 🟡 Duplicado interno).
  * **Paso 2:** Visualización automática y de solo lectura de los datos oficiales de la **Registraduría (RNEC)**: Puesto oficial de votación, dirección y mesa exacta.
  * **Paso 3:** Registro formal del votante (teléfono, nivel de compromiso y estado del Día D) y opción de registrar apoyos de transporte/refrigerio con un solo clic.
  * **Restricción de seguridad:** No tienen acceso a las bases de datos ni estadísticas de candidatos rivales.

---

## 🚀 Cómo Abrir y Ejecutar en Visual Studio Code

### Opción 1: Ejecución con Un Clic (Recomendada en Windows)
1. Abre la carpeta `electoral_system` en el explorador de archivos.
2. Haz doble clic en el archivo **`iniciar_sistema.bat`**.
3. El script instalará automáticamente las dependencias, iniciará el servidor FastAPI y abrirá tu navegador en `http://localhost:8000`.

### Opción 2: Desde Visual Studio Code
1. Abre **Visual Studio Code**.
2. Ve a `Archivo` > `Abrir Carpeta...` y selecciona:
   `C:\Users\Sebas\.gemini\antigravity\scratch\electoral_system`
3. Abre una terminal integrada (`Ctrl + ñ` o `Terminal` > `Nueva Terminal`).
4. Ejecuta:
   ```bash
   cd backend
   pip install -r requirements.txt
   python main.py
   ```
5. Abre en tu navegador: `http://localhost:8000`

---

## 🗄️ Dónde y Cómo Configurar la Base de Datos

Tienes dos opciones preparadas según tu necesidad:

### A. Modo Automático Inmediato (Sin instalar nada - SQLite)
El backend viene configurado con un motor local (`electoral.db`) que **se crea e inicializa automáticamente** la primera vez que ejecutas el proyecto. Viene precargado con ciudadanos en el Censo RNEC, puestos de votación reales de Montería, campañas, líderes y votantes para que pruebes de inmediato.

---

### B. Subir el Archivo SQL a un Servidor (phpMyAdmin, PostgreSQL, Supabase, MySQL)
En la raíz del proyecto tienes el archivo listo para importar:
📄 **`database_schema_and_data.sql`**

#### 1. En phpMyAdmin / XAMPP / MySQL:
1. Abre `http://localhost/phpmyadmin`.
2. Haz clic en **Nueva** y crea una base de datos llamada `sistema_electoral`.
3. Selecciona la pestaña **Importar**.
4. Haz clic en **Seleccionar archivo** y elige `database_schema_and_data.sql`.
5. Presiona **Importar** al final de la página. ¡Listo! Todas las tablas, índices y datos quedarán creados.

#### 2. En PostgreSQL / pgAdmin / Supabase / Neon:
1. En tu panel de PostgreSQL (o Supabase SQL Editor), crea la base de datos.
2. Abre la herramienta **Query Tool / Editor SQL**.
3. Copia y pega el contenido completo del archivo `database_schema_and_data.sql` y presiona **Run / Ejecutar**.

---

## 🔑 Credenciales Demo de Prueba

| Perfil | Usuario | Contraseña | ¿Qué puede ver / hacer? |
| :--- | :--- | :--- | :--- |
| **Superadministrador** | `superadmin` | `123456` | War Room completo, cruces globales, métricas y padrón nacional |
| **Candidato Liberal** | `candidato.liberal` | `123456` | Consola de registro de su campaña, censo RNEC y sus apoyos |
| **Líder Rosa (Liberal)** | `lider.rosa` | `123456` | Registro de votantes en Barrio San José |
| **Candidato Conservador** | `candidato.conservador` | `123456` | Consola de su campaña conservadora |
| **Líder Carlos (Conservador)** | `lider.carlos` | `123456` | Registro de votantes en Barrio El Centro |

*(En la pantalla de login encontrarás botones rápidos para cargar cualquiera de estos usuarios con un clic).*

---

## 🧪 Cómo Probar la Detección de Cruces en Vivo

1. **Inicia sesión como Líder Carlos (Conservador):**
   * En el Paso 1, ingresa la cédula `1002345678`.
   * Verás que ya está registrado por él: semáforo **Amarillo (Duplicado Interno)**.
2. **Cierra sesión e inicia como Líder Rosa (Liberal):**
   * En el Paso 1, ingresa la misma cédula `1002345678`.
   * El sistema detecta inmediatamente: **🚨 ¡ALERTA DE CRUCE DE PARTIDO!** (Está registrado con el Partido Conservador).
   * Te muestra además su puesto real de Registraduría (`I.E. San Antero`, Mesa 12).
   * Si la registras, el sistema disparará un evento WebSocket instantáneo al Centro de Mando del Superadministrador.
3. **Consulta una cédula libre:**
   * Ingresa la cédula `1005112233` (Carlos Mario Reyes).
   * Semáforo **🟢 Verde (Habilitado)**: Puesto `I.E. Normal Superior`, Mesa 3. Listo para vincular y registrar.
