// ==============================================================================
// CONSOLA OPERATIVA GUIADA PARA CANDIDATOS Y LÍDERES (SIMPLE Y DINÁMICA)
// CON TEMA VISUAL DINÁMICO SEGÚN EL PARTIDO POLÍTICO
// ==============================================================================

let datosCensoActual = null;
let estadoVerificacionActual = null;

// Paleta oficial de partidos políticos colombianos (Principal: Partido Liberal Colombiano #CC0000)
const MAPA_COLORES_PARTIDOS = {
    'liberal': '#CC0000',           // Rojo Oficial Partido Liberal Colombiano
    'conservador': '#0033A0',       // Azul Real
    'la u': '#FF8200',              // Naranja Institucional
    'partido de la u': '#FF8200',   // Naranja Institucional
    'alianza verde': '#10B981',     // Verde Esmeralda
    'verde': '#10B981',             // Verde Esmeralda
    'cambio radical': '#0284C7',    // Azul Celeste / Turquesa
    'centro democratico': '#0EA5E9',// Azul Cielo
    'centro democrático': '#0EA5E9',// Azul Cielo
    'pacto historico': '#8B5CF6',   // Morado / Púrpura
    'pacto histórico': '#8B5CF6',   // Morado / Púrpura
    'nuevo liberalismo': '#BE123C', // Rojo Vino
    'mira': '#4338CA',              // Azul Índigo
    'mais': '#D97706',              // Ámbar
    'independiente': '#06B6D4'      // Cian Eléctrico
};

function resolverColorPartido(partido, colorDefinido) {
    if (colorDefinido && colorDefinido.startsWith('#') && colorDefinido.length >= 4) {
        return colorDefinido;
    }
    if (!partido) return '#CC0000';
    const norm = partido.toLowerCase().trim();
    for (const [key, hex] of Object.entries(MAPA_COLORES_PARTIDOS)) {
        if (norm.includes(key)) {
            return hex;
        }
    }
    return '#CC0000';
}

function aplicarTemaPartido(colorHex, nombrePartido, nombreCandidato, rol, zona, nombreUsuario) {
    const colorPartido = resolverColorPartido(nombrePartido, colorHex);
    const color = colorPartido || '#CC0000';

    // Descomponer hex a RGB para generar transparencias dinámicas
    let hex = color.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.substring(0, 2), 16) || 204;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;

    // Inyectar variables CSS en el contenedor de la consola
    const container = document.getElementById('view-lider');
    if (container) {
        container.style.setProperty('--party-color', color);
        container.style.setProperty('--party-color-rgb', `${r}, ${g}, ${b}`);
        container.style.setProperty('--party-color-dark', '#880000');
        container.style.setProperty('--party-glow', 'rgba(0, 0, 0, 0.35)');
        container.style.setProperty('--party-glow-strong', 'rgba(0, 0, 0, 0.55)');
        container.style.setProperty('--party-soft', 'rgba(204, 0, 0, 0.08)');
        container.style.setProperty('--party-border', 'rgba(255, 255, 255, 0.08)');
        container.style.setProperty('--party-gradient', `linear-gradient(135deg, ${color}, #990000)`);
    }

    // Actualizar badge superior del header
    const partyBadge = document.getElementById('badge-partido-user');
    if (partyBadge) {
        partyBadge.style.backgroundColor = color;
        partyBadge.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.35)';
        partyBadge.style.color = '#FFFFFF';
        partyBadge.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        partyBadge.innerHTML = `<i class="fas fa-flag me-1"></i> ${nombrePartido || 'Campaña'}`;
    }

    // Actualizar elementos de la cinta de campaña oficial
    const bannerBadge = document.getElementById('banner-partido-nombre');
    if (bannerBadge) bannerBadge.textContent = (nombrePartido || 'PARTIDO POLÍTICO').toUpperCase();

    const bannerCand = document.getElementById('banner-candidato-nombre');
    if (bannerCand) bannerCand.textContent = nombreCandidato || 'Candidatura Oficial';

    const bannerRol = document.getElementById('banner-rol-badge');
    if (bannerRol) {
        bannerRol.textContent = rol === 'CANDIDATO' ? 'CANDIDATO OFICIAL' : 'LÍDER TERRITORIAL';
        bannerRol.style.backgroundColor = color;
    }

    const bannerOperador = document.getElementById('banner-operador-nombre');
    if (bannerOperador) bannerOperador.textContent = nombreUsuario || 'Operador de Campaña';

    const bannerZona = document.getElementById('banner-operador-zona');
    if (bannerZona) bannerZona.innerHTML = `<i class="fas fa-map-marker-alt me-1"></i> ${zona || 'San Antero, Córdoba'}`;
}

