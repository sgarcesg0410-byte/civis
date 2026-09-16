-- ==============================================================================
-- SISTEMA ELECTORAL: CONTROL DE CRUCES Y REGISTRADURÍA EN TIEMPO REAL
-- Archivo 100% optimizado para MySQL / MariaDB / phpMyAdmin / XAMPP
-- ==============================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- CREAR Y SELECCIONAR LA BASE DE DATOS AUTOMÁTICAMENTE (Previene error #1046)
CREATE DATABASE IF NOT EXISTS `elecciones_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `elecciones_db`;

-- 1. ELIMINAR TABLAS SI EXISTEN (Para reinicio limpio)
DROP TABLE IF EXISTS `auditoria_intentos_duplicados`;
DROP TABLE IF EXISTS `apoyos_logistica`;
DROP TABLE IF EXISTS `alertas_cruces`;
DROP TABLE IF EXISTS `votantes_campana`;
DROP TABLE IF EXISTS `usuarios`;
DROP TABLE IF EXISTS `campanas`;
DROP TABLE IF EXISTS `censo_electoral`;

-- 2. TABLA: CENSO ELECTORAL OFICIAL DE LA REGISTRADURÍA (RNEC)
CREATE TABLE `censo_electoral` (
    `cedula` VARCHAR(20) NOT NULL PRIMARY KEY,
    `nombres` VARCHAR(100) NOT NULL,
    `apellidos` VARCHAR(100) NOT NULL,
    `departamento` VARCHAR(60) NOT NULL,
    `municipio` VARCHAR(60) NOT NULL,
    `puesto_votacion` VARCHAR(150) NOT NULL,
    `direccion_puesto` VARCHAR(200) NOT NULL,
    `mesa` INT NOT NULL,
    `latitud` DECIMAL(10, 7) NULL,
    `longitud` DECIMAL(10, 7) NULL,
    INDEX `idx_censo_municipio` (`municipio`),
    INDEX `idx_censo_puesto_mesa` (`puesto_votacion`, `mesa`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. TABLA: PARTIDOS Y CAMPAÑAS ELECTORALES
CREATE TABLE `campanas` (
    `id` VARCHAR(36) NOT NULL PRIMARY KEY,
    `nombre_candidato` VARCHAR(120) NOT NULL,
    `partido` VARCHAR(80) NOT NULL,
    `color_distintivo` VARCHAR(20) DEFAULT '#CC0000',
    `cargo_aspirado` VARCHAR(60) NOT NULL,
    `municipio` VARCHAR(60) NOT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. TABLA: USUARIOS (SUPERADMIN, CANDIDATO, LÍDER)
CREATE TABLE `usuarios` (
    `id` VARCHAR(36) NOT NULL PRIMARY KEY,
    `campana_id` VARCHAR(36) NULL,
    `cedula` VARCHAR(20) NOT NULL,
    `nombre_completo` VARCHAR(120) NOT NULL,
    `telefono` VARCHAR(25) NULL,
    `username` VARCHAR(50) NOT NULL UNIQUE,
    `password_hash` VARCHAR(255) NOT NULL,
    `rol` VARCHAR(20) NOT NULL, -- 'SUPERADMIN', 'CANDIDATO', 'LIDER'
    `zona_barrio` VARCHAR(100) NULL,
    `activo` TINYINT(1) DEFAULT 1,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_usuarios_campana` FOREIGN KEY (`campana_id`) REFERENCES `campanas`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. TABLA: VOTANTES REGISTRADOS POR CADA CAMPAÑA
CREATE TABLE `votantes_campana` (
    `id` VARCHAR(36) NOT NULL PRIMARY KEY,
    `campana_id` VARCHAR(36) NOT NULL,
    `lider_id` VARCHAR(36) NOT NULL,
    `cedula` VARCHAR(20) NOT NULL,
    `telefono` VARCHAR(25) NULL,
    `barrio_direccion` VARCHAR(150) NULL,
    `compromiso` VARCHAR(20) DEFAULT 'SEGURO', -- 'SEGURO', 'DUDOSO', 'POR_CONFIRMAR'
    `estado_dia_d` VARCHAR(20) DEFAULT 'PENDIENTE', -- 'PENDIENTE', 'YA_VOTO', 'REQUIERE_TRANSPORTE'
    `observaciones` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `uq_campana_cedula` UNIQUE (`campana_id`, `cedula`),
    CONSTRAINT `fk_votantes_campana` FOREIGN KEY (`campana_id`) REFERENCES `campanas`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_votantes_lider` FOREIGN KEY (`lider_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE,
    INDEX `idx_votantes_cedula` (`cedula`),
    INDEX `idx_votantes_lider` (`lider_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. TABLA: AUDITORÍA DE CRUCES EN TIEMPO REAL (HISTORIAL DE COLISIONES)
CREATE TABLE `alertas_cruces` (
    `id` VARCHAR(36) NOT NULL PRIMARY KEY,
    `cedula` VARCHAR(20) NOT NULL,
    `campana_origen_id` VARCHAR(36) NOT NULL,
    `campana_conflicto_id` VARCHAR(36) NOT NULL,
    `lider_origen_id` VARCHAR(36) NULL,
    `lider_conflicto_id` VARCHAR(36) NULL,
    `tipo_cruce` VARCHAR(30) NOT NULL, -- 'INTER_PARTIDISTA', 'INTRA_CAMPANA'
    `fecha_deteccion` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `resuelto` TINYINT(1) DEFAULT 0,
    CONSTRAINT `fk_cruces_campana_origen` FOREIGN KEY (`campana_origen_id`) REFERENCES `campanas`(`id`),
    CONSTRAINT `fk_cruces_campana_conflicto` FOREIGN KEY (`campana_conflicto_id`) REFERENCES `campanas`(`id`),
    INDEX `idx_cruces_cedula` (`cedula`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. TABLA: AUDITORÍA DE APOYOS LOGÍSTICOS (DÍA D)
CREATE TABLE `apoyos_logistica` (
    `id` VARCHAR(36) NOT NULL PRIMARY KEY,
    `campana_id` VARCHAR(36) NOT NULL,
    `lider_id` VARCHAR(36) NOT NULL,
    `votante_cedula` VARCHAR(20) NOT NULL,
    `tipo_apoyo` VARCHAR(50) NOT NULL, -- 'Transporte', 'Refrigerio', 'Viático Día D', 'Testigo Electoral'
    `valor_economico` DECIMAL(12, 2) DEFAULT 0.00,
    `descripcion` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `fk_apoyos_campana` FOREIGN KEY (`campana_id`) REFERENCES `campanas`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_apoyos_lider` FOREIGN KEY (`lider_id`) REFERENCES `usuarios`(`id`) ON DELETE CASCADE,
    INDEX `idx_apoyos_cedula` (`votante_cedula`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. TABLA: AUDITORÍA FORENSE DE INTENTOS DE DUPLICADOS Y CRUCES (SUPERADMINISTRADOR)
CREATE TABLE `auditoria_intentos_duplicados` (
    `id` VARCHAR(36) NOT NULL PRIMARY KEY,
    `cedula` VARCHAR(20) NOT NULL,
    `nombre_votante` VARCHAR(120) NULL,
    `puesto_mesa` VARCHAR(150) NULL,
    `operador_nombre` VARCHAR(120) NOT NULL,
    `operador_username` VARCHAR(50) NULL,
    `operador_rol` VARCHAR(20) NULL,
    `operador_partido` VARCHAR(80) NULL,
    `propietario_nombre` VARCHAR(120) NULL,
    `propietario_partido` VARCHAR(80) NULL,
    `telefono_notificado` VARCHAR(25) NULL,
    `tipo_evento` VARCHAR(40) NOT NULL,
    `accion_tomada` VARCHAR(40) NOT NULL,
    `fecha_hora` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_audit_cedula` (`cedula`),
    INDEX `idx_audit_fecha` (`fecha_hora`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==============================================================================
-- INSERCIÓN DE DATOS INICIALES (SEMILLA DE PRUEBA REALISTA)
-- ==============================================================================

-- 1. Censo Electoral Oficial Registraduría (RNEC) - SAN ANTERO, CÓRDOBA
INSERT INTO `censo_electoral` (`cedula`, `nombres`, `apellidos`, `departamento`, `municipio`, `puesto_votacion`, `direccion_puesto`, `mesa`, `latitud`, `longitud`) VALUES
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
('1063774411', 'Ever José', 'Palencia Correa', 'Córdoba', 'San Antero', 'Escuela Rural Caño Grande', 'Vereda Caño Grande', 1, 9.3600, -75.7900);

-- 2. Campañas Electorales en San Antero
INSERT INTO `campanas` (`id`, `nombre_candidato`, `partido`, `color_distintivo`, `cargo_aspirado`, `municipio`) VALUES
('camp-01', 'Dr. Roberto Mendoza', 'Partido Liberal', '#CC0000', 'Alcaldía Municipal', 'San Antero'),
('camp-02', 'Ing. Gabriel Montoya', 'Partido Conservador', '#0033A0', 'Alcaldía Municipal', 'San Antero'),
('camp-03', 'Dra. María Patricia Cruz', 'Partido de la U', '#FF8200', 'Concejo Municipal', 'San Antero');

-- 3. Usuarios del Sistema: SUPERADMINISTRADORES (Propietarios) + CANDIDATOS + LÍDERES
INSERT INTO `usuarios` (`id`, `campana_id`, `cedula`, `nombre_completo`, `telefono`, `username`, `password_hash`, `rol`, `zona_barrio`) VALUES
('usr-admin-1', NULL, '1063165499', 'Sebastián - Administrador General & Propietario', '3001112233', 'superadmin', '123456', 'SUPERADMIN', 'San Antero - Comando Central'),
('usr-admin-2', NULL, '1000000002', 'Ing. Carlos Restrepo (Auditor General de Datos)', '3102223344', 'admin.carlos', '123456', 'SUPERADMIN', 'Auditoría Técnica'),
('usr-admin-3', NULL, '1000000003', 'Dra. Claudia Gómez (Coordinadora Electoral)', '3153334455', 'admin.claudia', '123456', 'SUPERADMIN', 'Monitoreo CNE'),
('usr-cand-lib', 'camp-01', '1000000010', 'Dr. Roberto Mendoza (Candidato Alcaldía)', '3104567890', 'candidato.liberal', '123456', 'CANDIDATO', 'San Antero Cabecera'),
('usr-lider-lib', 'camp-01', '1000000011', 'Rosaura Benítez (Líder Liberal)', '3157891234', 'lider.rosa', '123456', 'LIDER', 'Corregimiento El Porvenir'),
('usr-cand-con', 'camp-02', '1000000020', 'Ing. Gabriel Montoya (Candidato Alcaldía)', '3119876543', 'candidato.conservador', '123456', 'CANDIDATO', 'San Antero Rural'),
('usr-lider-con', 'camp-02', '1000000021', 'Carlos Meza (Líder Conservador)', '3182233445', 'lider.carlos', '123456', 'LIDER', 'Santa Rosa del Volcán'),
('usr-cand-u', 'camp-03', '1000000030', 'Dra. María Patricia Cruz (Candidata Concejo)', '3135557788', 'candidata.la-u', '123456', 'CANDIDATO', 'San Antero Zona Urbana'),
('usr-lider-u', 'camp-03', '1000000031', 'Manuel Pacheco (Líder La U)', '3146668899', 'lider.manuel', '123456', 'LIDER', 'Corregimiento Tijeretas');

-- 4. Votantes ya inscritos para detonar detección de cruces de prueba en San Antero
INSERT INTO `votantes_campana` (`id`, `campana_id`, `lider_id`, `cedula`, `telefono`, `barrio_direccion`, `compromiso`, `estado_dia_d`, `observaciones`) VALUES
('vot-01', 'camp-02', 'usr-lider-con', '1002345678', '3004561234', 'Sector Playa El Porvenir', 'SEGURO', 'PENDIENTE', 'Registrado en Corregimiento El Porvenir'),
('vot-02', 'camp-01', 'usr-lider-lib', '1003456789', '3129988776', 'Vía Principal Volcán', 'DUDOSO', 'REQUIERE_TRANSPORTE', 'Registrado en Santa Rosa del Volcán');

-- 5. Apoyo Logístico otorgado a Luis por la campaña Liberal
INSERT INTO `apoyos_logistica` (`id`, `campana_id`, `lider_id`, `votante_cedula`, `tipo_apoyo`, `valor_economico`, `descripcion`) VALUES
('apo-01', 'camp-01', 'usr-lider-lib', '1003456789', 'Transporte', 60000.00, 'Subsidio moto-taxi para ida y vuelta a mesa');

SET FOREIGN_KEY_CHECKS = 1;
