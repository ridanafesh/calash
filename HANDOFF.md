# Developer Handoff

This document covers everything a new developer needs to understand, run, and extend the Calash platform.

---

## Quick Start

### Prerequisites

- Node.js 20+, npm 10+
- PostgreSQL 16 (or Docker)

### First-time setup

```bash
git clone https://github.com/ridanafesh/calash.git
cd calash
./scripts/setup.sh          # installs deps, copies .env files, starts DB, migrates + seeds
npm run dev                 # starts server (4000) + web (3000) in parallel
```

If you don't have Docker, start PostgreSQL manually and then:
```bash
npm install
cp apps/server/.env.example apps/server/.env   # edit DATABASE_URL, JWT_SECRET
cp apps/web/.env.example apps/web/.env.local
npm run db:migrate -w apps/server
npm run db:seed -w apps/server
npm run dev
```

### Verify it works

```bash
curl http://localhost:4000/api/health
# {"success":true,"data":{"status":"ok","db":"connected"}}
```

---

## Environment Variables

### `apps/server/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |
| `PORT` | No | `4000` | HTTP port |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `JWT_SECRET` | **Yes** | — | Secret for signing JWTs (min 32 chars in prod) |
| `JWT_EXPIRES_IN` | No | `7d` | Token lifetime for full accounts |
| `JWT_GUEST_EXPIRES_IN` | No | `24h` | Token lifetime for guest accounts |
| `CORS_ORIGIN` | No | `http://localhost:3000` | Allowed CORS origin |
| `GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID (Google sign-in disabled if absent) |
| `COMMERCE_ENABLED` | No | `false` | Set `true` to enable `/api/commerce/*` routes |
| `PAYPAL_CLIENT_ID` | No | — | PayPal credentials (commerce only) |
| `PAYPAL_CLIENT_SECRET` | No | — | |
| `APPLE_BUNDLE_ID` | No | — | Apple IAP credentials (commerce only) |
| `APPLE_IAP_KEY_ID` | No | — | |
| `APPLE_IAP_KEY` | No | — | |
| `APPLE_IAP_ISSUER` | No | — | |
| `GOOGLE_PLAY_PACKAGE_NAME` | No | — | Google Play credentials (commerce only) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | No | — | |
| `LOG_LEVEL` | No | `debug` (dev) / `info` (prod) | pino log level |

### `apps/web/.env.local`

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:4000` | Backend API base URL |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | No | — | Google OAuth client ID for frontend |

---

## Running Tests

```bash
# All tests (game-core + server integration)
npm test

# Game-core unit tests only
npm test -w packages/game-core

# Server integration tests only
cd apps/server && npx jest

# With coverage
cd apps/server && npx jest --coverage

# Watch mode
cd apps/server && npx jest --watch
```

Server integration tests mock the database at the module level — no real DB connection is needed.

---

## Database

### Migrations

```bash
npm run db:migrate -w apps/server
```

Migrations live in `apps/server/src/db/migrations/*.sql`, applied in lexicographic order, tracked in `schema_migrations`. Each migration runs in a transaction and rolls back on failure.

### Reset for development

```bash
./scripts/reset-db.sh       # drops + recreates DB, runs migrations + seed
```

### Seed data

```bash
npm run db:seed -w apps/server
```

Creates three dev users (alice/bob/charlie with password `password`), three example products (inactive), and 1000 coins per user.

### Schema tables

| Table | Purpose |
|---|---|
| `users` | User accounts |
| `auth_accounts` | Auth providers (password, google, guest) |
| `user_profiles` | Username, display name, avatar |
| `game_rooms` | Room records |
| `game_room_players` | Room membership |
| `game_rounds` | Round records |
| `round_hands` | Dealt cards per round |
| `game_moves` | Action log |
| `round_discards` | Discard history |
| `game_melds` | Table melds per round |
| `game_meld_cards` | Cards in each meld |
| `game_scores` | Final scores per round |
| `products` | Purchasable products |
| `product_prices` | Per-platform pricing |
| `orders` | Purchase intents |
| `payments` | Confirmed captures |
| `entitlements` | Granted access rights |
| `user_inventory` | Owned cosmetic items |
| `wallet_balances` | Virtual currency balance |
| `wallet_transactions` | Currency ledger |

---

## Project Structure

```
calash/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── app.ts              ← Express app factory (used in tests)
│   │   │   ├── index.ts            ← Entry point (starts HTTP server)
│   │   │   ├── config/             ← Env var validation
│   │   │   ├── db/
│   │   │   │   ├── index.ts        ← pg Pool singleton
│   │   │   │   ├── migrate.ts      ← Migration runner
│   │   │   │   ├── seed.ts         ← Dev seed data
│   │   │   │   ├── migrations/     ← SQL migration files
│   │   │   │   └── repositories/   ← Domain repositories
│   │   │   ├── middleware/         ← auth, errorHandler
│   │   │   ├── routes/             ← REST route handlers
│   │   │   ├── services/           ← Entitlements, payment providers
│   │   │   ├── sockets/            ← Socket.IO server + handlers
│   │   │   └── store/              ← In-memory RoomStore
│   │   ├── __tests__/              ← Integration tests
│   │   ├── jest.config.cjs
│   │   └── tsconfig.test.json
│   └── web/
│       └── src/app/                ← Next.js App Router pages
└── packages/
    ├── shared/src/                 ← Shared TypeScript types
    └── game-core/src/              ← Pure game logic + unit tests
```

---

## Adding Features

### New REST route

1. Create `apps/server/src/routes/myfeature.ts`
2. Export a `Router` with route handlers
3. Import and register in `apps/server/src/routes/index.ts`
4. Use `requireAuth` middleware for protected routes
5. Use Zod `safeParse` (or `parse` + let errors bubble to `errorHandler`) for input validation
6. Write integration tests in `apps/server/src/__tests__/myfeature.test.ts`

### New Socket.IO event

1. Add the event type to `packages/shared/src/types/events.ts`
2. Add a handler in `apps/server/src/sockets/handlers/`
3. Register the handler in `apps/server/src/sockets/index.ts`

### New DB migration

Create `apps/server/src/db/migrations/NNN_description.sql` (NNN = next number). The runner applies migrations in alphabetical order.

### New payment provider

See [docs/MONETIZATION.md § Adding a new payment provider](docs/MONETIZATION.md#8-adding-a-new-payment-provider).

---

## Known Limitations

| Limitation | Impact | Planned fix |
|---|---|---|
| In-memory RoomStore | Server restart ends all active games; no horizontal scaling | Redis-backed store (Phase 2) |
| No admin role enforcement | Any authenticated user can call admin commerce routes | Role middleware (Phase 2) |
| No token revocation | Stolen JWTs are valid until expiry | Revocation list table (Phase 2) |
| No email verification | Anyone can register with any email | Email provider integration |
| Webhook reconciliation is a stub | Subscription renewals/cancellations not processed | Implement in `commerce.ts` webhook handler |
| No frontend tests | Next.js App Router + context mocking is complex | Deferred; see below |

### Frontend testing notes

The web app uses Next.js 14 App Router with `'use client'` components and a custom `useAuth()` context. Setting up Jest for this requires:
- `jest-environment-jsdom`
- Mocking `next/navigation` (useRouter, usePathname)
- Mocking `@react-oauth/google` (GoogleLogin)
- Providing an `AuthContext` wrapper

Recommended alternative: use Playwright for end-to-end tests against the running dev server.

---

## Future Work Roadmap

### Phase 2 (Scaling)
- Redis RoomStore for multi-instance deployment
- Admin role middleware
- Token revocation
- Email verification

### Phase 3 (Commerce)
- Enable `COMMERCE_ENABLED=true`
- Configure PayPal / Apple / Google credentials
- Implement webhook reconciliation logic
- Activate products via database update

### Phase 4 (Mobile)
See [docs/MOBILE.md](docs/MOBILE.md) for the full React Native integration plan.
