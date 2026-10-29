-- HotelSync - datos base (se puede ejecutar varias veces)
SET NAMES utf8mb4;
USE hotelsync_db;

INSERT IGNORE INTO pisos (id, numero, descripcion) VALUES
  (1, 1, 'Primer piso'),
  (2, 2, 'Segundo piso'),
  (3, 3, 'Tercer piso');

INSERT IGNORE INTO tipos_habitacion (id, nombre, capacidad, precio_base, servicios) VALUES
  (1, 'Individual',  1,  35.00, 'Wi-Fi, TV'),
  (2, 'Doble',       2,  50.00, 'Wi-Fi, TV, baño privado'),
  (3, 'Matrimonial', 2,  60.00, 'Wi-Fi, TV, cama queen, minibar'),
  (4, 'Suite',       4, 120.00, 'Wi-Fi, TV, sala, jacuzzi, minibar');

INSERT IGNORE INTO habitaciones (id, numero, piso_id, tipo_id) VALUES
  (1,  '101', 1, 1), (2,  '102', 1, 2), (3,  '103', 1, 3), (4,  '104', 1, 4),
  (5,  '201', 2, 1), (6,  '202', 2, 2), (7,  '203', 2, 3), (8,  '204', 2, 2),
  (9,  '301', 3, 3), (10, '302', 3, 2), (11, '303', 3, 1), (12, '304', 3, 4);