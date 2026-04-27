// Results + wrap-up. Pulls the leaderboard from the backend so refreshers and
// late joiners see identical data. Excel export uses SheetJS.
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { useStore } from '../store.js';
import { api } from '../api.js';
import { toast, launchConfetti } from '../toast.js';
import { leaveRoom } from '../leaveRoom.js';
import Avatar from '../components/Avatar.jsx';

const LANE_NAMES = ['Went Well', 'Improve', 'Not Sure'];

export default function Results() {
  const room = useStore((s) => s.room);
  const roomId = useStore((s) => s.roomId);
  const meId = useStore((s) => s.me.id);
  const players = useStore((s) => s.players);
  const retro = useStore((s) => s.retro);
  const review = useStore((s) => s.review);
  const results = useStore((s) => s.results);
  const setResults = useStore((s) => s.setResults);
  const setRetro = useStore((s) => s.setRetro);
  const setReview = useStore((s) => s.setReview);

  const [leaderboard, setLeaderboard] = useState(null);

  useEffect(() => { launchConfetti(); }, []);

  useEffect(() => {
    (async () => {
      if (!roomId) return;
      let lb = null, cs = null;
      try {
        const [r1, r2] = await Promise.all([
          api.get(`/api/leaderboard/${roomId}`).catch(() => ({ leaderboard: null })),
          api.get(`/api/rooms/${roomId}/cards?phase=vote&player_id=${meId}`).catch(() => ({ cards: null })),
        ]);
        lb = r1.leaderboard;
        cs = r2.cards;
      } catch {}

      if (Array.isArray(cs) && cs.length) {
        const lanes = [[], [], []];
        // Rebuild review.discussed/duplicates in step so the new local ids line up
        // with the Sets — otherwise the previously-collected ids would orphan and
        // the commits filter + Excel "Duplicate" column would miss server-stored flags.
        const discussed = new Set();
        const duplicates = new Set();
        let nextId = 0;
        for (const c of cs) {
          const ci = ['went_well', 'improve', 'not_sure'].indexOf(c.col);
          if (ci < 0) continue;
          const localId = nextId++;
          lanes[ci].push({
            id: localId, dbId: c.id,
            txt: c.content || '',
            pid: c.player_id,
            pname: c.players?.anon_handle || 'Teammate',
            pav: c.players?.avatar || '🦄',
            votes: c.vote_count || 0,
            isMe: c.player_id === meId,
            is_duplicate: !!c.is_duplicate,
            is_discussed: !!c.is_discussed,
          });
          if (c.is_discussed) discussed.add(localId);
          if (c.is_duplicate) duplicates.add(localId);
        }
        setRetro({ cards: lanes, nextId });
        setReview({ discussed, duplicates });
      }
      setLeaderboard(lb);
      if (lb) setResults({ leaderboard: lb });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const flat = retro.cards.flat();
  const total = flat.length;
  const tv = flat.reduce((a, c) => a + (c.votes || 0), 0);
  const topCard = [...flat].sort((a, b) => b.votes - a.votes)[0];

  const lbRows = Array.isArray(leaderboard) && leaderboard.length
    ? leaderboard.slice().sort((a, b) => (a.rank || 999) - (b.rank || 999))
    : [...players].map((p) => ({
        player_id: p.id, anon_handle: p.name || p.anon_handle || 'Player',
        avatar: p.avatar, xp_total: p.xp || 0,
      })).sort((a, b) => b.xp_total - a.xp_total);

  const myXp = Array.isArray(leaderboard)
    ? leaderboard.find((x) => x.player_id === meId)?.xp_total
    : undefined;
  const totalXpDisplay = typeof myXp === 'number' ? myXp : results.totalXp;

  const commits = flat
    .filter((c) => !c.is_duplicate && !(review.duplicates && review.duplicates.has(c.id)))
    .sort((a, b) => b.votes - a.votes).slice(0, 3).map((c) => c.txt);

  const exportExcel = () => {
    const date = new Date().toLocaleDateString('th-TH');
    const wb = XLSX.utils.book_new();

    // Cards
    const cardsData = [['Lane', 'Content', 'Votes', 'Author', 'Discussed', 'Duplicate']];
    retro.cards.forEach((lane, ci) => {
      lane.forEach((c) => {
        cardsData.push([
          LANE_NAMES[ci], c.txt, c.votes || 0, c.pname || '',
          review.discussed.has(c.id) ? 'Yes' : 'No',
          (review.duplicates.has(c.id) || c.is_duplicate) ? 'Yes' : 'No',
        ]);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cardsData), 'Cards');

    // Most voted
    const votedData = [['Rank', 'Card', 'Votes', 'Lane']];
    const sorted = retro.cards.flatMap((lane, ci) => lane.map((c) => ({ ...c, laneIdx: ci })))
      .filter((c) => !review.duplicates.has(c.id))
      .sort((a, b) => b.votes - a.votes).slice(0, 10);
    sorted.forEach((c, i) => votedData.push([i + 1, c.txt, c.votes, LANE_NAMES[c.laneIdx]]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(votedData), 'Most Voted');

    // Leaderboard
    const xpData = [['Rank', 'Avatar', 'Name', 'XP']];
    lbRows.forEach((p, i) => xpData.push([i + 1, p.avatar || '🦄', p.anon_handle, p.xp_total || 0]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(xpData), 'Leaderboard');

    // Comments
    const cmtData = [['Card', 'Comment', 'By']];
    retro.cards.flat().forEach((c) => {
      (review.comments[c.id] || []).forEach((cm) => cmtData.push([c.txt, cm.text, cm.handle]));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cmtData), 'Comments');

    XLSX.writeFile(wb, `RetroQuest-${room}-${date}.xlsx`);
    toast('📊 Excel exported!');
  };

  const copySummary = () => {
    const lane = (i) => retro.cards[i].map((c) => `• ${c.txt}`).join('\n') || '(none)';
    const text =
      `RetroQuest · ${room} · ${new Date().toLocaleDateString()}\n\n` +
      `🚀 WENT WELL\n${lane(0)}\n\n` +
      `🔧 IMPROVE\n${lane(1)}\n\n` +
      `🤔 NOT SURE\n${lane(2)}\n\n` +
      `🏆 MOST VOTED\n${commits.map((c, i) => `${i + 1}. ${c}`).join('\n') || '(none)'}\n\n` +
      `Total XP: ${totalXpDisplay}`;
    navigator.clipboard.writeText(text).then(() => toast('Summary copied!')).catch(() => {});
  };

  const M = ['🥇', '🥈', '🥉'];

  return (
    <div className="screen active" id="s-results">
      <div className="w680" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, paddingTop: 14 }}>
        <div className="top-bar w680">
          <div className="logo-sm">RetroQuest</div>
          <button className="btn btn-out btn-sm" onClick={copySummary}>📋 Export</button>
        </div>
        <div style={{ textAlign: 'center', width: '100%', padding: '10px 0' }}>
          <div className="label" style={{ marginBottom: 10 }}>Retrospective Complete</div>
          <div className="mood-big pop-in">🎉</div>
          <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 20, marginTop: 6 }}>Retrospective Complete</div>
        </div>
        <div style={{ width: '100%' }}>
          <div style={{ background: 'rgba(0,179,89,.06)', border: '1px solid rgba(0,179,89,.18)', borderRadius: 'var(--r)', padding: '16px 18px', textAlign: 'center' }}>
            <div className="label" style={{ marginBottom: 10 }}>⚡ XP Earned This Session</div>
            <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 800, fontSize: 42, color: 'var(--y)', lineHeight: 1 }}>{totalXpDisplay}</div>
          </div>
        </div>
        <div className="hl-grid w680">
          <div className="hl-card">
            <div className="label" style={{ marginBottom: 5 }}>Total Cards</div>
            <div className="hl-num" style={{ color: 'var(--g)' }}>{total}</div>
          </div>
          <div className="hl-card">
            <div className="label" style={{ marginBottom: 5 }}>Total Votes</div>
            <div className="hl-num" style={{ color: 'var(--y)' }}>{tv}</div>
          </div>
          <div className="hl-card" style={{ gridColumn: '1 / -1' }}>
            <div className="label" style={{ marginBottom: 5 }}>⭐ Most Voted Card</div>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{topCard ? topCard.txt : '—'}</div>
          </div>
        </div>
        <div className="w680">
          <div className="label" style={{ marginBottom: 8 }}>🏆 Final Leaderboard</div>
          <div className="sc-list">
            {lbRows.map((p, i) => (
              <div className={`sc-row${p.player_id === meId ? ' me' : ''}`} key={p.player_id || i}>
                <div className="sc-rank">{M[i] || `#${i + 1}`}</div>
                <Avatar value={p.avatar || 'durian-1'} size={24} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "'Kanit',sans-serif", fontWeight: 700, fontSize: 13 }}>
                    {p.anon_handle || 'Player'}{p.player_id === meId ? ' (you)' : ''}
                  </div>
                </div>
                <div className="sc-xp">{Number(p.xp_total) || 0} XP</div>
              </div>
            ))}
          </div>
        </div>
        <div className="w680">
          <div className="label" style={{ marginBottom: 8 }}>🏆 Most Voted Cards</div>
          <div className="commit-list">
            {commits.map((c, i) => (
              <div className="commit" key={i}>
                <div className="commit-n">{i + 1}</div>
                <div>{c}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
          <button className="btn btn-y" style={{ flex: 1 }} onClick={leaveRoom}>▶ Play Again</button>
          <button className="btn btn-b" style={{ flex: 1 }} onClick={exportExcel}>📊 Export Excel</button>
        </div>
      </div>
    </div>
  );
}
