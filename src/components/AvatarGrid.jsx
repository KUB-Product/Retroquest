// Avatar picker. Renders the NFT whitelist (Durian the Elephant) as round
// thumbnails. Emoji fallbacks would only appear if the whitelist itself is
// edited to include non-NFT values; none do today.
import { AVATARS, avatarUrl } from '../constants.js';
import { useStore } from '../store.js';

export default function AvatarGrid() {
  const selAv = useStore((s) => s.selAv);
  const setSelAv = useStore((s) => s.setSelAv);
  return (
    <div className="av-grid">
      {AVATARS.map((a) => (
        <button
          key={a}
          className={`av-btn${a === selAv ? ' sel' : ''}`}
          onClick={() => setSelAv(a)}
          type="button"
          title={a}
        >
          <img src={avatarUrl(a)} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
}
