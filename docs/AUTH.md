# Authentication

## Overview

Calash uses **JWT-based stateless authentication** with three sign-in methods and an optional guest mode. All tokens are signed with a shared secret and expire server-side; no session store is required.

## Sign-in methods

| Method | Provider | Who it's for |
|--------|----------|--------------|
| Email + password | `password` | Direct registration |
| Google | `google` | Web (OAuth ID token flow) |
| Guest | `guest` | Try-before-you-sign-up |

Apple Sign-In (planned for the iOS app) will use the same `auth_accounts` table with `provider = 'apple'` and requires no schema changes.

## Token format

```
JWT payload: { userId: string, isGuest: boolean }
```

- Regular accounts expire after **7 days** (`JWT_EXPIRES_IN` env var).
- Guest tokens expire after **24 hours** (`JWT_GUEST_EXPIRES_IN` env var).
- Tokens are sent as `Authorization: Bearer <token>` on every API request.
- The web client stores the token in `localStorage`.

## Google sign-in flow (web)

```
Browser                           Server                         Google
  │                                 │                              │
  │  Click "Sign in with Google"    │                              │
  ├─────────────────────────────────┼──────────────────────────────►
  │                                 │      OAuth consent screen    │
  │◄────────────────────────────────┼──────────────────────────────┤
  │  credential (ID token)          │                              │
  │                                 │                              │
  │  POST /api/auth/google          │                              │
  │  { credential }                 │                              │
  ├────────────────────────────────►│                              │
  │                                 │  verifyIdToken()             │
  │                                 ├─────────────────────────────►│
  │                                 │◄─────────────────────────────┤
  │                                 │  { sub, email, name, picture }
  │                                 │                              │
  │                                 │  find or create user in DB   │
  │                                 │                              │
  │◄────────────────────────────────┤                              │
  │  { token, user }                │                              │
```

The frontend uses `@react-oauth/google`'s `<GoogleLogin>` component. Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the web app's env and `GOOGLE_CLIENT_ID` on the server. If `GOOGLE_CLIENT_ID` is not set, the Google button is rendered but the backend returns `501 GOOGLE_DISABLED`.

## Guest flow

```
POST /api/auth/guest
→ creates user (no email) + auth_accounts(provider='guest') + player_profiles(username='guest_xxxxxx')
→ returns JWT with isGuest=true, 24h expiry
```

A guest can play fully but their account is ephemeral. The lobby shows a banner prompting them to create a permanent account.

## Guest upgrade

A guest can link a permanent identity without losing their game history (same `user_id`):

```
POST /api/auth/upgrade/google   { credential }    → links Google, sets isGuest=false
POST /api/auth/upgrade/password { email, password } → adds password auth, sets isGuest=false
```

Both endpoints require a valid guest JWT. After upgrading, a new non-guest token is returned and the client replaces the stored token.

## Account model

```
users (id, email?)
  └── auth_accounts (provider, provider_account_id, password_hash)
        providers: 'password' | 'google' | 'apple' | 'guest'
  └── player_profiles (username, display_name, avatar_url)
```

One `users` row is the identity anchor. Multiple `auth_accounts` rows allow a single user to sign in via multiple providers. `player_profiles` holds public display data and is independent of auth.

## Route protection

| Middleware | What it checks |
|------------|---------------|
| `requireAuth` | Valid JWT (any, including guests) |
| `requireFullAccount` | Valid JWT + `isGuest === false` |

Apply `requireAuth` to all game routes. Apply `requireFullAccount` to any future purchase/payment routes.

## Web auth state

`AuthProvider` (`src/lib/auth-context.tsx`) wraps the entire app and provides:

- `user` — the current `UserProfile` or `null`
- `token` — the raw JWT or `null`
- `isLoading` — true while the session is being restored from `localStorage`
- `loginWithPassword / loginWithGoogle / loginAsGuest / logout / refreshUser`

On mount, the provider reads the stored token and validates it with `GET /api/auth/me`. If the token is expired or invalid, the session is cleared.

`AuthGuard` (`src/lib/auth-guard.tsx`) wraps pages that require authentication. It renders a loading state while the session resolves, then either shows the page or redirects to `/auth/login`.

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Email + password registration |
| POST | `/api/auth/login` | — | Email + password login |
| POST | `/api/auth/google` | — | Google ID token sign-in |
| POST | `/api/auth/guest` | — | Create guest session |
| GET | `/api/auth/me` | required | Current user |
| POST | `/api/auth/logout` | required | Invalidate (client clears token) |
| POST | `/api/auth/upgrade/password` | guest | Upgrade guest → password |
| POST | `/api/auth/upgrade/google` | guest | Upgrade guest → Google |
| GET | `/api/profile` | required | Get profile |
| PUT | `/api/profile` | required | Update display name / avatar |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | yes | Signing secret (min 32 random chars in production) |
| `JWT_EXPIRES_IN` | no | Regular token TTL, default `7d` |
| `JWT_GUEST_EXPIRES_IN` | no | Guest token TTL, default `24h` |
| `GOOGLE_CLIENT_ID` | no | Enables Google sign-in |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | no | Must match above (exposed to browser) |
