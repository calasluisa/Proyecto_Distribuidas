// Puente para avisar a todos los clientes (Socket.io)
let io = null;
const suscriptores = [];

function iniciar(servidorIo) {
  io = servidorIo;
}

function emitir(evento, datos) {
  if (io) io.emit(evento, datos);
  suscriptores.forEach((fn) => {
    try { fn(evento, datos); } catch (err) { console.error('Error en suscriptor:', err.message); }
  });
}

function suscribir(fn) {
  suscriptores.push(fn);
}

module.exports = { iniciar, emitir, suscribir };