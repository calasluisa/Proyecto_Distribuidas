-- HotelSync - esquema de la base de datos
CREATE DATABASE IF NOT EXISTS hotelsync_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hotelsync_db;

CREATE TABLE IF NOT EXISTS pisos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  numero INT NOT NULL UNIQUE,
  descripcion VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS tipos_habitacion (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(30) NOT NULL UNIQUE,
  capacidad INT NOT NULL,
  precio_base DECIMAL(10,2) NOT NULL,
  servicios VARCHAR(255) NOT NULL DEFAULT ''
);

-- estado físico de la habitación; "reservada" NO se guarda, se calcula con las reservas
CREATE TABLE IF NOT EXISTS habitaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  numero VARCHAR(10) NOT NULL UNIQUE,
  piso_id INT NOT NULL,
  tipo_id INT NOT NULL,
  estado ENUM('disponible','ocupada','limpieza','mantenimiento') NOT NULL DEFAULT 'disponible',
  FOREIGN KEY (piso_id) REFERENCES pisos(id),
  FOREIGN KEY (tipo_id) REFERENCES tipos_habitacion(id)
);

CREATE TABLE IF NOT EXISTS clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cedula VARCHAR(10) NOT NULL UNIQUE,
  nombre VARCHAR(100) NOT NULL,
  correo VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS reservas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cliente_id INT NOT NULL,
  habitacion_id INT NOT NULL,
  fecha_entrada DATE NOT NULL,
  fecha_salida DATE NOT NULL,
  estado ENUM('activa','en_curso','finalizada','cancelada') NOT NULL DEFAULT 'activa',
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  creado_por VARCHAR(50) NOT NULL DEFAULT '',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cliente_id) REFERENCES clientes(id),
  FOREIGN KEY (habitacion_id) REFERENCES habitaciones(id),
  INDEX idx_reservas_fechas (fecha_entrada, fecha_salida),
  INDEX idx_reservas_habitacion (habitacion_id)
);

CREATE TABLE IF NOT EXISTS eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tipo VARCHAR(40) NOT NULL,
  descripcion VARCHAR(255) NOT NULL,
  usuario VARCHAR(50) NOT NULL DEFAULT '',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);