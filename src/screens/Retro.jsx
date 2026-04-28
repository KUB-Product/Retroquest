// Retro board — submit and vote phases. Host drives phase transitions via
// emit('retro_phase_change' / 'phase_change'); participants react via sockets.
import { useEffect, useRef, useState } from 'react';
import { useStore, earnXP } from '../store.js';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { toast } from '../toast.js';
import { COLS } from '../constants.js';
import HostPanel from '../components/HostPanel.jsx';
import Avatar from '../components/Avatar.jsx';

export default function Retro() {
  const isHost = useStore((s) => s.isHost);
  const roomId = useStore((s) => s.roomId);
  const meId   = useStore((s) => s.me.id);
  const meName = useStore((s) => s.me.name);
  const meAv   = useStore((s) => s.me.avatar);
  const meXp   = useStore((s) => s.me.xp);
  const players = useStore((s) => s.players);
  const retro = useStore((s) => s.retro);
  const setRetro = useStore((s) => s.setRetro);
  const cfg = useStore((s) => s.cfg);
  const show = useStore((s) => s.show);

  const [draft, setDraft] = useState('');
  const [selCol, setSelCol] = useState(0);

  const startedTimerRef = useRef(null);
  // Host starts the backend timer once per (sub)phase. We key it so the
  // effect fires again on phase change. Submit phase is skipped entirely
  // when the room is configured for unlimited submission — host advances
  // manually from the host panel.
  useEffect(() => {
    if (!isHost || !roomId) return;
    const key = retro.phase;
    if (startedTimerRef.current === key) return;
    if (retro.phase === 'submit' && cfg.retroSubmitUnlimited) {
      startedTimerRef.current = key;
      return;
    }
    startedTimerRef.current = key;
    const phaseKey = retro.phase === 'submit' ? 'retro_submit' : 'retro_vote';
    getSocket().emit('start_timer', { room_id: roomId, phase: phaseKey });
  }, [retro.phase, isHost, roomId, cfg.retroSubmitUnlimited]);

  // Listen for timer_end for retro phases so the host moves to vote/review.
  useEffect(() => {
    if (!isHost || !roomId) return;
    const s = getSocket();
    const onEnd = ({ phase }) => {
      if (phase === 'retro_submit' && useStore.getState().retro.phase === 'submit') toVote();
      else if (phase === 'retro_vote' && useStore.getState().retro.phase === 'vote') endRetro();
    };
    s.on('timer_end', onEnd);
    return () => s.off('timer_end', onEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, roomId]);

  const toVote = () => {
    setRetro({ phase: 'vote', myVotes: new Set() });
    toast('🗳️ Voting phase! Click 👍 to upvote cards');
    if (roomId && isHost) {
      getSocket().emit('retro_phase_change', { room_id: roomId, retro_phase: 'vote' });
    }
  };

  const endRetro = () => {
    toast('Voting done! Starting Card Review…');
    if (roomId && isHost) {
      getSocket().emit('phase_change', { room_id: roomId, phase: 'review' });
    }
    setTimeout(() => show('s-review'), 800);
  };

  const advancePhase = () => {
    if (retro.phase === 'submit') toVote();
    else endRetro();
  };

  const submitCard = async () => {
    const txt = draft.trim();
    if (!txt) { toast('Write something first!'); return; }
    setDraft('');
    const colMap = ['went_well', 'improve', 'not_sure'];
    let dbId = null;
    if (roomId) {
      try {
        const { card } = await api.post('/api/cards', {
          room_id: roomId, player_id: meId, col: colMap[selCol], content: txt,
        });
        dbId = card.id;
      } catch (e) {
        toast('Error saving card: ' + e.message);
        return;
      }
    }
    // Locally add the card — socket echo from the server will be deduped by dbId.
    const st = useStore.getState();
    const lanes = st.retro.cards.map((l) => l.slice());
    lanes[selCol].push({
      id: st.retro.nextId, dbId, txt,
      pid: meId, pname: meName || 'You', pav: meAv,
      votes: 0, isMe: true,
    });
    setRetro({ cards: lanes, nextId: st.retro.nextId + 1 });
    earnXP(20);
    toast('+20 XP — card added!');
  };

  const deleteCard = async (ci, cid) => {
    if (retro.phase !== 'submit') return;
    const st = useStore.getState();
    const card = st.retro.cards[ci].find((c) => c.id === cid);
    if (!card?.isMe) return;

    // Optimistic remove — the server broadcast (`card_deleted`) is idempotent if
    // we receive our own echo, since the card is already gone locally.
    const lanes = st.retro.cards.map((l, i) => i === ci ? l.filter(c => c.id !== cid) : l);
    setRetro({ cards: lanes });

    if (card.dbId && roomId) {
      try {
        await api.del(`/api/cards/${card.dbId}`, { room_id: roomId, player_id: meId });
        earnXP(-20);
        toast('🗑 Card deleted');
      } catch (e) {
        // Roll back on failure so the user doesn't see their card silently vanish.
        const reverted = useStore.getState().retro.cards.map((l) => l.slice());
        reverted[ci].push(card);
        setRetro({ cards: reverted });
        toast('Could not delete card: ' + e.message);
      }
    }
  };

  const voteCard = (ci, cid) => {
    if (retro.phase !== 'vote') return;
    const st = useStore.getState();
    const lane = st.retro.cards[ci];
    const card = lane.find((c) => c.id === cid);
    if (!card) return;
    const voteKey = card.dbId || cid;
    const isVoted = st.retro.myVotes.has(cid) || st.retro.myVotes.has(voteKey);

    const prevVotes = card.votes;
    const prevMembership = { cid: st.retro.myVotes.has(cid), voteKey: st.retro.myVotes.has(voteKey) };
    const applyVote = (voted) => {
      const lanes = useStore.getState().retro.cards.map((l, i) => {
        if (i !== ci) return l;
        return l.map((c) => c.id === cid ? { ...c, votes: voted ? c.votes + 1 : Math.max(0, c.votes - 1) } : c);
      });
      const votes = new Set(useStore.getState().retro.myVotes);
      if (voted) { votes.add(cid); votes.add(voteKey); }
      else { votes.delete(cid); votes.delete(voteKey); }
      setRetro({ cards: lanes, myVotes: votes });
    };
    const rollback = () => {
      const lanes = useStore.getState().retro.cards.map((l, i) => {
        if (i !== ci) return l;
        return l.map((c) => c.id === cid ? { ...c, votes: prevVotes } : c);
      });
      const votes = new Set(useStore.getState().retro.myVotes);
      if (prevMembership.cid) votes.add(cid); else votes.delete(cid);
      if (prevMembership.voteKey) votes.add(voteKey); else votes.delete(voteKey);
      setRetro({ cards: lanes, myVotes: votes });
    };

    if (isVoted) {
      applyVote(false);
      earnXP(-5);
      if (roomId && card.dbId) {
        api.post(`/api/cards/${card.dbId}/unvote`, { room_id: roomId, voter_id: meId, player_id: meId })
          .catch((e) => { console.warn('Unvote sync:', e.message); earnXP(5); rollback(); toast('Unvote failed — retry'); });
      }
    } else {
      applyVote(true);
      earnXP(5);
      if (roomId && card.dbId) {
        api.post(`/api/cards/${card.dbId}/vote`, { room_id: roomId, voter_id: meId, player_id: meId })
          .catch((e) => { console.warn('Vote sync:', e.message); earnXP(-5); rollback(); toast('Vote failed — retry'); });
      }
    }
  };

  const noTimer = retro.phase === 'submit' && cfg.retroSubmitUnlimited;
  const max = retro.max || (retro.phase === 'submit' ? cfg.retroSubmitSecs : cfg.retroVoteSecs);
  const ringOffset = 145 - (retro.timer / max) * 145;
  const lead = players.find((p) => p.isHost);

  const phaseLbl = retro.phase === 'submit'
    ? (cfg.retroSubmitUnlimited ? 'Submit your cards (no time limit)' : `Submit your cards (${cfg.retroSubmitSecs}s)`)
    : 'Vote on cards';

  return (
    <div className="screen active" id="s-retro">
      <div className="w960" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 6 }}>
        <div className="top-bar w960">
          <div className="logo-sm">RetroQuest</div>
          {!isHost && lead && (
            <div className="lead-indicator">👑 Team Lead: <Avatar value={lead.avatar} size={16} /> {lead.name || lead.anon_handle}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div className="xp-chip">⚡ {meXp} XP</div>
            {noTimer ? (
              <div className="timer-wrap timer-unlimited" title="No time limit on this phase">
                <div className="t-num" style={{ fontSize: 22 }}>♾</div>
              </div>
            ) : (
              <div className="timer-wrap">
                <svg width="54" height="54" viewBox="0 0 54 54">
                  <circle className="t-bg" cx="27" cy="27" r="23" />
                  <circle
                    className="t-fg" cx="27" cy="27" r="23"
                    stroke={retro.phase === 'submit' ? 'var(--g)' : 'var(--b)'}
                    strokeDasharray="145" strokeDashoffset={ringOffset}
                  />
                </svg>
                <div className="t-num">{retro.timer}</div>
              </div>
            )}
          </div>
        </div>

        <div className="round-pill">
          <div className="round-dot" style={{ background: 'var(--g)' }}></div>
          <span style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 12 }}>Round 2 — Retro Board</span>
          <span className="muted" style={{ fontSize: 11 }}>{phaseLbl}</span>
        </div>

        {retro.phase === 'submit' && (
          <div className="sub-area w960">
            <div className="col-tabs">
              {COLS.map((c, i) => (
                <button
                  key={c.key}
                  className={`c-tab${selCol === i ? ' active' : ''}`}
                  onClick={() => setSelCol(i)}
                >
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
            <div className="sub-row">
              <textarea
                className="inp inp-sm"
                rows={2}
                placeholder="Share your thought… (max 140 chars)"
                maxLength={140}
                style={{ resize: 'none', flex: 1 }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button className="btn btn-g" onClick={submitCard}>Add Card</button>
            </div>
            <div style={{ textAlign: 'right', marginTop: 3 }}>
              <span className="muted">{draft.length}/140</span>
            </div>
          </div>
        )}

        <div className="retro-grid w960">
          {COLS.map((c, ci) => (
            <div className="r-col" key={c.key}>
              <div className="r-col-head">
                <span style={{ fontSize: 16 }}>{c.icon}</span>
                <span className="r-col-title" style={{ color: c.color }}>{c.label}</span>
                <span className="muted" style={{ marginLeft: 'auto' }}>{retro.cards[ci].length}</span>
              </div>
              <div className="r-cards">
                {retro.cards[ci].map((card) => {
                  const voted = retro.myVotes.has(card.id) || retro.myVotes.has(card.dbId);
                  return (
                    <div className={`r-card${card.isMe ? ' mine' : ''}`} key={card.id}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                        <div style={{ flex: 1 }}>{card.txt}</div>
                        {retro.phase === 'submit' && card.isMe && (
                          <button
                            className="r-card-del"
                            title="Delete this card"
                            onClick={() => deleteCard(ci, card.id)}
                          >✕</button>
                        )}
                      </div>
                      {retro.phase === 'vote' ? (
                        <div className="vote-row" style={{ flexWrap: 'wrap', gap: 5 }}>
                          <button
                            className={`v-btn${voted ? ' voted' : ''}`}
                            onClick={() => voteCard(ci, card.id)}
                          >
                            👍 {card.votes}
                          </button>
                          <span className="card-by" style={{ flex: 1 }}>
                            <Avatar value={card.pav} size={18} /> {card.pname}
                          </span>
                        </div>
                      ) : (
                        <div className="card-by"><Avatar value={card.pav} size={18} /> {card.pname}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <HostPanel onAdvance={advancePhase} />
    </div>
  );
}
