// App — screen router. Reads useStore.screen, renders exactly one screen.
// Also mounts useRoomSocket() once globally so socket listeners survive
// between screen transitions.
import { useEffect } from 'react';
import { useStore } from './store.js';
import { useRoomSocket } from './useRoomSocket.js';
import { loadRoomSession } from './session.js';
import Home from './screens/Home.jsx';
import Admin from './screens/Admin.jsx';
import RoomSetup from './screens/RoomSetup.jsx';
import JoinSetup from './screens/JoinSetup.jsx';
import Lobby from './screens/Lobby.jsx';
import Ice from './screens/Ice.jsx';
import Retro from './screens/Retro.jsx';
import Review from './screens/Review.jsx';
import Results from './screens/Results.jsx';
import GalaxyBg from './components/GalaxyBg.jsx';

const SCREENS = {
  's-home':      Home,
  's-admin':     Admin,
  's-roomsetup': RoomSetup,
  's-joinsetup': JoinSetup,
  's-lobby':     Lobby,
  's-ice':       Ice,
  's-retro':     Retro,
  's-review':    Review,
  's-results':   Results,
};

export default function App() {
  useRoomSocket();
  const screen = useStore((s) => s.screen);
  const show = useStore((s) => s.show);
  const setSelAv = useStore((s) => s.setSelAv);
  const setMe = useStore((s) => s.setMe);

  // Handle /join/ROOMCODE invite URLs on initial load. If a session for the
  // code already exists in localStorage we stash the avatar; JoinSetup picks up
  // the pre-filled code via store and the player can confirm.
  useEffect(() => {
    const path = window.location.pathname;
    const m = path.match(/\/join\/([A-Z0-9]{4,8})/i);
    if (!m) return;
    const code = m[1].toUpperCase();
    const existing = loadRoomSession(code);
    if (existing?.avatar) {
      setSelAv(existing.avatar);
      setMe({ avatar: existing.avatar });
    }
    useStore.setState({ _autoJoinCode: code });
    try { history.replaceState(null, '', '/'); } catch {}
    show('s-joinsetup');
  }, [setSelAv, setMe, show]);

  const Current = SCREENS[screen] || Home;
  return (
    <>
      {/* Galaxy backdrop lives OUTSIDE `.screen` so `position:fixed` resolves
          against the viewport instead of `.screen`'s transform containing block.
          Home-only — other screens don't need the deep-space vibe. */}
      {screen === 's-home' && (
        <>
          <GalaxyBg />
          <div className="galaxy-veil"></div>
        </>
      )}
      <Current />
    </>
  );
}
