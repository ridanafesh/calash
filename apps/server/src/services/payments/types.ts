/**
 * Payment provider abstraction.
 *
 * Every payment provider (PayPal, Apple IAP, Google Play) implements the
 * PaymentProvider interface.  The rest of the application only depends on
 * this interface — no provider SDK types leak outside their own module.
 *
 * Adding a new provider:
 *   1. Create a new file, e.g. src/services/payments/stripe.provider.ts
 *   2. Implement the PaymentProvider interface
 *   3. Register it in src/services/payments/index.ts
 *   4. Add the new platform value to PaymentPlatform
 *   5. Add a matching product_prices row with the new platform identifier
 *
 * Platform → Provider mapping:
 *   web_paypal    → PayPalProvider   (web checkout)
 *   ios_iap       → AppleProvider    (StoreKit / In-App Purchase)
 *   android_iap   → GoogleProvider   (Google Play Billing)
 */

// ─── Platform / provider identifiers ────────────────────────────────────────

/** Matches the `platform` column in product_prices and orders. */
export type PaymentPlatform = 'web_paypal' | 'ios_iap' | 'android_iap';

/** Matches the `provider` enum in the payments table. */
export type ProviderName = 'paypal' | 'apple' | 'google';

// ─── Input / output types ────────────────────────────────────────────────────

export interface CreatePaymentIntentParams {
  orderId: string;
  userId: string;
  amountCents: number;
  currency: string;
  /** Internal product ID — used for line-item descriptions. */
  productId: string;
  productName: string;
  /** Arbitrary k/v pairs forwarded to the provider as order metadata. */
  metadata?: Record<string, string>;
}

export interface PaymentIntentResult {
  /**
   * Opaque token passed verbatim to the frontend SDK.
   * - PayPal: order ID (used with PayPal JS SDK `createOrder`)
   * - Apple: not used (SKProduct is fetched directly by StoreKit)
   * - Google: purchase token
   */
  clientToken: string;
  /** Provider-specific fields the client may need to launch the payment UI. */
  providerData?: Record<string, unknown>;
}

export interface VerifyParams {
  orderId: string;
  userId: string;
  /** PayPal: capture ID returned after approval. Mobile: nonce/token. */
  providerTransactionId?: string;
  /**
   * Apple/Google: raw receipt or purchase token for server-side verification.
   * PayPal: not used (server-side capture handles everything).
   */
  providerReceipt?: unknown;
}

export interface VerifyResult {
  success: boolean;
  /** Canonical transaction ID to store in payments.provider_transaction_id. */
  providerTransactionId: string;
  /** Verified amount (should match order; mismatch → reject). */
  amountCents: number;
  currency: string;
  /** Raw provider response — stored in payments.provider_receipt_json for audits. */
  rawResponse: Record<string, unknown>;
}

export interface RefundParams {
  paymentId: string;
  providerTransactionId: string;
  /** Omit for full refund. */
  amountCents?: number;
  reason?: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
}

/**
 * Normalised webhook event.  Each provider's raw webhook is translated into
 * one of these types by the provider's handleWebhook implementation.
 */
export type WebhookEventType =
  | 'payment.completed'
  | 'payment.refunded'
  | 'subscription.renewed'
  | 'subscription.cancelled'
  | 'unknown';

export interface WebhookEvent {
  type: WebhookEventType;
  /** Our internal order ID if it can be resolved from the webhook payload. */
  orderId?: string;
  providerTransactionId?: string;
  metadata?: Record<string, unknown>;
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly platform: PaymentPlatform;
  /** False in MVP — all providers start disabled. */
  readonly enabled: boolean;

  /**
   * Create a provider-side payment intent / order.
   * Returns a client token the frontend SDK needs to launch its payment UI.
   */
  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntentResult>;

  /**
   * Verify and capture a payment after the client-side SDK completes.
   * Called by POST /api/commerce/payments/verify.
   * Must be idempotent — provider may deliver duplicate webhooks.
   */
  verifyAndCapture(params: VerifyParams): Promise<VerifyResult>;

  /**
   * Issue a (partial or full) refund for a completed payment.
   */
  refund(params: RefundParams): Promise<RefundResult>;

  /**
   * Parse and validate an inbound webhook from the provider.
   * The route handler passes the raw body and request headers.
   * Throws if the signature is invalid.
   */
  handleWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookEvent>;
}
