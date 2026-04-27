// Card review — host navigates card-by-card; participants follow.
// Sort order: votes desc. Host can mark discussed / duplicate, move cards,
// and post comments.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.js';
import { api } from '../api.js';
import { getSocket } from '../socket.js';
import { toast } from '../toast.js';
import { COLS } from '../constants.js';
import HostPanel from '../components/HostPanel.jsx';
import Avatar from '../components/Avatar.jsx';

const COL_KEY = ['went_well', 'improve', 'not_sure'];
const TAG_BG  = ['rgba(47,232,168,.12)', 'rgba(240,80,138,.12)', 'rgba(108,143,255,.12)'];
const TAG_FG  = ['var(--g)', 'var(--pk)', 'var(--b)'];

export default function Review() {
  const isHost = useStore((s) => s.isHost);
  const roomId = useStore((s) => s.roomId);
  const meId   = useStore((s) => s.me.id);
  const meXp   = useStore((s) => s.me.xp);
  const players = useStore((s) => s.players);
  const retro = useStore((s) => s.retro);
  const review = useStore((s) => s.review);
  const setReview = useStore((s) => s.setReview);
  const setRetro = useStore((s) => s.setRetro);
  const show = useStore((s) => s.show);

  const [comment, setComment] = useState('');

  // Build (or rebuild) the review queue whenever the underlying card list
  // changes — sort by vote count desc.
  const queue = useMemo(() => {
    const all = [];
    retro.cards.forEach((lane, ci) => lane.forEach((card) => all.push({ card, ci })));
    all.sort((a, b) => b.card.votes - a.card.votes);
    return all;
  }, [retro.cards]);

  // Keep the review.queue mirror in store so socket handlers (in useRoomSocket)
  // can look up cards by dbId.
  useEffect(() => {
    setReview({ queue });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // Reset idx if it ever falls out of range.
  useEffect(() => {
    if (review.idx >= queue.length && queue.length > 0) setReview({ idx: queue.length - 1 });
  }, [queue.length, review.idx, setReview]);

  const total = queue.length;
  const entry = queue[review.idx];
  const card = entry?.card;
  const ci = entry?.ci ?? 0;

  const isDupMarked = card ? review.duplicates.has(card.id) : false;
  const isDiscussed = card ? review.discussed.has(card.id) : false;

  const navigate = (dir) => {
    if (!isHost) return;
    const next = review.idx + dir;
    if (next < 0 || next >= total) return;
    setReview({ idx: next });
    if (roomId) getSocket().emit('review_navigate', { room_id: roomId, card_index: next });
  };

  const jumpTo = (i) => {
    if (!isHost) return;
    setReview({ idx: i });
    if (roomId) getSocket().emit('review_navigate', { room_id: roomId, card_index: i });
  };

  const toggleDiscussed = () => {
    if (!isHost || !card) return;
    const discussed = new Set(review.discussed);
    const willMark = !discussed.has(card.id);
    if (willMark) discussed.add(card.id); else discussed.delete(card.id);
    setReview({ discussed });
    if (roomId && card.dbId) {
      api.post(`/api/cards/${card.dbId}/discussed`, {
        room_id: roomId, player_id: meId, is_discussed: willMark,
      }).catch((e) => console.warn('discussed sync:', e.message));
    }
    // auto-advance to next undone card
    const nextUndone = queue.findIndex(({ card: c }, i) => i > review.idx && !discussed.has(c.id) && !review.duplicates.has(c.id));
    if (nextUndone !== -1) {
      setTimeout(() => {
        setReview({ idx: nextUndone });
        if (roomId) getSocket().emit('review_navigate', { room_id: roomId, card_index: nextUndone });
      }, 400);
    }
  };

  const toggleDuplicate = () => {
    if (!isHost || !card) return;
    const dupes = new Set(review.duplicates);
    const discussed = new Set(review.discussed);
    const willMark = !dupes.has(card.id);
    if (willMark) {
      dupes.add(card.id);
      discussed.add(card.id);
      toast('🔁 Card marked as duplicate — will be excluded');
    } else {
      dupes.delete(card.id);
      toast('🔁 Duplicate mark removed');
    }
    setReview({ duplicates: dupes, discussed });
    if (roomId && card.dbId) {
      api.post(`/api/cards/${card.dbId}/duplicate`, {
        room_id: roomId, player_id: meId, is_duplicate: willMark,
      }).catch((e) => console.warn('duplicate sync:', e.message));
    }
  };

  const moveCard = (toCi) => {
    if (!isHost || !card) return;
    const lanes = retro.cards.map((l) => l.slice());
    const idx = lanes[ci].findIndex((c) => c.id === card.id);
    if (idx < 0) return;
    const [moved] = lanes[ci].splice(idx, 1);
    lanes[toCi].push(moved);
    setRetro({ cards: lanes });
    toast(`↗ Card moved to ${COLS[toCi].icon} ${COLS[toCi].label}`);
    if (roomId && card.dbId) {
      api.post(`/api/cards/${card.dbId}/move`, {
        room_id: roomId, player_id: meId, col: COL_KEY[toCi],
      }).catch((e) => console.warn('move sync:', e.message));
    }
  };

  const submitComment = () => {
    if (!isHost) { toast('Only the Team Lead can add comments'); return; }
    const text = comment.trim();
    if (!text) { toast('Write a comment first'); return; }
    if (!card) return;
    setComment('');
    // Optimistic local push (server echoes back via card_commented event).
    const now = new Date();
    const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    const next = { ...review.comments };
    const list = next[card.id] ? next[card.id].slice() : [];
    const me = useStore.getState().me;
    list.push({ avatar: me.avatar, handle: me.name, text, isLead: true, time });
    next[card.id] = list;
    setReview({ comments: next });
    if (roomId && card.dbId) {
      api.post(`/api/cards/${card.dbId}/comment`, {
        room_id: roomId, player_id: meId, content: text,
      }).catch((e) => console.warn('Comment sync:', e.message));
    }
    toast('💬 Comment added');
  };

  const endReview = async () => {
    if (!isHost) return;
    toast('Review complete! Generating results…');
    if (roomId) {
      try {
        const commits = retro.cards.flat()
          .filter((c) => !review.duplicates.has(c.id))
          .sort((a, b) => b.votes - a.votes)
          .slice(0, 3)
          .map((c) => ({ text: c.txt, votes: c.votes }));
        await api.post(`/api/rooms/${roomId}/end`, {
          player_id: meId,
          mood_emoji: '🎉',
          mood_label: 'Retrospective Complete',
          committed_items: commits,
        });
      } catch (e) { console.warn('session end:', e.message); }
      getSocket().emit('phase_change', { room_id: roomId, phase: 'results' });
    }
    setTimeout(() => show('s-results'), 800);
  };

  const lead = players.find((p) => p.isHost);
  const comments = card ? (review.comments[card.id] || []) : [];

  return (
    <div className="screen active" id="s-review">
      <div className="w680" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 6 }}>
        <div className="top-bar w680">
          <div className="logo-sm">RetroQuest</div>
          {!isHost && lead && (
            <div className="lead-indicator">👑 Team Lead: <Avatar value={lead.avatar} size={16} /> {lead.name || lead.anon_handle}</div>
          )}
          <div className="xp-chip">⚡ {meXp} XP</div>
        </div>

        <div className="round-pill">
          <div className="round-dot" style={{ background: 'var(--b)' }}></div>
          <span style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 12 }}>Card Review</span>
          <span className="muted" style={{ fontSize: 11 }}>{total ? `${review.idx + 1} of ${total}` : '0 of 0'}</span>
        </div>

        <div className="w680">
          <div className="review-dots">
            {queue.map((e, i) => {
              const done = review.discussed.has(e.card.id);
              const dup  = review.duplicates.has(e.card.id);
              const cls = `rdot${i === review.idx ? ' r-active' : done ? ' r-done' : dup ? ' rdot-dup' : ''}`;
              return (
                <div
                  key={e.card.id}
                  className={cls}
                  style={dup ? { background: 'rgba(255,159,90,.45)' } : undefined}
                  onClick={() => jumpTo(i)}
                  title={`Card ${i + 1}${dup ? ' (duplicate)' : ''}`}
                />
              );
            })}
          </div>
          <div className="prog-bar">
            <div className="prog-fill" style={{ width: `${total ? ((review.idx + 1) / total) * 100 : 0}%`, background: 'var(--b)' }}></div>
          </div>
        </div>

        <div className="review-stage">
          {!card ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--mt)' }}>No cards to review.</div>
          ) : (
            <>
              <div
                className="review-col-tag"
                style={{
                  background: TAG_BG[ci],
                  color: TAG_FG[ci],
                  border: `1px solid ${TAG_FG[ci].replace('var(--', 'rgba(').replace(')', ',.28)')}`,
                }}
              >
                {COLS[ci].icon} {COLS[ci].label}
              </div>
              <div className="review-card-txt" style={{ opacity: isDupMarked ? 0.45 : 1 }}>{card.txt}</div>
              <div className="review-meta">
                <div className="review-author"><Avatar value={card.pav} size={20} /> {card.pname}</div>
                <div className="review-votes">👍 {card.votes} vote{card.votes !== 1 ? 's' : ''}</div>
                <div>
                  {isDupMarked && (
                    <div className="dup-card-banner">🔁 Marked as duplicate — excluded from Results</div>
                  )}
                </div>
              </div>

              {isHost && (
                <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--br)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <button
                      className={`discussed-btn${isDiscussed ? ' marked' : ''}`}
                      onClick={toggleDiscussed}
                    >
                      {isDiscussed ? '✓ Discussed' : '✓ Mark Discussed'}
                    </button>
                    <button
                      className={`duplicate-btn${isDupMarked ? ' is-dup' : ''}`}
                      onClick={toggleDuplicate}
                    >
                      {isDupMarked ? '🔁 Unmark Duplicate' : '🔁 Duplicate Content'}
                    </button>
                    <div style={{ flex: 1 }}></div>
                    <div style={{ fontSize: 11, color: 'var(--mt)' }}>Move to:</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {COLS.map((c, i) => (
                        i === ci ? null : (
                          <button
                            key={c.key}
                            className="rev-move-btn"
                            style={{ '--hover-color': TAG_FG[i] }}
                            onClick={() => moveCard(i)}
                          >
                            {c.icon} {c.label}
                          </button>
                        )
                      ))}
                    </div>
                  </div>
                  <div className="comment-inp-row">
                    <textarea
                      className="comment-inp"
                      rows={2}
                      placeholder="Add a comment visible to the whole team… (max 300 chars)"
                      maxLength={300}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(); }
                      }}
                    />
                    <button className="btn btn-b btn-sm" style={{ flexShrink: 0 }} onClick={submitComment}>Comment</button>
                  </div>
                </div>
              )}

              {comments.length > 0 && (
                <div className="comment-list">
                  {comments.map((c, i) => (
                    <div className="comment-item" key={i}>
                      <div className="comment-av"><Avatar value={c.avatar} size={28} /></div>
                      <div className="comment-bubble">
                        <div className="comment-meta">
                          <span style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, color: 'var(--tx)' }}>{c.handle}</span>
                          {c.isLead && <span className="host-badge">LEAD</span>}
                          <span>{c.time}</span>
                        </div>
                        <div className="comment-txt">{c.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="review-nav">
          <button className="rnav-btn" onClick={() => navigate(-1)} disabled={!isHost || review.idx === 0} style={!isHost ? { opacity: 0.28, cursor: 'not-allowed' } : undefined}>←</button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 11 }}>
              {isHost ? 'Navigate cards, add comments, and mark each one as discussed' : 'Read-only view — only the Team Lead can navigate and comment'}
            </div>
          </div>
          <button className="rnav-btn" onClick={() => navigate(1)} disabled={!isHost || review.idx >= total - 1} style={!isHost ? { opacity: 0.28, cursor: 'not-allowed' } : undefined}>→</button>
        </div>

        <div style={{ background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 'var(--r)', padding: 14, width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="label">All Cards</div>
            <div className="muted">{review.discussed.size} discussed · {review.duplicates.size} duplicates</div>
          </div>
          <div className="review-queue">
            {queue.map(({ card: qc, ci: qci }, i) => {
              const done = review.discussed.has(qc.id);
              const dup = review.duplicates.has(qc.id);
              const comCount = (review.comments[qc.id] || []).length;
              const dotColors = ['var(--g)', 'var(--pk)', 'var(--b)'];
              return (
                <div
                  key={qc.id}
                  className={`rq-item${i === review.idx ? ' rq-active' : (done || dup) ? ' rq-done' : ''}`}
                  onClick={() => jumpTo(i)}
                  style={{ pointerEvents: isHost ? 'auto' : 'none' }}
                >
                  <div className="rq-col-dot" style={{ background: dup ? 'var(--o)' : dotColors[qci] }}></div>
                  <div className="rq-txt">{dup && <span style={{ color: 'var(--o)' }}>🔁 </span>}{qc.txt}</div>
                  {comCount > 0 && <div style={{ fontSize: 10, color: 'var(--b)' }}>💬{comCount}</div>}
                  <div className="rq-votes">👍{qc.votes}</div>
                  <div style={{ fontSize: 12 }}>{dup ? '🔁' : done ? '✓' : '○'}</div>
                </div>
              );
            })}
          </div>
        </div>

        {isHost ? (
          <button className="btn btn-g btn-full" onClick={endReview}>✓ Finish Review &amp; See Results</button>
        ) : (
          <p className="sub" style={{ textAlign: 'center' }}>Waiting for host to proceed…</p>
        )}
      </div>
      <HostPanel onAdvance={endReview} />
    </div>
  );
}
