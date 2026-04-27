// Host-only room configuration: timers, lock mode, optional custom questions,
// avatar. On "Create Room" we create the room, join as Team Lead, optionally
// save custom questions, then transition to the lobby.
import { useState } from 'react';
import { useStore } from '../store.js';
import { api } from '../api.js';
import { getSocket, setSocketIdentity } from '../socket.js';
import { saveRoomSession, loadRoomSession, randomToken } from '../session.js';
import { toast } from '../toast.js';
import { MAX_QUESTIONS, randomHandle } from '../constants.js';
import AvatarGrid from '../components/AvatarGrid.jsx';

export default function RoomSetup() {
  const cfg = useStore((s) => s.cfg);
  const setCfg = useStore((s) => s.setCfg);
  const show = useStore((s) => s.show);
  const selAv = useStore((s) => s.selAv);
  const setMe = useStore((s) => s.setMe);
  const setRoom = useStore((s) => s.setRoom);
  const setIsHost = useStore((s) => s.setIsHost);
  const setPlayers = useStore((s) => s.setPlayers);

  const [showQForm, setShowQForm] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '', '', '']);
  const [correct, setCorrect] = useState(null);
  const [qXp, setQxp] = useState(100);
  const [busy, setBusy] = useState(false);

  const resetQForm = () => {
    setQ('');
    setOpts(['', '', '', '']);
    setCorrect(null);
    setQxp(100);
  };

  const saveQuestion = () => {
    const qt = q.trim();
    const cleaned = opts.map((o) => o.trim());
    if (!qt) { toast('Enter the question text'); return; }
    const filled = cleaned.filter((o) => o.length);
    if (filled.length < 2) { toast('Enter at least 2 answer options'); return; }
    if (correct == null) { toast('Select the correct answer'); return; }
    if (!cleaned[correct]) { toast('The correct answer option must not be empty'); return; }
    const finalOpts = cleaned.map((o, i) => o || `Option ${['A','B','C','D'][i]}`);
    const next = [...cfg.customQuestions, { q: qt, opts: finalOpts, correct, xp: qXp }];
    setCfg({ customQuestions: next });
    setShowQForm(false);
    resetQForm();
    toast(`✓ Question ${next.length} saved`);
  };

  const deleteQuestion = (idx) => {
    const next = cfg.customQuestions.slice();
    next.splice(idx, 1);
    setCfg({ customQuestions: next });
  };

  const createRoom = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const meName = randomHandle();
      setIsHost(true);
      setMe({ name: meName, avatar: selAv, id: null, xp: 0 });

      const { room } = await api.post('/api/rooms', {
        cfg_room_open:              cfg.roomOpen,
        cfg_ice_enabled:            cfg.iceEnabled,
        cfg_ice_timer_secs:         cfg.iceTimerSecs,
        cfg_retro_submit_secs:      cfg.retroSubmitSecs,
        cfg_retro_submit_unlimited: cfg.retroSubmitUnlimited,
        cfg_retro_vote_secs:        cfg.retroVoteSecs,
      });
      setRoom({ room: room.code, roomId: room.id });

      // Reuse a stored token so refresh keeps our identity via backend dedup.
      const existing = loadRoomSession(room.code);
      const sessionToken = existing?.token || randomToken();
      const { player } = await api.post(`/api/rooms/${room.id}/join`, {
        avatar: selAv, session_token: sessionToken,
      });

      // Promote creator to Team Lead.
      await api.post(`/api/rooms/${room.id}/start`, {
        player_id: player.id, team_lead_player_id: player.id,
      });

      const handle = player.anon_handle || meName;
      setMe({ id: player.id, name: handle, avatar: player.avatar || selAv });
      saveRoomSession(room.code, { token: sessionToken, avatar: selAv, name: handle, playerId: player.id });

      // Save custom questions (authoritative copy lives on the backend).
      // Skip entirely when ice breaker is disabled — questions are useless then.
      if (cfg.iceEnabled && cfg.customQuestions.length > 0) {
        try {
          await api.post('/api/ice/questions', {
            room_id: room.id, player_id: player.id, questions: cfg.customQuestions,
          });
        } catch (e) { console.warn('custom Qs:', e.message); }
      }

      setPlayers([{
        id: player.id, name: handle, avatar: player.avatar || selAv,
        isHost: true, anon_handle: handle,
      }]);

      // Connect + join socket channel so we receive player_joined etc.
      setSocketIdentity(room.id, player.id);
      const s = getSocket();
      if (!s.connected) s.connect();
      s.emit('join_room', { room_id: room.id, player_id: player.id });

      // Catch any joiners who connected during the async gap.
      setTimeout(async () => {
        try {
          const { players: fresh } = await api.get(`/api/rooms/${room.id}/players`);
          const mapped = fresh.map((p) => ({
            ...p,
            name: p.anon_handle || p.name || 'Player',
            isHost: p.is_team_lead === true,
          }));
          setPlayers(mapped);
        } catch {}
      }, 800);

      try { history.pushState(null, '', `/join/${room.code}`); } catch {}
      show('s-lobby');
    } catch (e) {
      toast('Error creating room: ' + e.message);
      setIsHost(false);
    } finally {
      setBusy(false);
    }
  };

  const qCount = cfg.customQuestions.length;

  return (
    <div className="screen active" id="s-roomsetup">
      <div className="w520c" style={{ paddingTop: 32 }}>
        <div style={{ width: '100%', textAlign: 'left' }}>
          <div className="badge bdg-y" style={{ marginBottom: 10 }}>Room Configuration</div>
          <h2>Configure your room</h2>
          <p className="sub" style={{ marginTop: 6 }}>Set up the game rules before players join.</p>
        </div>

        {/* Open/locked toggle */}
        <div className="card" style={{ width: '100%' }}>
          <div className="toggle-row">
            <div className="toggle-label">
              <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 14 }}>
                {cfg.roomOpen ? '🔓 Open Room' : '🔒 Locked Room'}
              </div>
              <div className="muted">
                {cfg.roomOpen ? 'Anyone with the link or code can join' : 'Room is locked — no new players can join'}
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={cfg.roomOpen} onChange={(e) => setCfg({ roomOpen: e.target.checked })} />
              <div className="toggle-track"><div className="toggle-thumb"></div></div>
            </label>
          </div>
        </div>

        {/* Ice breaker enable/disable */}
        <div className="card" style={{ width: '100%' }}>
          <div className="toggle-row">
            <div className="toggle-label">
              <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 14 }}>
                {cfg.iceEnabled ? '🧊 Ice Breaker — On' : '⏭️ Ice Breaker — Skip'}
              </div>
              <div className="muted">
                {cfg.iceEnabled
                  ? 'Warm up with quick trivia before the retro'
                  : 'Jump straight to the retrospective'}
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={cfg.iceEnabled} onChange={(e) => setCfg({ iceEnabled: e.target.checked })} />
              <div className="toggle-track"><div className="toggle-thumb"></div></div>
            </label>
          </div>
        </div>

        {/* Phase timers */}
        <div className="card" style={{ width: '100%' }}>
          <h3 style={{ marginBottom: 16 }}>⏱️ Phase Timers</h3>
          <div className="col" style={{ gap: 18 }}>
            {cfg.iceEnabled && (
              <TimerSlider
                title="Ice Breaker — Question Time"
                sub="Per question duration"
                min={5} max={30} step={1}
                value={cfg.iceTimerSecs}
                onChange={(v) => setCfg({ iceTimerSecs: v })}
              />
            )}
            <div>
              {!cfg.retroSubmitUnlimited && (
                <TimerSlider
                  title="Retro — Submit Phase"
                  sub="Time for card submission"
                  min={30} max={1800} step={30}
                  value={cfg.retroSubmitSecs}
                  onChange={(v) => setCfg({ retroSubmitSecs: v })}
                />
              )}
              <label className="check-row" style={{ marginTop: cfg.retroSubmitUnlimited ? 0 : 10 }}>
                <input
                  type="checkbox"
                  checked={cfg.retroSubmitUnlimited}
                  onChange={(e) => setCfg({ retroSubmitUnlimited: e.target.checked })}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>No limit on submit phase</div>
                  <div className="muted">Host advances manually from the admin panel</div>
                </div>
              </label>
            </div>
            <TimerSlider
              title="Retro — Vote Phase"
              sub="Time for upvoting cards"
              min={30} max={600} step={10}
              value={cfg.retroVoteSecs}
              onChange={(v) => setCfg({ retroVoteSecs: v })}
            />
          </div>
        </div>

        {/* Avatar */}
        <div style={{ width: '100%' }}>
          <div className="muted" style={{ marginBottom: 8 }}>Your avatar (as host)</div>
          <AvatarGrid />
        </div>

        {/* Custom questions — only relevant when ice breaker is on */}
        {cfg.iceEnabled && (
        <div className="card" style={{ width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div>
              <h3>🧠 Custom Ice Breaker Questions</h3>
              <div className="muted" style={{ marginTop: 3 }}>Leave empty to use the default questions</div>
            </div>
            <div
              className="badge bdg-b"
              style={qCount >= MAX_QUESTIONS ? { background: 'rgba(240,80,138,.1)', color: 'var(--pk)' } : undefined}
            >
              {qCount} / {MAX_QUESTIONS}
            </div>
          </div>

          <div className="qb-list" style={{ marginTop: 12 }}>
            {cfg.customQuestions.map((qq, i) => (
              <div className="qb-row" key={i}>
                <div className="qb-num">{i + 1}</div>
                <div className="qb-txt" title={qq.q}>{qq.q}</div>
                <div className="qb-xp">⚡ {qq.xp} XP</div>
                <div style={{ fontSize: 10, color: 'var(--mt)', flexShrink: 0 }}>✓ {['A','B','C','D'][qq.correct]}</div>
                <button className="qb-del" title="Delete" onClick={() => deleteQuestion(i)}>✕</button>
              </div>
            ))}
          </div>

          {showQForm && (
            <div className="qb-form" style={{ marginTop: 10, display: 'flex' }}>
              <div className="qb-form-title">New Question</div>
              <input className="inp inp-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Question text…" maxLength={160} />
              <div style={{ fontSize: 11, color: 'var(--mt)', marginBottom: 2 }}>Answer options — select the correct one ✓</div>
              <div className="qb-opts-grid">
                {[0, 1, 2, 3].map((i) => (
                  <div className="qb-opt-row" key={i}>
                    <span className="qb-opt-lbl">{['A','B','C','D'][i]}</span>
                    <input
                      className="inp inp-sm"
                      value={opts[i]}
                      onChange={(e) => {
                        const next = opts.slice();
                        next[i] = e.target.value;
                        setOpts(next);
                      }}
                      placeholder={`Option ${['A','B','C','D'][i]}`}
                      maxLength={80}
                      style={{ flex: 1 }}
                    />
                    <input
                      type="radio"
                      name="qb-correct"
                      className="qb-radio"
                      checked={correct === i}
                      onChange={() => setCorrect(i)}
                      title={`Mark ${['A','B','C','D'][i]} as correct`}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontSize: 11, color: 'var(--mt)' }}>XP for correct answer</div>
                    <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 13, color: 'var(--y)' }}>{qXp} XP</div>
                  </div>
                  <input type="range" min={50} max={300} value={qXp} step={10} onChange={(e) => setQxp(parseInt(e.target.value) || 100)} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">50</span><span className="muted">300</span></div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 7 }}>
                <button className="btn btn-g" style={{ flex: 2 }} onClick={saveQuestion}>✓ Save Question</button>
                <button className="btn btn-out" style={{ flex: 1 }} onClick={() => { setShowQForm(false); resetQForm(); }}>Cancel</button>
              </div>
            </div>
          )}

          {!showQForm && (
            <button
              className="btn btn-b btn-full"
              style={{ marginTop: 10 }}
              disabled={qCount >= MAX_QUESTIONS}
              onClick={() => {
                if (qCount >= MAX_QUESTIONS) { toast('Maximum 10 questions reached'); return; }
                resetQForm();
                setShowQForm(true);
              }}
            >
              + Add Question
            </button>
          )}
        </div>
        )}

        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <button className="btn btn-out" style={{ flex: 1 }} onClick={() => show('s-home')}>← Back</button>
          <button className="btn btn-y" style={{ flex: 2 }} onClick={createRoom} disabled={busy}>
            {busy ? 'Creating…' : 'Create Room →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TimerSlider({ title, sub, value, min, max, step, onChange }) {
  return (
    <div className="range-row">
      <div className="range-header">
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
          <div className="muted">{sub}</div>
        </div>
        <div className="range-val">{value}s</div>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="muted">{min}s</span><span className="muted">{max}s</span>
      </div>
    </div>
  );
}
