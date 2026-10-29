// HotelSync - cliente con Socket.io (vanilla JS)

const socket = io();

const ESTADOS = ['disponible', 'reservada', 'ocupada', 'limpieza', 'mantenimiento'];
const ETIQUETAS = {
  disponible: 'Disponible',
  reservada: 'Reservada',
  ocupada: 'Ocupada',
  limpieza: 'En limpieza',
  mantenimiento: 'Mantenimiento',
};
const ETIQUETAS_RESERVA = { activa: 'Activa', en_curso: 'En curso' };
const ACCIONES_POR_ESTADO = {
  reservada: [{ accion: 'checkin', texto: 'Hacer check-in', principal: true }],
  ocupada: [{ accion: 'checkout', texto: 'Hacer check-out', principal: true }],
  limpieza: [
    { accion: 'limpieza-terminada', texto: 'Marcar como limpia', principal: true },
    { accion: 'mantenimiento-on', texto: 'Enviar a mantenimiento' },
  ],
  disponible: [{ accion: 'mantenimiento-on', texto: 'Enviar a mantenimiento' }],
  mantenimiento: [{ accion: 'mantenimiento-off', texto: 'Terminar mantenimiento', principal: true }],
};

// -------- utilidades --------
const $ = (id) => document.getElementById(id);

