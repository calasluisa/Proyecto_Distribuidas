const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const mysql = require('mysql2/promise');

// Pool de conexiones a MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'hotelsync_db',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,    // fechas llegan como 'YYYY-MM-DD'
  decimalNumbers: true, // DECIMAL llega como número
});

// Ejecuta fn dentro de una transacción: commit si todo sale bien, rollback si falla
async function transaccion(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resultado = await fn(conn);
    await conn.commit();
    return resultado;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, transaccion };