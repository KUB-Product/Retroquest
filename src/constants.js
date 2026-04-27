// Shared constants. Keep in sync with backend util/validators.js ALLOWED_AVATARS.
//
// Avatars are Durian the Elephant NFT IDs served from /public/nft/ as JPEGs.
// We store the short id in the DB (`durian-1`, `token-131072`) and expand to
// `/nft/{id}.jpeg` at render time via `avatarUrl()`.
//   collection: https://www.nfispace.com/collection/0x0e987608fecaa052b43628c0e5ab5a6e28d933f2
//   on-chain:   https://www.kubscan.com/token/0x0e987608FECAa052b43628c0e5AB5a6e28d933F2
export const AVATARS = [
  // 8 official showcase pieces
  'durian-1','durian-2','durian-3','durian-4',
  'durian-5','durian-6','durian-7','durian-8',
  // 16 real minted tokens pulled via ERC721Enumerable.tokenByIndex —
  // together with the 8 showcase pieces, a 24-avatar pool.
  'token-1','token-131072','token-262144','token-393216',
  'token-524288','token-655360','token-786432','token-917504',
  'token-1048576','token-1179648','token-1310720','token-1441792',
  'token-1572864','token-1703936','token-1835008','token-1966080',
];

export function avatarUrl(id) {
  if (!id) return null;
  if (id.startsWith('/') || id.startsWith('http')) return id; // already a URL (rare)
  return `/nft/${id}.jpeg`;
}
export function isNftAvatar(v) {
  return typeof v === 'string' && (v.startsWith('durian-') || v.startsWith('token-'));
}

export const COLS = [
  { key: 'went_well', icon: '🚀', label: 'Went Well',  color: 'var(--g)'  },
  { key: 'improve',   icon: '🔧', label: 'Improve',    color: 'var(--pk)' },
  { key: 'not_sure',  icon: '🤔', label: 'Not Sure',   color: 'var(--b)'  },
];

// Offline/fallback ice questions. When backend reaches us we replace this with the
// server-supplied list (custom-per-room or the 20 default-seed questions).
export const FALLBACK_QUESTIONS = [
  { q: "When someone says 'this will only take 5 minutes'…", opts: ['Trust them completely 🙏','Add 2 hours to the estimate ⏱','Ask them to elaborate 🤔','Cancel the sprint 🚨'], correct: 1, xp: 100 },
  { q: 'The #1 sign of a GREAT retrospective is…',           opts: ['Everyone agrees on everything','Clear action items with real owners ✅','It finishes early 🏃','Unlimited snacks 🍕'], correct: 1, xp: 100 },
  { q: "In agile, 'velocity' measures…",                     opts: ['How fast devs type ⌨️','Work completed per sprint 📊','Server response time 🖥','Meeting efficiency ☕'],    correct: 1, xp: 100 },
  { q: 'Technical debt is best described as…',               opts: ['Money owed to AWS','The future cost of shortcuts taken ⚠️','Slow office wifi','A deprecated Jira board'],  correct: 1, xp: 100 },
  { q: 'The best way to unblock a teammate is…',             opts: ['Schedule a meeting for next week','Respond in Slack immediately, then pair if needed 🤝','Reassign their ticket','Add it to the backlog'], correct: 1, xp: 100 },
];

export const MAX_QUESTIONS = 10;

// Lobby emoji reactions. Keep in sync with REACT_EMOJIS on the backend
// (src/socket/handlers.js). Only values in this list are allowed.
export const REACT_EMOJIS = ['👍', '❤️', '🔥', '🎉', '😂', '💪', '🚀', '👏'];
// Number of reactions kept in the visual stack above each player. Oldest drops
// when full. Reactions also auto-expire after REACTION_TTL_MS.
export const MAX_REACTION_STACK = 10;
export const REACTION_TTL_MS = 6000;

// Anonymous handle pool — random adjective + 3-digit suffix. Used as a fallback
// on the client; the backend already generates its own handle at /join and
// those take precedence.
const HANDLE_ADJ = ['Ghost','Ninja','Shadow','Phantom','Agent','Ranger','Scout','Comet','Rebel','Player','Viper','Falcon'];
export function randomHandle() {
  const a = HANDLE_ADJ[Math.floor(Math.random() * HANDLE_ADJ.length)];
  return `${a}#${100 + Math.floor(Math.random() * 900)}`;
}