function dinero(valor) { return `$${Number(valor).toFixed(2)}`; }
function sumarDias(fecha, dias) {
  const d = new Date(fecha + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function noches(entrada, salida) {
  return Math.round((Date.parse(salida + 'T00:00:00Z') - Date.parse(entrada + 'T00:00:00Z')) / 86400000);
}
function fechaCorta(fecha) {
  return new Date(fecha + 'T00:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
}
function fechaLarga(fecha) {
  return new Date(fecha + 'T00:00:00').toLocaleDateString('es-EC', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function pedir(evento, datos) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(evento, datos, (err, respuesta) => {
      if (err) return resolve({ ok: false, error: 'El servidor no respondió. Revisa tu conexión.' });
      resolve(respuesta);
    });
  });
}

// -------- estado local --------
const estado = {
  conectado: false,
  usuario: null,
  hoy: '',
  pisos: [],
  tipos: [],
  habitaciones: [],
  reservas: [],
  bloqueos: {},
  eventos: [],
  filtros: { piso: 'todos', tipo: 'todos', estado: 'todos' },
  abierta: null,
  formAbierto: false,
};

const miSocketId = () => socket.id;
const usuarioActual = () => estado.usuario;

let destacadas = {};
function destacar(id) {
  destacadas[id] = true;
  renderPanel();
  setTimeout(() => { delete destacadas[id]; renderPanel(); }, 1600);
}

let avisoTimer = null;
function avisar(texto, tipo = 'ok') {
  const el = $('aviso');
  el.textContent = texto;
  el.className = `aviso aviso--${tipo}`;
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// -------- Socket.io --------
socket.on('connect', () => {
  estado.conectado = true;
  renderConexion();
  const guardado = sessionStorage.getItem('hotelsync_usuario');
  if (guardado) {
    pedir('setUsername', guardado).then((r) => {
      if (r.ok) { estado.usuario = r.usuario; renderApp(); }
    });
  }
});

socket.on('disconnect', () => { estado.conectado = false; renderConexion(); });

socket.on('init', (datos) => {
  estado.hoy = datos.hoy;
  estado.pisos = datos.pisos;
  estado.tipos = datos.tipos;
  estado.habitaciones = datos.habitaciones;
  estado.reservas = datos.reservas;
  estado.eventos = datos.eventos;
  estado.bloqueos = {};
  datos.bloqueos.forEach((b) => { estado.bloqueos[b.habitacionId] = b; });
  renderApp();
});

socket.on('habitacion-bloqueada', (bloqueo) => {
  estado.bloqueos[bloqueo.habitacionId] = bloqueo;
  renderPanel();
  renderModal();
});

socket.on('habitacion-desbloqueada', ({ habitacionId }) => {
  delete estado.bloqueos[habitacionId];
  renderPanel();
  renderModal();
});

function aplicarCambio({ habitacion, reserva, por }) {
  const idx = estado.habitaciones.findIndex((h) => h.id === habitacion.id);
  if (idx >= 0) estado.habitaciones[idx] = habitacion;
  if (reserva) {
    const i = estado.reservas.findIndex((r) => r.id === reserva.id);
    const vigente = reserva.estado === 'activa' || reserva.estado === 'en_curso';
    if (i >= 0) estado.reservas.splice(i, 1);
    if (vigente) estado.reservas.push(reserva);
    estado.reservas.sort((a, b) => a.fechaEntrada.localeCompare(b.fechaEntrada) || a.id - b.id);
  }
  if (por !== usuarioActual()) destacar(habitacion.id);
  renderApp();
  renderModal();
}

socket.on('reserva-creada', aplicarCambio);
socket.on('reserva-cancelada', aplicarCambio);
socket.on('estado-cambiado', aplicarCambio);

socket.on('evento-nuevo', (evento) => {
  estado.eventos.unshift(evento);
  if (estado.eventos.length > 30) estado.eventos.pop();
  renderBitacora();
});

// -------- Login --------
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = $('login-nombre').value.trim();
  if (nombre.length < 2) return;
  const r = await pedir('setUsername', nombre);
  if (!r.ok) {
    $('login-error').textContent = r.error;
    $('login-error').hidden = false;
    return;
  }
  estado.usuario = r.usuario;
  sessionStorage.setItem('hotelsync_usuario', r.usuario);
  $('login-error').hidden = true;
  renderApp();
});

$('cambiar-usuario').addEventListener('click', () => {
  sessionStorage.removeItem('hotelsync_usuario');
  estado.usuario = null;
  renderApp();
});

// -------- Render --------
function renderConexion() {
  const el = $('conexion');
  el.classList.toggle('conexion--ok', estado.conectado);
  $('conexion-texto').textContent = estado.conectado ? 'En línea' : 'Reconectando…';
  $('login-btn').disabled = !estado.conectado;
  $('login-conectando').hidden = estado.conectado;
}

function renderApp() {
  renderConexion();
  const logueado = !!estado.usuario;
  $('login').hidden = logueado;
  $('app').hidden = !logueado;
  if (!logueado) return;

  $('usuario').textContent = estado.usuario;
  $('hoy').textContent = fechaLarga(estado.hoy);

  renderFiltros();
  renderPanel();
  renderReservas();
  renderBitacora();
  renderModal();
}

function conteos() {
  const c = {};
  estado.habitaciones.forEach((h) => { c[h.estado] = (c[h.estado] || 0) + 1; });
  return c;
}

function renderFiltros() {
  const fp = $('filtros-piso');
  fp.innerHTML = '';
  const todos = document.createElement('button');
  todos.type = 'button';
  todos.textContent = 'Todos';
  todos.setAttribute('aria-pressed', estado.filtros.piso === 'todos');
  todos.onclick = () => { estado.filtros.piso = 'todos'; renderApp(); };
  fp.appendChild(todos);
  estado.pisos.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `Piso ${p.numero}`;
    b.setAttribute('aria-pressed', estado.filtros.piso === p.numero);
    b.onclick = () => { estado.filtros.piso = p.numero; renderApp(); };
    fp.appendChild(b);
  });

  const ft = $('filtro-tipo');
  ft.innerHTML = '<option value="todos">Todos los tipos</option>';
  estado.tipos.forEach((t) => {
    const op = document.createElement('option');
    op.value = String(t.id);
    op.textContent = t.nombre;
    if (estado.filtros.tipo === t.id) op.selected = true;
    ft.appendChild(op);
  });
  ft.onchange = () => {
    estado.filtros.tipo = ft.value === 'todos' ? 'todos' : Number(ft.value);
    renderApp();
  };

  const counts = conteos();
  const ley = $('leyenda');
  ley.innerHTML = '';
  ESTADOS.forEach((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ficha ficha--${e}`;
    b.setAttribute('aria-pressed', estado.filtros.estado === e);
    b.innerHTML = `<span class="ficha__color" aria-hidden="true"></span>${ETIQUETAS[e]}<strong>${counts[e] || 0}</strong>`;
    b.onclick = () => {
      estado.filtros.estado = estado.filtros.estado === e ? 'todos' : e;
      renderApp();
    };
    ley.appendChild(b);
  });
}

function habitacionesVisibles() {
  return estado.habitaciones.filter(
    (h) =>
      (estado.filtros.piso === 'todos' || h.piso === estado.filtros.piso) &&
      (estado.filtros.tipo === 'todos' || h.tipoId === estado.filtros.tipo) &&
      (estado.filtros.estado === 'todos' || h.estado === estado.filtros.estado)
  );
}

function renderPanel() {
  const cont = $('panel-pisos');
  cont.innerHTML = '';
  const visibles = habitacionesVisibles();

  if (visibles.length === 0) {
    const v = document.createElement('div');
    v.className = 'vacio';
    v.innerHTML = '<p>Ninguna habitación coincide con los filtros elegidos.</p>';
    cont.appendChild(v);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'pisos';

  estado.pisos.forEach((p) => {
    const lista = visibles.filter((h) => h.piso === p.numero);
    if (lista.length === 0) return;

    const sec = document.createElement('section');
    sec.className = 'piso';
    sec.setAttribute('aria-label', `Piso ${p.numero}`);

    const h2 = document.createElement('h2');
    h2.className = 'piso__titulo';
    h2.innerHTML = `Piso ${p.numero}<span>${p.descripcion}</span>`;
    sec.appendChild(h2);

    const tablero = document.createElement('div');
    tablero.className = 'tablero';

    lista.forEach((h) => {
      const bloqueo = estado.bloqueos[h.id];
      const esMio = bloqueo && bloqueo.socketId === miSocketId();
      let detalle;
      if (bloqueo) detalle = esMio ? 'La estás reservando' : `Reservando: ${bloqueo.usuario}`;
      else if (h.reservaActual) detalle = h.reservaActual.cliente;
      else detalle = `${dinero(h.precioBase)} por noche`;

      const btn = document.createElement('button');
      btn.type = 'button';
      const clases = ['llave', `llave--${h.estado}`];
      if (bloqueo) clases.push('llave--bloqueada');
      if (destacadas[h.id]) clases.push('llave--nueva');
      btn.className = clases.join(' ');
      btn.setAttribute('aria-label', `Habitación ${h.numero}, ${h.tipo}, ${ETIQUETAS[h.estado]}`);
      btn.innerHTML = `
        <span class="llave__numero">${h.numero}</span>
        <span class="llave__tipo">${h.tipo}</span>
        <span class="llave__capacidad">${h.capacidad === 1 ? '1 persona' : `${h.capacidad} personas`}</span>
        <span class="llave__estado">${ETIQUETAS[h.estado]}</span>
        <span class="llave__detalle">${detalle}</span>
      `;
      btn.onclick = () => abrirModal(h.id);
      tablero.appendChild(btn);
    });

    sec.appendChild(tablero);
    wrap.appendChild(sec);
  });

  cont.appendChild(wrap);
}

function renderReservas() {
  const cuenta = $('reservas-cuenta');
  const lista = $('reservas-lista');
  const vacio = $('reservas-vacio');
  cuenta.textContent = estado.reservas.length;
  lista.innerHTML = '';
  if (estado.reservas.length === 0) { vacio.hidden = false; return; }
  vacio.hidden = true;

  estado.reservas.forEach((r) => {
    const li = document.createElement('li');
    li.className = 'reserva';
    li.innerHTML = `
      <button type="button" class="reserva__abrir">
        <span class="reserva__hab">${r.habitacionNumero}</span>
        <span class="reserva__datos">
          <strong>${r.cliente}</strong>
          <span>del ${fechaCorta(r.fechaEntrada)} al ${fechaCorta(r.fechaSalida)}</span>
        </span>
      </button>
      <span class="insignia insignia--${r.estado}">${ETIQUETAS_RESERVA[r.estado]}</span>
    `;
    li.querySelector('.reserva__abrir').onclick = () => abrirModal(r.habitacionId);
    if (r.estado === 'activa') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'boton boton--texto boton--peligro';
      btn.textContent = 'Cancelar';
      btn.onclick = async () => {
        if (!window.confirm(`¿Cancelar la reserva #${r.id} de ${r.cliente}?`)) return;
        const res = await pedir('cancelar-reserva', r.id);
        avisar(res.ok ? `Reserva #${r.id} cancelada.` : res.error, res.ok ? 'ok' : 'error');
      };
      li.appendChild(btn);
    }
    lista.appendChild(li);
  });
}

