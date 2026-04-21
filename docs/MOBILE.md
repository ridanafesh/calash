# Mobile Integration Guide

This document describes how to add a React Native mobile app (`apps/mobile`) to the Calash monorepo without modifying the server or shared packages.

---

## Architecture fit

The monorepo is designed for mobile from day one:

- **`@calash/shared`** — TypeScript types for players, rooms, game state, socket events, and API contracts. No runtime deps; runs on React Native.
- **`@calash/game-core`** — Pure game logic (deck, validation, scoring). No I/O. Importable in a mobile app for offline UI previews without a server round-trip.
- **`apps/server`** — The same REST + Socket.IO backend serves both web and mobile.
- **Payment stubs** — `AppleProvider` and `GoogleProvider` are already wired in `apps/server/src/services/payments/`. Mobile IAP just needs credentials.

---

## Recommended tech stack

| Layer | Recommendation |
|---|---|
| Framework | Expo (managed or bare) for fastest start; bare React Native for full native control |
| Navigation | React Navigation 6 |
| State | Zustand (same as web, zero-dep) or React Context |
| HTTP | `fetch` / `axios` with the same API contract as the web |
| WebSockets | `socket.io-client` (same package as web) |
| Payments | `@revenuecat/purchases-capacitor` or `react-native-iap` |
| Auth | Expo SecureStore for JWT storage; `@react-native-google-signin/google-signin` for Google OAuth |

---

## Adding `apps/mobile`

### Step 1 — Scaffold the app

```bash
# From the repo root
npx create-expo-app apps/mobile --template blank-typescript
```

Add to the root `package.json` workspaces array:
```json
"workspaces": ["apps/*", "packages/*"]
```

### Step 2 — Add shared dependencies

```json
// apps/mobile/package.json
"dependencies": {
  "@calash/shared": "*",
  "@calash/game-core": "*",
  "socket.io-client": "^4.7.5",
  "zod": "^3.23.4"
}
```

Run `npm install` from the repo root.

### Step 3 — Configure Metro for workspaces

Create `apps/mobile/metro.config.js`:

```javascript
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
```

### Step 4 — Configure TypeScript paths

Create `apps/mobile/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "paths": {
      "@calash/shared": ["../../packages/shared/src/index.ts"],
      "@calash/game-core": ["../../packages/game-core/src/index.ts"]
    }
  }
}
```

---

## Socket.IO connection

The socket client is identical to the web:

```typescript
// apps/mobile/src/lib/socket.ts
import { io } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@calash/shared';

export const socket = io(process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:4000', {
  autoConnect: false,
  auth: (cb) => cb({ token: getStoredToken() }),
});
```

---

## Authentication

JWTs are stored in Expo SecureStore:

```typescript
import * as SecureStore from 'expo-secure-store';

export async function storeToken(token: string) {
  await SecureStore.setItemAsync('calash_jwt', token);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync('calash_jwt');
}
```

The same auth endpoints (`/api/auth/login`, `/api/auth/register`, `/api/auth/guest`, `/api/auth/google`) work for mobile — no server changes needed.

---

## In-App Purchases

### Apple (iOS)

1. Set up products in App Store Connect with product IDs matching `product_prices.external_product_id` in the DB.
2. Set the server env vars:
   ```
   APPLE_BUNDLE_ID=com.yourcompany.calash
   APPLE_IAP_KEY_ID=...
   APPLE_IAP_KEY=...
   APPLE_IAP_ISSUER=...
   ```
3. Flip `enabled = true` in `apps/server/src/services/payments/apple.provider.ts`.
4. On the mobile side, use `@revenuecat/purchases-capacitor` or `react-native-iap` to trigger the StoreKit purchase flow and obtain the receipt.
5. POST the receipt to `/api/commerce/payments/verify`.

### Google (Android)

1. Set up products in Google Play Console.
2. Set:
   ```
   GOOGLE_PLAY_PACKAGE_NAME=com.yourcompany.calash
   GOOGLE_SERVICE_ACCOUNT_JSON=...
   ```
3. Flip `enabled = true` in `apps/server/src/services/payments/google.provider.ts`.
4. Use `react-native-iap` to trigger the Google Play Billing flow and obtain a purchase token.
5. POST to `/api/commerce/payments/verify`.

See [MONETIZATION.md](MONETIZATION.md) for the full purchase flow.

---

## Push notifications

Not yet wired. Plan:
- Use Expo Notifications or Firebase Cloud Messaging
- Store device tokens in a new `device_tokens` table linked to `users`
- Send via the server when a game event occurs (e.g. "it's your turn")

---

## What does NOT need to change in the server

- All REST routes work identically for mobile
- Socket.IO events and payloads are defined in `@calash/shared` and work for any client
- Payment provider implementations in `apps/server/src/services/payments/` only need credentials and `enabled = true`
- The `@calash/game-core` package runs identically on mobile for offline previews
