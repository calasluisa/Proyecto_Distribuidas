// Panel de administrador: solo lectura + botones de liberar/resetear.
const socket = io();
const $ = (id) => document.getElementById(id);

let avisoTimer = null;
function avisar(texto, tipo = 'ok') {
  const el = $('aviso');
  el.textContent = texto;
  el.className = `aviso aviso--${tipo}`;
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

const ETIQUETAS = {
  disponible: 'Disponible',
  reservada: 'Reservada',
  ocupada: 'Ocupada',
  limpieza: 'En limpieza',
  mantenimiento: 'Mantenimiento',
};

// --- Conexión ---
socket.on('connect', () => {
  $('conexion').classList.add('conexion--ok');
  $('conexion-texto').textContent = 'En línea';
  socket.emit('pedir-estado');
});

socket.on('disconnect', () => {
  $('conexion').classList.remove('conexion--ok');
  $('conexion-texto').textContent = 'Reconectando…';
});

// --- Eventos que cambian el estado: pedimos refresco ---
['init', 'reserva-creada', 'reserva-cancelada', 'estado-cambiado', 'habitacion-desbloqueada', 'habitacion-bloqueada']
  .forEach((evt) => socket.on(evt, () => socket.emit('pedir-estado')));

socket.on('admin-estado', (datos) => render(datos));

// --- Render ---
function render(datos) {
  if (datos.hoy) {
    $('hoy').textContent = new Date(datos.hoy + 'T00:00:00').toLocaleDateString('es-EC', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  }

  const c = { disponible: 0, reservada: 0, ocupada: 0, limpieza: 0, mantenimiento: 0 };
  datos.habitaciones.forEach((h) => { c[h.estado] = (c[h.estado] || 0) + 1; });
  $('c-disponible').textContent = c.disponible || 0;
  $('c-reservada').textContent = c.reservada || 0;
  $('c-ocupada').textContent = c.ocupada || 0;
  $('c-limpieza').textContent = c.limpieza || 0;
  $('c-mantenimiento').textContent = c.mantenimiento || 0;
  $('c-ingresos').textContent = `$${Number(datos.ingresos || 0).toFixed(2)}`;

  // Pisos y habitaciones (solo lectura)
  const cont = $('panel-pisos');
  cont.innerHTML = '';

  datos.pisos.forEach((p) => {
    const lista = datos.habitaciones.filter((h) => h.piso === p.numero);
    if (lista.length === 0) return;

    const sec = document.createElement('section');
    sec.className = 'piso';

    const h2 = document.createElement('h2');
    h2.className = 'piso__titulo';
    h2.innerHTML = `Piso ${p.numero}<span>${p.descripcion}</span>`;
    sec.appendChild(h2);

    const tablero = document.createElement('div');
    tablero.className = 'tablero';

    lista.forEach((h) => {
      const div = document.createElement('div');
      div.className = `llave llave--${h.estado}`;
      div.style.cursor = 'default';
      const detalle = h.reservaActual
        ? h.reservaActual.cliente
        : `$${Number(h.precioBase).toFixed(2)}/noche`;
      div.innerHTML = `
        <span class="llave__numero">${h.numero}</span>
        <span class="llave__tipo">${h.tipo}</span>
        <span class="llave__capacidad">${h.capacidad === 1 ? '1 persona' : `${h.capacidad} personas`}</span>
        <span class="llave__estado">${ETIQUETAS[h.estado]}</span>
        <span class="llave__detalle">${detalle}</span>
      `;
      tablero.appendChild(div);
    });

    sec.appendChild(tablero);
    cont.appendChild(sec);
  });
}

// --- Botones de admin ---
$('btn-liberar').addEventListener('click', () => {
  if (!confirm('¿Liberar todos los bloqueos temporales de 60 s?\n(Las reservas confirmadas no se tocan)')) return;
  socket.emit('admin-liberar-locks', (r) => {
    if (r && r.ok) avisar(`Bloqueos liberados: ${r.liberados}`);
    else avisar((r && r.error) || 'Error al liberar bloqueos', 'error');
  });
});

$('btn-reset').addEventListener('click', () => {
  if (!confirm('¿Resetear el hotel?\n\nSe CANCELARÁN todas las reservas activas y TODAS las habitaciones volverán a "disponible". Esta acción no se puede deshacer.')) return;
  socket.emit('admin-reset', (r) => {
    if (r && r.ok) avisar('Hotel reseteado.');
    else avisar((r && r.error) || 'Error al resetear el hotel', 'error');
  });
});