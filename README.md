# Calash — Multiplayer Card Game Platform

Production-ready MVP monorepo for the Calash card game platform. Built with TypeScript throughout, designed so a React Native mobile app can be added without major rewrites.

## Monorepo structure

```
calash/
├── apps/
│   ├── server/          # Node.js + Express + Socket.IO backend
│   └── web/             # Next.js 14 frontend
└── packages/
    ├── shared/          # Shared TypeScript types (no runtime deps)
    └── game-core/       # Pure game logic & validation (no framework deps)
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript |
| Backend | Node.js 20, Express 4, Socket.IO 4 |
| Database | PostgreSQL 16 |
| Realtime | Socket.IO (WebSockets) |
| Auth | JWT + bcrypt |
| Validation | Zod |
| Package manager | npm workspaces |

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 16 (or Docker)

## Quick start

```bash
# 1. Clone and install
git clone https://github.com/ridanafesh/calash.git
cd calash
npm install

# 2. Set up environment files
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local
# Edit both files with your values

# 3. Start PostgreSQL (Docker)
docker run -d --name calash-pg \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=calash \
  -p 5432:5432 postgres:16

# 4. Run database schema
psql postgresql://postgres:password@localhost:5432/calash \
  < apps/server/src/db/schema.sql

# 5. Start all services (server + web in parallel)
npm run dev
```

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:4000](http://localhost:4000)
- Health: [http://localhost:4000/api/health](http://localhost:4000/api/health)

## Individual app commands

```bash
# Server only
npm run dev -w apps/server

# Web only
npm run dev -w apps/web

# Build everything
npm run build

# Lint
npm run lint

# Format
npm run format
```

## Architecture decisions

### Why monorepo?
Shared types (`@calash/shared`) and game logic (`@calash/game-core`) are consumed by both the web app and the future React Native app. A monorepo eliminates type drift and makes refactoring across layers safe.

### Why game-core is framework-free
`@calash/game-core` has zero runtime dependencies on Express, React, or any platform SDK. This means the same deck, validation, and scoring logic runs identically on the server (authoritative) and can be imported into a mobile app for local previews without a server round-trip.

### Future mobile app
Add `apps/mobile` (Expo or bare React Native), depend on `@calash/shared` and `@calash/game-core`, and implement a platform-specific socket layer. No changes needed in `apps/server` or the shared packages.

### Future payments
- Web: PayPal SDK in `apps/web`; a `/api/payments` route in `apps/server`
- Mobile: `react-native-iap` for Apple/Google; server validates receipts
- The `payments` table is already scaffolded (commented out) in `apps/server/src/db/schema.sql`

## Package overview

| Package | Purpose |
|---|---|
| `@calash/shared` | TypeScript interfaces for players, game state, Socket.IO events, API contracts |
| `@calash/game-core` | Deck creation/shuffle/deal, action validation, scoring — pure functions, no I/O |
| `@calash/server` | REST API, Socket.IO server, PostgreSQL queries, JWT auth |
| `@calash/web` | Next.js pages, API client, Socket.IO client singleton |