function renderBitacora() {
  const ol = $('bitacora');
  const vacio = $('bitacora-vacio');
  ol.innerHTML = '';
  if (estado.eventos.length === 0) { vacio.hidden = false; return; }
  vacio.hidden = true;
  estado.eventos.forEach((e) => {
    const li = document.createElement('li');
    const hora = String(e.creadoEn).slice(11, 16);
    li.innerHTML = `<time>${hora}</time><span>${e.descripcion}${e.usuario ? ` <em>por ${e.usuario}</em>` : ''}</span>`;
    ol.appendChild(li);
  });
}

// -------- Modal habitación --------
function habitacionPorId(id) {
  return estado.habitaciones.find((h) => h.id === id);
}

function abrirModal(id) {
  estado.abierta = id;
  estado.formAbierto = false;
  renderModal();
  const modal = $('modal');
  if (!modal.open) modal.showModal();
}

function cerrarModal() {
  if (estado.formAbierto && esMiBloqueo()) {
    pedir('desbloquear-habitacion', estado.abierta);
  }
  estado.abierta = null;
  estado.formAbierto = false;
  const modal = $('modal');
  if (modal.open) modal.close();
  renderPanel();
}

function esMiBloqueo() {
  const b = estado.bloqueos[estado.abierta];
  return b && b.socketId === miSocketId();
}

