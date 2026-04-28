# RetroQuest

A real-time team retrospective platform with an ice-breaker game built in. Hosts run a session, teammates join with a PIN, answer ice-breaker questions, then move into a structured retro (submit → review → results).

## Stack

- **Frontend:** React 18 + Vite, Zustand for state, Socket.IO client for real-time
- **Realtime/backend:** Socket.IO (served by the separate `Retroquest-backend` repo)
- **Export:** `xlsx` for downloading retro results
- **Deploy:** Vercel (`vercel.json`)

## Getting started

Requires Node.js ≥ 18.

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts:

```bash
npm run build    # production build to dist/
npm run preview  # preview the production build
```

The frontend talks to the backend over Socket.IO. Configure the backend URL via the API/socket modules in [src/api.js](src/api.js) and [src/socket.js](src/socket.js).

## App flow

1. **Home** — pick host or join.
2. **Room setup / Join setup** — host creates a room, players join with a PIN.
3. **Lobby** — wait for players, host configures the session.
4. **Ice breaker** — questions, answer reveal, countdown to next.
5. **Retro** — submit phase → review phase → results.
6. **Admin** — host controls and overrides.

Screens live in [src/screens/](src/screens/), shared UI in [src/components/](src/components/).

## Project layout

```
src/
  screens/        Home, Lobby, Ice, Retro, Review, Results, Admin, …
  components/     Avatar, HostPanel, PinOverlay, GalaxyBg, …
  store.js        Zustand store
  socket.js       Socket.IO client
  useRoomSocket.js  Room subscription hook
  api.js          REST helpers
  session.js      Session/persistence
  leaveRoom.js    Leave/cleanup
  constants.js    Shared constants
  toast.js        Toast notifications
  styles.css      Global styles
public/           Static assets (OG image, NFT art)
```

## Deployment

Push to the connected Vercel project; `vercel.json` handles SPA rewrites. The backend is deployed separately.
