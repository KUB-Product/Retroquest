import { useEffect, useMemo } from 'react';
import { useStore } from '../store.js';
import { AVATARS, avatarUrl } from '../constants.js';

const PLANET_COUNT = 8;

export default function Home() {
  const show = useStore((s) => s.show);
  const setCfg = useStore((s) => s.setCfg);
  const screen = useStore((s) => s.screen);

  const goCreate = () => { setCfg({ customQuestions: [] }); show('s-roomsetup'); };
  const goJoin   = () => show('s-joinsetup');
  const goAdmin  = () => show('s-admin');

  // Keyboard shortcuts only fire on the Home screen. Bind while mounted.
  useEffect(() => {
    const onKey = (e) => {
      if (screen !== 's-home') return;
      if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'c')     { e.preventDefault(); goCreate(); }
      else if (k === 'j'){ e.preventDefault(); goJoin(); }
      else if (k === 'a'){ e.preventDefault(); goAdmin(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // Pick `PLANET_COUNT` random NFTs from the 32-image pool on every mount; seeded
  // via `useMemo` so they don't reshuffle mid-session (would make the orbit jitter).
  const planets = useMemo(() => {
    const shuffled = [...AVATARS].sort(() => Math.random() - 0.5).slice(0, PLANET_COUNT).map(avatarUrl);
    return shuffled.map((src, i) => {
      const angle = (i / PLANET_COUNT) * Math.PI * 2;
      const radius = 220 + (i % 3) * 60;
      const startX = Math.cos(angle) * radius;
      const startY = Math.sin(angle) * radius;
      return {
        src,
        style: {
          left: '50%',
          top: '50%',
          '--from-x': `${startX}px`,
          '--from-y': `${startY}px`,
          '--to-x':   `${startX + (Math.random() * 60 - 30)}px`,
          '--to-y':   `${startY + (Math.random() * 60 - 30)}px`,
          '--dur':    `${12 + Math.random() * 14}s`,
          '--delay':  `${Math.random() * -10}s`,
        },
      };
    });
  }, []);

  return (
    <div className="screen active" id="s-home">
      <div className="hero-grid"></div>
      <div className="hero-orbit">
        {planets.map((p, i) => (
          <img key={i} className="hero-planet-img" src={p.src} alt="" loading="lazy" style={p.style} />
        ))}
      </div>

      <div className="hero">
        <div className="hero-head">
          <div className="hero-badge">◉ Multiplayer Retro Platform</div>
          <div className="logo">Retrospective</div>
          <div className="hero-tag">
            <span>Reflect</span><span className="hero-tag-dot"></span>
            <span>Adapt</span><span className="hero-tag-dot"></span>
            <span>Improve</span>
          </div>
        </div>

        {/* Sample cards appear BEFORE the CTAs so a visitor sees what they're
            signing up for (a card-based retro) before picking Create/Join. */}
        <div className="hero-samples" aria-hidden="true">
          <div className="hero-samples-label">Here's what a retro card looks like</div>
          <div className="hero-samples-row">
            <article className="hero-sample hero-sample-g" style={{ '--rot': '-3deg', '--delay': '0s',   '--dur': '7s' }}>
              <span className="hero-sample-spark" style={{ top: -6, right: 10 }}>✦</span>
              <div className="hero-sample-tag">🚀 Went Well</div>
              <div className="hero-sample-txt">Great teamwork</div>
              <div className="hero-sample-votes">👍 7</div>
            </article>
            <article className="hero-sample hero-sample-pk" style={{ '--rot': '1deg',  '--delay': '1.2s', '--dur': '6.4s' }}>
              <span className="hero-sample-spark" style={{ top: 8, left: -4 }}>✧</span>
              <div className="hero-sample-tag">🔧 Improve</div>
              <div className="hero-sample-txt">Too many mid-sprint scope changes</div>
              <div className="hero-sample-votes">👍 5</div>
            </article>
            <article className="hero-sample hero-sample-b" style={{ '--rot': '2.5deg','--delay': '2.4s', '--dur': '7.8s' }}>
              <span className="hero-sample-spark" style={{ bottom: 4, right: -4 }}>✦</span>
              <div className="hero-sample-tag">🤔 Not Sure</div>
              <div className="hero-sample-txt">Should we try pair programming?</div>
              <div className="hero-sample-votes">👍 3</div>
            </article>
          </div>
        </div>

        <div className="hero-ctas">
          <div className="hero-cta hero-cta-primary" onClick={goCreate} role="button" tabIndex={0}
               onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && goCreate()}>
            <span className="hero-cta-kbd">C</span>
            <div className="hero-cta-icon">⚡</div>
            <div className="hero-cta-label">Create Room</div>
            <div className="hero-cta-sub">Host a new retro room</div>
            <div className="hero-cta-arrow">↗</div>
          </div>
          <div className="hero-cta" onClick={goJoin} role="button" tabIndex={0}
               onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && goJoin()}>
            <span className="hero-cta-kbd">J</span>
            <div className="hero-cta-icon">🧭</div>
            <div className="hero-cta-label">Join Room</div>
            <div className="hero-cta-sub">Enter a 6-char code</div>
            <div className="hero-cta-arrow">↗</div>
          </div>
        </div>

        <div className="hero-meta">
          <span>20 PLAYERS</span>
          <span className="hero-tag-dot"></span>
          <span>30–60 MIN</span>
          <span className="hero-tag-dot"></span>
          <span>QUIZ · RETRO · REVIEW</span>
        </div>
      </div>

      <div className="hero-nft-credit">
        Orbit art · <a href="https://www.nfispace.com/collection/0x0e987608fecaa052b43628c0e5ab5a6e28d933f2" target="_blank" rel="noopener noreferrer">Durian the Elephant</a>
      </div>
      <button className="hero-admin" onClick={goAdmin} title="Admin (A)">🔐 Admin · A</button>
    </div>
  );
}
