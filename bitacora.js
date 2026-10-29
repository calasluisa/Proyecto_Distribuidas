const { pool } = require('./db');
const realtime = require('./realtime');

// Guarda el evento en la BD y lo avisa a todos en tiempo real
async function registrar(tipo, descripcion, usuario) {
  const [res] = await pool.query(
    'INSERT INTO eventos (tipo, descripcion, usuario) VALUES (?, ?, ?)',
    [tipo, descripcion, usuario || '']
  );
  const [filas] = await pool.query(
    'SELECT id, tipo, descripcion, usuario, creado_en AS creadoEn FROM eventos WHERE id = ?',
    [res.insertId]
  );
  const evento = filas[0];
  realtime.emitir('evento-nuevo', evento);
  return evento;
}

// Últimos eventos, del más reciente al más antiguo
async function ultimos(cantidad = 20) {
  const [filas] = await pool.query(
    'SELECT id, tipo, descripcion, usuario, creado_en AS creadoEn FROM eventos ORDER BY id DESC LIMIT ?',
    [cantidad]
  );
  return filas;
}

module.exports = { registrar, ultimos };