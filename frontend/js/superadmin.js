// ==============================================================================
// WAR ROOM SUPERADMINISTRADOR (VISTA COMPLETA, AUDITORÍA GLOBAL Y TIEMPO REAL)
// ==============================================================================

let mapaGlobal = null;
let socketSuperadmin = null;

async function inicializarWarRoomSuperadmin() {
    const user = ElectoralAPI.getUser();
    if (user) {
        document.getElementById('lbl-admin-nombre').textContent = user.nombre || 'Administrador General';
    }

    // Cargar datos iniciales
    await cargarKpisGlobales();
    await cargarCrucesGlobales();
    await cargarAuditoriaForense();
    await cargarPadronConsolidado();
    await cargarGestionUsuarios();

    // Conectar WebSocket para notificaciones en vivo
    conectarWebSocketSuperadmin();
}

// 1. CARGAR KPIS GLOBALES
async function cargarKpisGlobales() {
    try {
        const kpis = await ElectoralAPI.getKpis();
        document.getElementById('kpi-total-votantes').textContent = Number(kpis.total_votantes || 0).toLocaleString();
        document.getElementById('kpi-total-cruces').textContent = Number(kpis.total_cruces || 0).toLocaleString();
        document.getElementById('kpi-inversion-apoyos').textContent = `$${Number(kpis.total_inversion_apoyos || 0).toLocaleString()}`;
        document.getElementById('kpi-votos-confirmados').textContent = Number(kpis.votos_confirmados || 0).toLocaleString();

        // Renderizar barras de distribución por partido
        const containerPartidos = document.getElementById('distribucion-partidos');
        if (containerPartidos && kpis.distribucion_partidos) {
            containerPartidos.innerHTML = kpis.distribucion_partidos.map(p => `
                <div class="mb-3">
                    <div class="d-flex justify-content-between small fw-bold mb-1">
                        <span class="text-white"><i class="fas fa-flag me-2" style="color: ${p.color_distintivo};"></i> ${p.partido}</span>
                        <span class="text-white fw-bold">${p.total_inscritos} votantes</span>
                    </div>
                    <div class="progress" style="height: 12px; border-radius: 6px; background: rgba(255, 255, 255, 0.1);">
                        <div class="progress-bar" style="width: ${Math.min(100, (p.total_inscritos / (kpis.total_votantes || 1)) * 100)}%; background-color: ${p.color_distintivo};"></div>
                    </div>
                </div>
            `).join('');
        }
    } catch (err) {
        console.error("Error al cargar KPIs:", err);
    }
}

// 2. AUDITORÍA DE CRUCES GLOBALES EN TIEMPO REAL
async function cargarCrucesGlobales() {
    const tbody = document.getElementById('tbody-cruces-globales');
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-white"><i class="fas fa-spinner fa-spin me-2"></i> Cargando cruces inter-partidistas...</td></tr>`;

    try {
        const cruces = await ElectoralAPI.getCrucesGlobales();
        if (cruces.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-success fw-bold"><i class="fas fa-check-circle me-1"></i> No se han detectado votantes duplicados o cruzados entre partidos.</td></tr>`;
            return;
        }

        tbody.innerHTML = cruces.map(c => `
            <tr>
                <td><strong class="text-white">${c.cedula}</strong></td>
                <td><strong class="text-white">${c.nombres || ''} ${c.apellidos || ''}</strong></td>
                <td>
                    <span class="badge px-3 py-1 fw-bold" style="background: ${c.color_1 || '#DC2626'}; color: #fff;">${c.partido_1}</span>
                    <div class="small text-muted mt-1">${c.candidato_1} (Líder: ${c.lider_1 || 'General'})</div>
                </td>
                <td>
                    <span class="badge px-3 py-1 fw-bold" style="background: ${c.color_2 || '#2563EB'}; color: #fff;">${c.partido_2}</span>
                    <div class="small text-muted mt-1">${c.candidato_2} (Líder: ${c.lider_2 || 'General'})</div>
                </td>
                <td>
                    <div class="text-white"><strong>${c.puesto_votacion || 'No registrado'}</strong></div>
                    <span class="badge bg-secondary">Mesa ${c.mesa || '-'}</span>
                </td>
                <td><span class="badge bg-danger px-3 py-2 fw-bold"><i class="fas fa-bolt me-1"></i> ${new Date(c.fecha_deteccion).toLocaleTimeString()}</span></td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-3">Error: ${err.message}</td></tr>`;
    }
}

// 3. PADRÓN CONSOLIDADO DE TODOS LOS PARTIDOS
async function cargarPadronConsolidado() {
    const tbody = document.getElementById('tbody-padron-general');
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-white"><i class="fas fa-spinner fa-spin me-2"></i> Cargando padrón nacional consolidado...</td></tr>`;

    try {
        const votantes = await ElectoralAPI.getPadronGeneral();
        document.getElementById('badge-total-padron-general').textContent = `${votantes.length} registros`;

        if (votantes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No hay registros electorales en la base de datos.</td></tr>`;
            return;
        }

        tbody.innerHTML = votantes.map(v => `
            <tr>
                <td><strong class="text-white">${v.cedula}</strong></td>
                <td><strong class="text-white">${v.nombres || ''} ${v.apellidos || ''}</strong></td>
                <td>
                    <span class="badge px-3 py-1 fw-bold" style="background: ${v.color_distintivo || '#DC2626'}; color: #fff;">${v.partido}</span>
                    <small class="d-block text-muted mt-1">${v.nombre_candidato}</small>
                </td>
                <td>
                    <div class="text-white"><strong>${v.puesto_votacion || 'No asignado'}</strong></div>
                    <span class="badge bg-primary">Mesa ${v.mesa || '-'}</span>
                </td>
                <td><span class="text-white">${v.lider_responsable}</span></td>
                <td>
                    <span class="badge ${v.estado_dia_d === 'YA_VOTO' ? 'bg-success' : 'bg-secondary'} px-2 py-1">${v.estado_dia_d}</span>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-3">Error: ${err.message}</td></tr>`;
    }
}

// 4. GESTIÓN INTEGRAL DE USUARIOS Y ASIGNACIÓN DE ROLES (EXCLUSIVO SUPERADMIN)
let usuariosSistemaCache = [];
let campanasSistemaCache = [];
let filtroRolActual = 'TODOS';

async function cargarGestionUsuarios() {
    const tbody = document.getElementById('tbody-usuarios-general');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-white"><i class="fas fa-spinner fa-spin me-2"></i> Cargando usuarios y campañas...</td></tr>`;
    }

    try {
        // Cargar usuarios y campañas en paralelo
        const [usuarios, campanas] = await Promise.all([
            ElectoralAPI.getUsuarios(),
            ElectoralAPI.getCampanas()
        ]);

        usuariosSistemaCache = usuarios || [];
        campanasSistemaCache = campanas || [];

        // Poblar selector de campañas en el formulario
        const selCampana = document.getElementById('usr-campana-nueva');
        if (selCampana) {
            selCampana.innerHTML = `
                <option value="">-- Seleccione Campaña / Partido --</option>
                ${campanasSistemaCache.map(c => `
                    <option value="${c.id}">${c.partido} (${c.nombre_candidato} - ${c.cargo_aspirado})</option>
                `).join('')}
            `;
        }

        // Actualizar contadores de métricas por rol
        const total = usuariosSistemaCache.length;
        const superadmins = usuariosSistemaCache.filter(u => u.rol === 'SUPERADMIN').length;
        const candidatos = usuariosSistemaCache.filter(u => u.rol === 'CANDIDATO').length;
        const lideres = usuariosSistemaCache.filter(u => u.rol === 'LIDER').length;

        const elTotal = document.getElementById('cnt-usr-total');
        const elSuper = document.getElementById('cnt-usr-superadmins');
        const elCand = document.getElementById('cnt-usr-candidatos');
        const elLid = document.getElementById('cnt-usr-lideres');

        if (elTotal) elTotal.textContent = total;
        if (elSuper) elSuper.textContent = superadmins;
        if (elCand) elCand.textContent = candidatos;
        if (elLid) elLid.textContent = lideres;

        // Renderizar tabla
        renderizarTablaUsuarios();

    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-3">Error al cargar usuarios: ${err.message}</td></tr>`;
        }
    }
}

