// HotelSync - servidor con Express + Socket.io + MySQL
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { pool, transaccion } = require('./db');
const locks = require('./locks');
const habitaciones = require('./habitaciones');
const reservas = require('./reservas');
const realtime = require('./realtime');
const bitacora = require('./bitacora');
const { hoy, ErrorNegocio } = require('./utils');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Panel de administrador: http://localhost:3000/admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

realtime.iniciar(io);

// Estado completo que recibe un cliente normal al conectarse
async function estadoInicial() {
  const [pisos, tipos, habs, reservasVig, eventos] = await Promise.all([
    habitaciones.pisos(),
    habitaciones.tipos(),
    habitaciones.listar(),
    reservas.listarVigentes(),
    bitacora.ultimos(20),
  ]);
  return {
    hoy: hoy(),
    pisos,
    tipos,
    habitaciones: habs,
    reservas: reservasVig,
    bloqueos: locks.listar(),
    eventos,
  };
}

// Estado que recibe el panel de administrador
async function estadoAdmin() {
  const [pisos, tipos, habs, ingresosRes] = await Promise.all([
    habitaciones.pisos(),
    habitaciones.tipos(),
    habitaciones.listar(),
    pool.query(
      `SELECT COALESCE(SUM(total),0) AS total FROM reservas WHERE estado IN ('en_curso','finalizada')`
    ),
  ]);
  return {
    hoy: hoy(),
    pisos,
    tipos,
    habitaciones: habs,
    bloqueos: locks.listar(),
    ingresos: Number(ingresosRes[0][0].total) || 0,
  };
}

// Envuelve un manejador para responder con un ok y el error
function responder(fn) {
  return async (datos, cb) => {
    const respuesta = typeof cb === 'function' ? cb : () => {};
    try {
      respuesta({ ok: true, ...(await fn(datos)) });
    } catch (err) {
      if (!(err instanceof ErrorNegocio)) console.error('Error inesperado:', err);
      respuesta({
        ok: false,
        error: err instanceof ErrorNegocio ? err.message : 'Error interno del servidor',
      });
    }
  };
}

// Cambiar estado de habitación (checkin, checkout, limpieza, mantenimiento)
const ACCIONES = ['checkin', 'checkout', 'limpieza-terminada', 'mantenimiento-on', 'mantenimiento-off'];

async function cambiarEstado(habitacionId, accion, usuario) {
  if (!Number.isInteger(habitacionId)) throw new ErrorNegocio('Habitación inválida');
  if (!ACCIONES.includes(accion)) throw new ErrorNegocio('Acción no reconocida');

  const resultado = await locks.conBloqueo([habitacionId], () =>
    transaccion(async (conn) => {
      const [filasHab] = await conn.query(
        'SELECT id, numero, estado AS estadoFisico FROM habitaciones WHERE id = ?',
        [habitacionId]
      );
      const hab = filasHab[0];
      if (!hab) throw new ErrorNegocio('La habitación no existe');
      const fisico = hab.estadoFisico;
      let reservaId = null;
      let mensaje = '';

      if (accion === 'checkin') {
        if (fisico !== 'disponible')
          throw new ErrorNegocio(`La habitación ${hab.numero} no está disponible para check-in`);
        const hoyStr = hoy();
        const [res] = await conn.query(
          `SELECT id FROM reservas
           WHERE habitacion_id = ? AND estado = 'activa'
             AND fecha_entrada <= ? AND fecha_salida > ?
           LIMIT 1`,
          [habitacionId, hoyStr, hoyStr]
        );
        if (!res[0])
          throw new ErrorNegocio(`La habitación ${hab.numero} no tiene una reserva activa para hoy`);
        reservaId = res[0].id;
        await conn.query(`UPDATE habitaciones SET estado = 'ocupada' WHERE id = ?`, [habitacionId]);
        await conn.query(`UPDATE reservas SET estado = 'en_curso' WHERE id = ?`, [reservaId]);
        mensaje = `Check-in en la habitación ${hab.numero}`;
      } else if (accion === 'checkout') {
        if (fisico !== 'ocupada') throw new ErrorNegocio(`La habitación ${hab.numero} no está ocupada`);
        const [res] = await conn.query(
          `SELECT id FROM reservas WHERE habitacion_id = ? AND estado = 'en_curso' ORDER BY id DESC LIMIT 1`,
          [habitacionId]
        );
        if (res[0]) {
          reservaId = res[0].id;
          await conn.query(`UPDATE reservas SET estado = 'finalizada' WHERE id = ?`, [reservaId]);
        }
        await conn.query(`UPDATE habitaciones SET estado = 'limpieza' WHERE id = ?`, [habitacionId]);
        mensaje = `Check-out en la habitación ${hab.numero}`;
      } else if (accion === 'limpieza-terminada') {
        if (fisico !== 'limpieza') throw new ErrorNegocio(`La habitación ${hab.numero} no está en limpieza`);
        await conn.query(`UPDATE habitaciones SET estado = 'disponible' WHERE id = ?`, [habitacionId]);
        mensaje = `Limpieza terminada en la habitación ${hab.numero}`;
      } else if (accion === 'mantenimiento-on') {
        if (fisico !== 'disponible' && fisico !== 'limpieza')
          throw new ErrorNegocio(`La habitación ${hab.numero} no puede pasar a mantenimiento desde ${fisico}`);
        await conn.query(`UPDATE habitaciones SET estado = 'mantenimiento' WHERE id = ?`, [habitacionId]);
        mensaje = `La habitación ${hab.numero} pasó a mantenimiento`;
      } else {
        if (fisico !== 'mantenimiento')
          throw new ErrorNegocio(`La habitación ${hab.numero} no está en mantenimiento`);
        await conn.query(`UPDATE habitaciones SET estado = 'disponible' WHERE id = ?`, [habitacionId]);
        mensaje = `La habitación ${hab.numero} terminó el mantenimiento`;
      }
      return { reservaId, mensaje };
    })
  );

  const habitacion = await habitaciones.obtener(habitacionId);
  const reserva = resultado.reservaId ? await reservas.formatear(pool, resultado.reservaId) : null;
  realtime.emitir('estado-cambiado', { habitacion, reserva, por: usuario });
  await bitacora.registrar('estado', resultado.mensaje, usuario);
  return { habitacion, reserva };
}