$('modal-cerrar').addEventListener('click', cerrarModal);
$('modal').addEventListener('close', () => { if (estado.abierta) cerrarModal(); });
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) cerrarModal(); });

let timerCuenta = null;
function iniciarCuenta() {
  clearInterval(timerCuenta);
  timerCuenta = setInterval(() => {
    const b = estado.bloqueos[estado.abierta];
    if (!b || b.socketId !== miSocketId()) return;
    const s = Math.max(0, Math.ceil((b.expiraEn - Date.now()) / 1000));
    const el = $('form-tiempo');
    if (el) el.textContent = `${s} s`;
    if (s <= 0 && estado.formAbierto) {
      estado.formAbierto = false;
      renderModal();
    }
  }, 500);
}

function renderModal() {
  if (!estado.abierta) return;
  const h = habitacionPorId(estado.abierta);
  if (!h) return;
  const bloqueo = estado.bloqueos[h.id];
  const esMio = bloqueo && bloqueo.socketId === miSocketId();
  const bloqueadaPorOtro = bloqueo && !esMio;

  const cab = $('modal-cabecera');
  cab.className = `modal__cabecera modal__cabecera--${h.estado}`;
  $('modal-titulo').innerHTML = `<span class="modal__numero">${h.numero}</span> ${h.tipo}`;
  $('modal-subtitulo').textContent =
    `Piso ${h.piso}, ${h.capacidad === 1 ? '1 persona' : `${h.capacidad} personas`}, ${dinero(h.precioBase)} por noche`;
  $('modal-estado').textContent = ETIQUETAS[h.estado];
  $('modal-servicios').textContent = h.servicios;

  const actual = $('modal-actual');
  if (h.reservaActual) {
    actual.hidden = false;
    const etiqueta = h.reservaActual.estado === 'en_curso' ? 'Alojado:' : 'Llega hoy:';
    actual.innerHTML = `${etiqueta} <strong>${h.reservaActual.cliente}</strong>, del ${fechaCorta(h.reservaActual.fechaEntrada)} al ${fechaCorta(h.reservaActual.fechaSalida)}`;
  } else { actual.hidden = true; }

  const acc = $('modal-acciones');
  acc.innerHTML = '';
  (ACCIONES_POR_ESTADO[h.estado] || []).forEach((a) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `boton ${a.principal ? 'boton--principal' : 'boton--suave'}`;
    btn.textContent = a.texto;
    btn.onclick = async () => {
      const r = await pedir('cambiar-estado', { habitacionId: h.id, accion: a.accion });
      if (!r.ok) avisar(r.error, 'error');
    };
    acc.appendChild(btn);
  });

  const reservasHab = estado.reservas.filter((r) => r.habitacionId === h.id);
  const contR = $('modal-reservas');
  const listaR = $('modal-reservas-lista');
  if (reservasHab.length === 0) { contR.hidden = true; }
  else {
    contR.hidden = false;
    listaR.innerHTML = '';
    reservasHab.forEach((r) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span><strong>${r.cliente}</strong>, del ${fechaCorta(r.fechaEntrada)} al ${fechaCorta(r.fechaSalida)}
          <span class="insignia insignia--${r.estado}">${ETIQUETAS_RESERVA[r.estado]}</span>
        </span>`;
      if (r.estado === 'activa') {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'boton boton--texto boton--peligro';
        b.textContent = 'Cancelar';
        b.onclick = async () => {
          if (!window.confirm(`¿Cancelar la reserva #${r.id} de ${r.cliente}?`)) return;
          const res = await pedir('cancelar-reserva', r.id);
          if (!res.ok) avisar(res.error, 'error');
        };
        li.appendChild(b);
      }
      listaR.appendChild(li);
    });
  }

  const nueva = $('modal-nueva');
  const form = $('form-reserva');
  const avisoBloq = $('modal-bloqueo-aviso');

  if (estado.formAbierto) {
    nueva.hidden = true;
    form.hidden = false;
    $('form-entrada').min = estado.hoy;
    $('form-salida').min = sumarDias($('form-entrada').value || estado.hoy, 1);
    actualizarTotal();
    iniciarCuenta();
  } else {
    nueva.hidden = false;
    form.hidden = true;
    clearInterval(timerCuenta);

    const btnRes = $('btn-reservar');
    btnRes.disabled = bloqueadaPorOtro || h.estado === 'mantenimiento';

    if (bloqueadaPorOtro) {
      avisoBloq.hidden = false;
      avisoBloq.textContent = `${bloqueo.usuario} está reservando esta habitación en este momento.`;
    } else if (h.estado === 'mantenimiento') {
      avisoBloq.hidden = false;
      avisoBloq.textContent = 'No se puede reservar mientras esté en mantenimiento.';
    } else { avisoBloq.hidden = true; }
  }

  const err = $('modal-error');
  err.hidden = true;
}

