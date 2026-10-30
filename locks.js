// 1) Bloqueos temporales: mientras un recepcionista arma una reserva,
//    la habitación queda bloqueada 60 s.
// 2) Colas por habitación: serializan las operaciones sobre la misma habitación.

const DURACION_MS = 60000;
const bloqueos = new Map();   // habitacionId -> { habitacionId, usuario, socketId, expiraEn, timer }
const colas = new Map();      // habitacionId -> Promise del último turno
let alExpirarFn = () => {};

function publico(b) {
  return b
    ? { habitacionId: b.habitacionId, usuario: b.usuario, socketId: b.socketId, expiraEn: b.expiraEn }
    : null;
}

function alExpirar(fn) {
  alExpirarFn = fn;
}

function obtener(habitacionId) {
  return publico(bloqueos.get(habitacionId));
}

function listar() {
  return [...bloqueos.values()].map(publico);
}

function bloquear(habitacionId, socketId, usuario) {
  const actual = bloqueos.get(habitacionId);
  if (actual && actual.socketId !== socketId) {
    return { ok: false, bloqueo: publico(actual) };   // ya lo tiene otro
  }
  if (actual) clearTimeout(actual.timer);
  const nuevo = { habitacionId, usuario, socketId, expiraEn: Date.now() + DURACION_MS };
  nuevo.timer = setTimeout(() => {
    bloqueos.delete(habitacionId);
    alExpirarFn(habitacionId);
  }, DURACION_MS);
  bloqueos.set(habitacionId, nuevo);
  return { ok: true, bloqueo: publico(nuevo) };
}

function liberar(habitacionId, socketId) {
  const b = bloqueos.get(habitacionId);
  if (!b) return false;
  if (socketId !== undefined && b.socketId !== socketId) return false;
  clearTimeout(b.timer);
  bloqueos.delete(habitacionId);
  return true;
}

function liberarDeSocket(socketId) {
  const liberadas = [];
  for (const [id, b] of bloqueos) {
    if (b.socketId === socketId) {
      clearTimeout(b.timer);
      bloqueos.delete(id);
      liberadas.push(id);
    }
  }
  return liberadas;
}

// Ejecuta fn cuando le toca el turno sobre las habitaciones indicadas.
async function conBloqueo(ids, fn) {
  const ordenados = [...new Set(ids)].sort((a, b) => a - b);   // mismo orden y asi evita interbloqueos
  const liberadores = [];
  for (const id of ordenados) {
    const anterior = colas.get(id) || Promise.resolve();
    let liberarTurno;
    const turno = new Promise((res) => { liberarTurno = res; });
    colas.set(id, anterior.then(() => turno));
    await anterior;
    liberadores.push(liberarTurno);
  }
  try {
    return await fn();
  } finally {
    liberadores.forEach((liberarTurno) => liberarTurno());
  }
}

module.exports = { alExpirar, obtener, listar, bloquear, liberar, liberarDeSocket, conBloqueo };