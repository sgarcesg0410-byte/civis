// ==============================================================================
// CLIENTE API CON GESTIÓN DE SESIÓN Y TOKENS
// ==============================================================================

const API_BASE = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
    ? '' 
    : '';

class ElectoralAPI {
    static getToken() {
        return localStorage.getItem('electoral_token');
    }

    static getUser() {
        const u = localStorage.getItem('electoral_user');
        return u ? JSON.parse(u) : null;
    }

    static setSession(token, user) {
        localStorage.setItem('electoral_token', token);
        localStorage.setItem('electoral_user', JSON.stringify(user));
    }

    static clearSession() {
        localStorage.removeItem('electoral_token');
        localStorage.removeItem('electoral_user');
    }

    static async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        const token = this.getToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`/api/v1${endpoint}`, {
            ...options,
            headers
        });

        if (response.status === 401) {
            this.clearSession();
            window.location.reload();
            throw new Error("Sesión expirada o no autorizada.");
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || 'Ocurrió un error en la solicitud.');
        }

        return data;
    }

    // Auth
    static login(username, password) {
        return this.request('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    }

    // Candidato y Líder
    static verificarCruce(cedula) {
        return this.request(`/votantes/verificar/${cedula}`);
    }

    static registrarVotante(datos) {
        return this.request('/votantes', {
            method: 'POST',
            body: JSON.stringify(datos)
        });
    }

    static registrarApoyo(datos) {
        return this.request('/apoyos', {
            method: 'POST',
            body: JSON.stringify(datos)
        });
    }

    static getMisVotantes() {
        return this.request('/votantes/mis-votantes');
    }

    // SuperAdmin
    static getKpis() {
        return this.request('/superadmin/kpis');
    }

    static getCrucesGlobales() {
        return this.request('/superadmin/cruces');
    }

    static getPadronGeneral() {
        return this.request('/superadmin/padron-general');
    }

    // SuperAdmin - Gestión Integral de Usuarios y Roles
    static getUsuarios() {
        return this.request('/superadmin/usuarios');
    }

    static getCampanas() {
        return this.request('/superadmin/campanas');
    }

    static crearUsuario(datos) {
        return this.request('/superadmin/usuarios', {
            method: 'POST',
            body: JSON.stringify(datos)
        });
    }

    static toggleUsuarioActivo(userId) {
        return this.request(`/superadmin/usuarios/${userId}/toggle-activo`, {
            method: 'PUT'
        });
    }

    static eliminarUsuario(userId) {
        return this.request(`/superadmin/usuarios/${userId}`, {
            method: 'DELETE'
        });
    }

    static restablecerPassword(userId, nuevaPassword) {
        return this.request(`/superadmin/usuarios/${userId}/restablecer-password`, {
            method: 'PUT',
            body: JSON.stringify({ nueva_password: nuevaPassword })
        });
    }

    // Auditoría de Intentos y Alertas WhatsApp
    static getAuditoriaIntentos() {
        return this.request('/superadmin/auditoria-intentos');
    }

    static getMiTelefono() {
        return this.request('/usuarios/mi-telefono');
    }

    static actualizarMiTelefono(telefono) {
        return this.request('/usuarios/mi-telefono', {
            method: 'PUT',
            body: JSON.stringify({ telefono })
        });
    }
}
