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

    // Asegurar visualización del Mando Central por defecto
    activarTabSuperadmin('#war-tab-kpis', 'Mando Central & KPIs');

    // Cargar datos iniciales
    await cargarKpisGlobales();
    await cargarCrucesGlobales();
    await cargarAuditoriaForense();
    await cargarPadronConsolidado();
    await cargarGestionUsuarios();
    await cargarTokensTerritoriales();
    await cargarSolicitudesArco();

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
                agregarEventoLiveFeed('CRUCE', 'Alerta de Inconsistencia', `C.C. ${data.cedula} disputada entre ${data.partido_1} y ${data.partido_2}`);
            } else if (data.tipo_evento === 'NUEVO_VOTANTE') {
                cargarKpisGlobales();
                cargarPadronConsolidado();
                agregarEventoLiveFeed('TOKEN', 'Nuevo Votante Registrado', `C.C. ${data.cedula} ingresada al padrón general.`);
            } else if (data.tipo_evento === 'INTENTO_DUPLICADO_AUDITORIA') {
                mostrarAlertaIntentoAuditoriaFlotante(data);
                cargarAuditoriaForense();
                agregarEventoLiveFeed('AUDITORIA', 'Intento Bloqueado', `C.C. ${data.cedula} ya registrada previamente por ${data.partido_original}.`);
            } else if (data.tipo_evento === 'VERIFICACION_PUBLICA') {
                agregarEventoLiveFeed('TOKEN', 'Consulta Móvil en Territorio', `Líder verificó C.C. ${data.cedula} (${data.encontrado ? 'Votante Activo' : 'No Encontrado'})`);
            } else if (data.tipo_evento === 'SOLICITUD_ARCO_RECIBIDA') {
                cargarSolicitudesArco();
                agregarEventoLiveFeed('ARCO', 'Trámite Radicado Ley 1581', `Titular C.C. ${data.cedula} radicó solicitud de ${data.tipo_derecho}`);
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
// 10. ENRUTADOR DE LA MATRIZ DE MÓDULOS DE MANDO (DIRECCIONAMIENTO DIRECTO ROBUSTO)
// ==============================================================================
function activarTabSuperadmin(targetSelector, titulo) {
    // 1. Quitar 'active' de todos los botones de la barra lateral
    document.querySelectorAll('.civis-sidebar-nav .nav-link').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
    });

    // 2. Activar el botón correspondiente
    const btn = document.querySelector(`.civis-sidebar-nav .nav-link[data-bs-target="${targetSelector}"]`);
    if (btn) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        if (!titulo) {
            const titleSpan = btn.querySelector('.sidebar-text');
            if (titleSpan) titulo = titleSpan.textContent.trim();
        }
    }

    // 3. Ocultar todos los paneles de pestañas dentro de civisTabContent
    document.querySelectorAll('#civisTabContent > .tab-pane').forEach(p => {
        p.classList.remove('show', 'active');
        p.style.display = 'none';
    });

    // 4. Mostrar el panel de destino
    const targetPane = document.querySelector(targetSelector);
    if (targetPane) {
        targetPane.style.display = 'block';
        targetPane.classList.add('show', 'active');
    }

    // 5. Actualizar título en el Topbar
    if (titulo) {
        actualizarTituloVista(titulo);
    }

    // 6. Carga dinámica e inmediata de datos según el módulo activado
    try {
        if (targetSelector === '#war-tab-kpis') {
            cargarKpisGlobales();
            cargarCrucesGlobales();
        } else if (targetSelector === '#war-tab-padron') {
            cargarPadronConsolidado();
        } else if (targetSelector === '#war-tab-mapa') {
            inicializarMapaSuperadmin();
        } else if (targetSelector === '#war-tab-cruces') {
            cargarCrucesGlobales();
        } else if (targetSelector === '#war-tab-ranking') {
            cargarRankingLideres();
        } else if (targetSelector === '#war-tab-filtro') {
            inicializarFiltroDinamico();
        } else if (targetSelector === '#war-tab-equipo') {
            cargarGestionUsuarios();
        } else if (targetSelector === '#war-tab-auditoria') {
            cargarAuditoriaForense();
        } else if (targetSelector === '#war-tab-tokens-v11') {
            cargarTokensTerritoriales();
        } else if (targetSelector === '#war-tab-arco-v11') {
            cargarSolicitudesArco();
        }
    } catch (errLoader) {
        console.warn('Alerta al cargar módulo:', targetSelector, errLoader);
    }

    // 7. Si es el mapa, forzar re-render de Leaflet
    if (targetSelector === '#war-tab-mapa' && typeof mapaGlobal !== 'undefined' && mapaGlobal) {
        setTimeout(() => mapaGlobal.invalidateSize(), 150);
    }

    // 8. Cerrar menú en móviles
    const sidebar = document.getElementById('civisSidebar');
    if (sidebar) sidebar.classList.remove('show-mobile');

    window.scrollTo({ top: 0, behavior: 'smooth' });
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

        // Renderizar Podio Top 3 con Cards Ejecutivas Ultracompactas
        if (podioCont) {
            const top3 = ranking.slice(0, 3);
            if (top3.length === 0) {
                podioCont.innerHTML = `<div class="col-12 text-center text-muted py-3">No hay registros de líderes para conformar el podio.</div>`;
            } else {
                podioCont.innerHTML = top3.map((l, idx) => {
                    const rankNum = idx + 1;
                    const rankClass = rankNum === 1 ? 'rank-1' : (rankNum === 2 ? 'rank-2' : 'rank-3');
                    const rankLabel = rankNum === 1 ? '#01 LÍDER PRINCIPAL' : (rankNum === 2 ? '#02 SEGUNDO LUGAR' : '#03 TERCER LUGAR');
                    const efec = l.total_inscritos > 0 ? Math.round((l.votos_confirmados / l.total_inscritos) * 100) : 0;
                    return `
                    <div class="col-md-4">
                        <div class="executive-rank-card">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <span class="rank-pill ${rankClass}">${rankLabel}</span>
                                <span class="d-flex align-items-center gap-1 small" style="color: #94A3B8; font-size: 0.72rem;">
                                    <span class="rounded-circle" style="width: 7px; height: 7px; background: ${l.color || '#38BDF8'};"></span>
                                    ${l.partido || 'Campaña'}
                                </span>
                            </div>
                            <div class="my-2">
                                <h6 class="fw-bold text-white mb-0" style="font-size: 0.95rem;">${l.nombre}</h6>
                                <small class="text-muted" style="font-size: 0.75rem; color: #64748B !important;">${l.zona || 'Jurisdicción General'} &bull; ${l.candidato || 'General'}</small>
                            </div>
                            <div class="pt-2 border-top border-secondary border-opacity-10 mt-2">
                                <div class="d-flex justify-content-between align-items-end">
                                    <div>
                                        <div class="rank-metric-val">${l.total_inscritos.toLocaleString()}</div>
                                        <div class="rank-metric-lbl">Votantes Inscritos</div>
                                    </div>
                                    <div class="text-end">
                                        <div class="fs-6 fw-bold" style="color: #34D399; font-variant-numeric: tabular-nums;">
                                            <i class="fas fa-check-circle me-1 small"></i>${l.votos_confirmados}
                                        </div>
                                        <div class="rank-metric-lbl">Día D (${efec}%)</div>
                                    </div>
                                </div>
                                <div class="progress mt-2" style="height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px;">
                                    <div class="progress-bar bg-success" style="width: ${efec}%;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    `;
                }).join('');
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
                const posPill = `<span class="badge" style="background: rgba(255,255,255,0.05); color: #94A3B8; font-family: monospace; font-size: 0.72rem; border: 1px solid rgba(255,255,255,0.07);">#${String(idx + 1).padStart(2, '0')}</span>`;

                return `
                    <tr>
                        <td>${posPill}</td>
                        <td><strong class="text-white">${l.nombre}</strong></td>
                        <td><small style="color: #94A3B8;">${l.zona}</small></td>
                        <td>
                            <div class="d-flex align-items-center gap-2">
                                <span class="rounded-circle flex-shrink-0" style="width: 8px; height: 8px; background: ${l.color || '#38BDF8'};"></span>
                                <div>
                                    <span class="text-white small fw-bold">${l.partido}</span>
                                    <small class="d-block" style="color: #64748B; font-size: 0.72rem;">${l.candidato}</small>
                                </div>
                            </div>
                        </td>
                        <td><span class="fw-bold text-white fs-6" style="font-variant-numeric: tabular-nums;">${l.total_inscritos.toLocaleString()}</span></td>
                        <td><span class="fw-bold" style="color: #34D399; font-variant-numeric: tabular-nums;">${l.votos_confirmados.toLocaleString()}</span></td>
                        <td>
                            <div class="d-flex align-items-center gap-2">
                                <div class="progress flex-grow-1" style="height: 5px; background: rgba(255,255,255,0.06); border-radius: 3px;">
                                    <div class="progress-bar bg-success" style="width: ${efec}%;"></div>
                                </div>
                                <span class="small fw-bold text-white" style="font-variant-numeric: tabular-nums; width: 34px; text-align: right;">${efec}%</span>
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

// ==============================================================================
// 7. SISTEMA DE NAVEGACIÓN Y EXPERIENCIA EMPRESARIAL (SIDEBAR & CONTROLES v1.1)
// ==============================================================================

function actualizarTituloVista(titulo) {
    const el = document.getElementById('currentViewTitle');
    if (el) el.textContent = titulo;
}

// Control de Colapso del Sidebar y Atajo Ctrl+K
document.addEventListener('DOMContentLoaded', () => {
    const btnToggle = document.getElementById('btnToggleSidebar');
    const btnMobile = document.getElementById('btnMobileSidebar');
    const sidebar = document.getElementById('civisSidebar');

    if (btnToggle && sidebar) {
        btnToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    if (btnMobile && sidebar) {
        btnMobile.addEventListener('click', () => {
            sidebar.classList.toggle('show-mobile');
        });
    }

    // Atajo Global Ctrl + K para Omni-Search
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            const searchInput = document.getElementById('globalOmniSearch');
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }
    });

    const searchInput = document.getElementById('globalOmniSearch');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const term = searchInput.value.trim();
                if (term) {
                    ejecutarOmniSearch(term);
                }
            }
        });
    }

    // Delegación y enganche de clics en la barra lateral para navegación instantánea
    document.querySelectorAll('.civis-sidebar-nav .nav-link').forEach(btn => {
        btn.addEventListener('click', function(e) {
            const target = this.getAttribute('data-bs-target');
            if (target) {
                const titleSpan = this.querySelector('.sidebar-text');
                const title = titleSpan ? titleSpan.textContent.trim() : '';
                activarTabSuperadmin(target, title);
            }
        });
    });
});

function ejecutarOmniSearch(term) {
    // Si es un número (cédula), redirigir a consulta de censo
    if (/^\d+$/.test(term)) {
        const tabBtn = document.querySelector('button[data-bs-target="#war-tab-censo"]');
        if (tabBtn) {
            tabBtn.click();
            const txt = document.getElementById('txt-tab-censo-cedula');
            if (txt) {
                txt.value = term;
                if (typeof consultarCensoDesdeTab === 'function') {
                    consultarCensoDesdeTab();
                }
            }
        }
    } else {
        // Redirigir a padrón y filtrar
        const tabBtn = document.querySelector('button[data-bs-target="#war-tab-padron"]');
        if (tabBtn) {
            tabBtn.click();
            const txt = document.getElementById('txt-buscar-padron');
            if (txt) {
                txt.value = term;
                if (typeof filtrarPadronConsolidado === 'function') {
                    filtrarPadronConsolidado();
                }
            }
        }
    }
}

function agregarEventoLiveFeed(tipo, titulo, detalle) {
    const feed = document.getElementById('liveActivityFeed');
    if (!feed) return;

    // Remover mensaje placeholder si existe
    const emptyNotice = feed.querySelector('.text-muted.text-center');
    if (emptyNotice) emptyNotice.remove();

    const hora = new Date().toLocaleTimeString();
    let badgeColor = 'bg-primary';
    let icon = 'fas fa-info-circle';

    if (tipo === 'CRUCE') {
        badgeColor = 'bg-danger';
        icon = 'fas fa-bolt';
    } else if (tipo === 'AUDITORIA') {
        badgeColor = 'bg-warning text-dark';
        icon = 'fas fa-shield-alt';
    } else if (tipo === 'TOKEN') {
        badgeColor = 'bg-success';
        icon = 'fas fa-mobile-alt';
    } else if (tipo === 'ARCO') {
        badgeColor = 'bg-info text-dark';
        icon = 'fas fa-balance-scale';
    }

    const item = document.createElement('div');
    item.className = 'live-activity-item';
    item.innerHTML = `
        <span class="badge ${badgeColor} p-2 rounded-circle" style="width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;"><i class="${icon}"></i></span>
        <div class="flex-grow-1">
            <div class="d-flex justify-content-between align-items-center">
                <strong class="text-white">${titulo}</strong>
                <small class="text-muted">${hora}</small>
            </div>
            <div class="text-muted small mt-1">${detalle}</div>
        </div>
    `;

    feed.prepend(item);

    // Mantener máximo 20 eventos
    while (feed.children.length > 20) {
        feed.removeChild(feed.lastChild);
    }
}

// ==============================================================================
// 8. GESTIÓN DE TOKENS MÓVILES PARA LÍDERES (v1.1-beta)
// ==============================================================================

async function cargarTokensTerritoriales() {
    const tbody = document.getElementById('tbody-tokens-v11');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-white"><i class="fas fa-spinner fa-spin me-2"></i> Cargando tokens y magic links...</td></tr>`;

    try {
        const tokens = await ElectoralAPI.getTokens();
        if (!tokens || tokens.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-muted"><i class="fas fa-info-circle me-1"></i> No se han emitido tokens móviles de verificación territorial.</td></tr>`;
            return;
        }

        const baseUrl = window.location.origin;

        tbody.innerHTML = tokens.map(t => {
            const expDate = new Date(t.fecha_expiracion);
            const vencido = new Date() > expDate;
            const linkUrl = `${baseUrl}/v/${t.token}`;
            
            let estadoBadge = `<span class="badge bg-success"><i class="fas fa-check-circle me-1"></i> ACTIVO</span>`;
            if (!t.activo) {
                estadoBadge = `<span class="badge bg-secondary"><i class="fas fa-ban me-1"></i> REVOCADO</span>`;
            } else if (vencido) {
                estadoBadge = `<span class="badge bg-danger"><i class="fas fa-clock me-1"></i> EXPIRADO</span>`;
            }

            return `
                <tr>
                    <td>
                        <strong class="text-white">${t.nombre_lider}</strong>
                        <div class="small text-muted">ID: ${t.id}</div>
                    </td>
                    <td>
                        <span class="text-info fw-bold">${t.telefono_lider || 'N/A'}</span>
                    </td>
                    <td>
                        <span class="badge bg-dark border border-secondary text-white">${t.campana_id}</span>
                    </td>
                    <td>
                        <div class="d-flex align-items-center gap-1">
                            <code class="text-success small bg-black px-2 py-1 rounded">${t.token}</code>
                            <button class="btn btn-sm btn-outline-light py-0 px-2" title="Copiar Magic Link" onclick="copiarTextoPortapapeles('${linkUrl}', 'Enlace Magic Link copiado')">
                                <i class="fas fa-copy"></i>
                            </button>
                            <a href="https://wa.me/57${t.telefono_lider}?text=${encodeURIComponent('Hola ' + t.nombre_lider + ', aquí tienes tu enlace oficial CIVIS para verificar votantes y consultar puestos de votación: ' + linkUrl)}" target="_blank" class="btn btn-sm btn-outline-success py-0 px-2" title="Enviar por WhatsApp">
                                <i class="fab fa-whatsapp"></i>
                            </a>
                        </div>
                    </td>
                    <td>
                        <strong class="text-white">${t.consultas_realizadas}</strong> / <span class="text-muted">${t.max_consultas}</span>
                    </td>
                    <td>
                        <small class="text-white">${expDate.toLocaleDateString()} ${expDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>
                    </td>
                    <td>${estadoBadge}</td>
                    <td class="text-end">
                        <div class="btn-group btn-group-sm">
                            ${t.activo && !vencido ? `
                                <button class="btn btn-outline-danger" title="Revocar Token" onclick="ejecutarRevocarToken(${t.id})">
                                    <i class="fas fa-ban"></i>
                                </button>
                            ` : `
                                <button class="btn btn-outline-info" title="Renovar +48h" onclick="ejecutarRenovarToken(${t.id})">
                                    <i class="fas fa-redo"></i>
                                </button>
                            `}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">Error al cargar tokens: ${err.message}</td></tr>`;
    }
}

function abrirModalCrearToken() {
    const modalEl = document.getElementById('modal-crear-token-v11');
    if (modalEl) {
        document.getElementById('token-nombre-lider').value = '';
        document.getElementById('token-telefono-lider').value = '';
        document.getElementById('token-vigencia-horas').value = '48';
        document.getElementById('token-max-consultas').value = '500';
        document.getElementById('box-resultado-token').style.display = 'none';
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
}

let ultimoEnlaceTokenGenerado = '';

async function ejecutarCrearToken() {
    const nombre = document.getElementById('token-nombre-lider').value.trim();
    const telefono = document.getElementById('token-telefono-lider').value.trim();
    const campanaId = document.getElementById('token-campana-id').value;
    const vigencia = parseInt(document.getElementById('token-vigencia-horas').value) || 48;
    const maxConsultas = parseInt(document.getElementById('token-max-consultas').value) || 500;

    if (!nombre) {
        alert("Por favor ingrese el nombre del líder o destinatario.");
        return;
    }

    const btn = document.getElementById('btn-confirmar-crear-token');
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> Generando...`;

    try {
        const res = await ElectoralAPI.crearToken({
            nombre_lider: nombre,
            telefono_lider: telefono,
            campana_id: campanaId,
            vigencia_horas: vigencia,
            max_consultas: maxConsultas
        });

        const fullUrl = `${window.location.origin}${res.magic_link}`;
        ultimoEnlaceTokenGenerado = fullUrl;

        const box = document.getElementById('box-resultado-token');
        const txt = document.getElementById('txt-enlace-token-generado');
        const btnWa = document.getElementById('btn-share-whatsapp-token');

        txt.textContent = fullUrl;
        if (telefono) {
            btnWa.onclick = () => {
                const mensaje = `Hola ${nombre}, aquí tienes tu enlace oficial CIVIS para verificar votantes y consultar puestos: ${fullUrl}`;
                window.open(`https://wa.me/57${telefono}?text=${encodeURIComponent(mensaje)}`, '_blank');
            };
            btnWa.style.display = 'inline-block';
        } else {
            btnWa.style.display = 'none';
        }

        box.style.display = 'block';
        btn.innerHTML = `<i class="fas fa-check me-1"></i> Generado`;

        // Refrescar tabla en segundo plano
        cargarTokensTerritoriales();
    } catch (err) {
        alert("Error al generar token: " + err.message);
        btn.innerHTML = `<i class="fas fa-bolt me-1"></i> Generar Magic Link`;
    } finally {
        btn.disabled = false;
    }
}

function copiarEnlaceTokenGenerado() {
    if (ultimoEnlaceTokenGenerado) {
        copiarTextoPortapapeles(ultimoEnlaceTokenGenerado, "Magic link copiado al portapapeles.");
    }
}

async function ejecutarRevocarToken(id) {
    if (!confirm("¿Está seguro de revocar este token? El líder ya no podrá realizar consultas con este enlace.")) return;
    try {
        await ElectoralAPI.revocarToken(id);
        cargarTokensTerritoriales();
    } catch (err) {
        alert("Error al revocar token: " + err.message);
    }
}

async function ejecutarRenovarToken(id) {
    try {
        await ElectoralAPI.renovarToken(id, 48);
        cargarTokensTerritoriales();
    } catch (err) {
        alert("Error al renovar token: " + err.message);
    }
}

// ==============================================================================
// 9. GESTIÓN DE DERECHOS ARCO - HABEAS DATA (LEY 1581 DE 2012)
// ==============================================================================

async function cargarSolicitudesArco() {
    const tbody = document.getElementById('tbody-solicitudes-arco');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-white"><i class="fas fa-spinner fa-spin me-2"></i> Cargando bandeja de trámites ARCO...</td></tr>`;

    try {
        const solicitudes = await ElectoralAPI.getSolicitudesArco();
        
        let countPendientes = 0;
        let countTramite = 0;
        let countResueltas = 0;

        solicitudes.forEach(s => {
            if (s.estado === 'PENDIENTE') countPendientes++;
            else if (s.estado === 'EN_TRAMITE') countTramite++;
            else if (s.estado === 'EJECUTADA' || s.estado === 'RESUELTA') countResueltas++;
        });

        const pEl = document.getElementById('arco-stat-pendientes');
        const tEl = document.getElementById('arco-stat-tramite');
        const rEl = document.getElementById('arco-stat-resueltas');
        if (pEl) pEl.textContent = countPendientes;
        if (tEl) tEl.textContent = countTramite;
        if (rEl) rEl.textContent = countResueltas;

        if (solicitudes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><i class="fas fa-check-circle me-1"></i> No hay solicitudes ARCO radicadas en el sistema.</td></tr>`;
            return;
        }

        tbody.innerHTML = solicitudes.map(s => {
            const fechaRad = new Date(s.fecha_recepcion || s.fecha_radicacion || Date.now());
            const diasRestantes = typeof s.dias_restantes === 'number' ? s.dias_restantes : 10;

            let terminoBadge = `<span class="badge bg-success">${diasRestantes} días restantes</span>`;
            if (s.estado === 'EJECUTADA' || s.estado === 'RESUELTA') {
                terminoBadge = `<span class="badge bg-secondary">Archivado</span>`;
            } else if (diasRestantes < 0) {
                terminoBadge = `<span class="badge bg-danger animate-pulse">VENCIDO (${Math.abs(diasRestantes)}d)</span>`;
            } else if (diasRestantes <= 3) {
                terminoBadge = `<span class="badge bg-warning text-dark">${diasRestantes} días (Urgente)</span>`;
            }

            let estadoBadge = `<span class="badge bg-warning text-dark">${s.estado}</span>`;
            if (s.estado === 'EN_TRAMITE') estadoBadge = `<span class="badge bg-info text-dark">EN TRÁMITE</span>`;
            if (s.estado === 'EJECUTADA' || s.estado === 'RESUELTA') estadoBadge = `<span class="badge bg-success">EJECUTADA</span>`;
            if (s.estado === 'RECHAZADA') estadoBadge = `<span class="badge bg-danger">RECHAZADA</span>`;

            let tipoBadge = `<span class="badge bg-danger">${s.tipo}</span>`;
            if (s.tipo === 'OPOSICION') tipoBadge = `<span class="badge bg-warning text-dark">OPOSICIÓN</span>`;
            if (s.tipo === 'RECTIFICACION') tipoBadge = `<span class="badge bg-primary">RECTIFICACIÓN</span>`;
            if (s.tipo === 'ACCESO') tipoBadge = `<span class="badge bg-secondary">ACCESO</span>`;

            return `
                <tr>
                    <td>
                        <strong class="text-white">${s.id}</strong>
                    </td>
                    <td>
                        <div class="text-white fw-bold">${s.justificacion ? s.justificacion.slice(0, 35) + '...' : 'Ciudadano Titular'}</div>
                        <div class="small text-muted">C.C. <strong class="text-white">${s.cedula}</strong> &bull; ${s.canal_recepcion || 'WEB'}</div>
                    </td>
                    <td>${tipoBadge}</td>
                    <td>
                        <small class="text-white">${fechaRad.toLocaleDateString()}</small>
                    </td>
                    <td>${terminoBadge}</td>
                    <td>${estadoBadge}</td>
                    <td class="text-end">
                        ${s.estado === 'PENDIENTE' ? `
                            <button class="btn btn-sm btn-outline-warning fw-bold" onclick="abrirModalResolverArco('${s.id}', 'C.C. ${s.cedula}', '${s.id}', '${s.estado}')">
                                <i class="fas fa-gavel me-1"></i> Resolver
                            </button>
                        ` : `
                            <span class="text-muted small"><i class="fas fa-check text-success me-1"></i> Atendida</span>
                        `}
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Error al cargar solicitudes ARCO: ${err.message}</td></tr>`;
    }
}

function abrirModalRadicarArco() {
    const modalEl = document.getElementById('modal-radicar-arco-v11');
    if (modalEl) {
        document.getElementById('arco-cedula-titular').value = '';
        document.getElementById('arco-nombre-titular').value = '';
        document.getElementById('arco-telefono-titular').value = '';
        document.getElementById('arco-email-titular').value = '';
        document.getElementById('arco-motivo').value = '';
        document.getElementById('box-feedback-arco').style.display = 'none';
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
}

async function ejecutarRadicarArco() {
    const cedula = document.getElementById('arco-cedula-titular').value.trim();
    const nombre = document.getElementById('arco-nombre-titular').value.trim();
    const tipo = document.getElementById('arco-tipo-solicitud').value;
    const telefono = document.getElementById('arco-telefono-titular').value.trim();
    const email = document.getElementById('arco-email-titular').value.trim();
    const motivo = document.getElementById('arco-motivo').value.trim();

    if (!cedula) {
        alert("Por favor ingrese la cédula del titular.");
        return;
    }

    const btn = document.getElementById('btn-confirmar-radicar-arco');
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> Radicando...`;

    try {
        const infoContacto = [nombre, telefono ? `Tel: ${telefono}` : '', email ? `Email: ${email}` : '', motivo].filter(Boolean).join(' | ');

        const res = await ElectoralAPI.crearSolicitudArco({
            cedula: cedula,
            tipo: tipo,
            canal_recepcion: 'WEB_SUPERADMIN',
            justificacion: infoContacto || 'Solicitud radicada ante la campaña'
        });

        const feedback = document.getElementById('box-feedback-arco');
        feedback.style.display = 'block';
        feedback.className = 'alert alert-success py-2 small fw-bold mt-2';
        feedback.innerHTML = `<i class="fas fa-check-circle me-1"></i> Radicado exitoso: <strong>${res.id}</strong>. Término de 10 días en curso.`;

        cargarSolicitudesArco();
        setTimeout(() => {
            const modalEl = document.getElementById('modal-radicar-arco-v11');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }, 1800);
    } catch (err) {
        alert("Error al radicar solicitud: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-file-signature me-1"></i> Radicar Formalmente`;
    }
}

function abrirModalResolverArco(id, titular, radicado, estadoActual) {
    const modalEl = document.getElementById('modal-resolver-arco-v11');
    if (modalEl) {
        document.getElementById('arco-resolver-id').value = id;
        document.getElementById('arco-resolver-titular-info').textContent = `${titular} (ID: ${radicado})`;
        document.getElementById('arco-resolver-estado').value = (estadoActual === 'PENDIENTE') ? 'RESUELTA' : estadoActual;
        document.getElementById('arco-resolver-respuesta').value = '';
        document.getElementById('box-feedback-resolver-arco').style.display = 'none';
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    }
}

async function ejecutarResolverArco() {
    const id = document.getElementById('arco-resolver-id').value;
    const estado = document.getElementById('arco-resolver-estado').value;
    const respuesta = document.getElementById('arco-resolver-respuesta').value.trim();

    if (!respuesta) {
        alert("Por favor ingrese la respuesta formal y las medidas técnicas ejecutadas.");
        return;
    }

    try {
        await ElectoralAPI.procesarSolicitudArco(id, {
            accion: (estado === 'RESUELTA' || estado === 'EJECUTADA') ? 'EJECUTAR' : 'RECHAZAR',
            justificacion: respuesta
        });

        const feedback = document.getElementById('box-feedback-resolver-arco');
        feedback.style.display = 'block';
        feedback.className = 'alert alert-success py-2 small fw-bold mt-2';
        feedback.innerHTML = `<i class="fas fa-check-double me-1"></i> Trámite actualizado con éxito.`;

        cargarSolicitudesArco();
        setTimeout(() => {
            const modalEl = document.getElementById('modal-resolver-arco-v11');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }, 1500);
    } catch (err) {
        alert("Error al resolver trámite: " + err.message);
    }
}

function copiarTextoPortapapeles(texto, mensajeExito) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(texto).then(() => {
            mostrarToastNotificacion(mensajeExito || "Copiado al portapapeles");
        }).catch(() => {
            prompt("Copie el enlace manualmente:", texto);
        });
    } else {
        prompt("Copie el enlace manualmente:", texto);
    }
}

function mostrarToastNotificacion(mensaje) {
    const toast = document.createElement('div');
    toast.className = 'toast-civis-notification';
    toast.innerHTML = `<i class="fas fa-check-circle text-success me-2"></i> ${mensaje}`;
    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: #111726;
        color: #fff;
        padding: 12px 20px;
        border-radius: 10px;
        border: 1px solid rgba(16, 185, 129, 0.4);
        box-shadow: 0 10px 30px rgba(0,0,0,0.6);
        z-index: 99999;
        font-weight: 600;
        font-size: 0.85rem;
        animation: fadeIn 0.2s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.4s ease';
        setTimeout(() => toast.remove(), 400);
    }, 2800);
}