async function inicializarConsolaLider() {
    const user = ElectoralAPI.getUser();
    if (!user) return;

    document.getElementById('lbl-usuario-nombre').textContent = user.nombre;
    document.getElementById('lbl-usuario-zona').textContent = user.zona || 'San Antero';
    
    // Aplicar transformación completa del color del partido a la interfaz
    aplicarTemaPartido(
        user.color_partido, 
        user.partido, 
        user.candidato, 
        user.rol, 
        user.zona, 
        user.nombre
    );

    // Cargar la lista inicial de votantes propios y actualizar KPIs
    await cargarMisVotantes();

    // Evento de búsqueda de cédula
    const txtCedula = document.getElementById('txt-cedula-consulta');
    if (txtCedula) {
        txtCedula.value = '';
        txtCedula.focus();
        txtCedula.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                consultarCedula();
            }
        });
    }
}

// 1. CONSULTA DE CÉDULA Y CRUCE EN TIEMPO REAL
async function consultarCedula() {
    const cedula = document.getElementById('txt-cedula-consulta').value.trim();
    const contenedorFeedback = document.getElementById('box-status-cruce');
    const contenedorRnec = document.getElementById('box-datos-rnec');
    const btnGuardar = document.getElementById('btn-guardar-votante');
    
    if (!cedula || cedula.length < 4) {
        alert("Por favor ingrese un número de cédula válido.");
        return;
    }

    contenedorFeedback.innerHTML = `
        <div class="d-flex align-items-center gap-2 text-primary fw-bold">
            <i class="fas fa-spinner fa-spin fa-lg"></i> Consultando base oficial RNEC y verificando cruces...
        </div>
    `;
    contenedorFeedback.className = "status-indicator-box duplicado";
    contenedorFeedback.style.display = "flex";

    try {
        const res = await ElectoralAPI.verificarCruce(cedula);
        estadoVerificacionActual = res.estado;

        // Renderizar datos oficiales del Censo RNEC
        if (res.censo) {
            datosCensoActual = res.censo;
            const nombreCompleto = `${res.censo.nombres || ''} ${res.censo.apellidos || ''}`.trim();
            document.getElementById('rnec-nombre').textContent = nombreCompleto || `Ciudadano C.C. ${cedula}`;
            document.getElementById('rnec-municipio').textContent = `${res.censo.municipio} - ${res.censo.departamento}`;
            document.getElementById('rnec-puesto').textContent = res.censo.puesto_votacion;
            document.getElementById('rnec-direccion').textContent = res.censo.direccion_puesto;
            document.getElementById('rnec-mesa').textContent = `MESA ${res.censo.mesa}`;
            
            // Sugerir nombre en el campo de registro si no es el genérico
            const txtNombre = document.getElementById('txt-nombre-votante');
            if (txtNombre && !nombreCompleto.includes('Ciudadano Habilitado')) {
                txtNombre.value = nombreCompleto;
            }
            
            contenedorRnec.style.display = "block";
        }

        let whatsappHtml = '';
        if (res.alerta_whatsapp) {
            whatsappHtml = `
                <div class="mt-3 pt-2 border-top border-secondary w-100 d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <div>
                        <span class="badge bg-success text-white px-2 py-1 small fw-bold">
                            <i class="fab fa-whatsapp me-1"></i> Alerta WhatsApp Preparada
                        </span>
                        <small class="text-white d-block mt-1">Propietario original: <strong>${res.alerta_whatsapp.propietario_nombre}</strong> (${res.alerta_whatsapp.propietario_partido})</small>
                    </div>
                    <a href="${res.alerta_whatsapp.whatsapp_url}" target="_blank" class="btn btn-sm btn-success fw-bold px-3 py-1 shadow-sm text-decoration-none">
                        <i class="fab fa-whatsapp me-1"></i> Notificar al Propietario por WhatsApp
                    </a>
                </div>
            `;
        }

        if (res.estado === 'HABILITADO') {
            contenedorFeedback.className = "status-indicator-box limpio";
            contenedorFeedback.innerHTML = `
                <i class="fas fa-check-circle fa-2x text-success"></i>
                <div>
                    <h5 class="fw-bold mb-1 text-success">VOTANTE DISPONIBLE</h5>
                    <p class="mb-0 text-white fw-bold">${res.mensaje}</p>
                    <small class="text-light opacity-75">Puede proceder a registrarlo formalmente en el formulario de abajo.</small>
                </div>
            `;
            btnGuardar.disabled = false;
        } else if (res.estado === 'CRUCE_INTER_PARTIDISTA') {
            contenedorFeedback.className = "status-indicator-box cruce";
            contenedorFeedback.innerHTML = `
                <i class="fas fa-exclamation-triangle fa-2x text-danger"></i>
                <div class="w-100">
                    <h5 class="fw-bold mb-1 text-danger">🚨 ¡ALERTA DE CRUCE DE PARTIDO!</h5>
                    <p class="mb-1 text-white fw-bold">${res.mensaje}</p>
                    <small class="text-danger fw-bold">⚠️ Atención: Este intento queda registrado con fecha y hora exacta en la Auditoría del Superadministrador.</small>
                    ${whatsappHtml}
                </div>
            `;
            btnGuardar.disabled = false; // Se permite registrar bajo advertencia
        } else if (res.estado === 'DUPLICADO_INTERNO') {
            contenedorFeedback.className = "status-indicator-box duplicado";
            contenedorFeedback.innerHTML = `
                <i class="fas fa-ban fa-2x text-danger"></i>
                <div class="w-100">
                    <h5 class="fw-bold mb-1 text-danger">DUPLICADO EN SU PROPIA CAMPAÑA</h5>
                    <p class="mb-1 text-white fw-bold">${res.mensaje}</p>
                    <small class="text-white opacity-75">Este votante ya pertenece a su lista. Intento reportado a la Bitácora Central.</small>
                    ${whatsappHtml}
                </div>
            `;
            btnGuardar.disabled = true; // Bloqueado
        }

        // Advertencia si ya cobró apoyos
        if (res.tiene_apoyo_previo) {
            const detalleApoyos = res.apoyos_previos.map(a => `${a.tipo_apoyo} ($${Number(a.valor_economico).toLocaleString()}) otorgado por ${a.partido}`).join(', ');
            const alertApoyo = document.createElement('div');
            alertApoyo.className = "alert alert-danger mt-3 mb-0 small fw-bold w-100 text-white";
            alertApoyo.innerHTML = `<i class="fas fa-hand-holding-usd me-1"></i> <strong>Atención Logística Día D:</strong> Ya recibió apoyos económicos registrados: ${detalleApoyos}`;
            contenedorFeedback.appendChild(alertApoyo);
        }

    } catch (err) {
        contenedorFeedback.className = "status-indicator-box cruce";
        contenedorFeedback.innerHTML = `<i class="fas fa-times-circle fa-2x text-danger"></i> <div class="text-white">Error al consultar: ${err.message}</div>`;
        btnGuardar.disabled = true;
    }
}