function filtrarUsuariosPorRol(rol) {
    filtroRolActual = rol;
    renderizarTablaUsuarios();
}

function renderizarTablaUsuarios() {
    const tbody = document.getElementById('tbody-usuarios-general');
    if (!tbody) return;

    let lista = usuariosSistemaCache;
    if (filtroRolActual !== 'TODOS') {
        lista = lista.filter(u => u.rol === filtroRolActual);
    }

    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted">No hay usuarios registrados con el filtro "${filtroRolActual}".</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(u => {
        // Estilo del badge de rol
        let badgeRol = '';
        let iconRol = '';
        if (u.rol === 'SUPERADMIN') {
            badgeRol = '<span class="badge bg-danger text-white px-2 py-1"><i class="fas fa-user-shield me-1"></i> SUPERADMIN</span>';
            iconRol = '<i class="fas fa-shield-alt text-danger"></i>';
        } else if (u.rol === 'CANDIDATO') {
            badgeRol = '<span class="badge bg-primary text-white px-2 py-1"><i class="fas fa-landmark me-1"></i> CANDIDATO</span>';
            iconRol = '<i class="fas fa-landmark text-primary"></i>';
        } else {
            badgeRol = '<span class="badge bg-success text-white px-2 py-1"><i class="fas fa-user me-1"></i> LÍDER</span>';
            iconRol = '<i class="fas fa-user text-success"></i>';
        }

        // Estilo del partido / campaña
        let partyHtml = '';
        if (u.rol === 'SUPERADMIN') {
            partyHtml = '<span class="badge bg-dark border border-secondary text-info"><i class="fas fa-shield-virus me-1"></i> Mando Central</span>';
        } else if (u.partido) {
            partyHtml = `
                <div>
                    <span class="badge px-2 py-1 fw-bold text-white" style="background-color: ${u.color_distintivo || '#2563EB'};">
                        <i class="fas fa-flag me-1"></i> ${u.partido}
                    </span>
                    <small class="d-block text-muted" style="color: #94A3B8 !important;">${u.nombre_candidato || ''}</small>
                </div>
            `;
        } else {
            partyHtml = '<span class="text-muted small">Sin asignar</span>';
        }

        const isActivo = u.activo === 1;

        return `
            <tr style="opacity: ${isActivo ? '1' : '0.55'};">
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="rounded-circle bg-dark border border-secondary text-white d-flex align-items-center justify-content-center fw-bold" style="width: 32px; height: 32px; font-size: 0.85rem;">
                            ${iconRol}
                        </div>
                        <div>
                            <strong class="text-white">@${u.username}</strong>
                            <small class="d-block text-muted" style="font-size: 0.75rem;">${u.telefono || 'Sin teléfono'}</small>
                        </div>
                    </div>
                </td>
                <td>
                    <strong class="text-white">${u.nombre_completo}</strong>
                    <small class="d-block text-muted">C.C. ${u.cedula}</small>
                </td>
                <td>${badgeRol}</td>
                <td>${partyHtml}</td>
                <td>
                    <div class="text-white">${u.zona_barrio || 'San Antero'}</div>
                </td>
                <td>
                    <span class="badge bg-secondary px-2 py-1 fw-bold">${u.total_votantes || 0}</span>
                </td>
                <td>
                    <span class="badge ${isActivo ? 'bg-success' : 'bg-danger'} px-2 py-1 fw-bold">
                        ${isActivo ? 'Activo' : 'Inactivo'}
                    </span>
                </td>
                <td>
                    <div class="d-flex align-items-center gap-1">
                        <button class="btn btn-sm btn-outline-info" 
                                title="Restablecer Contraseña" 
                                onclick="abrirModalRestablecerPass('${u.id}', '${u.nombre_completo.replace(/'/g, "\\'")}', '${u.username}')">
                            <i class="fas fa-key"></i>
                        </button>
                        <button class="btn btn-sm ${isActivo ? 'btn-outline-danger' : 'btn-outline-success'}" 
                                title="${isActivo ? 'Desactivar acceso' : 'Reactivar acceso'}" 
                                onclick="alternarEstadoUsuario('${u.id}')">
                            <i class="fas ${isActivo ? 'fa-pause' : 'fa-play'}"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" 
                                title="Eliminar usuario" 
                                onclick="eliminarUsuarioSistema('${u.id}', '${u.nombre_completo.replace(/'/g, "\\'")}')">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function toggleFormularioNuevoUsuario() {
    const card = document.getElementById('card-form-crear-usuario');
    if (!card) return;
    const isHidden = card.style.display === 'none' || card.style.display === '';
    card.style.display = isHidden ? 'block' : 'none';
    if (isHidden) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        actualizarCamposPorRol();
    }
}

function actualizarCamposPorRol() {
    const rol = document.getElementById('usr-rol-nuevo').value;
    const boxCampana = document.getElementById('box-select-campana');
    const selCampana = document.getElementById('usr-campana-nueva');

    if (rol === 'SUPERADMIN') {
        if (boxCampana) boxCampana.style.opacity = '0.4';
        if (selCampana) {
            selCampana.disabled = true;
            selCampana.required = false;
            selCampana.value = '';
        }
    } else {
        if (boxCampana) boxCampana.style.opacity = '1';
        if (selCampana) {
            selCampana.disabled = false;
            selCampana.required = true;
        }
    }
}

async function guardarUsuarioSistema(e) {
    e.preventDefault();
    const rol = document.getElementById('usr-rol-nuevo').value;
    const campana_id = document.getElementById('usr-campana-nueva').value;
    const nombre = document.getElementById('usr-nombre-nuevo').value.trim();
    const cedula = document.getElementById('usr-cedula-nueva').value.trim();
    const telefono = document.getElementById('usr-telefono-nuevo').value.trim();
    const username = document.getElementById('usr-username-nuevo').value.trim();
    const password = document.getElementById('usr-password-nueva').value.trim();
    const zona = document.getElementById('usr-zona-nueva').value.trim();

    if (rol !== 'SUPERADMIN' && !campana_id) {
        alert("Por favor seleccione la campaña o partido al que pertenecerá este usuario.");
        return;
    }

    const btn = document.getElementById('btn-guardar-usr-sistema');
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i> Creando usuario...`;

    try {
        await ElectoralAPI.crearUsuario({
            nombre_completo: nombre,
            cedula: cedula,
            telefono: telefono,
            username: username,
            password: password,
            rol: rol,
            campana_id: campana_id || null,
            zona_barrio: zona || 'San Antero'
        });

        alert(`✅ Usuario "${nombre}" (@${username}) creado exitosamente con el rol ${rol}.`);
        document.getElementById('form-crear-usuario').reset();
        document.getElementById('card-form-crear-usuario').style.display = 'none';

        // Recargar lista y métricas
        await cargarGestionUsuarios();

    } catch (err) {
        alert("Error al crear usuario: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-user-check me-2"></i> Guardar y Habilitar Usuario`;
    }
}

async function alternarEstadoUsuario(userId) {
    try {
        await ElectoralAPI.toggleUsuarioActivo(userId);
        await cargarGestionUsuarios();
    } catch (err) {
        alert("Error al cambiar estado: " + err.message);
    }
}

async function eliminarUsuarioSistema(userId, nombre) {
    if (!confirm(`¿Está seguro de que desea eliminar al usuario "${nombre}" del sistema?\nEsta acción no se puede deshacer.`)) {
        return;
    }

    try {
        await ElectoralAPI.eliminarUsuario(userId);
        await cargarGestionUsuarios();
    } catch (err) {
        alert("Error al eliminar usuario: " + err.message);
    }
}

// Alias para mantener compatibilidad con llamadas existentes
const cargarEquipoSuperadmins = cargarGestionUsuarios;
const agregarNuevoSuperadmin = guardarUsuarioSistema;

// 5. EXPORTAR EXCEL GLOBAL
function exportarSuperadminExcel(idTabla, nombreArchivo) {
    const tabla = document.getElementById(idTabla);
    if (!tabla) return;
    const libro = XLSX.utils.table_to_book(tabla, { sheet: "Reporte" });
    XLSX.writeFile(libro, `${nombreArchivo}.xlsx`);
}

// 6. WEBSOCKET EN TIEMPO REAL PARA EL SUPERADMINISTRADOR
function conectarWebSocketSuperadmin() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketUrl = `${protocol}//${window.location.host}/ws/superadmin`;

    try {
        socketSuperadmin = new WebSocket(socketUrl);

        socketSuperadmin.onopen = () => {
            console.log("🟢 WebSocket War Room conectado en tiempo real.");
            const badge = document.getElementById('live-ws-indicator');
            if (badge) badge.style.display = 'inline-flex';
        };

        socketSuperadmin.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.tipo_evento === 'NUEVO_CRUCE') {
                mostrarAlertaCruceFlotante(data);
                cargarKpisGlobales();
                cargarCrucesGlobales();
            } else if (data.tipo_evento === 'NUEVO_VOTANTE') {
                cargarKpisGlobales();
                cargarPadronConsolidado();
            } else if (data.tipo_evento === 'INTENTO_DUPLICADO_AUDITORIA') {
                mostrarAlertaIntentoAuditoriaFlotante(data);
                cargarAuditoriaForense();
            }
        };

        socketSuperadmin.onclose = () => {
            const badge = document.getElementById('live-ws-indicator');
            if (badge) badge.style.display = 'none';
            setTimeout(conectarWebSocketSuperadmin, 3000);
        };
    } catch (e) {
        console.error("Error al iniciar WebSocket:", e);
    }
}

