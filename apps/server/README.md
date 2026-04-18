# @calash/server

Node.js + Express + Socket.IO backend for the Calash card game platform.

## Stack

- **Runtime**: Node.js 20+
- **Framework**: Express 4
- **Realtime**: Socket.IO 4
- **Database**: PostgreSQL (via `pg`)
- **Auth**: JWT (`jsonwebtoken`) + bcrypt
- **Validation**: Zod

## Getting started

```bash
# 1. Copy environment variables
cp .env.example .env
# Edit .env with your values

# 2. Start PostgreSQL (Docker example)
docker run -d --name calash-pg \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=calash \
  -p 5432:5432 postgres:16

# 3. Run migrations
psql $DATABASE_URL < src/db/schema.sql

# 4. Start development server
npm run dev -w apps/server
```

## Environment variables

See `.env.example` for all available options.

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWTs (keep long & random) |
| `PORT` | HTTP port (default `4000`) |
| `CORS_ORIGIN` | Allowed frontend origin |

## API routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check (includes DB connectivity) |
| POST | `/api/auth/register` | Register a new player |
| POST | `/api/auth/login` | Login and receive JWT |

## Socket.IO events

Authentication: pass `{ token: "<jwt>" }` in `socket.handshake.auth`.

| Direction | Event | Description |
|---|---|---|
| Client → Server | `room:create` | Create a new game room |
| Client → Server | `room:join` | Join an existing room |
| Client → Server | `room:leave` | Leave the current room |
| Client → Server | `room:ready` | Signal ready to start |
| Client → Server | `game:action` | Submit a game action |
| Server → Client | `room:updated` | Room state changed |
| Server → Client | `game:started` | Game has begun |
| Server → Client | `game:state` | Current game state |
| Server → Client | `game:finished` | Game over with result |
