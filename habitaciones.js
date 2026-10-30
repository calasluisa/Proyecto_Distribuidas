const { pool } = require('./db');
const { hoy } = require('./utils');

const SELECT_HABITACION = `
  SELECT h.id, h.numero, h.estado AS estadoFisico,
         p.numero AS piso, p.descripcion AS pisoDescripcion,
         t.id AS tipoId, t.nombre AS tipo, t.capacidad,
         t.precio_base AS precioBase, t.servicios
  FROM habitaciones h
  JOIN pisos p ON p.id = h.piso_id
  JOIN tipos_habitacion t ON t.id = h.tipo_id`;

// Reserva actual de una habitación 
async function reservaActualDe(habitacionId, hoyStr) {
  const [filas] = await pool.query(
    `SELECT r.id, r.fecha_entrada AS fechaEntrada, r.fecha_salida AS fechaSalida, r.estado,
            c.nombre AS cliente, c.cedula
     FROM reservas r
     JOIN clientes c ON c.id = r.cliente_id
     WHERE r.habitacion_id = ?
       AND (r.estado = 'en_curso'
            OR (r.estado = 'activa' AND r.fecha_entrada <= ? AND r.fecha_salida > ?))
     ORDER BY (r.estado = 'en_curso') DESC, r.id
     LIMIT 1`,
    [habitacionId, hoyStr, hoyStr]
  );
  return filas[0] || null;
}

// "Reservada" se calcula: habitación disponible + reserva activa que cubre hoy
function armar(hab, reserva) {
  let estado = hab.estadoFisico;
  if (estado === 'disponible' && reserva && reserva.estado === 'activa') estado = 'reservada';
  return {
    ...hab,
    estado,
    reservaActual: reserva
      ? {
          id: reserva.id,
          cliente: reserva.cliente,
          cedula: reserva.cedula,
          fechaEntrada: reserva.fechaEntrada,
          fechaSalida: reserva.fechaSalida,
          estado: reserva.estado,
        }
      : null,
  };
}

async function listar() {
  const hoyStr = hoy();
  const [habitaciones] = await pool.query(`${SELECT_HABITACION} ORDER BY h.numero`);
  const [actuales] = await pool.query(
    `SELECT r.id, r.habitacion_id AS habitacionId,
            r.fecha_entrada AS fechaEntrada, r.fecha_salida AS fechaSalida, r.estado,
            c.nombre AS cliente, c.cedula
     FROM reservas r
     JOIN clientes c ON c.id = r.cliente_id
     WHERE r.estado = 'en_curso'
        OR (r.estado = 'activa' AND r.fecha_entrada <= ? AND r.fecha_salida > ?)
     ORDER BY (r.estado = 'en_curso') DESC, r.id`,
    [hoyStr, hoyStr]
  );
  const porHab = new Map();
  for (const r of actuales) {
    if (!porHab.has(r.habitacionId)) porHab.set(r.habitacionId, r);
  }
  return habitaciones.map((h) => armar(h, porHab.get(h.id) || null));
}

async function obtener(id) {
  const [filas] = await pool.query(`${SELECT_HABITACION} WHERE h.id = ?`, [id]);
  if (!filas[0]) return null;
  const reserva = await reservaActualDe(id, hoy());
  return armar(filas[0], reserva);
}

async function buscarPorNumero(numero) {
  const [filas] = await pool.query(`${SELECT_HABITACION} WHERE h.numero = ?`, [String(numero)]);
  if (!filas[0]) return null;
  const reserva = await reservaActualDe(filas[0].id, hoy());
  return armar(filas[0], reserva);
}

async function pisos() {
  const [filas] = await pool.query('SELECT id, numero, descripcion FROM pisos ORDER BY numero');
  return filas;
}

async function tipos() {
  const [filas] = await pool.query(
    'SELECT id, nombre, capacidad, precio_base AS precioBase, servicios FROM tipos_habitacion ORDER BY id'
  );
  return filas;
}

module.exports = { listar, obtener, buscarPorNumero, pisos, tipos };