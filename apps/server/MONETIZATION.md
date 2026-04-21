# Monetization Integration Guide

All commerce infrastructure is present but **disabled by default**.
No payment UI exists in the frontend yet.  This document covers what's
built, what's needed to go live, and the overall flow.

---

## Feature flag

```
COMMERCE_ENABLED=true   # set in .env to enable all /api/commerce/* routes
```

Without this variable, every commerce route returns `503 Service Unavailable`.
Live payment credentials are also required per provider (see below).

---

## Architecture overview

```
Frontend
  └── POST /api/commerce/orders        (create order)
  └── POST /api/commerce/payments/intent  (get provider token)
  └── [provider SDK runs in browser / app]
  └── POST /api/commerce/payments/verify  (server captures + grants entitlement)

Providers (server-side)
  PayPalProvider   platform=web_paypal    (disabled)
  AppleProvider    platform=ios_iap       (disabled)
  GoogleProvider   platform=android_iap   (disabled)

Entitlements (source of truth for feature gates)
  └── entitlements table — checked at runtime, not payments/orders
```

---

## Payment flow (all providers)

1. **Create order** `POST /api/commerce/orders`
   - Body: `{ productId, priceId, platform }`
   - Returns: `{ order }` with `order.id`

2. **Create payment intent** `POST /api/commerce/payments/intent`
   - Body: `{ orderId }`
   - Server calls `provider.createPaymentIntent()`
   - Returns: `{ paymentId, clientToken, providerData }`

3. **Run provider SDK on client**
   - PayPal: pass `clientToken` to `paypal.createOrder()` / `paypal.captureOrder()`
   - Apple: StoreKit handles everything; receipt is returned to app
   - Google: Google Play Billing; purchase token is returned to app

4. **Verify & capture** `POST /api/commerce/payments/verify`
   - Body: `{ paymentId, providerTransactionId?, providerReceipt? }`
   - Server calls `provider.verifyAndCapture()`, marks payment `completed`,
     order `paid`, grants entitlement
   - Returns: `{ success, providerTransactionId }`

---

## Provider setup

### PayPal (web_paypal)

Required env vars:
```
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com  # or production URL
```

Implementation in `src/services/payments/paypal.provider.ts`:
- `createPaymentIntent`: `POST /v2/checkout/orders` with `CAPTURE` intent
- `verifyAndCapture`: `POST /v2/checkout/orders/:id/capture`
- `refund`: `POST /v2/payments/captures/:id/refund`
- `handleWebhook`: verify `PayPal-Transmission-Sig` header using
  `POST /v1/notifications/verify-webhook-signature`

### Apple IAP (ios_iap)

Required env vars:
```
APPLE_BUNDLE_ID=com.yourcompany.calash
# App Store Server API (recommended for new apps):
APPLE_IAP_KEY_ID=...
APPLE_IAP_KEY=<private key PEM>
APPLE_IAP_ISSUER=<issuer UUID from App Store Connect>
```

Implementation in `src/services/payments/apple.provider.ts`:
- `createPaymentIntent`: no-op — StoreKit fetches products directly from
  App Store; return `clientToken: ''`
- `verifyAndCapture`: call App Store Server API
  `GET /inApps/v1/transactions/{transactionId}` (or legacy `verifyReceipt`)
- `handleWebhook`: verify JWS-signed App Store Server Notifications (v2);
  decode the `signedPayload` JWT and map notification type to `WebhookEventType`

### Google Play (android_iap)

Required env vars:
```
GOOGLE_PLAY_PACKAGE_NAME=com.yourcompany.calash
GOOGLE_SERVICE_ACCOUNT_JSON=<JSON key for service account with
  androidpublisher scope>
```

Implementation in `src/services/payments/google.provider.ts`:
- `createPaymentIntent`: validate SKU exists; return `clientToken: sku`
- `verifyAndCapture`: call
  `purchases.products.get` (one-time) or `purchases.subscriptions.get`
  then `purchases.products.acknowledge`
- `refund`: `orders.refund` via Google Play Developer API
- `handleWebhook`: parse Pub/Sub JSON push from
  Google Play developer notifications topic; verify message `attributes`

---

## Enabling a provider

1. Set the required env vars above
2. Open `src/services/payments/<provider>.provider.ts`
3. Change `readonly enabled = false` → `readonly enabled = true`
4. Implement the method bodies (replace the `throw new Error(...)` stubs)
5. Set `COMMERCE_ENABLED=true`
6. Set `is_active = true` for the relevant rows in `products` and
   `product_prices`

---

## Entitlements

Entitlements are the **single source of truth** for access control.
Never gate features on `orders` or `payments` tables directly.

```typescript
import { EntitlementsService } from '../services/entitlements.service.js';
const ents = new EntitlementsService(pool);

// Check access
const hasAccess = await ents.hasEntitlement(userId, 'cosmetic_pack_classic');

// List everything a user has
const all = await ents.listEntitlements(userId);
```

`GET /api/commerce/entitlements` returns the current user's active entitlements.

---

## Database tables (migration 003)

| Table | Purpose |
|---|---|
| `products` | Product catalogue |
| `product_prices` | Per-platform prices |
| `orders` | One row per purchase attempt |
| `payments` | Provider transaction records |
| `entitlements` | Active feature grants (source of truth) |
| `user_inventory` | Cosmetic items granted to a user |
| `subscriptions` | Subscription lifecycle tracking |

---

## Admin endpoints

All admin endpoints are stubbed and return `501 Not Implemented`.
Phase 2 should add role-based access control before activating them.

| Route | Purpose |
|---|---|
| `GET /api/commerce/admin/orders` | List all orders |
| `POST /api/commerce/admin/refund` | Issue a refund |
| `POST /api/commerce/admin/entitlements/grant` | Manually grant entitlement |
| `DELETE /api/commerce/admin/entitlements/revoke` | Manually revoke entitlement |

---

## Webhooks

Each provider posts events to:
```
POST /api/commerce/webhooks/<provider-name>
```
e.g. `/api/commerce/webhooks/paypal`

This endpoint does **not** require authentication.  Each provider's
`handleWebhook` implementation must verify the request signature before
returning a `WebhookEvent`.  Unsigned requests must throw an error.

---

## Product catalogue (seed data)

Three products are seeded with `is_active = false`:

| Product | Type | Price |
|---|---|---|
| Classic Card Pack | cosmetic | $2.99 |
| Neon Card Pack | cosmetic | $2.99 |
| Calash Premium Monthly | subscription | $4.99/mo |

All three have prices for `web_paypal`, `ios_iap`, and `android_iap`.
Set `is_active = true` in both `products` and `product_prices` when ready.
