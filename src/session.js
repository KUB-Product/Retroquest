// Per-room session tokens stored in localStorage. 4-hour TTL.
// Enables refresh-without-losing-identity: POST /api/rooms/:id/join with the
// stored token returns the same player row via backend dedup.
//
// Storage is version-namespaced (`rq_session_v<APP_VERSION>`) so a deploy that
// changes the persisted shape doesn't have to defensively migrate every field —
// older keys are swept on init and ignored.
import { APP_VERSION } from './constants.js';

const KEY_PREFIX = 'rq_session_v';
const KEY = KEY_PREFIX + APP_VERSION;
const TTL_MS = 4 * 60 * 60 * 1000;

// One-time sweep: drop the legacy unversioned key plus any version key that
// isn't ours. Runs at module load so the first read after a deploy doesn't
// surface stale state. Idempotent — safe to run repeatedly.
(function sweepLegacy() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k === 'rq_session') { toRemove.push(k); continue; }
      if (k.startsWith(KEY_PREFIX) && k !== KEY) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {}
})();

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
