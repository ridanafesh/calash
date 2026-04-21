# Calash — Multiplayer Card Game Platform

Production-ready MVP monorepo for the Calash card game platform. Built with TypeScript throughout, designed so a React Native mobile app can be added without major rewrites.

## Monorepo structure

```
calash/
├── apps/
│   ├── server/          # Node.js + Express + Socket.IO backend
│   └── web/             # Next.js 14 frontend
├── packages/
│   ├── shared/          # Shared TypeScript types (no runtime deps)
│   └── game-core/       # Pure game logic & validation (no framework deps)
├── docs/
│   ├── MONETIZATION.md  # Commerce architecture & payment provider guide
│   └── MOBILE.md        # React Native integration guide
├── ARCHITECTURE.md      # ADRs, system design, data model
├── HANDOFF.md           # Developer onboarding & contribution guide
└── docker-compose.yml   # Local dev database (postgres)
```

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14, React 18, TypeScript |
| Backend | Node.js 20, Express 4, Socket.IO 4 |
| Database | PostgreSQL 16 |
| Realtime | Socket.IO (WebSockets) |
| Auth | JWT + bcrypt, optional Google OAuth |
| Validation | Zod |
| Logging | pino |
| Testing | Jest + ts-jest + supertest |
| Package manager | npm workspaces |

## Quick start

```bash
# 1. Clone and set up (installs deps, copies env files, starts DB, migrates, seeds)
git clone https://github.com/ridanafesh/calash.git
cd calash
./scripts/setup.sh

# 2. Start all services (server :4000 + web :3000)
npm run dev
```

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:4000](http://localhost:4000)
- Health: [http://localhost:4000/api/health](http://localhost:4000/api/health)

### Manual setup (without Docker)

```bash
npm install

# Copy and edit env files
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env.local

# Start PostgreSQL yourself, then:
npm run db:migrate -w apps/server
npm run db:seed -w apps/server
npm run dev
```

## Running tests

```bash
# All tests (game-core + server integration)
npm test

# Game-core unit tests (60+ covering all game rules)
npm test -w packages/game-core

# Server integration tests (23 tests, no real DB needed)
cd apps/server && npx jest
```

## Individual commands

```bash
# Start server only
npm run dev -w apps/server

# Start web only
npm run dev -w apps/web

# Build everything
npm run build

# Run migrations
npm run db:migrate -w apps/server

# Seed development data
npm run db:seed -w apps/server

# Reset database (drop + migrate + seed)
./scripts/reset-db.sh
```

## Seed accounts

After `npm run db:seed`, the following accounts are available:

| Email | Password | Role |
|---|---|---|
| alice@example.com | password | Player |
| bob@example.com | password | Player |
| charlie@example.com | password | Player |

## Architecture decisions

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design document including ADRs.

### Key decisions

**Monorepo** — `@calash/shared` and `@calash/game-core` are consumed by both the web app and the future React Native app. A monorepo eliminates type drift and makes cross-layer refactoring safe.

**Framework-free game logic** — `@calash/game-core` has zero runtime dependencies. The same deck, validation, and scoring logic runs on the server (authoritative) and can be imported into a mobile app for offline UI previews without a round-trip.

**In-memory + DB** — Active game rooms live in a `Map`-based store for zero-latency socket events. Completed rounds and scores are persisted to PostgreSQL.

**Commerce behind a flag** — All payment tables, services, and provider stubs are fully wired. Routes return `503` until `COMMERCE_ENABLED=true`. No live payment UI is exposed until credentials and legal review are complete.

## Adding a mobile app

See [docs/MOBILE.md](docs/MOBILE.md) for the step-by-step guide. No changes are needed in `apps/server` or `packages/` — add `apps/mobile` and connect it to the existing API and socket events.

## Enabling payments

See [docs/MONETIZATION.md](docs/MONETIZATION.md). Supported platforms: PayPal (web), Apple IAP (iOS), Google Play (Android).