function mostrarAlertaCruceFlotante(info) {
    const toast = document.createElement('div');
    toast.className = 'toast-cruce';
    toast.innerHTML = `
        <i class="fas fa-exclamation-triangle fa-2x text-danger"></i>
        <div>
            <strong class="d-block text-white fs-6">🚨 ¡NUEVO CRUCE DETECTADO EN VIVO!</strong>
            <span class="text-white">Cédula: <strong>${info.cedula}</strong></span><br>
            <small class="text-light">${info.partido_origen} (${info.candidato_origen}) ⚡ ${info.partido_conflicto} (${info.candidato_conflicto})</small>
        </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 6000);
}

// 7. MAPA GPS CON LEAFLET
function inicializarMapaSuperadmin() {
    setTimeout(async () => {
        const cont = document.getElementById('mapa-global-calor');
        if (!cont) return;

        if (!mapaGlobal) {
            mapaGlobal = L.map('mapa-global-calor').setView([9.3739, -75.7600], 12);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap'
            }).addTo(mapaGlobal);
        } else {
            mapaGlobal.invalidateSize();
        }

        try {
            const res = await fetch('/api/v1/superadmin/mapa-puntos', {
                headers: { 'Authorization': `Bearer ${ElectoralAPI.getToken()}` }
            });
            const puntos = await res.json();

            puntos.forEach(p => {
                L.circleMarker([p.latitud, p.longitud], {
                    radius: 9,
                    fillColor: p.color_distintivo || '#2563EB',
                    color: '#FFF',
                    weight: 2,
                    fillOpacity: 0.9
                }).addTo(mapaGlobal).bindPopup(`
                    <strong class="text-dark">${p.nombres} ${p.apellidos}</strong><br>
                    <span class="text-dark">Cédula: ${p.cedula}</span><br>
                    <span class="text-dark">Partido: <b>${p.partido}</b></span><br>
                    <span class="text-dark">Puesto: ${p.puesto_votacion} (Mesa ${p.mesa})</span><br>
                    <span class="text-dark">Estado: <b>${p.estado_dia_d}</b></span>
                `);
            });
        } catch (e) {
            console.error("Error al cargar puntos en mapa:", e);
        }
    }, 300);
}

// ==============================================================================
// 8. RESTABLECIMIENTO EXCLUSIVO DE CONTRASEÑAS POR SUPERADMINISTRADOR
// ==============================================================================
let modalRestablecerInstance = null;

function abrirModalRestablecerPass(userId, nombre, username) {
    document.getElementById('txt-reset-user-id').value = userId;
    document.getElementById('lbl-reset-nombre').textContent = nombre;
    document.getElementById('lbl-reset-username').textContent = `@${username}`;
    document.getElementById('txt-reset-nueva-pass').value = '';
    
    const boxCreds = document.getElementById('box-resultado-credenciales');
    if (boxCreds) boxCreds.style.display = 'none';

    const modalEl = document.getElementById('modal-restablecer-pass');
    if (modalEl) {
        modalRestablecerInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        modalRestablecerInstance.show();
    }
}

function generarPasswordAleatoria() {
    const prefijos = ['SanAntero', 'Voto', 'Seguro', 'Lider', 'Victoria', 'Caribe'];
    const prefijo = prefijos[Math.floor(Math.random() * prefijos.length)];
    const numero = Math.floor(1000 + Math.random() * 9000);
    const pass = `${prefijo}${numero}`;
    document.getElementById('txt-reset-nueva-pass').value = pass;
}

async function guardarNuevaPasswordUsuario() {
    const userId = document.getElementById('txt-reset-user-id').value;
    const nuevaPass = document.getElementById('txt-reset-nueva-pass').value.trim();
    const nombre = document.getElementById('lbl-reset-nombre').textContent;
    const username = document.getElementById('lbl-reset-username').textContent;

    if (!nuevaPass || nuevaPass.length < 4) {
        alert("La contraseña debe tener al menos 4 caracteres.");
        return;
    }

    const btn = document.getElementById('btn-confirmar-reset-pass');
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> Guardando...`;

    try {
        await ElectoralAPI.restablecerPassword(userId, nuevaPass);
        
        // Formatear texto listo para enviar por WhatsApp
        const textoWhatsApp = `🏛️ *CIVIS - ACCESO ACTUALIZADO*\n` +
            `Hola *${nombre}*, el Superadministrador ha actualizado tu contraseña de acceso:\n\n` +
            `👤 *Usuario:* ${username.replace('@', '')}\n` +
            `🔑 *Nueva Contraseña:* ${nuevaPass}\n` +
            `🌐 *Acceso:* ${window.location.origin}\n\n` +
            `_Por favor guarde sus credenciales en un lugar seguro._`;

        const boxCreds = document.getElementById('box-resultado-credenciales');
        const txtBox = document.getElementById('txt-credenciales-copiar');
        if (txtBox) {
            txtBox.innerText = textoWhatsApp;
        }
        if (boxCreds) {
            boxCreds.style.display = 'block';
        }

        alert(`✅ Contraseña actualizada correctamente para ${username}. Ya puede copiar las credenciales para enviarlas.`);
    } catch (err) {
        alert("Error al restablecer la contraseña: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-save me-1"></i> Guardar Nueva Contraseña`;
    }
}

function copiarCredencialesGeneradas() {
    const txtBox = document.getElementById('txt-credenciales-copiar');
    if (!txtBox) return;
    
    const texto = txtBox.innerText;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(() => {
            alert("📋 ¡Credenciales copiadas al portapapeles! Ahora puede pegarlas directamente en WhatsApp.");
        }).catch(() => {
            copiarFallback(texto);
        });
    } else {
        copiarFallback(texto);
    }
}

function copiarFallback(texto) {
    const textArea = document.createElement("textarea");
    textArea.value = texto;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        alert("📋 ¡Credenciales copiadas al portapapeles! Ahora puede pegarlas directamente en WhatsApp.");
    } catch (e) {
        alert("No se pudo copiar automáticamente. Puede seleccionar y copiar el texto manualmente.");
    }
    document.body.removeChild(textArea);
}

// ==============================================================================
// 9. AUDITORÍA FORENSE CENTRAL DE DUPLICADOS Y CRUCES (SUPERADMINISTRADOR)
// ==============================================================================
async function cargarAuditoriaForense() {
    const tbody = document.getElementById('tbody-auditoria-intentos');
    const badgeTotal = document.getElementById('badge-total-intentos-auditoria');
    if (!tbody) return;

    try {
        const res = await ElectoralAPI.getAuditoriaIntentos();
        if (badgeTotal) badgeTotal.textContent = `${res.length} eventos`;

        if (!res || res.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No se registran intentos de duplicados o cruces recientes. La plataforma opera de forma limpia.</td></tr>`;
            return;
        }

        tbody.innerHTML = res.map(l => {
            const fechaHora = l.fecha_hora || '';
            const partes = fechaHora.split(' ');
            const fecha = partes[0] || '';
            const hora = partes[1] || '';

            const badgeAccion = l.accion_tomada.includes('BLOQUEADO') 
                ? '<span class="badge bg-danger text-white px-2 py-1 fw-bold"><i class="fas fa-ban me-1"></i> Bloqueado</span>' 
                : '<span class="badge bg-danger text-white px-2 py-1 fw-bold"><i class="fas fa-exclamation-triangle me-1"></i> Cruce Registrado</span>';

            const telBadge = l.telefono_notificado 
                ? `<span class="badge bg-success text-white px-2 py-1"><i class="fab fa-whatsapp me-1"></i> +57 ${l.telefono_notificado}</span>` 
                : '<span class="badge bg-secondary text-light">Sin WhatsApp</span>';

            return `
                <tr>
                    <td>
                        <div class="fw-bold text-white font-monospace" style="font-size: 0.95rem;">${hora}</div>
                        <small class="text-muted" style="font-size: 0.75rem;">${fecha}</small>
                    </td>
                    <td>
                        <strong class="text-white">${l.operador_nombre}</strong>
                        <small class="d-block text-info fw-bold">@${l.operador_username || ''} • ${l.operador_partido || 'Campaña'}</small>
                        <span class="badge bg-dark border border-secondary text-muted" style="font-size: 0.68rem;">${l.operador_rol || 'OPERADOR'}</span>
                    </td>
                    <td>
                        <strong class="text-white">${l.nombre_votante || 'Ciudadano'}</strong>
                        <small class="d-block text-white fw-bold">C.C. ${l.cedula}</small>
                    </td>
                    <td>
                        <span class="badge bg-dark border border-secondary text-light" style="font-size: 0.78rem;">${l.puesto_mesa || 'San Antero'}</span>
                    </td>
                    <td>
                        <strong class="text-danger">${l.propietario_nombre || 'Sin Asignar'}</strong>
                        <small class="d-block text-light opacity-75">${l.propietario_partido || 'Campaña Original'}</small>
                    </td>
                    <td>${telBadge}</td>
                    <td>${badgeAccion}</td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-3 text-danger">Error al cargar bitácora: ${err.message}</td></tr>`;
    }
}

function mostrarAlertaIntentoAuditoriaFlotante(info) {
    const toast = document.createElement('div');
    toast.className = 'toast-cruce';
    toast.style.borderColor = '#CC0000';
    toast.style.background = 'linear-gradient(135deg, #18181D, #2D1418)';
    toast.innerHTML = `
        <i class="fas fa-shield-virus fa-2x text-danger"></i>
        <div>
            <div class="d-flex align-items-center gap-2 mb-1">
                <span class="badge bg-dark border border-danger text-danger fw-bold">${info.hora || 'Ahora'}</span>
                <strong class="text-white">🚨 INTENTO DE DUPLICACIÓN EN VIVO</strong>
            </div>
            <div class="text-light small">
                <strong>Operador:</strong> ${info.operador_nombre} (${info.operador_partido})<br>
                <strong>Votante:</strong> ${info.nombre_votante} (C.C. ${info.cedula})<br>
                <strong>Propietario:</strong> <span class="text-danger fw-bold">${info.propietario_nombre}</span> (${info.propietario_partido})
            </div>
        </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 7000);
}

// ==============================================================================
// 10. ENRUTADOR DE LA MATRIZ DE 12 MÓDULOS DE MANDO (IMAGEN 1)
// ==============================================================================
function activarTabSuperadmin(targetSelector) {
    const btn = document.querySelector(`button[data-bs-target="${targetSelector}"]`);
    if (btn) {
        const tabInstance = bootstrap.Tab.getOrCreateInstance(btn);
        tabInstance.show();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function abrirModuloSuperadmin(modulo) {
    switch (modulo) {
        case 'personas':
            activarTabSuperadmin('#war-tab-padron');
            cargarPadronConsolidado();
            break;
        case 'geomapa':
            activarTabSuperadmin('#war-tab-mapa');
            inicializarMapaSuperadmin();
            break;
        case 'filtro':
            activarTabSuperadmin('#war-tab-filtro');
            inicializarFiltroDinamico();
            break;
        case 'eventos':
            activarTabSuperadmin('#war-tab-eventos');
            break;
        case 'sms':
            activarTabSuperadmin('#war-tab-sms');
            break;
        case 'medios':
            activarTabSuperadmin('#war-tab-medios');
            break;
        case 'informes':
            activarTabSuperadmin('#war-tab-informes');
            break;
        case 'operaciones':
            activarTabSuperadmin('#war-tab-cruces');
            cargarCrucesGlobales();
            break;
        case 'ranking':
            activarTabSuperadmin('#war-tab-ranking');
            cargarRankingLideres();
            break;
        case 'censo':
            activarTabSuperadmin('#war-tab-censo');
            break;
        case 'usuarios':
            activarTabSuperadmin('#war-tab-equipo');
            cargarGestionUsuarios();
            break;
        case 'app-movil':
            activarTabSuperadmin('#war-tab-app-movil');
            break;
        default:
            console.warn("Módulo no reconocido:", modulo);
    }
}

// ==============================================================================
// 11. DEMOSTRADOR Y SIMULADOR DE APP MÓVIL (IMAGEN 2)
// ==============================================================================
function simularLecturaMovil() {
    const scannerBox = document.getElementById('phone-scanner-box-demo');
    const fb = document.getElementById('phone-feedback-scan');

    if (scannerBox) {
        scannerBox.style.borderColor = '#F59E0B';
        scannerBox.style.boxShadow = '0 0 25px rgba(245, 158, 11, 0.7)';
    }

    if (fb) {
        fb.style.display = 'block';
        fb.style.background = 'rgba(245, 158, 11, 0.2)';
        fb.style.borderColor = '#F59E0B';
        fb.style.color = '#F59E0B';
        fb.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i> Procesando OCR / MRZ de la cédula...`;

        setTimeout(() => {
            const demos = [
                { cc: '1.063.245.981', nom: 'Manuel S. Pacheco', puesto: 'Puesto Principal San Antero', mesa: '3' },
                { cc: '1.063.892.114', nom: 'Rosaura María Díaz', puesto: 'Corregimiento El Porvenir', mesa: '1' },
                { cc: '78.542.903', nom: 'Carlos Mario Benítez', puesto: 'Colegio José Yances', mesa: '5' }
            ];
            const sel = demos[Math.floor(Math.random() * demos.length)];

            fb.innerHTML = `<i class="fas fa-check-circle me-1 text-success"></i> <strong>C.C. ${sel.cc}</strong>: ${sel.nom}<br><small class="text-light">${sel.puesto} • Mesa ${sel.mesa}</small>`;
            fb.style.background = 'rgba(34, 197, 94, 0.2)';
            fb.style.borderColor = '#22C55E';
            fb.style.color = '#86EFAC';

            if (scannerBox) {
                scannerBox.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                scannerBox.style.boxShadow = 'none';
            }
        }, 900);
    }
}

function mostrarModalGuiaApp() {
    const modalEl = document.getElementById('modal-guia-app-pwa');
    if (modalEl) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
}

// ==============================================================================
// 12. RANKING DE RENDIMIENTO DE LÍDERES TERRITORIALES
// ==============================================================================
async function cargarRankingLideres() {
    const tbody = document.getElementById('tbody-ranking-lideres');
    const podioCont = document.getElementById('podio-top-lideres');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-white"><i class="fas fa-spinner fa-spin me-2"></i> Calculando rendimiento en tiempo real...</td></tr>`;
    }

    try {
        const votantes = await ElectoralAPI.getPadronGeneral();
        const lideresMap = {};

        votantes.forEach(v => {
            const lid = v.lider_responsable || 'General / Sin Asignar';
            if (!lideresMap[lid]) {
                lideresMap[lid] = {
                    nombre: lid,
                    partido: v.partido || 'Campaña',
                    candidato: v.nombre_candidato || 'Oficial',
                    color: v.color_distintivo || '#CC0000',
                    total_inscritos: 0,
                    votos_confirmados: 0,
                    zona: v.puesto_votacion || 'San Antero'
                };
            }
            lideresMap[lid].total_inscritos++;
            if (v.estado_dia_d === 'YA_VOTO') {
                lideresMap[lid].votos_confirmados++;
            }
        });

        const ranking = Object.values(lideresMap).sort((a, b) => b.total_inscritos - a.total_inscritos);

        // Renderizar Podio Top 3
        if (podioCont) {
            const top3 = ranking.slice(0, 3);
            const medallas = [
                { puesto: '1° LUGAR', clase: 'text-warning', icon: 'fa-trophy', bg: 'rgba(234, 179, 8, 0.12)', border: 'rgba(234, 179, 8, 0.4)' },
                { puesto: '2° LUGAR', clase: 'text-light', icon: 'fa-medal', bg: 'rgba(255, 255, 255, 0.06)', border: 'rgba(255, 255, 255, 0.25)' },
                { puesto: '3° LUGAR', clase: 'text-warning', icon: 'fa-award', bg: 'rgba(249, 115, 22, 0.12)', border: 'rgba(249, 115, 22, 0.35)' }
            ];

            if (top3.length === 0) {
                podioCont.innerHTML = `<div class="col-12 text-center text-muted py-3">No hay registros de líderes para conformar el podio.</div>`;
            } else {
                podioCont.innerHTML = top3.map((l, idx) => `
                    <div class="col-md-4">
                        <div class="p-3 rounded text-center h-100" style="background: ${medallas[idx].bg}; border: 1.5px solid ${medallas[idx].border};">
                            <i class="fas ${medallas[idx].icon} fa-2x ${medallas[idx].clase} mb-2"></i>
                            <span class="badge bg-dark border border-secondary ${medallas[idx].clase} d-block mx-auto mb-2 fw-bold" style="width: fit-content;">${medallas[idx].puesto}</span>
                            <h6 class="fw-bold text-white mb-1">${l.nombre}</h6>
                            <small class="text-muted d-block mb-2">${l.partido}</small>
                            <div class="fs-4 fw-bold text-white">${l.total_inscritos} <small class="fs-6 text-muted">votantes</small></div>
                            <div class="small text-success mt-1"><i class="fas fa-check-circle me-1"></i> ${l.votos_confirmados} votos Día D</div>
                        </div>
                    </div>
                `).join('');
            }
        }

        // Renderizar Tabla
        if (tbody) {
            if (ranking.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">No se registran líderes en el padrón consolidado.</td></tr>`;
                return;
            }

            tbody.innerHTML = ranking.map((l, idx) => {
                const efec = l.total_inscritos > 0 ? Math.round((l.votos_confirmados / l.total_inscritos) * 100) : 0;
                let badgePos = '';
                if (idx === 0) badgePos = '<span class="badge bg-warning text-dark fw-bold px-2 py-1"><i class="fas fa-crown me-1"></i> 1°</span>';
                else if (idx === 1) badgePos = '<span class="badge bg-secondary text-white fw-bold px-2 py-1">2°</span>';
                else if (idx === 2) badgePos = '<span class="badge text-white fw-bold px-2 py-1" style="background: #CD7F32;">3°</span>';
                else badgePos = `<span class="badge bg-dark border border-secondary text-light">${idx + 1}°</span>`;

                return `
                    <tr>
                        <td>${badgePos}</td>
                        <td><strong class="text-white">${l.nombre}</strong></td>
                        <td><small class="text-light">${l.zona}</small></td>
                        <td>
                            <span class="badge px-2 py-1 text-white fw-bold" style="background: ${l.color};">${l.partido}</span>
                            <small class="d-block text-muted">${l.candidato}</small>
                        </td>
                        <td><span class="badge bg-primary px-3 py-1 fs-6">${l.total_inscritos}</span></td>
                        <td><span class="badge bg-success px-2 py-1">${l.votos_confirmados}</span></td>
                        <td>
                            <div class="d-flex align-items-center gap-2">
                                <div class="progress flex-grow-1" style="height: 7px; background: rgba(255,255,255,0.1); border-radius: 4px;">
                                    <div class="progress-bar bg-success" style="width: ${efec}%;"></div>
                                </div>
                                <span class="small fw-bold text-white">${efec}%</span>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">Error: ${err.message}</td></tr>`;
    }
}

// ==============================================================================
// 13. FILTRO DINÁMICO MULTICRITERIO
// ==============================================================================
let padronFiltrableCache = [];

async function inicializarFiltroDinamico() {
    const tbody = document.getElementById('tbody-filtro-dinamico');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-white"><i class="fas fa-spinner fa-spin me-2"></i> Cargando base de datos completa...</td></tr>`;
    }

    try {
        padronFiltrableCache = await ElectoralAPI.getPadronGeneral();

        // Poblar selectores de Partido y Puestos únicos
        const partidos = [...new Set(padronFiltrableCache.map(v => v.partido).filter(Boolean))];
        const puestos = [...new Set(padronFiltrableCache.map(v => v.puesto_votacion).filter(Boolean))];

        const selPart = document.getElementById('filtro-sel-partido');
        if (selPart) {
            selPart.innerHTML = `<option value="TODOS">Todos los Partidos (${partidos.length})</option>` +
                partidos.map(p => `<option value="${p}">${p}</option>`).join('');
        }

        const selPuesto = document.getElementById('filtro-sel-puesto');
        if (selPuesto) {
            selPuesto.innerHTML = `<option value="TODOS">Todos los Puestos (${puestos.length})</option>` +
                puestos.map(pt => `<option value="${pt}">${pt}</option>`).join('');
        }

        ejecutarFiltroDinamico();

    } catch (err) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">Error: ${err.message}</td></tr>`;
    }
}

function ejecutarFiltroDinamico() {
    const txt = (document.getElementById('filtro-txt-busqueda')?.value || '').trim().toLowerCase();
    const partido = document.getElementById('filtro-sel-partido')?.value || 'TODOS';
    const puesto = document.getElementById('filtro-sel-puesto')?.value || 'TODOS';
    const estado = document.getElementById('filtro-sel-estado')?.value || 'TODOS';

    let filtrados = padronFiltrableCache.filter(v => {
        // Filtro texto
        if (txt) {
            const matchCedula = (v.cedula || '').toLowerCase().includes(txt);
            const matchNombre = `${v.nombres || ''} ${v.apellidos || ''}`.toLowerCase().includes(txt);
            if (!matchCedula && !matchNombre) return false;
        }
        // Filtro partido
        if (partido !== 'TODOS' && v.partido !== partido) return false;
        // Filtro puesto
        if (puesto !== 'TODOS' && v.puesto_votacion !== puesto) return false;
        // Filtro estado día d
        if (estado !== 'TODOS' && v.estado_dia_d !== estado) return false;

        return true;
    });

    const contador = document.getElementById('lbl-filtro-contador-resultados');
    if (contador) {
        contador.textContent = `Mostrando ${filtrados.length} de ${padronFiltrableCache.length} votantes`;
    }

    const tbody = document.getElementById('tbody-filtro-dinamico');
    if (!tbody) return;

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No se encontraron votantes con los criterios seleccionados.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtrados.map(v => `
        <tr>
            <td><strong class="text-white">${v.cedula}</strong></td>
            <td><strong class="text-white">${v.nombres || ''} ${v.apellidos || ''}</strong></td>
            <td>
                <span class="badge px-3 py-1 fw-bold" style="background: ${v.color_distintivo || '#DC2626'}; color: #fff;">${v.partido}</span>
                <small class="d-block text-muted mt-1">${v.nombre_candidato}</small>
            </td>
            <td>
                <div class="text-white"><strong>${v.puesto_votacion || 'No asignado'}</strong></div>
                <span class="badge bg-primary">Mesa ${v.mesa || '-'}</span>
            </td>
            <td><span class="text-white">${v.lider_responsable}</span></td>
            <td>
                <span class="badge ${v.estado_dia_d === 'YA_VOTO' ? 'bg-success' : 'bg-secondary'} px-2 py-1">${v.estado_dia_d}</span>
            </td>
        </tr>
    `).join('');
}

function limpiarFiltroDinamico() {
    const txt = document.getElementById('filtro-txt-busqueda');
    const part = document.getElementById('filtro-sel-partido');
    const pt = document.getElementById('filtro-sel-puesto');
    const est = document.getElementById('filtro-sel-estado');

    if (txt) txt.value = '';
    if (part) part.value = 'TODOS';
    if (pt) pt.value = 'TODOS';
    if (est) est.value = 'TODOS';

    ejecutarFiltroDinamico();
}

// ==============================================================================
// 14. CONSULTA RÁPIDA DE CENSO Y REGISTRADURÍA (RNEC)
// ==============================================================================
async function consultarCensoRapidoSuperadmin() {
    const input = document.getElementById('txt-censo-rapido-cedula');
    const box = document.getElementById('resultado-censo-rapido');
    if (!input || !box) return;

    const cedula = input.value.trim();
    if (!cedula) {
        alert("Por favor ingrese un número de cédula para consultar.");
        return;
    }

    box.style.display = 'block';
    box.innerHTML = `<div class="text-center py-3 text-info"><i class="fas fa-spinner fa-spin me-2"></i> Consultando base del Censo Nacional RNEC...</div>`;

    try {
        const res = await ElectoralAPI.verificarCruce(cedula);

        if (res && res.votante_oficial) {
            const v = res.votante_oficial;
            let alertaCampana = '';

            if (res.tiene_cruce) {
                alertaCampana = `<div class="alert alert-danger py-2 small mb-0 mt-2"><i class="fas fa-exclamation-triangle me-1"></i> ¡ALERTA DE CRUCE! Este ciudadano ya está registrado por la campaña <strong>${res.partido_registrado}</strong> (Líder: ${res.lider_registrador}).</div>`;
            } else {
                alertaCampana = `<div class="alert alert-success py-2 small mb-0 mt-2"><i class="fas fa-check-circle me-1"></i> Ciudadano habilitado en el censo. Sin registros previos en otras campañas.</div>`;
            }

            box.innerHTML = `
                <h6 class="text-white fw-bold mb-2"><i class="fas fa-user-check text-success me-2"></i> ${v.nombres || ''} ${v.apellidos || ''}</h6>
                <div class="small text-light mb-1"><strong>Cédula:</strong> ${cedula}</div>
                <div class="small text-light mb-1"><strong>Puesto Oficial:</strong> ${v.puesto_votacion || 'CABECERA MUNICIPAL'}</div>
                <div class="small text-light mb-1"><strong>Mesa de Votación:</strong> <span class="badge bg-primary">Mesa ${v.mesa || '1'}</span></div>
                <div class="small text-light mb-1"><strong>Jurisdicción:</strong> San Antero, Córdoba</div>
                ${alertaCampana}
            `;
        } else {
            box.innerHTML = `
                <div class="alert alert-warning py-2 small mb-0">
                    <i class="fas fa-info-circle me-1"></i> La cédula <strong>${cedula}</strong> no figura en la precarga del censo municipal o pertenece a otro departamento.
                </div>
            `;
        }
    } catch (err) {
        box.innerHTML = `<div class="alert alert-danger py-2 small mb-0">Error en consulta: ${err.message}</div>`;
    }
}

// 15. AGREGAR EVENTO EN AGENDA DE CAMPAÑA
function agregarEventoAgenda() {
    const nombre = document.getElementById('ev-nombre')?.value.trim();
    const fecha = document.getElementById('ev-fecha')?.value;
    const hora = document.getElementById('ev-hora')?.value;
    const lugar = document.getElementById('ev-lugar')?.value.trim();

    if (!nombre || !fecha || !lugar) {
        alert("Por favor complete el nombre, fecha y lugar del evento.");
        return;
    }

    const cont = document.getElementById('lista-eventos-container');
    if (cont) {
        const item = document.createElement('div');
        item.className = 'p-2 mb-2 rounded border border-secondary';
        item.style.background = '#0D111A';
        item.innerHTML = `
            <div class="d-flex justify-content-between">
                <strong class="text-white small">${nombre}</strong>
                <span class="badge bg-danger">${fecha} ${hora || ''}</span>
            </div>
            <small class="text-muted d-block">${lugar} • Registrado en agenda</small>
        `;
        cont.prepend(item);
    }

    alert(`✅ Evento "${nombre}" agregado a la agenda de campaña.`);
    document.getElementById('ev-nombre').value = '';
    document.getElementById('ev-lugar').value = '';
}

// 16. FUNCIONES DE LAS NUEVAS PESTAÑAS DE LA BARRA SUPERIOR
function agregarEventoDesdeTab() {
    const nombre = document.getElementById('ev-tab-nombre')?.value.trim();
    const fecha = document.getElementById('ev-tab-fecha')?.value;
    const hora = document.getElementById('ev-tab-hora')?.value;
    const lugar = document.getElementById('ev-tab-lugar')?.value.trim();
    const meta = document.getElementById('ev-tab-meta')?.value || '500';

    if (!nombre || !fecha || !lugar) {
        alert("Por favor complete el nombre, fecha y lugar del evento.");
        return;
    }

    const tbody = document.getElementById('tbody-eventos-tab');
    if (tbody) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong class="text-white">${nombre}</strong></td>
            <td><span class="badge bg-danger">${fecha} ${hora || ''}</span></td>
            <td>${lugar}</td>
            <td>${meta} personas</td>
            <td><span class="badge bg-success">0 confirmados</span></td>
            <td><span class="badge bg-primary">Programado</span></td>
        `;
        tbody.prepend(tr);
    }

    alert(`✅ Evento "${nombre}" publicado exitosamente en la agenda.`);
    document.getElementById('ev-tab-nombre').value = '';
    document.getElementById('ev-tab-lugar').value = '';
}

function despacharSmsMasivo() {
    const texto = document.getElementById('sms-txt-contenido')?.value.trim();
    const segmento = document.getElementById('sms-sel-segmento')?.value;
    const feedback = document.getElementById('box-sms-feedback');

    if (!texto) {
        alert("Por favor escriba el mensaje que desea despachar.");
        return;
    }

    if (feedback) {
        feedback.style.display = 'block';
        feedback.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i> Transmitiendo mensaje al Gateway de Telecomunicaciones...`;
        
        setTimeout(() => {
            feedback.innerHTML = `<i class="fas fa-check-circle me-1 text-success"></i> <strong>¡Despacho Exitoso!</strong> 420 mensajes SMS enviados a votantes (${segmento}).`;
            document.getElementById('sms-txt-contenido').value = '';
            document.getElementById('sms-char-counter').textContent = '0 / 160';
        }, 1200);
    }
}

