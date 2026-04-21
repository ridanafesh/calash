/**
 * Apple IAP (StoreKit) provider stub.
 *
 * Disabled until Apple App Store Connect credentials are configured.
 * Set COMMERCE_ENABLED=true and APPLE_BUNDLE_ID / APPLE_SHARED_SECRET
 * (sandbox) or APPLE_IAP_KEY_ID / APPLE_IAP_KEY / APPLE_IAP_ISSUER
 * (production App Store Server API) to activate.
 *
 * Real implementation steps:
 *   1. createPaymentIntent is a no-op — StoreKit fetches products directly
 *   2. verifyAndCapture: POST to App Store Server API /inApps/v1/transactions/verify
 *      OR use the legacy verifyReceipt endpoint for older clients
 *   3. refund: initiate via App Store Connect API or handle automatically
 *      through REFUND webhook
 *   4. handleWebhook: verify JWS-signed App Store Server Notifications
 */

import type {
  PaymentProvider,
  CreatePaymentIntentParams,
  PaymentIntentResult,
  VerifyParams,
  VerifyResult,
  RefundParams,
  RefundResult,
  WebhookEvent,
} from './types.js';

export class AppleProvider implements PaymentProvider {
  readonly name = 'apple' as const;
  readonly platform = 'ios_iap' as const;
  readonly enabled = false;

  async createPaymentIntent(_params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    // StoreKit fetches products directly; no server-side intent needed.
    // Return a no-op token so the interface contract is satisfied.
    throw new Error('Apple IAP provider is not enabled');
  }

  async verifyAndCapture(_params: VerifyParams): Promise<VerifyResult> {
    throw new Error('Apple IAP provider is not enabled');
  }

  async refund(_params: RefundParams): Promise<RefundResult> {
    throw new Error('Apple IAP provider is not enabled');
  }

  async handleWebhook(_payload: unknown, _headers: Record<string, string>): Promise<WebhookEvent> {
    throw new Error('Apple IAP provider is not enabled');
  }
}
