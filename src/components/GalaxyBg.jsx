// Pure-CSS (+ procedurally-placed stars) deep-space backdrop.
// Ties visually to the orbit rings + NFT planets above, loads instantly, and
// costs nothing in bandwidth or CSP exceptions. Animation pauses if the user
// has `prefers-reduced-motion`.
import { useMemo } from 'react';

const STAR_LAYERS = [
  { count: 120, size: 1, duration: 5.5, opacity: [0.35, 0.85] }, // tiny background
  { count: 40,  size: 2, duration: 4.0, opacity: [0.55, 1.0] },  // medium twinkle
  { count: 12,  size: 3, duration: 3.0, opacity: [0.75, 1.0] },  // bright anchors
];

function randomStars(count, size, [minO, maxO]) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      x: Math.random() * 100,
      y: Math.random() * 100,
      s: size + Math.random() * 0.5,
      o: minO + Math.random() * (maxO - minO),
      delay: Math.random() * 6,
    });
  }
  return arr;
}

export default function GalaxyBg() {
  // Seed once per mount — avoids reshuffling stars on every re-render.
  const layers = useMemo(() => STAR_LAYERS.map(L => ({
    ...L, stars: randomStars(L.count, L.size, L.opacity),
  })), []);

  return (
    <div className="galaxy-bg" aria-hidden="true">
      <div className="galaxy-nebula"></div>
      <div className="galaxy-disc"></div>
      {layers.map((L, li) => (
        <div key={li} className="galaxy-starlayer" style={{ animationDuration: `${L.duration}s` }}>
          {L.stars.map((s, i) => (
            <span
              key={i}
              className="galaxy-star"
              style={{
                left: `${s.x}%`,
                top:  `${s.y}%`,
                width:  `${s.s}px`,
                height: `${s.s}px`,
                opacity: s.o,
                animationDelay: `${s.delay}s`,
              }}
            />
          ))}
        </div>
      ))}
      {/* Two slow shooting stars on different angles — rare, decorative. */}
      <span className="galaxy-shooter" style={{ top: '22%', left: '-10%', animationDelay: '3s' }}></span>
      <span className="galaxy-shooter galaxy-shooter-alt" style={{ top: '65%', left: '-10%', animationDelay: '17s' }}></span>
    </div>
  );
}
