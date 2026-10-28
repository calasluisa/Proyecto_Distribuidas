const { pool, transaccion } = require('./db');
const locks = require('./locks');
const habitaciones = require('./habitaciones');
const realtime = require('./realtime');
const bitacora = require('./bitacora');
const { hoy, esFecha, noches, ErrorNegocio } = require('./utils');

// Valida y limpia los datos que llegan del cliente
function validar(datos) {
  const { habitacionId, cliente, fechaEntrada, fechaSalida } = datos || {};
  if (!Number.isInteger(habitacionId)) throw new ErrorNegocio('Habitación inválida');

  const cedula = String((cliente && cliente.cedula) || '').trim();
  const nombre = String((cliente && cliente.nombre) || '').trim();
  const correo = String((cliente && cliente.correo) || '').trim();
  if (!/^\d{10}$/.test(cedula)) throw new ErrorNegocio('La cédula debe tener 10 dígitos');
  if (nombre.length < 3 || nombre.length > 100) throw new ErrorNegocio('Ingrese el nombre completo del cliente');
  if (!/^\S+@\S+\.\S+$/.test(correo)) throw new ErrorNegocio('Ingrese un correo válido');

  if (!esFecha(fechaEntrada) || !esFecha(fechaSalida))
    throw new ErrorNegocio('Las fechas deben tener formato AAAA-MM-DD');
  if (fechaEntrada < hoy()) throw new ErrorNegocio('La fecha de entrada no puede ser anterior a hoy');
  if (fechaSalida <= fechaEntrada) throw new ErrorNegocio('La fecha de salida debe ser posterior a la de entrada');
  if (noches(fechaEntrada, fechaSalida) > 60) throw new ErrorNegocio('La estadía máxima es de 60 noches');

  return { habitacionId, cliente: { cedula, nombre, correo }, fechaEntrada, fechaSalida };
}

// Regla de solapamiento: entrada_A < salida_B y salida_A > entrada_B
async function buscarSolapamiento(db, habitacionId, entrada, salida) {
  const [filas] = await db.query(
    `SELECT id, fecha_entrada AS fechaEntrada, fecha_salida AS fechaSalida
     FROM reservas
     WHERE habitacion_id = ? AND estado IN ('activa','en_curso')
       AND fecha_entrada < ? AND fecha_salida > ?
     LIMIT 1`,
    [habitacionId, salida, entrada]
  );
  return filas[0] || null;
}

// Crea el cliente o actualiza sus datos si la cédula ya existe; devuelve el id
async function guardarCliente(db, cliente) {
  await db.query(
    `INSERT INTO clientes (cedula, nombre, correo) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), correo = VALUES(correo)`,
    [cliente.cedula, cliente.nombre, cliente.correo]
  );
  const [filas] = await db.query('SELECT id FROM clientes WHERE cedula = ?', [cliente.cedula]);
  return filas[0].id;
}

// Devuelve una reserva con todos los datos "planos" que usa el frontend
async function formatear(db, reservaId) {
  const [filas] = await db.query(
    `SELECT r.id, r.habitacion_id AS habitacionId, h.numero AS habitacionNumero,
            c.nombre AS cliente, c.cedula, c.correo,
            r.fecha_entrada AS fechaEntrada, r.fecha_salida AS fechaSalida,
            r.estado, r.total, r.creado_por AS creadoPor
     FROM reservas r
     JOIN habitaciones h ON h.id = r.habitacion_id
     JOIN clientes c ON c.id = r.cliente_id
     WHERE r.id = ?`,
    [reservaId]
  );
  return filas[0] || null;
}

async function crear(datos, usuario, socketId = null) {
  const { habitacionId, cliente, fechaEntrada, fechaSalida } = validar(datos);

  const hab = await habitaciones.obtener(habitacionId);
  if (!hab) throw new ErrorNegocio('La habitación no existe');
  if (hab.estadoFisico === 'mantenimiento')
    throw new ErrorNegocio(`La habitación ${hab.numero} está en mantenimiento`);

  // Si otro recepcionista la está reservando en este momento, se rechaza
  const bloqueo = locks.obtener(habitacionId);
  if (bloqueo && bloqueo.socketId !== socketId) {
    throw new ErrorNegocio(`La habitación ${hab.numero} está siendo reservada por ${bloqueo.usuario}`);
  }

  const total = noches(fechaEntrada, fechaSalida) * hab.precioBase;

  // La verificación de solapamiento y el INSERT van en el mismo turno y en una transacción
  const reservaId = await locks.conBloqueo([habitacionId], () =>
    transaccion(async (conn) => {
      const choque = await buscarSolapamiento(conn, habitacionId, fechaEntrada, fechaSalida);
      if (choque) {
        throw new ErrorNegocio(
          `La habitación ${hab.numero} ya está reservada del ${choque.fechaEntrada} al ${choque.fechaSalida}`
        );
      }
      const clienteId = await guardarCliente(conn, cliente);
      const [res] = await conn.query(
        `INSERT INTO reservas (cliente_id, habitacion_id, fecha_entrada, fecha_salida, total, creado_por)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [clienteId, habitacionId, fechaEntrada, fechaSalida, total, usuario]
      );
      return res.insertId;
    })
  );

  if (locks.liberar(habitacionId, socketId)) {
    realtime.emitir('habitacion-desbloqueada', { habitacionId });
  }

  const reserva = await formatear(pool, reservaId);
  const habitacion = await habitaciones.obtener(habitacionId);
  realtime.emitir('reserva-creada', { reserva, habitacion, por: usuario });
  await bitacora.registrar(
    'reserva',
    `Reserva #${reservaId}: habitación ${hab.numero}, ${cliente.nombre}, del ${fechaEntrada} al ${fechaSalida}`,
    usuario
  );
  return { reserva, habitacion };
}

async function cancelar(reservaId, usuario) {
  if (!Number.isInteger(reservaId)) throw new ErrorNegocio('Reserva inválida');
  const previa = await formatear(pool, reservaId);
  if (!previa) throw new ErrorNegocio('La reserva no existe');

  await locks.conBloqueo([previa.habitacionId], () =>
    transaccion(async (conn) => {
      const [filas] = await conn.query('SELECT estado FROM reservas WHERE id = ?', [reservaId]);
      if (filas[0].estado !== 'activa') throw new ErrorNegocio('Solo se pueden cancelar reservas activas');
      await conn.query(`UPDATE reservas SET estado = 'cancelada' WHERE id = ?`, [reservaId]);
    })
  );

  const reserva = await formatear(pool, reservaId);
  const habitacion = await habitaciones.obtener(previa.habitacionId);
  realtime.emitir('reserva-cancelada', { reserva, habitacion, por: usuario });
  await bitacora.registrar(
    'reserva',
    `Reserva #${reservaId} cancelada (habitación ${previa.habitacionNumero}, ${previa.cliente})`,
    usuario
  );
  return { reserva, habitacion };
}

async function listarVigentes() {
  const [filas] = await pool.query(
    `SELECT r.id, r.habitacion_id AS habitacionId, h.numero AS habitacionNumero,
            c.nombre AS cliente, c.cedula, c.correo,
            r.fecha_entrada AS fechaEntrada, r.fecha_salida AS fechaSalida,
            r.estado, r.total, r.creado_por AS creadoPor
     FROM reservas r
     JOIN habitaciones h ON h.id = r.habitacion_id
     JOIN clientes c ON c.id = r.cliente_id
     WHERE r.estado IN ('activa','en_curso')
     ORDER BY r.fecha_entrada, r.id`
  );
  return filas;
}

module.exports = { crear, cancelar, listarVigentes, formatear };