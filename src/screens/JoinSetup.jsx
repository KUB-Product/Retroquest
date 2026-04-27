// Player-side room join. Enter 6-char code + avatar, then either land in the
// lobby or (on refresh mid-game) jump straight to the in-progress phase.
import { useState, useEffect } from 'react';
import { useStore } from '../store.js';
import { api } from '../api.js';
import { getSocket, setSocketIdentity } from '../socket.js';
import { loadRoomSession, saveRoomSession, randomToken } from '../session.js';
import { toast } from '../toast.js';
import { randomHandle } from '../constants.js';
import AvatarGrid from '../components/AvatarGrid.jsx';

const COL_INDEX = { went_well: 0, improve: 1, not_sure: 2 };

export default function JoinSetup() {
  const show = useStore((s) => s.show);
  const selAv = useStore((s) => s.selAv);
  const setMe = useStore((s) => s.setMe);
  const setRoom = useStore((s) => s.setRoom);
  const setIsHost = useStore((s) => s.setIsHost);
  const setPlayers = useStore((s) => s.setPlayers);
  const setCfg = useStore((s) => s.setCfg);
  const setChat = useStore.setState;
  const setRetro = useStore((s) => s.setRetro);
  const setReview = useStore((s) => s.setReview);

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  // If App stashed an invite code, prefill it so the player only has to pick
  // an avatar and hit Join.
  useEffect(() => {
    const auto = useStore.getState()._autoJoinCode;
    if (auto) {
      setCode(auto);
      useStore.setState({ _autoJoinCode: null });
    }
  }, []);

  const join = async () => {
    if (busy) return;
    const c = code.trim().toUpperCase();
    if (c.length < 4) { toast('Enter the room code!'); return; }
    setBusy(true);
    try {
      const meName = randomHandle();
      setMe({ name: meName, avatar: selAv, id: null, xp: 0 });
      setIsHost(false);

      const { room } = await api.get(`/api/rooms/${c}`);
      setRoom({ room: room.code, roomId: room.id });

      setCfg({
        roomOpen:             room.cfg_room_open ?? true,
        iceEnabled:           room.cfg_ice_enabled ?? true,
        iceTimerSecs:         room.cfg_ice_timer_secs ?? 10,
        retroSubmitSecs:      room.cfg_retro_submit_secs ?? 90,
        retroSubmitUnlimited: room.cfg_retro_submit_unlimited ?? false,
        retroVoteSecs:        room.cfg_retro_vote_secs ?? 60,
      });

      const existing = loadRoomSession(room.code);
      const sessionToken = existing?.token || randomToken();
      const { player } = await api.post(`/api/rooms/${room.id}/join`, {
        avatar: selAv, session_token: sessionToken,
      });

      const handle = player.anon_handle || meName;
      setMe({ id: player.id, name: handle, avatar: player.avatar || selAv });
      saveRoomSession(room.code, { token: sessionToken, avatar: player.avatar || selAv, name: handle, playerId: player.id });

      const { players } = await api.get(`/api/rooms/${room.id}/players`);
      const mapped = players.map((p) => ({
        ...p,
        name: p.anon_handle || p.name || 'Player',
        isHost: p.is_team_lead === true,
      }));
      setPlayers(mapped);

      // If backend flags me as team lead (host on refresh), honor it.
      const myRecord = mapped.find((p) => p.id === player.id);
      if (myRecord?.isHost) setIsHost(true);

      setSocketIdentity(room.id, player.id);
      const s = getSocket();
      if (!s.connected) s.connect();
      s.emit('join_room', { room_id: room.id, player_id: player.id });

      // Preload the last 20 chat messages.
      try {
        const { messages } = await api.get(`/api/chat/${room.id}`);
        const mappedChat = (messages || []).map((m) => {
          const t = new Date(m.created_at || Date.now());
          const time = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
          return {
            avatar: m.avatar || m.players?.avatar || '🦄',
            handle: m.handle || m.players?.anon_handle || 'Player',
            text:   m.content,
            isLead: m.is_team_lead || m.players?.is_team_lead || false,
            time,
          };
        });
        setChat({ chat: mappedChat });
      } catch {}

      // Mid-game rejoin: route directly to the phase the room is currently in
      // and hydrate any server-side state we need for that screen.
      const phase = room.phase || 'lobby';
      const retroPhase = room.retro_phase || 'submit';

      try { history.pushState(null, '', `/join/${room.code}`); } catch {}

      if (phase === 'lobby' || phase === 'waiting') {
        show('s-lobby');
      } else if (phase === 'ice') {
        show('s-ice');
      } else if (phase === 'retro') {
        try {
          const { cards } = await api.get(`/api/rooms/${room.id}/cards?phase=${retroPhase}&player_id=${player.id}`);
          if (cards?.length) hydrateRetroCards(cards, setRetro, player.id);
        } catch {}
        setRetro({ phase: retroPhase });
        show('s-retro');
      } else if (phase === 'review') {
        try {
          const { cards } = await api.get(`/api/rooms/${room.id}/cards?phase=vote&player_id=${player.id}`);
          if (cards?.length) {
            // Rehydrate retro cards AND the review-phase metadata (comments,
            // discussed, duplicates). SR-4 fix parity: without this, a refresher
            // lands in Review with a blank comments panel and un-marked
            // discussed/duplicate flags even though peers already have them.
            const localByDb = hydrateRetroCards(cards, setRetro, player.id, true);
            const discussed = new Set();
            const duplicates = new Set();
            for (const c of cards) {
              const localId = localByDb[c.id];
              if (localId == null) continue;
              if (c.is_discussed) discussed.add(localId);
              if (c.is_duplicate) duplicates.add(localId);
            }
            const comments = {};
            await Promise.all(cards.map(async (c) => {
              const localId = localByDb[c.id];
              if (localId == null) return;
              try {
                const { comments: list } = await api.get(`/api/cards/${c.id}/comments`);
                if (!Array.isArray(list) || !list.length) return;
                comments[localId] = list.map((cm) => {
                  const t = new Date(cm.created_at);
                  const time = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
                  return {
                    avatar: cm.players?.avatar || '🦄',
                    handle: cm.players?.anon_handle || 'Lead',
                    text:   cm.content,
                    isLead: true,
                    time,
                  };
                });
              } catch {}
            }));
            setReview({ discussed, duplicates, comments });
          }
        } catch {}
        show('s-review');
      } else if (phase === 'results') {
        show('s-results');
      } else {
        show('s-lobby');
      }
    } catch (e) {
      toast('Could not join: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen active" id="s-joinsetup">
      <div className="center" style={{ maxWidth: 440 }}>
        <div className="badge bdg-b">Join a Room</div>
        <h2>Pick your avatar</h2>
        <p className="sub">You'll play anonymously — your avatar is your identity.</p>
        <div style={{ width: '100%' }}>
          <input
            className="inp inp-code"
            placeholder="ROOM CODE"
            maxLength={6}
            style={{ marginBottom: 12 }}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        <div style={{ width: '100%' }}>
          <div className="muted" style={{ marginBottom: 8 }}>Choose your avatar</div>
          <AvatarGrid />
        </div>
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button className="btn btn-out" style={{ flex: 1 }} onClick={() => show('s-home')}>← Back</button>
          <button className="btn btn-b" style={{ flex: 2 }} onClick={join} disabled={busy}>
            {busy ? 'Joining…' : 'Join Game →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function hydrateRetroCards(cards, setRetro, myPlayerId) {
  const lanes = [[], [], []];
  const localByDb = {}; // server card id → local id, needed by the review rehydrate
  let nextId = 0;
  for (const c of cards) {
    const ci = COL_INDEX[c.col];
    if (ci == null) continue;
    const localId = nextId++;
    localByDb[c.id] = localId;
    lanes[ci].push({
      id: localId, dbId: c.id,
      txt: c.content || '',
      pid: c.player_id,
      pname: c.players?.anon_handle || 'Teammate',
      pav:   c.players?.avatar || '🦄',
      votes: c.vote_count || 0,
      isMe:  c.player_id === myPlayerId,
      is_duplicate: !!c.is_duplicate,
      is_discussed: !!c.is_discussed,
    });
  }
  setRetro({ cards: lanes, nextId });
  return localByDb;
}
