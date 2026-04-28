// Kahoot-style ice breaker. Host drives the timer + next-question transitions;
// participants follow via socket events (wired in useRoomSocket).
import { useEffect, useRef, useState } from 'react';
import { useStore, earnXP } from '../store.js';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { toast } from '../toast.js';
import { FALLBACK_QUESTIONS } from '../constants.js';
import HostPanel from '../components/HostPanel.jsx';
import Avatar from '../components/Avatar.jsx';

const KAH = [
  { shape: '▲', cls: 'kah-a' },
  { shape: '●', cls: 'kah-b' },
  { shape: '◆', cls: 'kah-c' },
  { shape: '■', cls: 'kah-d' },
];
const BAR_COLORS = ['#e84060', '#2a6eff', '#f5a800', '#22a060'];

export default function Ice() {
  const isHost = useStore((s) => s.isHost);
  const roomId = useStore((s) => s.roomId);
  const meId = useStore((s) => s.me.id);
  const meXp = useStore((s) => s.me.xp);
  const players = useStore((s) => s.players);
  const ice = useStore((s) => s.ice);
  const setIce = useStore((s) => s.setIce);
  const resetIce = useStore((s) => s.resetIce);
  const cfg = useStore((s) => s.cfg);
  const show = useStore((s) => s.show);

  const loadedRef = useRef(false);
  const [loading, setLoading] = useState(true);

  // Load the question list from the backend once per room.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    (async () => {
      resetIce();
      let qs = null;
      if (roomId) {
        try {
          const { questions } = await api.get(`/api/ice/questions/${roomId}`);
          if (questions?.length) {
            qs = questions.map((q) => ({
              dbId: q.id,
              q: q.question_text,
              opts: [q.option_a, q.option_b, q.option_c, q.option_d],
              correct: q.correct_idx,
              xp: q.xp_value || 100,
            }));
          }
        } catch {}
      }
      if (!qs) qs = cfg.customQuestions.length > 0 ? cfg.customQuestions : FALLBACK_QUESTIONS;
      const scores = {};
      for (const p of players) scores[p.id] = 0;
      setIce({
        questions: qs, qIdx: 0, timer: cfg.iceTimerSecs, max: cfg.iceTimerSecs,
        answered: false, myPick: -1, answerCounts: [0, 0, 0, 0], answeredCount: 0,
        playerPicks: {}, resultsShown: false, nextScheduled: false, scores,
      });
      setLoading(false);
      // Host starts the backend timer after the first question loads.
      if (useStore.getState().isHost && roomId) {
        getSocket().emit('start_timer', { room_id: roomId, phase: 'ice' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a new question loads (host-driven), re-issue start_timer.
  // We detect "new question" via qIdx changes when not in results-shown state.
  const prevQIdx = useRef(0);
  useEffect(() => {
    if (loading) return;
    if (ice.qIdx === prevQIdx.current) return;
    prevQIdx.current = ice.qIdx;
    if (isHost && roomId) {
      getSocket().emit('start_timer', { room_id: roomId, phase: 'ice' });
    }
  }, [ice.qIdx, isHost, roomId, loading]);

  // Host schedules advance 4.2s after reveal; participants have a 10s failsafe.
  // The visible "next-in" countdown gives the user feedback that the round
  // didn't freeze — the previous behaviour left the question timer stuck at
  // its last value, which read as "stuck" to players.
  // IMPORTANT: do NOT include `ice.nextScheduled` in the deps. Setting it inside
  // the effect would re-run this effect, whose cleanup clears the very timeout
  // we just scheduled — host got stuck on the reveal panel forever (1 Q / 1 P
  // repro: ResultsPanel shows but auto-advance never fires).
  const [revealCountdown, setRevealCountdown] = useState(0);
  useEffect(() => {
    if (!ice.resultsShown) { setRevealCountdown(0); return; }
    const totalSecs = isHost ? 4 : 10;
    setRevealCountdown(totalSecs);
    const tick = setInterval(() => {
      setRevealCountdown((n) => Math.max(0, n - 1));
    }, 1000);
    const advance = setTimeout(() => {
      if (useStore.getState().screen === 's-ice' && useStore.getState().ice.resultsShown) nextQ();
    }, totalSecs * 1000 + 200);
    return () => { clearInterval(tick); clearTimeout(advance); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ice.resultsShown, isHost]);

  const nextQ = () => {
    const st = useStore.getState();
    const nextIdx = st.ice.qIdx + 1;
    if (nextIdx >= st.ice.questions.length) {
      endIce();
      return;
    }
    st.setIce({
      qIdx: nextIdx,
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
    if (st.isHost && st.roomId) {
      getSocket().emit('ice_next_q', { room_id: st.roomId, q_idx: nextIdx });
    }
  };

  const endIce = () => {
    toast('🎉 Ice breaker done!');
    // Always start retro on the submit sub-phase. Reset local retro state in
    // case stale values (e.g. phase='vote') leaked from a prior game in the
    // same tab — without this guard the host can land directly on vote and
    // skip card submission. Also persist retro_phase='submit' on the server
    // so participants joining mid-phase see the correct screen.
    const st = useStore.getState();
    st.resetRetro();
    st.setRetro({
      phase: 'submit',
      timer: cfg.retroSubmitSecs,
      max:   cfg.retroSubmitSecs,
    });
    if (isHost && roomId) {
      const s = getSocket();
      s.emit('phase_change', { room_id: roomId, phase: 'retro' });
      s.emit('retro_phase_change', { room_id: roomId, retro_phase: 'submit' });
    }
    show('s-retro');
  };

  const answer = (idx) => {
    const st = useStore.getState();
    if (st.ice.answered || st.ice.resultsShown) return;
    const q = st.ice.questions[st.ice.qIdx];
    if (!q) return;
    const ok = idx === q.correct;
    const xp = ok ? ((q.xp || 100) + st.ice.timer * 10) : 0;

    const counts = st.ice.answerCounts.slice();
    counts[idx] = (counts[idx] || 0) + 1;
    st.setIce({
      answered: true,
      myPick: idx,
      answerCounts: counts,
      answeredCount: st.ice.answeredCount + 1,
      playerPicks: { ...st.ice.playerPicks, [st.me.id]: idx },
    });
    if (xp > 0) earnXP(xp);

    // Never send time_left_sec — the backend derives it authoritatively.
    if (st.roomId && q.dbId) {
      api.post('/api/ice/answer', {
        room_id: st.roomId, player_id: st.me.id,
        question_id: q.dbId, chosen_idx: idx,
      }).catch((e) => console.warn('ice answer sync:', e.message));
    }

  };

  // Host reveal trigger — fires as soon as EITHER:
  //   (a) every human in the room has answered (regardless of who answered last), OR
  //   (b) the backend timer reaches zero.
  // The old code only checked `all answered` inside `answer()`, which missed the
  // case where the host answered FIRST and later participants pushed the total —
  // those `ice_answered` socket events never re-checked the condition, leaving
  // everyone stuck watching a dead question until the 10-second timer expired.
  useEffect(() => {
    if (!isHost || !roomId) return;
    if (ice.resultsShown) return;
    const allAnswered  = players.length > 0 && ice.answeredCount >= players.length;
    const timerExpired = ice.timer === 0 && ice.max > 0;
    if (!allAnswered && !timerExpired) return;
    if (allAnswered && !timerExpired) {
      getSocket().emit('stop_timer_early', { room_id: roomId, phase: 'ice', reason: 'all_answered' });
    }
    getSocket().emit('ice_reveal', {
      room_id: roomId, q_idx: ice.qIdx,
      answer_counts: ice.answerCounts, player_picks: ice.playerPicks,
    });
    setIce({ resultsShown: true });
  }, [ice.resultsShown, ice.answeredCount, ice.timer, ice.max, ice.qIdx, ice.answerCounts, ice.playerPicks, players.length, isHost, roomId, setIce]);

  // Participant fallback. The backend broadcasts `timer_tick {0}` followed by
  // `timer_end` — if a brief disconnect drops the `timer_end` event (or the
  // host's `ice_reveal`), participants would otherwise never flip to the reveal
  // panel and get stuck on the answered question. Watching the local tick for
  // zero guarantees the UI advances even when those events are missed.
  useEffect(() => {
    if (isHost) return;
    if (ice.resultsShown) return;
    if (ice.timer === 0 && ice.max > 0) {
      setIce({ resultsShown: true });
    }
  }, [ice.timer, ice.max, ice.resultsShown, isHost, setIce]);

  // Last-ditch safety net: if we've been on the same question for longer than
  // `max + 5s` without anything happening, force a reveal. Covers the case
  // where the participant's socket went dark early and never received ticks
  // either. We only arm this after the player has actually answered so we don't
  // short-circuit legitimately slow question intros.
  useEffect(() => {
    if (isHost) return;
    if (!ice.answered || ice.resultsShown) return;
    const ceiling = Math.max(ice.max || 0, cfg.iceTimerSecs || 10) + 5;
    const t = setTimeout(() => {
      if (!useStore.getState().ice.resultsShown) setIce({ resultsShown: true });
    }, ceiling * 1000);
    return () => clearTimeout(t);
  }, [ice.answered, ice.resultsShown, ice.max, cfg.iceTimerSecs, isHost, setIce]);

  const advancePhase = () => { nextQ(); };

  if (loading || !ice.questions.length) {
    return (
      <div className="screen active" id="s-ice">
        <div className="center"><p className="muted">Loading questions…</p></div>
      </div>
    );
  }

  const q = ice.questions[ice.qIdx];
  // Guard against malformed questions (custom-question editor or backend bug
  // could ship a row with fewer than 4 options). Without this, the kah-grid
  // map below indexes BAR_COLORS[i]/answerCounts[i] out of range and renders
  // undefined cells.
  if (!q || !Array.isArray(q.opts) || q.opts.length < 4) return null;

  const max = ice.max || cfg.iceTimerSecs || 10;
  // After answers are revealed the question timer is intentionally frozen
  // (server stopped early). Swap the ring to a "next-in" countdown so the
  // player can see we're about to advance — frozen seconds read as "stuck".
  const revealMax = isHost ? 4 : 10;
  const showRevealCountdown = ice.resultsShown && revealCountdown > 0;
  const displayTimer = showRevealCountdown ? revealCountdown : ice.timer;
  const displayMax = showRevealCountdown ? revealMax : max;
  const ringOffset = 145 - (displayTimer / displayMax) * 145;
  const ringColor = showRevealCountdown
    ? 'var(--g)'
    : (ice.timer > max * 0.35 ? 'var(--y)' : 'var(--pk)');

  const totalVotes = ice.answerCounts.reduce((a, b) => a + b, 0) || 1;
  const lead = players.find((p) => p.isHost);
  const sortedScores = [...players]
    .map((p) => ({ ...p, sc: ice.scores[p.id] || 0 }))
    .sort((a, b) => b.sc - a.sc);
  const M = ['🥇', '🥈', '🥉'];

  return (
    <div className="screen active" id="s-ice">
      <div className="w680" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 6 }}>
        <div className="top-bar w680">
          <div className="logo-sm">RetroQuest</div>
          {!isHost && lead && (
            <div className="lead-indicator">👑 Team Lead: <Avatar value={lead.avatar} size={16} /> {lead.name || lead.anon_handle}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="xp-chip">⚡ {meXp} XP</div>
            <div className="timer-wrap">
              <svg width="54" height="54" viewBox="0 0 54 54">
                <circle className="t-bg" cx="27" cy="27" r="23" />
                <circle
                  className="t-fg" cx="27" cy="27" r="23"
                  stroke={ringColor} strokeDasharray="145"
                  strokeDashoffset={ringOffset}
                />
              </svg>
              <div className="t-num">{displayTimer}</div>
            </div>
          </div>
        </div>

        <div className="round-pill">
          <div className="round-dot" style={{ background: 'var(--y)' }}></div>
          <span style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 12 }}>Round 1 — Ice Breaker</span>
          <span className="muted" style={{ fontSize: 11 }}>
            {showRevealCountdown
              ? `Next in ${revealCountdown}s…`
              : `${ice.questions.length} questions`}
          </span>
        </div>
        <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="muted">Question {ice.qIdx + 1} of {ice.questions.length}</span>
          <span className="muted">{ice.answeredCount} / {players.length} answered</span>
        </div>
        <div className="prog-bar w680">
          <div className="prog-fill" style={{ width: `${((ice.qIdx + 1) / ice.questions.length) * 100}%`, background: 'var(--y)' }}></div>
        </div>

        <div className="kah-question">
          <div className="kah-q-text">{q.q}</div>
        </div>

        <div className="kah-grid">
          {q.opts.map((opt, i) => {
            const picked = ice.myPick === i;
            const isCorrect = ice.resultsShown && i === q.correct;
            const isWrong   = ice.resultsShown && i === ice.myPick && i !== q.correct;
            const pct = Math.round((ice.answerCounts[i] / totalVotes) * 100);
            const extraCls =
              (picked && !ice.resultsShown ? ' kah-my-pick' : '') +
              (isCorrect ? ' kah-correct' : '') +
              (isWrong ? ' kah-wrong' : '');
            const dimStyle =
              (ice.answered || ice.resultsShown) && !picked && !isCorrect
                ? { opacity: ice.resultsShown ? 0.35 : 0.45 } : {};
            return (
              <button
                key={i}
                className={`kah-opt ${KAH[i].cls}${extraCls}`}
                onClick={() => answer(i)}
                disabled={ice.answered || ice.resultsShown}
                style={dimStyle}
              >
                <div className="kah-shape">{KAH[i].shape}</div>
                <div className="kah-opt-txt">{opt}</div>
                <div className="kah-bar-fill" style={{ width: ice.resultsShown ? `${pct}%` : '0%' }}></div>
              </button>
            );
          })}
        </div>

        {ice.resultsShown && <ResultsPanel q={q} ice={ice} players={players} />}

        <div style={{ width: '100%' }}>
          <div className="label" style={{ marginBottom: 7 }}>Live Leaderboard</div>
          <div className="sc-list">
            {sortedScores.map((p, i) => (
              <div className={`sc-row${p.id === meId ? ' me' : ''}`} key={p.id}>
                <div className="sc-rank">{M[i] || ''}</div>
                <Avatar value={p.avatar} size={24} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 13 }}>
                    {p.name}{p.id === meId ? ' (you)' : ''}
                  </div>
                </div>
                <div className="sc-xp">{Number(p.sc) || 0} XP</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <HostPanel onAdvance={advancePhase} />
    </div>
  );
}

function ResultsPanel({ q, ice, players }) {
  const totalVotes = ice.answerCounts.reduce((a, b) => a + b, 0) || 1;
  const didAnswer = ice.answered && ice.myPick >= 0;
  const ok = didAnswer && ice.myPick === q.correct;
  const xp = ok ? ((q.xp || 100) + Math.max(0, ice.timer) * 10) : 0;
  const correctCount = ice.answerCounts[q.correct] || 0;
  const correctPct = Math.round((correctCount / totalVotes) * 100);

  return (
    <div className="kah-results" style={{ display: 'block' }}>
      {!didAnswer && (
        <div className="kah-my-result" style={{ background: 'rgba(107,114,144,.1)', color: 'var(--mt)' }}>
          ⏱ Time's up — no answer — 0 XP
        </div>
      )}
      {didAnswer && ok && (
        <div className="kah-my-result" style={{ background: 'rgba(34,192,128,.12)', color: 'var(--g)' }}>
          ✓ Correct! +{xp} XP
        </div>
      )}
      {didAnswer && !ok && (
        <div className="kah-my-result" style={{ background: 'rgba(240,80,138,.1)', color: 'var(--pk)' }}>
          ✗ Not this time! — 0 XP
        </div>
      )}
      <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 13, marginBottom: 10, color: 'var(--tx)' }}>
        How everyone answered
      </div>
      {q.opts.map((opt, i) => {
        const count = ice.answerCounts[i] || 0;
        const pct = Math.round((count / totalVotes) * 100);
        const isCorrect = i === q.correct;
        const pickers = players.filter((p) => ice.playerPicks[p.id] === i);
        return (
          <div style={{ marginBottom: 12 }} key={i}>
            <div className="kah-bar-row" style={{ marginBottom: 0 }}>
              <div className="kah-bar-label" style={{ background: BAR_COLORS[i], fontSize: 13 }}>{KAH[i].shape}</div>
              <div className="kah-bar-track">
                <div
                  className="kah-bar-inner"
                  style={{ width: `${pct}%`, background: isCorrect ? '#22c080' : BAR_COLORS[i] }}
                >
                  {pct > 8 ? `${pct}%` : ''}
                </div>
              </div>
              <div className="kah-bar-count" style={{ color: isCorrect ? 'var(--g)' : 'var(--mt)' }}>{count}</div>
              {isCorrect && <div style={{ fontSize: 16 }}>✓</div>}
            </div>
            {pickers.length > 0 && (
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 5 }}>
                {pickers.map((p) => (
                  <div
                    key={p.id}
                    title={p.name}
                    style={{
                      width: 24, height: 24, borderRadius: 6, overflow: 'hidden',
                      background: isCorrect ? 'rgba(34,192,128,.2)' : 'rgba(255,255,255,.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: `1px solid ${isCorrect ? 'rgba(34,192,128,.4)' : 'rgba(255,255,255,.1)'}`,
                    }}
                  >
                    <Avatar value={p.avatar} size={22} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="kah-stat-row">
        <div className="kah-stat">
          <div className="kah-stat-num" style={{ color: 'var(--g)' }}>{correctCount}</div>
          <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>Got it right</div>
        </div>
        <div className="kah-stat">
          <div className="kah-stat-num" style={{ color: 'var(--y)' }}>{correctPct}%</div>
          <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>Correct rate</div>
        </div>
        <div className="kah-stat" style={{ flex: 2 }}>
          <div style={{ fontSize: 11, color: 'var(--g)', fontWeight: 700 }}>✓ {q.opts[q.correct]}</div>
          <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>Correct answer</div>
        </div>
      </div>
    </div>
  );
}
