// Central app state. Keep this flat — nested update ceremony is noise in a
// multiplayer game where many fields change per socket tick.
import { create } from 'zustand';
import { AVATARS, MAX_REACTION_STACK } from './constants.js';
import { floatXp } from './toast.js';

let reactionIdSeq = 0;

const initialIce = () => ({
  qIdx: 0,
  timer: 10,
  max: 10,
  answered: false,
  myPick: -1,
  scores: {},        // player_id → XP earned this session
  answerCounts: [0, 0, 0, 0],
  answeredCount: 0,
  playerPicks: {},
  resultsShown: false,
  nextScheduled: false,
  questions: [],     // active questions for this room (default or custom)
});

const initialRetro = () => ({
  phase: 'submit',   // 'submit' | 'vote'
  timer: 90,
  max: 90,
  cards: [[], [], []],  // indexed by col (0=went_well, 1=improve, 2=not_sure)
  nextId: 0,
  myVotes: new Set(),
});

const initialReview = () => ({
  queue: [],          // [{ card, ci }] sorted by votes desc
  idx: 0,
  discussed: new Set(),
  duplicates: new Set(),
  comments: {},       // local card id → [{avatar, handle, text, time, isLead}]
});

export const useStore = create((set, get) => ({
  screen: 's-home',
  show: (s) => set({ screen: s }),

  // Config the host picks before creating a room
  cfg: {
    roomOpen: true,
    iceEnabled: true,
    iceTimerSecs: 10,
    retroSubmitSecs: 90,
    retroSubmitUnlimited: false,
    retroVoteSecs: 60,
    customQuestions: [],
  },
  setCfg: (patch) => set((st) => ({ cfg: { ...st.cfg, ...patch } })),

  // Player identity
  me: { id: null, name: '', avatar: 'durian-1', xp: 0 },
  selAv: 'durian-1',
  isHost: false,
  setMe: (patch) => set((st) => ({ me: { ...st.me, ...patch } })),
  setSelAv: (a) => set({ selAv: AVATARS.includes(a) ? a : 'durian-1' }),
  setIsHost: (v) => set({ isHost: !!v }),

  // Room identity + participants
  room: '',         // 6-char join code
  roomId: '',       // UUID
  players: [],      // [{ id, name, avatar, isHost, anon_handle, ... }]
  setRoom: ({ room, roomId }) => set({ room: room ?? '', roomId: roomId ?? '' }),
  setPlayers: (players) => set({ players: Array.isArray(players) ? players : [] }),
  addOrReplacePlayer: (p) => set((st) => {
    const without = st.players.filter(x => x.id !== p.id);
    return { players: [...without, p] };
  }),
  removePlayer: (id) => set((st) => ({ players: st.players.filter(p => p.id !== id) })),
  markLead: (leadId) => set((st) => ({
    players: st.players.map(p => ({ ...p, isHost: p.id === leadId })),
    isHost: st.me.id === leadId ? true : st.isHost,
  })),

  // Chat
  chat: [],
  pushChat: (msg) => set((st) => ({ chat: [...st.chat, msg].slice(-200) })),

  // Lobby emoji reactions.
  //   reactions      — live visual stacks, keyed by recipient player_id.
  //                    Each entry = { id, emoji, from, at }. Capped at
  //                    MAX_REACTION_STACK (oldest dropped). Entries are
  //                    removed by expireReaction() after REACTION_TTL_MS,
  //                    wired up by the component that renders them.
  //   reactionBurst  — per-player integer that bumps every time a reaction
  //                    lands. React uses this as a `key` prop to retrigger
  //                    the wobble animation on the recipient's avatar.
  //   reactionTotals — lifetime count per player since the lobby started.
  //                    Used to pick the MVP (most-reacted-to) for highlight.
  reactions:        {},
  reactionBurst:    {},
  reactionTotals:   {},
  reactionFlavors:  {}, // { [pid]: [emoji, ...] }  distinct, insertion-order, capped
  addReaction: (to_player_id, { emoji, from_player_id, at }) => {
    const id = ++reactionIdSeq;
    set((st) => {
      const prev = st.reactions[to_player_id] || [];
      const next = [...prev, { id, emoji, from: from_player_id, at }].slice(-MAX_REACTION_STACK);
      const prevFlavors = st.reactionFlavors[to_player_id] || [];
      // Promote the just-used emoji to the END of the list (most-recent-first
      // feels right for a "vibes" summary) and cap at 5 distinct entries.
      const flavors = [...prevFlavors.filter((e) => e !== emoji), emoji].slice(-5);
      return {
        reactions:       { ...st.reactions,       [to_player_id]: next },
        reactionBurst:   { ...st.reactionBurst,   [to_player_id]: (st.reactionBurst[to_player_id] || 0) + 1 },
        reactionTotals:  { ...st.reactionTotals,  [to_player_id]: (st.reactionTotals[to_player_id] || 0) + 1 },
        reactionFlavors: { ...st.reactionFlavors, [to_player_id]: flavors },
      };
    });
    return id;
  },
  expireReaction: (to_player_id, id) => set((st) => {
    const prev = st.reactions[to_player_id];
    if (!prev) return st;
    const next = prev.filter((r) => r.id !== id);
    return { reactions: { ...st.reactions, [to_player_id]: next } };
  }),
  resetReactions: () => set({ reactions: {}, reactionBurst: {}, reactionTotals: {}, reactionFlavors: {} }),
  // Clear all reaction state for a single player — used when someone
  // (re)joins the room so we don't carry old stacks / flavors / totals
  // from their previous session. Also used on player_left so a subsequent
  // rejoin starts from a truly empty slate.
  resetReactionsFor: (playerId) => set((st) => {
    if (!playerId) return st;
    const stripKey = (obj) => {
      if (!(playerId in obj)) return obj;
      const { [playerId]: _, ...rest } = obj;
      return rest;
    };
    return {
      reactions:       stripKey(st.reactions),
      reactionBurst:   stripKey(st.reactionBurst),
      reactionTotals:  stripKey(st.reactionTotals),
      reactionFlavors: stripKey(st.reactionFlavors),
    };
  }),

  // Ice breaker phase state
  ice: initialIce(),
  setIce: (patch) => set((st) => ({ ice: { ...st.ice, ...patch } })),
  resetIce: () => set({ ice: initialIce() }),

  // Retro phase state
  retro: initialRetro(),
  setRetro: (patch) => set((st) => ({ retro: { ...st.retro, ...patch } })),
  resetRetro: () => set({ retro: initialRetro() }),

  // Review phase state
  review: initialReview(),
  setReview: (patch) => set((st) => ({ review: { ...st.review, ...patch } })),

  // Results (display-only; authoritative values come from the backend on showResults)
  results: { totalXp: 0, leaderboard: null },
  setResults: (patch) => set((st) => ({ results: { ...st.results, ...patch } })),

  // Full-state reset for leaveRoom / playAgain
  hardReset: () => set({
    screen: 's-home',
    me: { id: null, name: '', avatar: 'durian-1', xp: 0 },
    isHost: false,
    room: '',
    roomId: '',
    players: [],
    chat: [],
    reactions: {},
    reactionBurst: {},
    reactionTotals: {},
    reactionFlavors: {},
    ice: initialIce(),
    retro: initialRetro(),
    review: initialReview(),
    results: { totalXp: 0, leaderboard: null },
  }),
}));

// XP helper — updates self AND ice.scores so every screen's leaderboard stays
// in sync without threading state through components. Also fires the "+N XP"
// flyout animation for positive awards (legacy UX parity).
export function earnXP(amt) {
  useStore.setState((st) => {
    const id = st.me.id;
    const newXp = st.me.xp + amt;
    const newScores = { ...st.ice.scores };
    if (id) newScores[id] = (newScores[id] || 0) + amt;
    return {
      me: { ...st.me, xp: newXp },
      ice: { ...st.ice, scores: newScores },
      results: { ...st.results, totalXp: st.results.totalXp + amt },
    };
  });
  if (amt > 0) floatXp(amt);
}