$('btn-reservar').addEventListener('click', async () => {
  if (!estado.abierta) return;
  const r = await pedir('bloquear-habitacion', estado.abierta);
  if (!r.ok) {
    const err = $('modal-error');
    err.textContent = r.error;
    err.hidden = false;
    return;
  }
  estado.bloqueos[estado.abierta] = r.bloqueo;
  estado.formAbierto = true;
  $('form-cedula').value = '';
  $('form-nombre').value = '';
  $('form-correo').value = '';
  $('form-entrada').value = estado.hoy;
  $('form-salida').value = sumarDias(estado.hoy, 1);
  renderModal();
});

$('form-volver').addEventListener('click', async () => {
  if (estado.abierta) await pedir('desbloquear-habitacion', estado.abierta);
  if (estado.abierta) delete estado.bloqueos[estado.abierta];
  estado.formAbierto = false;
  renderModal();
});

function actualizarTotal() {
  if (!estado.abierta) return;
  const h = habitacionPorId(estado.abierta);
  const entrada = $('form-entrada').value;
  const salida = $('form-salida').value;
  const el = $('form-total');
  if (entrada && salida && salida > entrada) {
    const n = noches(entrada, salida);
    el.innerHTML = `${n} ${n === 1 ? 'noche' : 'noches'}, total estimado <strong>${dinero(n * h.precioBase)}</strong>`;
  } else { el.textContent = 'Elige fechas válidas para ver el total.'; }
}
$('form-entrada').addEventListener('change', () => {
  $('form-salida').min = sumarDias($('form-entrada').value, 1);
  if ($('form-salida').value <= $('form-entrada').value) {
    $('form-salida').value = sumarDias($('form-entrada').value, 1);
  }
  actualizarTotal();
});
$('form-salida').addEventListener('change', actualizarTotal);