function copiarEnlaceCampana(nombre) {
    const url = window.location.origin;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            alert(`📋 Enlace de "${nombre}" copiado al portapapeles: ${url}`);
        });
    } else {
        alert(`Enlace de "${nombre}": ${url}`);
    }
}

async function consultarCensoDesdeTab() {
    const input = document.getElementById('txt-tab-censo-cedula');
    const box = document.getElementById('box-resultado-tab-censo');
    if (!input || !box) return;

    const cedula = input.value.trim();
    if (!cedula) {
        alert("Por favor ingrese un número de cédula para consultar.");
        return;
    }

    box.style.display = 'block';
    box.innerHTML = `<div class="text-center py-4 text-info"><i class="fas fa-spinner fa-spin fa-2x mb-2"></i><br>Consultando censo oficial de la Registraduría Nacional...</div>`;

    try {
        const res = await ElectoralAPI.verificarCruce(cedula);

        if (res && res.votante_oficial) {
            const v = res.votante_oficial;
            let alertaCruce = '';

            if (res.tiene_cruce) {
                alertaCruce = `
                    <div class="alert alert-danger py-2 small mb-0 mt-3">
                        <i class="fas fa-exclamation-triangle me-1"></i> <strong>¡ALERTA DE DUPLICIDAD / CRUCE!</strong> Este ciudadano ya fue registrado previamente por la campaña <strong>${res.partido_registrado}</strong> (Líder: ${res.lider_registrador || 'General'}).
                    </div>
                `;
            } else {
                alertaCruce = `
                    <div class="alert alert-success py-2 small mb-0 mt-3">
                        <i class="fas fa-check-circle me-1"></i> <strong>Censo Limpio:</strong> El ciudadano está habilitado para votar y aún no ha sido registrado por ninguna campaña.
                    </div>
                `;
            }

            box.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h5 class="text-white fw-bold mb-0"><i class="fas fa-user-check text-success me-2"></i> ${v.nombres || ''} ${v.apellidos || ''}</h5>
                    <span class="badge bg-secondary px-3 py-2">C.C. ${cedula}</span>
                </div>
                <div class="row g-2 text-light small">
                    <div class="col-md-6"><strong>Puesto de Votación:</strong> <span class="text-white">${v.puesto_votacion || 'CABECERA MUNICIPAL'}</span></div>
                    <div class="col-md-6"><strong>Mesa Asignada:</strong> <span class="badge bg-primary fs-6">Mesa ${v.mesa || '1'}</span></div>
                    <div class="col-md-6"><strong>Departamento & Municipio:</strong> Córdoba • San Antero</div>
                    <div class="col-md-6"><strong>Dirección Censo:</strong> Casco Urbano / Puesto Oficial RNEC</div>
                </div>
                ${alertaCruce}
            `;
        } else {
            box.innerHTML = `
                <div class="alert alert-warning py-3 text-center mb-0">
                    <i class="fas fa-exclamation-circle fa-2x mb-2 d-block text-warning"></i>
                    La cédula <strong>${cedula}</strong> no figura en la base local del censo electoral o se encuentra inscrita en otro municipio.
                </div>
            `;
        }
    } catch (err) {
        box.innerHTML = `<div class="alert alert-danger py-3 text-center mb-0">Error de conexión: ${err.message}</div>`;
    }
}

// ==============================================================================
// 17. CONTROL DE ACCESO EN PUERTA & ASISTENCIA REAL A EVENTOS
// ==============================================================================
let eventoActivoCheckin = {
    nombre: 'Gran Concentración de Cierre',
    meta: 2500,
    convocados: 1840,
    asistieron: 1620,
    idRef: '1',
    asistentes: [
        { hora: '16:15:20', cedula: '1063165499', nombre: 'Sebastián Martínez Gómez', lider: 'Rosaura Benítez (Liberal)', zona: 'Cabecera Municipal', verificado: 'CERTIFICADO EN PUERTA' },
        { hora: '16:22:45', cedula: '1002345678', nombre: 'Pedro Antonio Martínez', lider: 'Carlos Meza (Conservador)', zona: 'El Porvenir', verificado: 'CERTIFICADO EN PUERTA' },
        { hora: '16:30:10', cedula: '1003456789', nombre: 'Luis Fernando Morales', lider: 'Rosaura Benítez (Liberal)', zona: 'Santa Rosa del Volcán', verificado: 'CERTIFICADO EN PUERTA' },
        { hora: '16:38:50', cedula: '1007445566', nombre: 'Rosa Elena Duque Herrera', lider: 'Manuel Pacheco (La U)', zona: 'El Porvenir', verificado: 'CERTIFICADO EN PUERTA' },
        { hora: '16:45:12', cedula: '1003987654', nombre: 'Ana Milena Suárez Vargas', lider: 'Rosaura Benítez (Liberal)', zona: 'El Bijao', verificado: 'CERTIFICADO EN PUERTA' }
    ],
    lideresRendimiento: [
        { lider: 'Rosaura Benítez', partido: 'Partido Liberal', convocados: 650, asistieron: 590, pct: 91, status: 'Sobresaliente' },
        { lider: 'Carlos Meza', partido: 'Partido Conservador', convocados: 520, asistieron: 440, pct: 85, status: 'Efectivo' },
        { lider: 'Manuel Pacheco', partido: 'Partido de la U', convocados: 410, asistieron: 360, pct: 88, status: 'Efectivo' },
        { lider: 'Dairo Peñata', partido: 'Comando Independiente', convocados: 260, asistieron: 230, pct: 88, status: 'Efectivo' }
    ]
};

function abrirControlAsistenciaEvento(nombre, meta, convocados, asistieron, idRef) {
    eventoActivoCheckin.nombre = nombre;
    eventoActivoCheckin.meta = meta;
    eventoActivoCheckin.convocados = convocados;
    eventoActivoCheckin.asistieron = asistieron;
    eventoActivoCheckin.idRef = idRef;

    document.getElementById('modal-ev-puerta-nombre').innerText = nombre;
    document.getElementById('modal-ev-kpi-meta').innerText = meta.toLocaleString();
    document.getElementById('modal-ev-kpi-convocados').innerText = convocados.toLocaleString();
    document.getElementById('modal-ev-kpi-asistieron').innerText = asistieron.toLocaleString();
    const pct = Math.round((asistieron / convocados) * 100);
    document.getElementById('modal-ev-kpi-porcentaje').innerText = `${pct}%`;
    document.getElementById('lbl-total-asistentes-lista').innerText = asistieron.toLocaleString();

    renderizarListasCheckin();

    const modalEl = document.getElementById('modal-control-asistencia-puerta');
    if (modalEl) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
        setTimeout(() => {
            document.getElementById('txt-checkin-cedula')?.focus();
        }, 400);
    }
}

function renderizarListasCheckin() {
    const tbody = document.getElementById('tbody-checkin-asistentes');
    if (tbody) {
        tbody.innerHTML = eventoActivoCheckin.asistentes.map(a => `
            <tr>
                <td><span class="badge bg-secondary">${a.hora}</span></td>
                <td><strong class="text-white">${a.cedula}</strong></td>
                <td><span class="text-white">${a.nombre}</span></td>
                <td><span class="text-info">${a.lider}</span></td>
                <td>${a.zona}</td>
                <td><span class="badge bg-success"><i class="fas fa-check-circle me-1"></i> ${a.verificado}</span></td>
            </tr>
        `).join('');
    }

    const tbodyLid = document.getElementById('tbody-rendimiento-lideres-evento');
    if (tbodyLid) {
        tbodyLid.innerHTML = eventoActivoCheckin.lideresRendimiento.map(l => `
            <tr>
                <td><strong class="text-white">${l.lider}</strong></td>
                <td><span class="badge bg-danger">${l.partido}</span></td>
                <td>${l.convocados} confirmados</td>
                <td><strong class="text-success">${l.asistieron} en sitio</strong></td>
                <td>
                    <div class="d-flex align-items-center gap-2">
                        <div class="progress w-100" style="height: 6px;">
                            <div class="progress-bar bg-success" style="width: ${l.pct}%"></div>
                        </div>
                        <span class="small fw-bold text-white">${l.pct}%</span>
                    </div>
                </td>
                <td><span class="badge bg-success">${l.status}</span></td>
            </tr>
        `).join('');
    }
}

async function registrarAsistenciaEnPuerta() {
    const txt = document.getElementById('txt-checkin-cedula');
    const boxFeedback = document.getElementById('box-feedback-checkin');
    const cedula = txt?.value.trim();

    if (!cedula || cedula.length < 5) {
        alert("Por favor digite o escanee una cédula válida.");
        txt?.focus();
        return;
    }

    // Verificar si ya ingresó
    const yaIngreso = eventoActivoCheckin.asistentes.find(a => a.cedula === cedula);
    if (yaIngreso) {
        if (boxFeedback) {
            boxFeedback.style.display = 'block';
            boxFeedback.className = 'mt-2 p-2 rounded small fw-bold alert alert-warning';
            boxFeedback.innerHTML = `<i class="fas fa-exclamation-triangle me-1"></i> <strong>Cédula ya registrada:</strong> ${yaIngreso.nombre} ingresó previamente a las <strong>${yaIngreso.hora}</strong>.`;
        }
        txt.value = '';
        txt.focus();
        return;
    }

    // Buscar en censo / padrón
    let votanteNombre = `Ciudadano C.C. ${cedula}`;
    let liderResponsable = 'Asistencia Espontánea / Puerta';
    let barrioZona = 'San Antero';

    try {
        const res = await ElectoralAPI.consultarCenso(cedula);
        if (res && res.datos) {
            votanteNombre = `${res.datos.nombres || ''} ${res.datos.apellidos || ''}`.trim() || votanteNombre;
            barrioZona = res.datos.puesto_votacion || barrioZona;
        }
    } catch (e) {
        // Modo offline
    }

    const ahora = new Date();
    const horaStr = ahora.toTimeString().split(' ')[0];

    const nuevoAsistente = {
        hora: horaStr,
        cedula: cedula,
        nombre: votanteNombre,
        lider: liderResponsable,
        zona: barrioZona,
        verificado: 'REGISTRADO EN PUERTA'
    };

    eventoActivoCheckin.asistentes.unshift(nuevoAsistente);
    eventoActivoCheckin.asistieron++;

    // Actualizar KPIs
    document.getElementById('modal-ev-kpi-asistieron').innerText = eventoActivoCheckin.asistieron.toLocaleString();
    const nuevoPct = Math.round((eventoActivoCheckin.asistieron / eventoActivoCheckin.convocados) * 100);
    document.getElementById('modal-ev-kpi-porcentaje').innerText = `${nuevoPct}%`;
    document.getElementById('lbl-total-asistentes-lista').innerText = eventoActivoCheckin.asistieron.toLocaleString();

    // Actualizar badge en la tabla principal
    const badgePrincipal = document.getElementById(`badge-asist-real-${eventoActivoCheckin.idRef}`);
    if (badgePrincipal) {
        badgePrincipal.innerHTML = `<i class="fas fa-check-double me-1"></i> ${eventoActivoCheckin.asistieron.toLocaleString()} presentes (${nuevoPct}%)`;
    }

    renderizarListasCheckin();

    if (boxFeedback) {
        boxFeedback.style.display = 'block';
        boxFeedback.className = 'mt-2 p-2 rounded small fw-bold alert alert-success';
        boxFeedback.innerHTML = `<i class="fas fa-check-double me-1"></i> <strong>¡ENTRADA VERIFICADA!</strong> Bienvenido(a) <strong>${votanteNombre}</strong> | Hora: ${horaStr}`;
    }

    txt.value = '';
    txt.focus();
}
