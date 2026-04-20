# Monetization Architecture

This document covers the domain model, purchase flow, entitlement system,
wallet abstraction, and the process for integrating a new payment provider.

> **MVP status**: All commerce routes return `503 Service Unavailable` until
> `COMMERCE_ENABLED=true` is set.  No payment UI is exposed to players.
> The tables, services, and provider stubs are fully wired — only the
> feature gate needs to be lifted when credentials are ready.

---

## Table of Contents

1. [Domain model](#1-domain-model)
2. [Purchase flow](#2-purchase-flow)
3. [Entitlement system](#3-entitlement-system)
4. [Wallet / virtual currency](#4-wallet--virtual-currency)
5. [Product catalogue](#5-product-catalogue)
6. [Platform mapping](#6-platform-mapping)
7. [Registered providers (MVP)](#7-registered-providers-mvp)
8. [Adding a new payment provider](#8-adding-a-new-payment-provider)
9. [Enabling commerce for the first time](#9-enabling-commerce-for-the-first-time)
10. [Admin operations](#10-admin-operations)

---

## 1. Domain model

```
products
  └── product_prices  (one row per platform: web_paypal / ios_iap / android_iap)

users
  └── orders          (intent to purchase)
        └── payments  (provider-confirmed capture)
  └── entitlements    (source of truth for feature access)
  └── user_inventory  (cosmetic items the user holds)
  └── wallet_balances (virtual currency per currency type)
        └── wallet_transactions  (append-only ledger)
```

### Key invariants

| Rule | Rationale |
|---|---|
| Always check `entitlements`, never `orders` or `payments`, at feature gates | Orders can be pending/failed; payments can be delayed |
| `entitlements.payment_id` uniquely indexes a granted entitlement | Prevents double-granting from duplicate webhooks |
| `wallet_balances.balance >= 0` is enforced by a DB constraint | Prevents overspend even under race conditions |
| `payments.provider_transaction_id` is UNIQUE | Deduplicates provider callbacks |
| All money amounts are integer cents | Avoids floating-point rounding errors |

---

## 2. Purchase flow

```
Client                    Server                      Provider
  │                          │                            │
  ├─POST /commerce/orders────►│  createOrder (pending)     │
  │◄─────────────────────────┤                            │
  │                          │                            │
  ├─POST /payments/intent────►│  getProvider(platform)     │
  │                          ├──createPaymentIntent()─────►│
  │◄──────── clientToken ────┤◄────────────────────────── │
  │                          │  createPayment (pending)    │
  │                          │                            │
  │  [user completes payment in provider SDK]              │
  │                          │                            │
  ├─POST /payments/verify────►│                            │
  │    { paymentId,           │  BEGIN TRANSACTION         │
  │      providerTxId,        ├──verifyAndCapture()────────►│
  │      providerReceipt }    │◄───────────────────────────┤
  │                          │  completePayment (completed)│
  │                          │  grant entitlement          │
  │                          │  COMMIT                     │
  │◄──────── { success } ────┤                            │
```

### Webhook path (async confirmation)

Some providers (especially mobile stores) deliver confirmation via webhook
rather than a synchronous response.  The flow:

```
Provider ──POST /commerce/webhooks/:provider──► Server
                                                handleWebhook() → WebhookEvent
                                                (TODO: route event to reconciliation logic)
```

The `handleWebhook` stub returns a normalised `WebhookEvent`.  The TODO in
`commerce.ts` is where subscription renewals, refunds, and cancellations
should update `orders`, `payments`, and `entitlements` accordingly.

---

## 3. Entitlement system

`EntitlementsService` is the **only** place that should be consulted at
runtime to decide whether a user can access a feature.

```typescript
// Check access
const hasPass = await entitlements.hasEntitlement(userId, PREMIUM_PRODUCT_ID);

// Grant after payment
await entitlements.grant({
  userId,
  productId,
  source: 'purchase',
  paymentId,          // links the entitlement to the verified payment
  expiresAt,          // omit for permanent; set for subscriptions
});

// Revoke (e.g. subscription cancelled)
await entitlements.revoke(userId, productId);
```

### Entitlement sources

| Source | When used |
|---|---|
| `purchase` | One-time verified payment |
| `subscription` | Subscription created or renewed via webhook |
| `promo` | Promotional grant — no payment required |
| `admin` | Support tooling via `POST /commerce/admin/entitlements/grant` |

---

## 4. Wallet / virtual currency

`wallet_balances` holds per-user in-game currency (default: `coins`).
This is distinct from real money — it is credited when a `currency_pack`
is purchased and debited when spent in-game.

```
wallet_balances   — current balance snapshot
wallet_transactions — append-only ledger (kind: credit | debit)
```

```typescript
// Credit after currency_pack purchase
await commerce.creditWallet({ userId, amount: 500, orderId, description: 'Coin pack x500' });

// Debit (future — in-game spend)
await commerce.debitWallet({ userId, amount: 50, description: 'Card back unlock' });
```

Debit throws `'Insufficient wallet balance'` if the balance would go
negative.  The DB `CHECK (balance >= 0)` enforces this at the storage layer
as a safety net.

New currency types (e.g. `gems`) are added by inserting a new row into
`wallet_balances` with a different `currency` value — no schema change needed.

---

## 5. Product catalogue

Products are managed in the database.  The seed (`npm run db:seed`) inserts
three example products (all inactive):

| Seed ID | Name | Type | Platforms | Price (USD) |
|---|---|---|---|---|
| `30000000-…-0001` | Classic Card Pack | `cosmetic` | web, iOS, Android | $2.99 |
| `30000000-…-0002` | Neon Card Pack | `cosmetic` | web, iOS, Android | $2.99 |
| `30000000-…-0003` | Calash Premium Monthly | `subscription` | web, iOS, Android | $4.99/mo |

To expose a product:
1. `UPDATE products SET is_active = true WHERE id = '…';`
2. `UPDATE product_prices SET is_active = true WHERE product_id = '…';`

`metadata_json` on `products` can hold any cosmetic-specific data the client
needs (card back image key, frame asset path, etc.).

---

## 6. Platform mapping

| Platform value | Provider | SDK |
|---|---|---|
| `web_paypal` | `PayPalProvider` | PayPal JS SDK (`@paypal/paypal-js`) |
| `ios_iap` | `AppleProvider` | StoreKit / `@revenuecat/purchases-capacitor` |
| `android_iap` | `GoogleProvider` | Google Play Billing Library |

`product_prices.external_product_id` carries the store-specific SKU:

- **Apple**: App Store Connect product identifier (e.g. `com.calash.cosmetic.classic`)
- **Google**: Google Play product ID (same namespace convention)
- **PayPal**: PayPal subscription plan ID (for subscriptions); omit for one-time

---

## 7. Registered providers (MVP)

All three providers are registered and disabled.  Use
`GET /api/commerce/admin/providers` to inspect their status.

```
PayPalProvider  — platform: web_paypal   — enabled: false
AppleProvider   — platform: ios_iap      — enabled: false
GoogleProvider  — platform: android_iap  — enabled: false
```

Credentials needed before enabling:

| Provider | Required env vars |
|---|---|
| PayPal | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` |
| Apple  | `APPLE_BUNDLE_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_KEY`, `APPLE_IAP_ISSUER` |
| Google | `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_SERVICE_ACCOUNT_JSON` |

---

## 8. Adding a new payment provider

Follow these steps to add a provider (e.g. Stripe for web):

### Step 1 — Create the provider file

```
apps/server/src/services/payments/stripe.provider.ts
```

Implement the `PaymentProvider` interface from `./types.ts`:

```typescript
import type {
  PaymentProvider, CreatePaymentIntentParams, PaymentIntentResult,
  VerifyParams, VerifyResult, RefundParams, RefundResult, WebhookEvent,
} from './types.js';

export class StripeProvider implements PaymentProvider {
  readonly name    = 'stripe'    as const;  // new ProviderName value
  readonly platform = 'web_stripe' as const; // new PaymentPlatform value
  readonly enabled  = false;                 // flip to true when ready

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    // 1. Create a PaymentIntent via the Stripe API
    // 2. Return { clientToken: paymentIntent.client_secret }
    throw new Error('Stripe provider is not enabled');
  }

  async verifyAndCapture(params: VerifyParams): Promise<VerifyResult> {
    // Retrieve and confirm the PaymentIntent, check amount matches
    throw new Error('Stripe provider is not enabled');
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    // Call stripe.refunds.create(...)
    throw new Error('Stripe provider is not enabled');
  }

  async handleWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookEvent> {
    // Verify with stripe.webhooks.constructEvent(payload, headers['stripe-signature'], secret)
    // Map Stripe event types to WebhookEventType
    throw new Error('Stripe provider is not enabled');
  }
}
```

### Step 2 — Extend the type definitions

In `apps/server/src/services/payments/types.ts`, add the new values:

```typescript
export type PaymentPlatform = 'web_paypal' | 'ios_iap' | 'android_iap' | 'web_stripe';
export type ProviderName    = 'paypal' | 'apple' | 'google' | 'stripe';
```

### Step 3 — Register the provider

In `apps/server/src/services/payments/index.ts`:

```typescript
import { StripeProvider } from './stripe.provider.js';

const providers: PaymentProvider[] = [
  new PayPalProvider(),
  new AppleProvider(),
  new GoogleProvider(),
  new StripeProvider(),   // ← add
];
```

### Step 4 — Add a product price row

```sql
INSERT INTO product_prices (product_id, platform, currency, amount_cents, is_active)
VALUES ('<product-uuid>', 'web_stripe', 'USD', 299, false);
```

Set `is_active = true` when the provider credentials are configured.

### Step 5 — (Optional) Extend the payment_provider enum

If the `provider` column on the `payments` table needs to include the new
provider name, add a migration:

```sql
ALTER TYPE payment_provider ADD VALUE 'stripe';
```

### What the framework handles automatically

Once the provider is registered and `enabled = true`, the rest of the
purchase flow (order creation, payment intent, verify-and-capture,
entitlement grant, webhook routing) works without any route changes.

---

## 9. Enabling commerce for the first time

1. Set `COMMERCE_ENABLED=true` in the server environment.
2. Confirm the provider credentials are in place (see table in §7).
3. Flip `enabled = true` in the relevant provider class.
4. Set `is_active = true` on the products and prices you want to sell:
   ```sql
   UPDATE products      SET is_active = true WHERE id = '…';
   UPDATE product_prices SET is_active = true WHERE product_id = '…';
   ```
5. Register webhook URLs in each provider's developer console:
   - PayPal:  `https://<your-domain>/api/commerce/webhooks/paypal`
   - Apple:   `https://<your-domain>/api/commerce/webhooks/apple`
   - Google:  `https://<your-domain>/api/commerce/webhooks/google`
6. Implement the webhook reconciliation logic (the `TODO` comment in
   `apps/server/src/routes/commerce.ts` at the webhook handler).

> **Legal reminder**: player-facing payment UI should not go live until the
> Terms of Service, Privacy Policy, and refund policy cover digital purchases.

---

## 10. Admin operations

All admin routes require authentication.  Role enforcement (admin-only) is
planned for Phase 2.  Current stubs:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/commerce/admin/orders` | List all orders (501 stub) |
| `GET` | `/api/commerce/admin/providers` | Provider registry status |
| `POST` | `/api/commerce/admin/refund` | Issue refund (501 stub) |
| `POST` | `/api/commerce/admin/entitlements/grant` | Manually grant entitlement |
| `DELETE` | `/api/commerce/admin/entitlements/revoke` | Revoke entitlement |
| `POST` | `/api/commerce/admin/wallet/credit` | Credit a user's wallet |

### Manual entitlement grant (support use case)

```bash
curl -X POST /api/commerce/admin/entitlements/grant \
  -H "Authorization: Bearer <admin-jwt>" \
  -d '{"userId": "<user-id>", "productId": "<product-id>"}'
```

This inserts an entitlement with `source = 'admin'` and no `payment_id`.
Use this for:
- Compensating a player after a failed payment that was charged
- Granting access during a promotional period
- Internal QA testing of gated features
