// Shared leaveRoom helper — ends the current room session cleanly.
//
// Uses a guaranteed REST call (/api/rooms/:id/leave) to mark the player as
// gone before we disconnect the socket. The older path (just socket.emit then
// disconnect) raced the transport close and frequently dropped the event, so
// peers were stuck seeing the leaver in the roster for the full 40s disconnect
// grace window — and on rejoin the user would appear as a duplicate next to
// their stale entry.
import { getSocket, disconnectSocket } from './socket.js';
import { clearRoomSession } from './session.js';
import { useStore } from './store.js';
import { api } from './api.js';

export function leaveRoom() {
  const st = useStore.getState();
  const { roomId, me, room } = st;

  if (roomId && me.id) {
    // Fire-and-forget REST leave. The backend marks the player as a zombie,
    // promotes the next lead if needed, and broadcasts `player_left` before
    // we pull the plug on the socket.
    api.post(`/api/rooms/${roomId}/leave`, { player_id: me.id }).catch(() => {});
    // Keep the socket emit too as a defence-in-depth fallback for the
    // offline / network-partition case; harmless if the REST call already
    // triggered the broadcast (the handler is idempotent).
    try {
      getSocket().emit('player_left_voluntary', { room_id: roomId, player_id: me.id });
    } catch {}
  }
  disconnectSocket();
  if (room) clearRoomSession(room);
  st.hardReset();
}
