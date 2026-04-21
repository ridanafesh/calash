# @calash/web

Next.js 14 frontend for the Calash card game platform.

## Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Realtime**: Socket.IO client
- **Styling**: CSS variables (no UI library dependency; easily swappable)

## Getting started

```bash
# 1. Copy environment variables
cp .env.example .env.local
# Edit .env.local with your values

# 2. Start the dev server (from repo root)
npm run dev -w apps/web
# or from this directory:
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend REST API base URL |
| `NEXT_PUBLIC_WS_URL` | Backend WebSocket URL |

## Project structure

```
src/
├── app/                # Next.js App Router pages & layouts
│   ├── auth/           # Login / register
│   ├── lobby/          # Game lobby (room list)
│   └── game/           # In-game view (next chunk)
└── lib/
    ├── api.ts          # REST API client
    └── socket.ts       # Socket.IO singleton
```

## Adding React Native support

The shared business logic lives in `@calash/shared` and `@calash/game-core` — no React/DOM dependencies. To add a React Native app:

1. Create `apps/mobile` with `expo` or bare React Native
2. Install `@calash/shared` and `@calash/game-core` as workspace deps
3. Replace `socket.io-client` with a React Native-compatible WS client
4. Implement payment flows via `react-native-iap` (Apple/Google) alongside the web PayPal flow
