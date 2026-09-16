// ==============================================================================
// CONTROLADOR PRINCIPAL Y ENRUTADOR BASADO EN ROLES
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
    cargarTemaGuardado();
    verificarEstadoSesion();
    configurarEventosUI();
});

function verificarEstadoSesion() {
    const user = ElectoralAPI.getUser();
    const viewLogin = document.getElementById('view-login');
    const viewSuperadmin = document.getElementById('view-superadmin');
    const viewLider = document.getElementById('view-lider');

    viewLogin.style.display = 'none';
    viewSuperadmin.style.display = 'none';
    viewLider.style.display = 'none';

    if (!user) {
        viewLogin.style.display = 'flex';
        return;
    }

    if (user.rol === 'SUPERADMIN') {
        viewSuperadmin.style.display = 'block';
        inicializarWarRoomSuperadmin();
    } else {
        // CANDIDATO o LIDER
        viewLider.style.display = 'block';
        inicializarConsolaLider();
    }
}

function configurarEventosUI() {
    // 1. Formulario de Login
    const formLogin = document.getElementById('form-login');
    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const u = document.getElementById('login-username').value.trim();
            const p = document.getElementById('login-password').value.trim();
            const errDiv = document.getElementById('login-error');
            const btnSubmit = formLogin.querySelector('button[type="submit"]');

            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Verificando...`;
            errDiv.style.display = 'none';

            try {
                const res = await ElectoralAPI.login(u, p);
                ElectoralAPI.setSession(res.token, res.usuario);
                verificarEstadoSesion();
            } catch (err) {
                errDiv.textContent = err.message;
                errDiv.style.display = 'block';
            } finally {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = `<i class="fas fa-sign-in-alt"></i> Ingresar al Sistema`;
            }
        });
    }

    // 2. Toggle de Apoyo Logístico en Consola de Líder
    const chkApoyo = document.getElementById('chk-dar-apoyo');
    if (chkApoyo) {
        chkApoyo.addEventListener('change', (e) => {
            const box = document.getElementById('box-apoyo-inputs');
            box.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    // 3. Formulario de Registro de Votante
    const formVotante = document.getElementById('form-registro-votante');
    if (formVotante) {
        formVotante.addEventListener('submit', guardarVotanteFormulario);
    }
}

// Botones de acceso rápido en demo
function cargarDemoCredenciales(username, password) {
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = password;
}

// Cerrar Sesión
function cerrarSesion() {
    ElectoralAPI.clearSession();
    window.location.reload();
}

// ==============================================================================
// CONFIGURACIÓN INSTITUCIONAL DE COLOR (PARTIDO LIBERAL #CC0000)
// ==============================================================================

const COLOR_INSTITUCIONAL = '#CC0000';

function cargarTemaGuardado() {
    // Limpiar almacenamiento previo para garantizar aplicación inmediata de la identidad oficial
    localStorage.removeItem('electoral_color_sistema');
    localStorage.removeItem('electoral_color_boton');
    localStorage.removeItem('electoral_color_texto_boton');

    const root = document.documentElement;
    root.style.setProperty('--theme-color', COLOR_INSTITUCIONAL);
    root.style.setProperty('--theme-color-dark', '#880000');
    root.style.setProperty('--theme-color-rgb', '204, 0, 0');
    root.style.setProperty('--liberal-red', COLOR_INSTITUCIONAL);
    root.style.setProperty('--party-color', COLOR_INSTITUCIONAL);

    root.style.setProperty('--btn-custom-bg', COLOR_INSTITUCIONAL);
    root.style.setProperty('--btn-custom-hover', '#B30000');
    root.style.setProperty('--btn-custom-text', '#FFFFFF');
    root.style.setProperty('--btn-custom-border', COLOR_INSTITUCIONAL);

    const liderContainer = document.getElementById('view-lider');
    if (liderContainer) {
        liderContainer.style.setProperty('--party-color', COLOR_INSTITUCIONAL);
        liderContainer.style.setProperty('--party-color-rgb', '204, 0, 0');
        liderContainer.style.setProperty('--party-color-dark', '#880000');
    }
}
