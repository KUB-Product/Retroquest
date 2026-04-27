// Admin dashboard. Shows all completed sessions with per-session and bulk
// Excel export. Gatekept by PinOverlay unless an admin token is already cached.
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { adminApi, getAdminToken, clearAdminToken, BACKEND_URL } from '../api.js';
import { useStore } from '../store.js';
import { toast } from '../toast.js';
import PinOverlay from '../components/PinOverlay.jsx';
import Avatar from '../components/Avatar.jsx';

const LANE_NAMES = ['Went Well', 'Improve', 'Not Sure'];
const COL_COLORS = { 0: 'var(--g)', 1: 'var(--pk)', 2: 'var(--b)' };
const COL_LABELS = { 0: '🚀 Went Well', 1: '🔧 Improve', 2: '🤔 Not Sure' };

export default function Admin() {
  const show = useStore((s) => s.show);
  const [authed, setAuthed] = useState(!!getAdminToken());
  const [sessions, setSessions] = useState([]);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  // Verify the cached token on mount; if it's stale, surface the sign-in form.
  useEffect(() => {
    if (!authed) return;
    const tok = getAdminToken();
    if (!tok) { setAuthed(false); return; }
    (async () => {
      try {
        const r = await fetch(BACKEND_URL + '/api/admin/verify', { headers: { Authorization: 'Bearer ' + tok } });
        if (!r.ok) { clearAdminToken(); setAuthed(false); return; }
        loadSessions();
      } catch { clearAdminToken(); setAuthed(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const { sessions } = await adminApi.get('/api/admin/sessions');
      setSessions(Array.isArray(sessions) ? sessions : []);
    } catch (e) {
      if (String(e.message).includes('401')) {
        clearAdminToken(); setAuthed(false);
        toast('Admin session expired — please sign in again');
      } else {
        toast('Failed to load sessions');
      }
    } finally { setLoading(false); }
  };

  const signOut = () => {
    clearAdminToken();
    setAuthed(false);
    show('s-home');
    toast('Signed out of admin');
  };

  const exportOne = (s) => {
    const wb = XLSX.utils.book_new();
    const cardsData = [['Lane', 'Content', 'Votes', 'Duplicate']];
    [0, 1, 2].forEach((ci) => {
      s.cards.filter((c) => c.col === ci).forEach((c) => {
        cardsData.push([LANE_NAMES[ci], c.txt, c.votes, c.isDuplicate ? 'Yes' : 'No']);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cardsData), 'Cards');

    const topData = [['Rank', 'Card', 'Votes']];
    (s.commits || []).forEach((c, i) => topData.push([i + 1, c, '']));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(topData), 'Most Voted');

    const xpData = [['Rank', 'Avatar', 'Name', 'XP']];
    (s.players || []).forEach((p, i) => xpData.push([i + 1, p.avatar, p.name, p.xp || 0]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(xpData), 'Leaderboard');

    XLSX.writeFile(wb, `RetroQuest-${s.id}-${s.date}.xlsx`);
    toast('📊 Excel exported!');
  };

  const exportAll = () => {
    if (!sessions.length) { toast('No sessions to export'); return; }
    const wb = XLSX.utils.book_new();
    const sumData = [['Room', 'Date', 'Cards', 'Votes', 'Players']];
    sessions.forEach((s) => sumData.push([s.id, s.date, s.totalCards, s.totalVotes, (s.players || []).length]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumData), 'Summary');

    const cardsData = [['Room', 'Date', 'Lane', 'Content', 'Votes']];
    sessions.forEach((s) => {
      [0, 1, 2].forEach((ci) => {
        s.cards.filter((c) => c.col === ci).forEach((c) => {
          cardsData.push([s.id, s.date, LANE_NAMES[ci], c.txt, c.votes]);
        });
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cardsData), 'All Cards');
    XLSX.writeFile(wb, `RetroQuest-All-Sessions-${new Date().toLocaleDateString('th-TH')}.xlsx`);
    toast(`📊 ${sessions.length} sessions exported to Excel!`);
  };

  if (!authed) {
    return (
      <div className="screen active" id="s-admin">
        <PinOverlay
          onSuccess={() => setAuthed(true)}
          onCancel={() => show('s-home')}
        />
      </div>
    );
  }

  let list = sessions;
  if (tab === 'active') list = list.filter((s) => s.phase === 'active');
  if (tab === 'completed') list = list.filter((s) => s.phase === 'completed');
  const query = q.toLowerCase();
  if (query) {
    list = list.filter((s) =>
      s.id.toLowerCase().includes(query) ||
      (s.cards || []).some((c) => (c.txt || '').toLowerCase().includes(query)) ||
      (s.players || []).some((p) => (p.name || '').toLowerCase().includes(query))
    );
  }

  return (
    <div className="screen active" id="s-admin">
      <div className="w960" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, paddingTop: 16 }}>
        <div className="top-bar w960">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="logo-sm">RetroQuest</div>
            <div className="badge bdg-b" style={{ fontSize: 9 }}>Admin</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              {list.length} session{list.length !== 1 ? 's' : ''}
            </div>
            <button className="btn btn-out btn-sm" onClick={() => show('s-home')}>← Exit</button>
          </div>
        </div>
        <div className="round-pill w960">
          <div className="round-dot" style={{ background: 'var(--b)' }}></div>
          <span style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 12 }}>All Retrospective Sessions</span>
        </div>

        <div className="adm-filters w960">
          <input
            className="adm-search"
            placeholder="Search rooms, cards, players…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {['all', 'active', 'completed'].map((t) => (
            <button
              key={t}
              className={`adm-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
          <button className="btn btn-b btn-sm" onClick={exportAll}>📊 Export All Excel</button>
          <button className="btn btn-out btn-sm" onClick={signOut} style={{ marginLeft: 'auto' }}>Sign out</button>
        </div>

        <div className="adm-grid w960">
          {loading && <div className="adm-empty">Loading sessions…</div>}
          {!loading && !list.length && (
            <div className="adm-empty">
              {sessions.length ? 'No sessions match your search.' : 'No sessions yet. Sessions appear here after a game is completed.'}
            </div>
          )}
          {!loading && list.map((s) => <SessionCard key={s.id} s={s} onExport={() => exportOne(s)} />)}
        </div>
      </div>
    </div>
  );
}

function SessionCard({ s, onExport }) {
  const byCol = [0, 1, 2].map((ci) => (s.cards || []).filter((c) => c.col === ci));
  const topCard = (s.cards || []).filter((c) => !c.isDuplicate)[0];

  return (
    <div className="adm-room">
      <div className="adm-room-head">
        <div>
          <div className="adm-room-code">{s.id}</div>
          <div className="adm-room-meta">{s.date} · {Number((s.players || []).length) || 0} players</div>
        </div>
        <button className="btn btn-ghost btn-xs adm-export-btn" onClick={onExport}>📋</button>
      </div>
      <div className="adm-room-body">
        <div className="adm-stat-row" style={{ marginTop: 0, paddingTop: 0, border: 'none', marginBottom: 12 }}>
          <div className="adm-stat"><div className="adm-stat-n" style={{ color: 'var(--g)' }}>{Number(s.totalCards) || 0}</div><div className="adm-stat-l">Cards</div></div>
          <div className="adm-stat"><div className="adm-stat-n" style={{ color: 'var(--y)' }}>{Number(s.totalVotes) || 0}</div><div className="adm-stat-l">Votes</div></div>
          <div className="adm-stat"><div className="adm-stat-n" style={{ color: 'var(--pk)' }}>{Number(s.duplicates) || 0}</div><div className="adm-stat-l">Duplicates</div></div>
        </div>
        <details style={{ marginBottom: 8 }}>
          <summary style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '6px 0', color: 'var(--mt)', userSelect: 'none' }}>📋 Cards by lane</summary>
          <div style={{ marginTop: 8 }}>
            {[0, 1, 2].map((ci) => byCol[ci].length === 0 ? null : (
              <div className="adm-lane" key={ci}>
                <div className="adm-lane-title" style={{ color: COL_COLORS[ci] }}>
                  {COL_LABELS[ci]}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {byCol[ci].length} card{byCol[ci].length !== 1 ? 's' : ''}
                  </span>
                </div>
                {byCol[ci].map((c, idx) => (
                  <div key={idx}>
                    <div className={`adm-card-row${c.isDuplicate ? ' adm-card-dup' : ''}`} style={{ borderLeftColor: COL_COLORS[ci] }}>
                      <div style={{ flex: 1, lineHeight: 1.45 }}>{c.txt}</div>
                      <div className="adm-vote-chip">👍{c.votes}</div>
                    </div>
                    {(c.comments || []).map((cm, j) => (
                      <div className="adm-comment" key={j}>💬 <strong>{cm.handle}</strong>: {cm.text}</div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            {byCol.every((l) => l.length === 0) && <div className="muted" style={{ fontSize: 12 }}>No cards</div>}
          </div>
        </details>

        <details style={{ marginBottom: 8 }}>
          <summary style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '6px 0', color: 'var(--mt)', userSelect: 'none' }}>
            ✓ Sprint commitments ({(s.commits || []).length})
          </summary>
          <div style={{ marginTop: 8 }}>
            {(s.commits || []).length ? (s.commits || []).map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 7, padding: '5px 0', borderBottom: '1px solid var(--br)', fontSize: 12 }}>
                <span style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 800, color: 'var(--g)', minWidth: 16 }}>{i + 1}</span>
                <span>{c}</span>
              </div>
            )) : (
              <div className="muted" style={{ fontSize: 12, padding: '4px 0' }}>No commitments recorded</div>
            )}
          </div>
        </details>

        <details>
          <summary style={{ fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '6px 0', color: 'var(--mt)', userSelect: 'none' }}>👥 Players &amp; XP</summary>
          <div style={{ marginTop: 8 }}>
            {(s.players || []).slice(0, 5).map((p, i) => (
              <div className="adm-player-row" key={i}>
                <Avatar value={p.avatar} size={22} />
                <div style={{ flex: 1, fontSize: 12, fontFamily: "'Kanit',sans-serif", fontWeight: 700 }}>{p.name}</div>
                {p.isHost && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--y)', background: 'rgba(0,179,89,.1)', padding: '2px 7px', borderRadius: 100 }}>LEAD</span>}
                <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 12, color: 'var(--y)' }}>{Number(p.xp) || 0} XP</div>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
