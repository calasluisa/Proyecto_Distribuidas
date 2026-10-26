// Servidor con Express y Socket.IO para reservas de habitaciones de hotel.
const express = require('express');
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const path = require('path');
const socketIo = require('socket.io');

//Instanciamos express
const app = express();

//Creamos el servidor HTTP
const server = http.createServer(app);

//Crear servidor WebSocket
const io = socketIo(server);

//Servir los archivos estáticos desde la carpeta "public"
app.use(express.static(path.join(__dirname, 'public')));

const roomCatalog = [
  { floor: 1, rooms: ['101', '102', '103', '104', '105', '106'] },
  { floor: 2, rooms: ['201', '202', '203', '204', '205', '206'] },
  { floor: 3, rooms: ['301', '302', '303', '304', '305', '306'] }
];
const roomTypes = ['standard', 'deluxe', 'suite'];
const roomPrices = { standard: 75, deluxe: 110, suite: 165 };
const rooms = {};

roomCatalog.forEach(({ floor, rooms: floorRooms }) => {
  floorRooms.forEach((number, index) => {
    const type = roomTypes[index % roomTypes.length];
    rooms[number] = {
      floor,
      type,
      price: roomPrices[type],
      status: 'available',
      user: '',
      expiresAt: 0
    };
  });
});

const createAvailableRoom = (room) => ({
  floor: room.floor,
  type: room.type,
  price: room.price,
  status: 'available',
  user: '',
  expiresAt: 0
});

const tcpClients = new Set();
const udpClients = new Map();
const sendJson = (socket, message) => socket.write(`${JSON.stringify(message)}\n`);

function broadcastRooms() {
  io.emit('rooms:update', rooms);
  tcpClients.forEach(client => sendJson(client, { event: 'rooms:update', rooms }));
  udpClients.forEach(client => {
    client.socket.send(Buffer.from(JSON.stringify({ event: 'rooms:update', rooms })), client.port, client.address);
  });
}

function reserveRoom(roomId, username) {
  const room = rooms[roomId];
  if (!room || room.status !== 'available') return { ok: false, error: 'Habitación no disponible' };

  room.status = 'reserved';
  room.user = username || 'Usuario';
  room.expiresAt = Date.now() + 60000;
  const reservation = { roomId, user: room.user, expiresAt: room.expiresAt };
  io.emit('reserve', reservation);
  broadcastRooms();

  setTimeout(() => {
    const currentRoom = rooms[roomId];
    if (currentRoom && currentRoom.status === 'reserved' && Date.now() >= currentRoom.expiresAt) {
      rooms[roomId] = createAvailableRoom(currentRoom);
      io.emit('release', roomId);
      broadcastRooms();
    }
  }, 60000);
  return { ok: true, data: reservation };
}

function releaseRoom(roomId, username) {
  const room = rooms[roomId];
  if (!room || room.status !== 'reserved' || room.user !== username) {
    return { ok: false, error: 'La habitación no está reservada por este huésped' };
  }
  rooms[roomId] = createAvailableRoom(room);
  io.emit('release', roomId);
  broadcastRooms();
  return { ok: true };
}

function bookRooms(roomIds, username) {
  if (!Array.isArray(roomIds)) return { ok: false, error: 'roomIds debe ser un arreglo' };
  const booked = [];
  roomIds.forEach(roomId => {
    const room = rooms[roomId];
    if (room && room.status === 'reserved' && room.user === username) {
      room.status = 'booked';
      room.expiresAt = 0;
      booked.push(roomId);
      io.emit('booked', { roomId, user: room.user });
    }
  });
  if (booked.length) broadcastRooms();
  return { ok: true, data: { booked } };
}

function resetRooms(onlyReserved) {
  Object.keys(rooms).forEach(roomId => {
    if (!onlyReserved || rooms[roomId].status === 'reserved') {
      rooms[roomId] = createAvailableRoom(rooms[roomId]);
    }
  });
  broadcastRooms();
}

function processCommand(command, clientState) {
  if (!command || typeof command !== 'object') return { ok: false, error: 'Mensaje JSON inválido' };
  if (command.action === 'setUsername') {
    clientState.username = String(command.username || 'Usuario').trim().slice(0, 50) || 'Usuario';
    return { ok: true, data: { username: clientState.username } };
  }
  if (command.action === 'list') return { ok: true, data: rooms };
  if (!clientState.username) return { ok: false, error: 'Primero usa setUsername' };
  if (command.action === 'reserve') return reserveRoom(String(command.roomId), clientState.username);
  if (command.action === 'release') return releaseRoom(String(command.roomId), clientState.username);
  if (command.action === 'book') return bookRooms(command.roomIds, clientState.username);
  return { ok: false, error: 'Acción desconocida' };
}

const tcpServer = net.createServer(socket => {
  const clientState = { username: '' };
  tcpClients.add(socket);
  sendJson(socket, { event: 'init', rooms });
  let buffer = '';

  socket.on('data', chunk => {
    buffer += chunk.toString();
    const messages = buffer.split('\n');
    buffer = messages.pop();
    messages.filter(Boolean).forEach(message => {
      let response;
      try {
        response = processCommand(JSON.parse(message), clientState);
      } catch {
        response = { ok: false, error: 'Mensaje JSON inválido' };
      }
      sendJson(socket, response);
    });
  });
  socket.on('close', () => tcpClients.delete(socket));
  socket.on('error', () => tcpClients.delete(socket));
});

const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (message, remote) => {
  const clientKey = `${remote.address}:${remote.port}`;
  const clientState = udpClients.get(clientKey) || { username: '' };
  udpClients.set(clientKey, { ...clientState, socket: udpServer, port: remote.port, address: remote.address });
  let response;
  try {
    response = processCommand(JSON.parse(message.toString()), clientState);
  } catch {
    response = { ok: false, error: 'Mensaje JSON inválido' };
  }
  udpServer.send(Buffer.from(JSON.stringify(response)), remote.port, remote.address);
});

//Manejo de conexión de clientes
io.on('connection', (socket) => {
  socket.emit('init', rooms);

  //Registrar nombre del cliente
  socket.on('setUsername', (username) => {
    socket.username = username;
  });

  // Manejar la reserva temporal de una habitación.
  socket.on('reserve', (roomId) => {
    reserveRoom(roomId, socket.username);
  });

  // Manejar la liberación de una habitación reservada.
  socket.on('release', (roomId) => {
    releaseRoom(roomId, socket.username);
  });
  
  // Confirmar la reserva de las habitaciones seleccionadas.
  socket.on('book', (roomIds) => {
    bookRooms(roomIds, socket.username);
  });

  // Acciones del panel de administración.
  socket.on('admin:releaseAll', () => {
    resetRooms(true);
  });

  socket.on('admin:reset', () => {
    resetRooms(false);
  });
});


//Iniciar el servidor en el puerto
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Servidor activo en http://localhost:${PORT}`);
});

const TCP_PORT = 4000;
const UDP_PORT = 4001;
tcpServer.listen(TCP_PORT, () => {
  console.log(`Servidor TCP activo en tcp://localhost:${TCP_PORT}`);
});
udpServer.bind(UDP_PORT, () => {
  console.log(`Servidor UDP activo en udp://localhost:${UDP_PORT}`);
});