// 2. GUARDAR VOTANTE CON O SIN APOYO
async function guardarVotanteFormulario(e) {
    e.preventDefault();
    const cedula = document.getElementById('txt-cedula-consulta').value.trim();
    if (!cedula) return;

    const nombre = document.getElementById('txt-nombre-votante').value.trim();
    const telefono = document.getElementById('txt-telefono').value.trim();
    const barrio = document.getElementById('txt-barrio').value.trim();
    const compromiso = document.getElementById('sel-compromiso').value;
    const estado_voto = document.getElementById('sel-estado-voto').value;
    const obs = document.getElementById('txt-observaciones').value.trim();

    const darApoyo = document.getElementById('chk-dar-apoyo').checked;
    const tipoApoyo = document.getElementById('sel-tipo-apoyo').value;
    const montoApoyo = parseFloat(document.getElementById('txt-monto-apoyo').value) || 0;

    const btnGuardar = document.getElementById('btn-guardar-votante');
    btnGuardar.disabled = true;
    btnGuardar.innerHTML = `<i class="fas fa-spinner fa-spin me-2"></i> Guardando en base de datos...`;

    try {
        const resVotante = await ElectoralAPI.registrarVotante({
            cedula,
            telefono,
            barrio_direccion: barrio,
            compromiso,
            estado_dia_d: estado_voto,
            observaciones: obs
        });

        // Registrar apoyo si fue seleccionado
        if (darApoyo && montoApoyo > 0) {
            await ElectoralAPI.registrarApoyo({
                votante_cedula: cedula,
                tipo_apoyo: tipoApoyo,
                valor_economico: montoApoyo,
                descripcion: `Otorgado por líder en registro`
            });
        }

        alert(resVotante.hubo_cruce 
            ? "⚠️ Votante registrado. ¡ALERTA! El sistema registró que este votante también está en otro partido." 
            : "✅ Votante registrado exitosamente en su campaña.");

        // Limpiar formulario y recargar lista
        limpiarFormularioRegistro();
        await cargarMisVotantes();

    } catch (err) {
        alert("Error al guardar: " + err.message);
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.innerHTML = `<i class="fas fa-check-circle me-2"></i> Confirmar y Guardar Votante en mi Campaña`;
    }
}

