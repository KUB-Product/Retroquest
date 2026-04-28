// Lobby — shows the room code, invite link, roster, chat, and (for host)
// lock toggle + start button.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store.js';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { toast } from '../toast.js';
import { leaveRoom } from '../leaveRoom.js';
import Avatar from '../components/Avatar.jsx';
import { REACT_EMOJIS } from '../constants.js';

export default function Lobby() {
  const room = useStore((s) => s.room);
  const roomId = useStore((s) => s.roomId);
  const isHost = useStore((s) => s.isHost);
  const players = useStore((s) => s.players);
  const meId = useStore((s) => s.me.id);
  const chat = useStore((s) => s.chat);
  const pushChat = useStore((s) => s.pushChat);
  const setCfgLocal = useStore((s) => s.setCfg);
  const roomOpen = useStore((s) => s.cfg.roomOpen);
  const show = useStore((s) => s.show);

  const reactions       = useStore((s) => s.reactions);
  const reactionBurst   = useStore((s) => s.reactionBurst);
  const reactionTotals  = useStore((s) => s.reactionTotals);
  const reactionFlavors = useStore((s) => s.reactionFlavors);

  const msgsRef = useRef(null);
  const [draft, setDraft] = useState('');

  // Emoji reaction cooldown — matches backend rate-limit (~900 ms). Also
  // tracks which player's picker is currently open.
  const REACT_COOLDOWN_MS = 1000;
  const [openPicker, setOpenPicker] = useState(null); // recipient player_id
  const reactLockRef = useRef(0); // epoch ms at which next react is allowed

  // MVP = player with the highest lifetime reaction count. Single winner only
  // when strictly ahead; ties display no crown so nobody "loses" it randomly.
  const mvpId = useMemo(() => {
    let best = null, bestN = 0, tie = false;
    for (const [pid, n] of Object.entries(reactionTotals)) {
      if (n > bestN) { best = pid; bestN = n; tie = false; }
      else if (n === bestN && n > 0) { tie = true; }
    }
    return tie || bestN === 0 ? null : best;
  }, [reactionTotals]);

  const sendReaction = (to_player_id, emoji) => {
    if (!roomId) return;
    if (to_player_id === meId) return;
    const now = Date.now();
    if (now < reactLockRef.current) { toast('Easy! 1 reaction per second'); return; }
    reactLockRef.current = now + REACT_COOLDOWN_MS;
    getSocket().emit('react', { room_id: roomId, to_player_id, emoji });
    setOpenPicker(null);
  };

  // Per-sender chat cooldown. Five seconds between messages is plenty for a
  // 20-person retro and discourages spam/flood without hurting normal flow.
  // We store the unlock deadline (epoch ms) and tick a local clock only while
  // the cooldown is live so the countdown can update in the UI. The ref mirrors
  // the state so a synchronous double-fire (Enter held down or rapid clicks)
  // can't slip past the check before React flushes the state update.
  const CHAT_COOLDOWN_MS = 5000;
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const cooldownUntilRef = useRef(0);
  const [nowTick, setNowTick] = useState(Date.now());
  const cooldownRemaining = Math.max(0, cooldownUntil - nowTick);
  const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);
  const coolingDown = cooldownRemaining > 0;

  // Close the emoji picker if the user clicks outside of it.
  useEffect(() => {
    if (!openPicker) return;
    const onDown = (e) => { if (!e.target.closest('.react-ctl')) setOpenPicker(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openPicker]);

  useEffect(() => {
    if (!coolingDown) return;
    const iv = setInterval(() => setNowTick(Date.now()), 250);
    return () => clearInterval(iv);
  }, [coolingDown]);

  // Auto-scroll chat on new message.
  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [chat]);

  const link = `${window.location.origin}/join/${room}`;

  const copyLink = () => {
    navigator.clipboard.writeText(link).catch(() => {});
    toast('📋 Invite link copied! Share it with your team.');
  };

  const toggleLock = async () => {
    if (!isHost) { toast('Only the Team Lead can lock the room'); return; }
    const next = !roomOpen;
    setCfgLocal({ roomOpen: next });
    toast(next ? '🔓 Room is now open — players can join' : '🔒 Room is locked — no new players');
    try {
      await api.post(`/api/rooms/${roomId}/lock`, { player_id: meId, is_open: next });
    } catch {
      setCfgLocal({ roomOpen: !next });
      toast('Lock sync failed — reverted');
    }
  };

  const sendChat = async () => {
    const now = Date.now();
    if (now < cooldownUntilRef.current) {
      toast(`Please wait ${Math.ceil((cooldownUntilRef.current - now) / 1000)}s`);
      return;
    }
    const txt = draft.trim();
    if (!txt) return;
    // Lock via ref BEFORE any await — state setters don't flush synchronously,
    // so a second Enter-keydown fired in the same tick would otherwise see
    // the stale cooldownUntil and slip a duplicate message through.
    cooldownUntilRef.current = now + CHAT_COOLDOWN_MS;
    setDraft('');
    setCooldownUntil(now + CHAT_COOLDOWN_MS);
    setNowTick(now);
    if (roomId) {
      try {
        await api.post('/api/chat', { room_id: roomId, player_id: meId, content: txt });
      } catch (e) {
        toast('Chat error');
        console.warn('Chat:', e.message);
      }
    } else {
      // Offline/dev fallback.
      const now = new Date();
      const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
      pushChat({ avatar: 'durian-1', handle: 'you', text: txt, isLead: isHost, time });
    }
  };

  const startGame = () => {
    if (!isHost) { toast('Only the Team Lead can start the game'); return; }
    // Optional ice breaker. When disabled at room creation, host jumps straight
    // to retro (submit phase) and participants follow via the broadcast
    // `phase_changed` + `retro_phase_changed`.
    const cfg = useStore.getState().cfg;
    const skipIce = !cfg.iceEnabled;
    if (skipIce) {
      // Belt-and-suspenders: clear any retro state that could be lingering
      // (e.g., if the host re-uses a tab where `retro.phase` ended on 'vote'
      // from a prior session) so the submit form actually renders.
      useStore.getState().resetRetro();
      useStore.getState().setRetro({
        phase: 'submit',
        timer: cfg.retroSubmitSecs,
        max:   cfg.retroSubmitSecs,
      });
    }
    if (roomId) {
      const s = getSocket();
      s.emit('phase_change', { room_id: roomId, phase: skipIce ? 'retro' : 'ice' });
      // Persist `retro_phase = 'submit'` server-side so a mid-phase rejoin's
      // state replay puts the participant back on the submit screen (not vote).
      if (skipIce) s.emit('retro_phase_change', { room_id: roomId, retro_phase: 'submit' });
    }
    show(skipIce ? 's-retro' : 's-ice');
  };

  const count = players.length;
  const pct = Math.min((count / 20) * 100, 100);
  const capFill = count >= 18 ? 'var(--pk)' : count >= 14 ? 'var(--y)' : 'var(--g)';

  const lead = players.find((p) => p.isHost);

  return (
    <div className="screen active" id="s-lobby">
      <div className="w520c" style={{ paddingTop: 28 }}>
        {/* Room code */}
        <div style={{ width: '100%', textAlign: 'center' }}>
          <div className="label" style={{ marginBottom: 8 }}>Room Code</div>
          <div className="room-code">{room || '------'}</div>
        </div>

        {/* Invite link */}
        <div className="card card-sm" style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, fontSize: 12, color: 'var(--mt)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link}</div>
            <button className="btn btn-y btn-sm" onClick={copyLink} style={{ flexShrink: 0 }}>📋 Copy Invite Link</button>
          </div>
        </div>

        {/* Player cap */}
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div className="label">Players</div>
            <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 12 }}>
              {count}<span className="muted">/20</span>
            </div>
          </div>
          <div className="cap-bar"><div className="cap-fill" style={{ width: `${pct}%`, background: capFill }}></div></div>
        </div>

        {/* Players list */}
        <div className="p-list" style={{ width: '100%' }}>
          {players.map((p) => {
            const stack     = reactions[p.id]        || [];
            const burst     = reactionBurst[p.id]    || 0;
            const flavors   = reactionFlavors[p.id]  || [];
            const isMvp     = p.id === mvpId;
            const isSelf    = p.id === meId;
            const pickerOpen = openPicker === p.id;
            return (
              <div className={`p-row${isMvp ? ' p-row-mvp' : ''}`} key={p.id}>
                <div className="p-av-wrap">
                  {/* Reaction stack floats above the avatar; each <span> animates
                      independently so new additions pop while older ones drift. */}
                  {stack.length > 0 && (
                    <div className="react-stack" aria-hidden="true">
                      {stack.map((r) => (
                        <span key={r.id} className="react-pop">{r.emoji}</span>
                      ))}
                    </div>
                  )}
                  {/* Key'd on burst counter so the wobble animation restarts
                      every time this player receives a new reaction. */}
                  <div className={`p-av p-av-animated`} key={`av-${p.id}-${burst}`}>
                    <Avatar value={p.avatar} size={32} />
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="p-name">
                    {isMvp && <span className="p-crown" title="Most loved">👑</span>}
                    {p.name || p.anon_handle || 'Player'}
                    {isSelf && <span style={{ fontSize: 10, color: 'var(--mt)' }}> (you)</span>}
                    {flavors.length > 0 && (
                      <span className="p-react-flavors" title="Reactions received">
                        {flavors.map((e, i) => <span key={e + i}>{e}</span>)}
                      </span>
                    )}
                  </div>
                  <div className="muted">Online</div>
                </div>
                {p.isHost && <span className="p-tag tag-host">LEAD</span>}
                {isSelf && !p.isHost && <span className="p-tag tag-you">YOU</span>}
                {!isSelf && (
                  <div className="react-ctl">
                    <button
                      className="react-btn"
                      onClick={() => setOpenPicker(pickerOpen ? null : p.id)}
                      title="Send a reaction"
                      type="button"
                    >😊</button>
                    {pickerOpen && (
                      <div className="react-picker" role="menu">
                        {REACT_EMOJIS.map((e) => (
                          <button
                            key={e}
                            className="react-picker-btn"
                            onClick={() => sendReaction(p.id, e)}
                            type="button"
                          >{e}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Host-only lock */}
        {isHost && (
          <div style={{ width: '100%' }}>
            <button
              className={`lock-toggle ${roomOpen ? 'open' : 'locked'}`}
              onClick={toggleLock}
              style={{ width: '100%', justifyContent: 'center', gap: 8, padding: '10px 18px' }}
            >
              <span>{roomOpen ? '🔓' : '🔒'}</span>
              <span>{roomOpen ? 'Open — Anyone can join' : 'Locked — No new players'}</span>
            </button>
          </div>
        )}

        {/* Chat */}
        <div className="chat-wrap" style={{ width: '100%' }}>
          <div className="chat-head">
            <div className="chat-dot"></div>
            <span style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 12 }}>Lobby Chat</span>
            <span className="muted" style={{ marginLeft: 'auto' }}>anonymous</span>
          </div>
          <div className="chat-msgs" ref={msgsRef}>
            {chat.map((m, i) => (
              <div className="chat-msg" key={i}>
                <div className="chat-av"><Avatar value={m.avatar} size={28} /></div>
                <div className="chat-body">
                  <div className="chat-meta">
                    <span className="chat-handle">{m.handle}</span>
                    {m.isLead && <span className="host-badge">LEAD</span>}
                    <span className="chat-time">{m.time}</span>
                  </div>
                  <div className="chat-text">{m.text}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="chat-input-row">
            <input
              className="chat-inp"
              placeholder={coolingDown ? `Cooling down… ${cooldownSeconds}s` : 'Say something… (max 200 chars)'}
              maxLength={200}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
              disabled={coolingDown}
            />
            <button
              className="btn btn-ghost btn-sm"
              onClick={sendChat}
              disabled={coolingDown || !draft.trim()}
              title={coolingDown ? `Wait ${cooldownSeconds}s before sending again` : 'Send'}
            >
              {coolingDown ? `${cooldownSeconds}s` : 'Send'}
            </button>
          </div>
        </div>

        <div className="muted blink-anim">
          {isHost ? (
            lead ? 'Ready when you are!' : 'Waiting for players…'
          ) : 'Waiting for host to start…'}
        </div>

        {isHost && (
          <button className="btn btn-g btn-full" onClick={startGame}>🚀 Start Game</button>
        )}
        <button className="btn btn-out btn-sm" onClick={leaveRoom}>Leave Room</button>
      </div>
    </div>
  );
}
