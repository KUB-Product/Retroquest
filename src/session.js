// Per-room session tokens stored in localStorage. 4-hour TTL.
// Enables refresh-without-losing-identity: POST /api/rooms/:id/join with the
// stored token returns the same player row via backend dedup.
const KEY = 'rq_session';
const TTL_MS = 4 * 60 * 60 * 1000;

function readAll() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function writeAll(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch {}
}

function pruneExpired(store) {
  const now = Date.now();
  for (const code of Object.keys(store)) {
    if (!store[code]?.savedAt || now - store[code].savedAt > TTL_MS) delete store[code];
  }
  return store;
}

export function saveRoomSession(roomCode, data) {
  if (!roomCode) return;
  const store = pruneExpired(readAll());
  store[roomCode] = { ...data, savedAt: Date.now() };
  writeAll(store);
}

export function loadRoomSession(roomCode) {
  if (!roomCode) return null;
  const store = pruneExpired(readAll());
  return store[roomCode] || null;
}

export function clearRoomSession(roomCode) {
  if (!roomCode) return;
  const store = readAll();
  delete store[roomCode];
  writeAll(store);
}

export function randomToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  for (const b of arr) out += chars[b % chars.length];
  return out;
}
