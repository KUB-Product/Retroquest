// Renders either an NFT image (from /public/nft) or an emoji fallback.
// Every place that used to show `{player.avatar}` passes the value through
// here so both cases — NFT id strings and the anonymous `🕵️` mask — render
// cleanly at the requested size.
import { avatarUrl, isNftAvatar } from '../constants.js';

export default function Avatar({ value, size = 24, className = '', title }) {
  const style = { width: size, height: size };
  if (isNftAvatar(value)) {
    return (
      <img
        src={avatarUrl(value)}
        alt=""
        title={title}
        loading="lazy"
        className={`avatar-img ${className}`}
        style={style}
      />
    );
  }
  // Emoji fallback (anonymous mask, legacy rows, server-generated bot avatars).
  return (
    <span
      className={`avatar-emoji ${className}`}
      title={title}
      style={{ ...style, fontSize: Math.round(size * 0.85), lineHeight: `${size}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {value || '🦄'}
    </span>
  );
}
