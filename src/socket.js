// Single Socket.IO instance with auto-rejoin-on-reconnect.
// Other modules should only import `getSocket()` — never construct their own.
import { io } from 'socket.io-client';
import { BACKEND_URL } from './api.js';

let socket = null;

// Closure captures room/player identity so `rejoin()` can fire after any (re)connect.
let roomId = null, playerId = null;

export function setSocketIdentity(newRoomId, newPlayerId) {
  roomId = newRoomId || null;
  playerId = newPlayerId || null;
}

export function getSocket() {
  if (socket) return socket;
  socket = io(BACKEND_URL, {
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });
  const rejoin = () => {
    if (roomId && playerId) socket.emit('join_room', { room_id: roomId, player_id: playerId });
  };
  socket.on('connect',       () => { console.log('[socket] connected'); rejoin(); });
  socket.on('reconnect',     () => { console.log('[socket] reconnected'); rejoin(); });
  socket.on('disconnect',    () => console.log('[socket] disconnected'));
  socket.on('connect_error', (e) => console.warn('[socket] error:', e.message));
  return socket;
}

// Safely disconnect + clear identity. Called from leaveRoom / playAgain so stale
// room events from the prior session can't leak into a new one (FS-3).
export function disconnectSocket() {
  if (socket && socket.connected) socket.disconnect();
  roomId = null; playerId = null;
}