function limpiarFormularioRegistro() {
    document.getElementById('txt-cedula-consulta').value = '';
    document.getElementById('txt-nombre-votante').value = '';
    document.getElementById('txt-telefono').value = '';
    document.getElementById('txt-barrio').value = '';
    document.getElementById('txt-observaciones').value = '';
    document.getElementById('chk-dar-apoyo').checked = false;
    document.getElementById('box-apoyo-inputs').style.display = 'none';
    document.getElementById('box-status-cruce').style.display = 'none';
    document.getElementById('box-datos-rnec').style.display = 'none';
}

// 3. CARGAR LISTADO DE VOTANTES PROPIOS Y ACTUALIZAR MINI KPIS
async function cargarMisVotantes() {
    const tbody = document.getElementById('tbody-mis-votantes');
    const badgeTotal = document.getElementById('badge-total-mis-votantes');
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-white"><i class="fas fa-spinner fa-spin me-2"></i> Cargando votantes...</td></tr>`;

    try {
        const votantes = await ElectoralAPI.getMisVotantes();
        if (badgeTotal) badgeTotal.textContent = `${votantes.length} registrados`;

        // Actualizar tarjetas de Mini KPIs en la cabecera del partido
        const kpiTotal = document.getElementById('kpi-mini-total');
        const kpiSeguros = document.getElementById('kpi-mini-seguros');
        const kpiTransporte = document.getElementById('kpi-mini-transporte');

        if (kpiTotal) kpiTotal.textContent = votantes.length;
        if (kpiSeguros) kpiSeguros.textContent = votantes.filter(v => v.compromiso === 'SEGURO').length;
        if (kpiTransporte) kpiTransporte.textContent = votantes.filter(v => v.estado_dia_d === 'REQUIERE_TRANSPORTE').length;

        if (votantes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">Aún no tiene votantes registrados en su lista. Ingrese una cédula arriba para comenzar.</td></tr>`;
            return;
        }

        tbody.innerHTML = votantes.map(v => `
            <tr>
                <td><strong class="text-white">${v.cedula}</strong></td>
                <td><strong class="text-white">${v.nombres || ''} ${v.apellidos || ''}</strong></td>
                <td>
                    <div class="text-white"><strong>${v.puesto_votacion || 'No definido'}</strong></div>
                    <small class="text-muted" style="color: #94A3B8 !important;">${v.direccion_puesto || ''}</small>
                </td>
                <td>
                    <span class="badge fw-bold px-3 py-2 text-white" style="background: var(--party-color); box-shadow: 0 0 10px var(--party-glow);">
                        Mesa ${v.mesa || '-'}
                    </span>
                </td>
                <td>
                    <span class="badge ${v.compromiso === 'SEGURO' ? 'bg-success' : v.compromiso === 'DUDOSO' ? 'bg-danger text-white' : 'bg-secondary'} px-2 py-1 fw-bold">
                        ${v.compromiso}
                    </span>
                </td>
                <td>
                    <span class="badge ${v.estado_dia_d === 'YA_VOTO' ? 'bg-success' : v.estado_dia_d === 'REQUIERE_TRANSPORTE' ? 'bg-danger' : 'bg-secondary text-white'} px-2 py-1 fw-bold">
                        ${v.estado_dia_d}
                    </span>
                </td>
                <td>
                    <span class="badge px-2 py-1" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15); color: #E2E8F0;">
                        <i class="fas fa-user-tag me-1 text-info"></i> ${v.nombre_lider || 'Mi Registro'}
                    </span>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-3 text-danger">Error: ${err.message}</td></tr>`;
    }
}

// 4. EXPORTAR EXCEL DE MIS VOTANTES
function exportarMisVotantesExcel() {
    const tabla = document.getElementById('tabla-mis-votantes');
    if (!tabla) return;
    const libro = XLSX.utils.table_to_book(tabla, { sheet: "MisVotantes" });
    XLSX.writeFile(libro, "Mis_Votantes_Registrados.xlsx");
}

// 5. GESTIÓN DE WHATSAPP PARA ALERTAS DE DUPLICADOS
let modalMiWhatsappInstance = null;

async function abrirModalMiWhatsapp() {
    const inputTel = document.getElementById('txt-mi-whatsapp-numero');
    const boxFeedback = document.getElementById('box-mi-whatsapp-feedback');
    if (boxFeedback) boxFeedback.style.display = 'none';

    try {
        const res = await ElectoralAPI.getMiTelefono();
        if (inputTel && res.telefono) {
            inputTel.value = res.telefono;
        }
    } catch (e) {
        console.warn("No se pudo cargar teléfono previo:", e);
    }

    const modalEl = document.getElementById('modal-mi-whatsapp');
    if (modalEl) {
        modalMiWhatsappInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        modalMiWhatsappInstance.show();
    }
}

async function guardarMiTelefonoWhatsApp() {
    const inputTel = document.getElementById('txt-mi-whatsapp-numero');
    const boxFeedback = document.getElementById('box-mi-whatsapp-feedback');
    const btn = document.getElementById('btn-guardar-mi-whatsapp');

    const tel = inputTel.value.trim().replace(/\D/g, '');
    if (!tel || tel.length < 10) {
        if (boxFeedback) {
            boxFeedback.className = "p-2 rounded mt-2 small fw-bold bg-danger text-white";
            boxFeedback.innerHTML = `<i class="fas fa-exclamation-circle me-1"></i> Ingrese un número de celular válido de 10 dígitos.`;
            boxFeedback.style.display = 'block';
        }
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin me-1"></i> Guardando...`;

    try {
        await ElectoralAPI.actualizarMiTelefono(tel);
        if (boxFeedback) {
            boxFeedback.className = "p-2 rounded mt-2 small fw-bold bg-success text-white";
            boxFeedback.innerHTML = `<i class="fas fa-check-circle me-1"></i> ¡Número guardado! Recibirás alertas cuando intenten duplicar tus votantes.`;
            boxFeedback.style.display = 'block';
        }
        setTimeout(() => {
            if (modalMiWhatsappInstance) modalMiWhatsappInstance.hide();
        }, 1500);
    } catch (err) {
        if (boxFeedback) {
            boxFeedback.className = "p-2 rounded mt-2 small fw-bold bg-danger text-white";
            boxFeedback.innerHTML = `Error: ${err.message}`;
            boxFeedback.style.display = 'block';
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-save me-1"></i> Guardar Mi WhatsApp`;
    }
}