// -------- Factura / Recibo --------
let pendingReserva = null;

$('form-reserva').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!estado.abierta) return;

  const h = habitacionPorId(estado.abierta);
  const entrada = $('form-entrada').value;
  const salida = $('form-salida').value;
  const n = noches(entrada, salida);

  pendingReserva = {
    habitacionId: estado.abierta,
    fechaEntrada: entrada,
    fechaSalida: salida,
    cliente: {
      cedula: $('form-cedula').value.trim(),
      nombre: $('form-nombre').value.trim(),
      correo: $('form-correo').value.trim(),
    },
  };

  // Cabecera
  $('invoice-cabecera').className = 'modal__cabecera modal__cabecera--reservada';
  $('invoice-titulo').textContent = 'Confirmar reserva';
  $('invoice-subtitulo').textContent = `Habitación ${h.numero} · ${h.tipo}`;

  // Cuerpo
  $('invoice-hab').textContent = `${h.numero} (${h.tipo})`;
  $('invoice-cliente').textContent = pendingReserva.cliente.nombre;
  $('invoice-cedula').textContent = pendingReserva.cliente.cedula;
  $('invoice-correo').textContent = pendingReserva.cliente.correo;
  $('invoice-entrada').textContent = fechaCorta(entrada);
  $('invoice-salida').textContent = fechaCorta(salida);
  $('invoice-noches').textContent = n;
  $('invoice-precio').textContent = dinero(h.precioBase);
  $('invoice-total').textContent = dinero(n * h.precioBase);

  // Botones
  $('invoice-botones').hidden = false;
  $('invoice-confirmar').disabled = false;
  $('invoice-confirmar').textContent = 'Confirmar reserva';

  $('invoice-modal').showModal();
});

$('invoice-volver').addEventListener('click', () => {
  $('invoice-modal').close();
  pendingReserva = null;
});

$('invoice-cerrar').addEventListener('click', () => {
  $('invoice-modal').close();
});

$('invoice-confirmar').addEventListener('click', async () => {
  if (!pendingReserva) return;
  $('invoice-confirmar').disabled = true;
  $('invoice-confirmar').textContent = 'Procesando…';

  const datos = pendingReserva;
  const r = await pedir('crear-reserva', datos);

  if (r.ok) {
    // Transformar a recibo
    $('invoice-cabecera').className = 'modal__cabecera modal__cabecera--disponible';
    $('invoice-titulo').textContent = 'Reserva confirmada';
    $('invoice-subtitulo').textContent = `Recibo #${r.reserva.id} · Habitación ${r.habitacion.numero}`;
    $('invoice-botones').hidden = true;

    pendingReserva = null;
    estado.formAbierto = false;

    // Cerrar el modal de habitación detrás
    const modal = $('modal');
    if (modal.open) modal.close();
    estado.abierta = null;

    avisar(`Reserva #${r.reserva.id} creada para la habitación ${r.habitacion.numero}.`);
  } else {
    $('invoice-confirmar').disabled = false;
    $('invoice-confirmar').textContent = 'Confirmar reserva';
    $('invoice-modal').close();
    avisar(r.error, 'error');
  }
});

$('invoice-modal').addEventListener('close', () => {
  $('invoice-confirmar').disabled = false;
  $('invoice-confirmar').textContent = 'Confirmar reserva';
});

// Inicial
renderConexion();