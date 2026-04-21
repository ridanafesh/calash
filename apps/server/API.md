# Calash Server — API Reference

All REST responses use the envelope:
```json
{ "success": true,  "data": <payload> }
{ "success": false, "error": { "code": "STRING", "message": "Human-readable text" } }
```

Authentication uses **Bearer JWT** in the `Authorization` header for REST and
`socket.handshake.auth.token` for Socket.IO.

---

## REST Endpoints

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | ✗ | Server liveness check |

---

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | ✗ | Register with email + password |
| POST | `/api/auth/login` | ✗ | Login, returns JWT |
| POST | `/api/auth/google` | ✗ | Google OAuth sign-in |
| POST | `/api/auth/guest` | ✗ | Create anonymous guest session |
| POST | `/api/auth/upgrade/password` | ✓ Guest | Upgrade guest with email+password |
| POST | `/api/auth/upgrade/google` | ✓ Guest | Upgrade guest with Google |
| POST | `/api/auth/refresh` | ✓ | Refresh JWT |

---

### Profile

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/profile` | ✓ | Get own profile |
| PATCH | `/api/profile` | ✓ | Update displayName / avatarUrl |

---

### Rooms

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/rooms` | ✓ | Create a new lobby room |
| GET | `/api/rooms` | ✓ | List open (lobby) rooms |
| GET | `/api/rooms/:id` | ✓ | Get room by UUID |
| GET | `/api/rooms/join/:code` | ✓ | Look up room by 6-char invite code |

#### POST /api/rooms

**Body:**
```json
{ "maxPlayers": 4 }
```
`maxPlayers` must be 2–4 (default 4).

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "code": "AB3K7Z",
    "hostUserId": "uuid",
    "status": "lobby",
    "maxPlayers": 4,
    "players": [
      { "userId": "uuid", "displayName": "Alice", "isReady": false, "isConnected": false }
    ],
    "currentRound": 0
  }
}
```

**Errors:**
- `409 ALREADY_IN_ROOM` — caller already has an active room.

#### GET /api/rooms/join/:code

Returns the room matching the 6-char invite code so the client can get
the `id` before calling the socket event `room:join`.

---

## Socket.IO Events

Connect with:
```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:4000', {
  auth: { token: '<JWT>' },
});
```

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `room:create` | `{ maxPlayers: number }` | Create a lobby room |
| `room:join` | `roomId: string` | Join room by UUID |
| `room:join-by-code` | `code: string` | Join room by 6-char invite code |
| `room:leave` | — | Leave current room (lobby only) |
| `room:ready` | — | Toggle own ready state |
| `game:action` | `TurnAction` | Submit a game turn action |

#### TurnAction union

```ts
// Draw from the face-down deck
{ type: 'draw-from-deck' }

// Take from the discard pile
{ type: 'take-from-discard', count: number, returnCardFromHand?: Card }

// Go down (open) — first melds on the table
{ type: 'go-down', melds: Array<{ type: 'sequence'|'set', cards: Card[] }> }

// Add cards to an existing meld
{ type: 'add-to-meld', meldId: string, cards: Card[] }

// Place a new meld (after already going down)
{ type: 'add-new-meld', meld: { type: 'sequence'|'set', cards: Card[] } }

// Discard a card and end your turn
{ type: 'discard', card: Card }
```

---

### Server → Client

| Event | Payload | When |
|-------|---------|------|
| `room:updated` | `GameRoom` | Room state changes (join, leave, ready, start, finish) |
| `room:error` | `{ code, message }` | Any rejected action |
| `game:hand` | `Card[]` | Private hand sent to each player after the round starts and after every action that changes their hand |
| `game:state` | `RoundStateView` | Broadcast after every turn action; contains public state (no hidden deck, no other players' hands) |
| `game:round-result` | `RoundResult` | Broadcast when a round ends |
| `game:scores` | `GameScore[]` | Cumulative scores after a round ends |
| `game:finished` | `{ playerId, finalScore }` | Broadcast when a player reaches 1 000 points |

---

### Server-authoritative rules

The server is **the sole source of truth** for:

| Data | Enforcement |
|------|-------------|
| Whose turn it is | `applyTurnAction` rejects if `playerId ≠ currentTurnPlayerId` |
| Card contents of each hand | Stored server-side; client receives their own hand via `game:hand` only |
| Discard pile | Maintained in `RoundState.discardPile`; sent in every `game:state` |
| Melds on the table | Stored in `RoundState.playerStates[id].melds`; sent in every `game:state` |
| Go-down eligibility | Validated by `validateGoDown` in game-core |
| Discard-then-go-down prohibition | `didTakeFromDiscardThisTurn` flag checked in game-core |

Any action that fails validation returns `room:error` and the state is unchanged.

---

### Reconnect behaviour

When a client reconnects (fresh socket, same JWT):

1. The JWT middleware resolves `playerId` from the token.
2. `restorePlayerToRoom` checks the in-memory store (or DB) for an active room.
3. If found, the socket is rejoined to the Socket.IO room channel.
4. The server emits `room:updated`, `game:state` (if in-progress), and `game:hand` (private).
5. The client resumes without any extra event required.

Alternatively, the client can re-emit `room:join` with the known `roomId` after reconnecting.

---

### Error codes

| Code | Meaning |
|------|---------|
| `ALREADY_IN_ROOM` | Player is already in an active room |
| `ROOM_NOT_FOUND` | No room with that ID or code |
| `ROOM_FULL` | Room has reached `maxPlayers` |
| `GAME_IN_PROGRESS` | Cannot join a room that has started |
| `GAME_ALREADY_STARTED` | Cannot change ready state after start |
| `CANNOT_LEAVE` | Cannot leave during an active game |
| `NOT_IN_ROOM` | Player has no active room |
| `NO_ACTIVE_GAME` | No round is currently in progress |
| `INVALID_ACTION` | Game-core rejected the turn action (message has details) |
| `INVALID_MAX_PLAYERS` | `maxPlayers` outside 2–4 |
| `INTERNAL_ERROR` | Unexpected server error |
