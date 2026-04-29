// useRoomSocket — mounts once (via App) and wires all room-scoped socket events
// into the Zustand store. Every screen reads from the store; none subscribe directly.
import { useEffect } from 'react';
import { getSocket } from './socket.js';
import { useStore } from './store.js';
import { toast } from './toast.js';
import { REACTION_TTL_MS } from './constants.js';

const COL_INDEX = { went_well: 0, improve: 1, not_sure: 2 };

export function useRoomSocket() {
  useEffect(() => {
    const s = getSocket();
    const handlers = {};
    const on = (ev, fn) => { handlers[ev] = fn; s.on(ev, fn); };

    on('player_joined', (p) => {
      const st = useStore.getState();
      if (p.id === st.me.id) return;
      // Don't early-return when the player is already in the roster — that made
      // refresh-within-grace rejoins invisible: the backend broadcasts a fresh
      // `player_joined` with the new avatar but the old row stayed behind, so
      // peers kept rendering the stale avatar / lead flag. Always upsert, but
      // only toast for genuinely-new arrivals so returning refreshes stay quiet.
      const wasPresent = !!st.players.find((x) => x.id === p.id);
      st.addOrReplacePlayer({
        ...p,
        name: p.anon_handle || 'Player',
        isHost: !!p.is_team_lead,
      });
      // Clear any stale reaction state for this player so their stack, flavor
      // trail, burst counter, and MVP total start fresh every time they
      // (re)enter the room — prevents emoji from a previous session lingering.
      st.resetReactionsFor(p.id);
      if (st.isHost && !wasPresent) toast(`${p.anon_handle} joined the room!`);
    });

    on('lead_set', ({ player_id, anon_handle, avatar }) => {
      const st = useStore.getState();
      const prevLeadId = st.players.find(p => p.isHost)?.id ?? null;
      const isNoOp = prevLeadId === player_id;
      const wasHost = st.isHost;
      const amINowLead = player_id === st.me.id;
      st.markLead(player_id);
      if (amINowLead && !wasHost) {
        st.setIsHost(true);
        if (!isNoOp) toast('👑 You are now the Team Lead');
      } else if (!amINowLead && wasHost) {
        // Server demoted us (e.g., we got disconnected past the lead grace and
        // someone else was promoted). Without this branch the local UI keeps
        // showing host-only buttons that the server will silently reject.
        st.setIsHost(false);
        if (anon_handle) toast(`👑 ${avatar || ''} ${anon_handle} is now Team Lead`);
      } else if (!amINowLead && !isNoOp && (anon_handle || avatar)) {
        toast(`👑 ${avatar || ''} ${anon_handle || 'A new lead'} is now Team Lead`);
      }
    });

    on('player_left', ({ player_id }) => {
      const st = useStore.getState();
      st.removePlayer(player_id);
      // Drop any lingering emoji state so their row doesn't leave a ghost
      // stack if they later rejoin; player_joined will also clear, but doing
      // it on leave means other users don't watch an un-owned stack float.
      st.resetReactionsFor(player_id);
    });

    on('phase_changed', ({ phase }) => {
      const { screen, isHost, show } = useStore.getState();
      // Participants follow; host self-drives transitions.
      if (isHost) return;
      if (phase === 'ice'     && screen !== 's-ice')     show('s-ice');
      if (phase === 'retro'   && screen !== 's-retro')   show('s-retro');
      if (phase === 'review'  && screen !== 's-review')  show('s-review');
      if (phase === 'results' && screen !== 's-results') show('s-results');
    });

    on('retro_phase_changed', ({ retro_phase }) => {
      const st = useStore.getState();
      if (st.isHost) return;
      if (retro_phase !== 'submit' && retro_phase !== 'vote') return;
      if (st.retro.phase === retro_phase) return;
      st.setRetro({ phase: retro_phase });
      if (retro_phase === 'vote') toast('🗳️ Voting phase! Click 👍 to upvote cards');
    });

    on('cards_revealed', ({ cards }) => {
      const st = useStore.getState();
      const lanes = [[], [], []];
      const myVotes = new Set();
      let nextId = 0;
      for (const c of (cards || [])) {
        const ci = COL_INDEX[c.col];
        if (ci == null) continue;
        const localId = nextId++;
        lanes[ci].push({
          id: localId, dbId: c.id,
          txt: c.content || '', pid: c.player_id,
          pname: c.players?.anon_handle ?? 'Teammate',
          pav: c.players?.avatar ?? '🦄',
          votes: c.vote_count ?? 0,
          isMe: c.player_id === st.me.id,
          is_duplicate: !!c.is_duplicate,
          is_discussed: !!c.is_discussed,
        });
      }
      st.setRetro({ cards: lanes, nextId, myVotes });
    });

    on('card_added', (card) => {
      const st = useStore.getState();
      if (st.screen !== 's-retro') return;
      // Accept either spelling — depending on the broadcast site the backend
      // sometimes sends `player_id` (canonical) and sometimes `_player_id`
      // (synthetic for self-events). Either flag means "you wrote it; you
      // already have an optimistic copy". The dbId check below is the second
      // defence for the path where neither field is present.
      const authorId = card._player_id ?? card.player_id;
      if (authorId === st.me.id) return;
      const lanes = st.retro.cards.map(l => l.slice());
      if (lanes.flat().find(c => c.dbId === card.id)) return; // dedup
      const ci = COL_INDEX[card.col];
      if (ci == null) return;
      const author = st.players.find(p => p.id === (card.player_id || card._player_id));
      lanes[ci].push({
        id: st.retro.nextId, dbId: card.id,
        txt: card.content || '',
        pid: card.player_id || card._player_id,
        pname: author?.name || author?.anon_handle || 'Teammate',
        pav: author?.avatar || '🦄',
        votes: 0, isMe: false,
      });
      st.setRetro({ cards: lanes, nextId: st.retro.nextId + 1 });
    });

    on('card_deleted', ({ card_id }) => {
      const st = useStore.getState();
      const lanes = st.retro.cards.map(l => l.filter(c => c.dbId !== card_id));
      // Also drop any local vote that was tracking this card so the vote
      // counter stays sane if the card is recreated later.
      const myVotes = new Set(st.retro.myVotes);
      myVotes.delete(card_id);
      st.setRetro({ cards: lanes, myVotes });
    });

    on('card_voted', ({ card_id, vote_count }) => {
      const st = useStore.getState();
      const lanes = st.retro.cards.map(l => l.map(c => c.dbId === card_id ? { ...c, votes: vote_count } : c));
      st.setRetro({ cards: lanes });
    });

    on('card_discussed', ({ card_id, is_discussed }) => {
      const st = useStore.getState();
      const local = st.review.queue.find(e => e.card.dbId === card_id);
      if (!local) return;
      const discussed = new Set(st.review.discussed);
      is_discussed ? discussed.add(local.card.id) : discussed.delete(local.card.id);
      st.setReview({ discussed });
    });

    on('card_duplicate', ({ card_id, is_duplicate }) => {
      const st = useStore.getState();
      const local = st.review.queue.find(e => e.card.dbId === card_id);
      if (!local) return;
      const dupes = new Set(st.review.duplicates);
      is_duplicate ? dupes.add(local.card.id) : dupes.delete(local.card.id);
      st.setReview({ duplicates: dupes });
    });

    on('card_commented', ({ card_id, comment_text, author_handle, avatar, created_at }) => {
      const st = useStore.getState();
      const local = st.review.queue.find(e => e.card.dbId === card_id);
      if (!local) return;
      // Server echoes have no player_id, so we can't dedupe by author. Instead
      // we look for a matching `_pendingSelfComments` entry that the host
      // submitComment helper just stashed. If we find one, this echo is the
      // host's own comment — promote the optimistic entry (drop _pendingKey)
      // instead of appending a duplicate.
      const pending = st._pendingSelfComments || {};
      const now = Date.now();
      let matchedKey = null;
      for (const [k, v] of Object.entries(pending)) {
        if (v.expiresAt < now) continue;
        if (v.dbId === card_id && v.text === comment_text) { matchedKey = k; break; }
      }
      const t = new Date(created_at || Date.now());
      const time = t.getHours().toString().padStart(2, '0') + ':' + t.getMinutes().toString().padStart(2, '0');
      const next = { ...st.review.comments };
      const existing = next[local.card.id] ? next[local.card.id].slice() : [];
      if (matchedKey) {
        // Replace the pending optimistic entry with the canonical server copy.
        const idx = existing.findIndex((c) => c._pendingKey === matchedKey);
        if (idx >= 0) existing[idx] = { avatar, handle: author_handle, text: comment_text, isLead: true, time };
        else existing.push({ avatar, handle: author_handle, text: comment_text, isLead: true, time });
        const { [matchedKey]: _, ...rest } = pending;
        useStore.setState({ _pendingSelfComments: rest });
      } else {
        existing.push({ avatar, handle: author_handle, text: comment_text, isLead: true, time });
      }
      next[local.card.id] = existing;
      st.setReview({ comments: next });
    });

    on('card_moved', ({ card_id, col }) => {
      const st = useStore.getState();
      const ci = COL_INDEX[col];
      if (ci == null) return;
      let moved = null;
      // Remove the card from whichever lane currently holds it, then append to the
      // destination. The old implementation inverted this check and left the card
      // in the source lane, so peers saw it duplicated across both columns.
      const lanes = st.retro.cards.map((lane) => {
        if (moved) return lane;
        const idx = lane.findIndex(c => c.dbId === card_id);
        if (idx < 0) return lane;
        moved = lane[idx];
        return [...lane.slice(0, idx), ...lane.slice(idx + 1)];
      });
      if (moved) {
        lanes[ci] = [...lanes[ci], moved];
        st.setRetro({ cards: lanes });
      }
    });

    on('chat_message', ({ avatar, handle, content, is_team_lead, created_at }) => {
      const now = new Date(created_at || Date.now());
      const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      useStore.getState().pushChat({ avatar, handle, text: content, isLead: is_team_lead, time });
    });

    on('ice_answered', ({ player_id, chosen_idx, xp_earned }) => {
      const st = useStore.getState();
      if (player_id === st.me.id || st.screen !== 's-ice') return;
      // Idempotency guard: backend retries or duplicate broadcasts would
      // otherwise double-increment answerCounts/answeredCount and skew the
      // "all answered → reveal" trigger. If we've already recorded this
      // player's pick for the current question, drop the echo.
      if (st.ice.playerPicks[player_id] !== undefined) return;
      const counts = st.ice.answerCounts.slice();
      counts[chosen_idx] = (counts[chosen_idx] || 0) + 1;
      const scores = { ...st.ice.scores };
      if (xp_earned > 0) scores[player_id] = (scores[player_id] || 0) + xp_earned;
      st.setIce({
        answerCounts: counts,
        answeredCount: st.ice.answeredCount + 1,
        playerPicks: { ...st.ice.playerPicks, [player_id]: chosen_idx },
        scores,
      });
    });

    on('ice_reveal', ({ q_idx, answer_counts, player_picks }) => {
      const st = useStore.getState();
      if (st.isHost) return;
      const patch = { resultsShown: true };
      if (Array.isArray(answer_counts)) patch.answerCounts = answer_counts;
      if (player_picks) patch.playerPicks = player_picks;
      st.setIce(patch);
    });

    on('ice_next_q', ({ q_idx }) => {
      const st = useStore.getState();
      if (st.isHost) return;
      // Reset the timer display to the configured max so participants don't
      // see a "0" for the ~1s gap before the first timer_tick of the new question.
      st.setIce({
        qIdx: q_idx,
        resultsShown: false,
        nextScheduled: false,
        answered: false,
        myPick: -1,
        answerCounts: [0, 0, 0, 0],
        answeredCount: 0,
        playerPicks: {},
        timer: st.cfg.iceTimerSecs,
        max:   st.cfg.iceTimerSecs,
      });
    });

    on('ice_prev_q', ({ q_idx }) => {
      const st = useStore.getState();
      if (st.isHost) return;
      st.setIce({
        qIdx: q_idx,
        resultsShown: false,
        nextScheduled: false,
        answered: false,
        myPick: -1,
        answerCounts: [0, 0, 0, 0],
        answeredCount: 0,
        playerPicks: {},
        timer: st.cfg.iceTimerSecs,
        max:   st.cfg.iceTimerSecs,
      });
    });

    on('timer_tick', ({ timer, phase, max }) => {
      const st = useStore.getState();
      if (phase === 'ice') st.setIce({ timer, max: max ?? st.ice.max });
      else if (phase === 'retro_submit' || phase === 'retro_vote') st.setRetro({ timer, max: max ?? st.retro.max });
    });

    on('timer_end', ({ phase }) => {
      const st = useStore.getState();
      if (phase === 'ice' && !st.ice.resultsShown) st.setIce({ resultsShown: true });
      // retro_submit / retro_vote transitions are host-driven via `phase_change` events.
    });

    on('review_navigate', ({ card_index }) => {
      const st = useStore.getState();
      if (!st.isHost) st.setReview({ idx: card_index });
    });

    on('reacted', ({ from_player_id, to_player_id, emoji, at }) => {
      const id = useStore.getState().addReaction(to_player_id, { emoji, from_player_id, at });
      // Schedule expiry so the visual stack drains by itself over time.
      setTimeout(() => useStore.getState().expireReaction(to_player_id, id), REACTION_TTL_MS);
    });

    on('room_locked',   () => useStore.getState().setCfg({ roomOpen: false }));
    on('room_unlocked', () => useStore.getState().setCfg({ roomOpen: true }));
    on('game_ended',    () => { const st = useStore.getState(); if (st.screen !== 's-results') st.show('s-results'); });

    // Do NOT auto-connect here. Home/admin screens have no backend work to do
    // and would otherwise trigger an infinite socket retry storm in the
    // console (ERR_CONNECTION_REFUSED × N) while the user just looks at the
    // landing page. createRoom / joinRoom call `s.connect()` themselves after
    // setSocketIdentity(roomId, playerId) — that's the right moment.

    return () => { for (const [ev, fn] of Object.entries(handlers)) s.off(ev, fn); };
  }, []);
}
