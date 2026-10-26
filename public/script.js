const socket = io();

const usernameInput = document.getElementById('usernameInput');
const bookBtn = document.getElementById('bookBtn');
const roomsContainer = document.getElementById('rooms');
const groupBy = document.getElementById('groupBy');
const timerDisplay = document.getElementById('timerDisplay');
const totalDisplay = document.getElementById('totalDisplay');
const selectedSummary = document.getElementById('selectedSummary');
const adminToggle = document.getElementById('adminToggle');
const adminPanel = document.getElementById('adminPanel');
const roomStats = document.getElementById('roomStats');
const releaseAllBtn = document.getElementById('releaseAllBtn');
const resetRoomsBtn = document.getElementById('resetRoomsBtn');

const selectedRooms = new Set();
let serverRooms = {};
let timerInterval = null;
let reservationEndTime = 0;

const typeLabels = { standard: 'Estándar', deluxe: 'Deluxe', suite: 'Suite' };
const statusLabels = { available: 'Disponible', reserved: 'Reservada', booked: 'Ocupada' };

function updatePurchaseSummary() {
    const ids = Array.from(selectedRooms);
    const total = ids.reduce((sum, id) => sum + (serverRooms[id]?.price || 0), 0);
    selectedSummary.innerText = ids.length
        ? `Habitaciones seleccionadas: ${ids.join(', ')}`
        : 'Selecciona una o más habitaciones.';
    totalDisplay.innerText = `$${total.toFixed(2)}`;
}

function updateAdminStats() {
    const counts = Object.values(serverRooms).reduce((result, room) => {
        result[room.status] += 1;
        return result;
    }, { available: 0, reserved: 0, booked: 0 });
    roomStats.innerHTML = `
        <div><strong>${counts.available}</strong><span>Disponibles</span></div>
        <div><strong>${counts.reserved}</strong><span>Reservadas</span></div>
        <div><strong>${counts.booked}</strong><span>Ocupadas</span></div>
    `;
}

function roomTitle(id, room) {
    return `Habitación ${id} · ${typeLabels[room.type]} · $${room.price}/noche · ${statusLabels[room.status]}`;
}

function renderRooms(rooms) {
    serverRooms = rooms;
    roomsContainer.innerHTML = '';
    const grouped = {};
    Object.entries(rooms).forEach(([id, room]) => {
        const key = groupBy.value === 'floor' ? `Piso ${room.floor}` : typeLabels[room.type];
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push([id, room]);
    });

    Object.entries(grouped).forEach(([title, entries]) => {
        const section = document.createElement('section');
        section.className = 'room-group';
        section.innerHTML = `<h2>${title}</h2><div class="room-grid"></div>`;
        const grid = section.querySelector('.room-grid');
        entries.forEach(([id, room]) => {
            const button = document.createElement('button');
            button.className = `room ${room.status}`;
            button.type = 'button';
            button.id = `room-${id}`;
            button.innerHTML = `<strong>${id}</strong><span>${typeLabels[room.type]}</span><small>$${room.price}/noche</small>`;
            button.title = roomTitle(id, room);
            button.disabled = room.status === 'booked' || (room.status === 'reserved' && !selectedRooms.has(id));
            button.addEventListener('click', () => toggleRoom(id));
            grid.appendChild(button);
        });
        roomsContainer.appendChild(section);
    });
    selectedRooms.forEach(id => {
        if (!rooms[id] || rooms[id].status !== 'reserved') selectedRooms.delete(id);
    });
    updatePurchaseSummary();
    updateAdminStats();
}

function toggleRoom(roomId) {
    const username = usernameInput.value.trim();
    if (!username) {
        window.alert('Ingresa el nombre del huésped antes de seleccionar una habitación.');
        usernameInput.focus();
        return;
    }
    socket.emit('setUsername', username);
    const room = serverRooms[roomId];
    if (!room || (room.status !== 'available' && !selectedRooms.has(roomId))) return;
    if (selectedRooms.has(roomId)) {
        selectedRooms.delete(roomId);
        socket.emit('release', roomId);
    } else {
        selectedRooms.add(roomId);
        socket.emit('reserve', roomId);
    }
    updatePurchaseSummary();
}

groupBy.addEventListener('change', () => renderRooms(serverRooms));
bookBtn.addEventListener('click', () => {
    if (selectedRooms.size && usernameInput.value.trim()) {
        socket.emit('book', Array.from(selectedRooms));
        selectedRooms.clear();
        updatePurchaseSummary();
        stopTimer();
    }
});
adminToggle.addEventListener('click', () => {
    adminPanel.hidden = !adminPanel.hidden;
    adminToggle.innerText = adminPanel.hidden ? 'Panel de administrador' : 'Ocultar panel';
});
releaseAllBtn.addEventListener('click', () => socket.emit('admin:releaseAll'));
resetRoomsBtn.addEventListener('click', () => {
    if (window.confirm('¿Restablecer todas las habitaciones, incluidas las ocupadas?')) socket.emit('admin:reset');
});

socket.on('init', renderRooms);
socket.on('rooms:update', renderRooms);
socket.on('reserve', ({ roomId, expiresAt }) => {
    reservationEndTime = expiresAt;
    startTimer();
});
socket.on('release', roomId => {
    selectedRooms.delete(roomId);
    updatePurchaseSummary();
    renderRooms(serverRooms);
    stopTimer();
});
socket.on('booked', ({ roomId }) => {
    selectedRooms.delete(roomId);
    renderRooms(serverRooms);
    updatePurchaseSummary();
    stopTimer();
});

function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
        const seconds = Math.max(0, Math.floor((reservationEndTime - Date.now()) / 1000));
        timerDisplay.innerText = `La reserva temporal vence en ${seconds} segundos`;
        if (seconds <= 0) stopTimer();
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    timerDisplay.innerText = '';
}
