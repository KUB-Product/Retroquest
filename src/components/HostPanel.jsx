// Floating host controls — only mounted on in-game screens (ice/retro/review).
// Hidden unless the current user is the Team Lead.
import { useStore } from '../store.js';
import { getSocket } from '../socket.js';
import { toast } from '../toast.js';
import { api } from '../api.js';

export default function HostPanel({ onAdvance, onPrevQ, onNextQ, onBack }) {
  const isHost   = useStore((s) => s.isHost);
  const roomId   = useStore((s) => s.roomId);
  const screen   = useStore((s) => s.screen);
  const roomOpen = useStore((s) => s.cfg.roomOpen);
  const retroPhase = useStore((s) => s.retro.phase);
  const submitUnlimited = useStore((s) => s.cfg.retroSubmitUnlimited);
  const iceQIdx     = useStore((s) => s.ice.qIdx);
  const iceQTotal   = useStore((s) => s.ice.questions.length);

  if (!isHost) return null;
  // No live timer running during unlimited submit → hide timer-only controls.
  const hasTimer = !(screen === 's-retro' && retroPhase === 'submit' && submitUnlimited);

  const isIce     = screen === 's-ice';
  const canPrevQ  = isIce && typeof onPrevQ === 'function' && iceQIdx > 0;
  const canNextQ  = isIce && typeof onNextQ === 'function' && iceQIdx < iceQTotal - 1;

  const toggleLock = async () => {
    if (!roomId) return;
    const next = !roomOpen;
    useStore.getState().setCfg({ roomOpen: next });
    toast(next ? '🔓 Room is now open — players can join' : '🔒 Room is locked — no new players');
    try {
      await api.post(`/api/rooms/${roomId}/lock`, {
        player_id: useStore.getState().me.id,
        is_open:   next,
      });
    } catch {
      useStore.getState().setCfg({ roomOpen: !next });
      toast('Lock sync failed — reverted');
    }
  };

  const addTimer = () => {
    toast('⏱️ +30 seconds added');
    if (roomId) getSocket().emit('add_time', { room_id: roomId, delta_seconds: 30 });
  };

  const skipTimer = () => {
    toast('⏭ Timer skipped');
    const phase = screen === 's-ice'
      ? 'ice'
      : retroPhase === 'submit' ? 'retro_submit' : 'retro_vote';
    if (roomId) getSocket().emit('stop_timer_early', { room_id: roomId, phase, reason: 'skip' });
  };

  return (
    <div className="host-panel">
      <div className="hp-label">🎛️ TEAM LEAD</div>
      <div className="hp-divider"></div>
      <button className={`lock-toggle ${roomOpen ? 'open' : 'locked'}`} onClick={toggleLock} title="Toggle room lock">
        <span>{roomOpen ? '🔓' : '🔒'}</span>
        <span>{roomOpen ? 'Open' : 'Locked'}</span>
      </button>
      <div className="hp-divider"></div>
      {hasTimer && <button className="btn btn-ghost btn-xs" onClick={addTimer}>+30s</button>}
      {hasTimer && <button className="btn btn-ghost btn-xs" onClick={skipTimer}>⏭ Skip</button>}
      {isIce && (
        <>
          <button
            className="btn btn-ghost btn-xs"
            onClick={onPrevQ}
            disabled={!canPrevQ}
            title="Back to previous question"
          >← Prev Q</button>
          <button
            className="btn btn-ghost btn-xs"
            onClick={onNextQ}
            disabled={!canNextQ}
            title="Skip to next question"
          >Next Q →</button>
        </>
      )}
      {typeof onBack === 'function' && (
        <button
          className="btn btn-ghost btn-xs"
          onClick={onBack}
          title="Back to submit phase"
        >← Back</button>
      )}
      <button className="btn btn-pk btn-xs" onClick={onAdvance}>
        {isIce ? 'End Ice →' : 'Next Phase →'}
      </button>
    </div>
  );
}