// Cuando un bloqueo vence solo, se avisa a todos
locks.alExpirar((habitacionId) =>
  realtime.emitir('habitacion-desbloqueada', { habitacionId, expirado: true })
);

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  const exigirUsuario = () => {
    if (!socket.username) throw new ErrorNegocio('Identifíquese antes de continuar');
    return socket.username;
  };

  socket.on('setUsername', responder((nombre) => {
    const limpio = String(nombre || '').trim();
    if (limpio.length < 2 || limpio.length > 30)
      throw new ErrorNegocio('El nombre debe tener entre 2 y 30 caracteres');
    socket.username = limpio;
    return { usuario: limpio };
  }));

  socket.on('bloquear-habitacion', responder(async (habitacionId) => {
    const usuario = exigirUsuario();
    const hab = Number.isInteger(habitacionId) ? await habitaciones.obtener(habitacionId) : null;
    if (!hab) throw new ErrorNegocio('La habitación no existe');
    if (hab.estadoFisico === 'mantenimiento')
      throw new ErrorNegocio(`La habitación ${hab.numero} está en mantenimiento`);

    locks.liberarDeSocket(socket.id).forEach((id) => {
      if (id !== habitacionId) realtime.emitir('habitacion-desbloqueada', { habitacionId: id });
    });

    const r = locks.bloquear(habitacionId, socket.id, usuario);
    if (!r.ok)
      throw new ErrorNegocio(`La habitación ${hab.numero} está siendo reservada por ${r.bloqueo.usuario}`);

    realtime.emitir('habitacion-bloqueada', r.bloqueo);
    return { bloqueo: r.bloqueo };
  }));

  socket.on('desbloquear-habitacion', responder((habitacionId) => {
    if (locks.liberar(habitacionId, socket.id)) {
      realtime.emitir('habitacion-desbloqueada', { habitacionId });
    }
    return {};
  }));

  socket.on('crear-reserva', responder((datos) => reservas.crear(datos, exigirUsuario(), socket.id)));
  socket.on('cancelar-reserva', responder((reservaId) => reservas.cancelar(reservaId, exigirUsuario())));
  socket.on('cambiar-estado', responder((datos) =>
    cambiarEstado(datos && datos.habitacionId, datos && datos.accion, exigirUsuario())
  ));

  // ---- ADMIN ----

  // El panel de administrador pide el estado completo 
  socket.on('pedir-estado', responder(async () => {
    const estado = await estadoAdmin();
    socket.emit('admin-estado', estado);
    return {};
  }));

  // Liberar todos los bloqueos temporales
  socket.on('admin-liberar-locks', responder(() => {
    const ids = locks.listar().map((b) => b.habitacionId);
    ids.forEach((id) => {
      locks.liberar(id);
      realtime.emitir('habitacion-desbloqueada', { habitacionId: id });
    });
    bitacora.registrar('admin', `Administrador liberó ${ids.length} bloqueo(s) temporal(es)`, 'admin');
    return { liberados: ids.length };
  }));

  // Resetear hotel: cancela todas las reservas activas/en_curso y devuelve habitaciones a disponible
  socket.on('admin-reset', responder(async () => {
    await transaccion(async (conn) => {
      await conn.query(
        `UPDATE reservas SET estado = 'cancelada' WHERE estado IN ('activa','en_curso')`
      );
      await conn.query(`UPDATE habitaciones SET estado = 'disponible'`);
    });

    // Liberar todos los locks en memoria
    locks.listar().forEach((b) => {
      locks.liberar(b.habitacionId);
      realtime.emitir('habitacion-desbloqueada', { habitacionId: b.habitacionId });
    });

    // Notificar a todos los clientes que el estado cambió
    const estado = await estadoInicial();
    io.emit('init', estado);

    await bitacora.registrar('admin', 'Hotel reseteado (reservas canceladas, habitaciones liberadas)', 'admin');
    return {};
  }));

  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
    locks.liberarDeSocket(socket.id).forEach((habitacionId) =>
      realtime.emitir('habitacion-desbloqueada', { habitacionId })
    );
  });

  estadoInicial()
    .then((estado) => socket.emit('init', estado))
    .catch((err) => console.error('No se pudo enviar el estado inicial:', err.message));
});

const PORT = Number(process.env.PORT) || 3000;

async function iniciar() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(`No se pudo conectar a MySQL (${err.code || err.message}).`);
    console.error('Revise .env y que el esquema (schema.sql + seed.sql) esté cargado.');
    process.exit(1);
  }
  server.listen(PORT, () => console.log(`HotelSync escuchando en http://localhost:${PORT}`));
}

iniciar();