/**
 * Google Play Billing provider stub.
 *
 * Disabled until Google Play developer credentials are configured.
 * Set COMMERCE_ENABLED=true and GOOGLE_PLAY_PACKAGE_NAME /
 * GOOGLE_SERVICE_ACCOUNT_JSON to activate.
 *
 * Real implementation steps:
 *   1. createPaymentIntent: use Google Play Developer API to validate the
 *      product and return its sku; client handles the purchase flow
 *   2. verifyAndCapture: call purchases.products.get or
 *      purchases.subscriptions.get to verify the purchase token
 *      then acknowledge with purchases.products.acknowledge
 *   3. refund: call orders.refund via the Google Play Developer API
 *   4. handleWebhook: parse Pub/Sub push notifications from Google Play
 *      developer notifications topic
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

export class GoogleProvider implements PaymentProvider {
  readonly name = 'google' as const;
  readonly platform = 'android_iap' as const;
  readonly enabled = false;

  async createPaymentIntent(_params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    throw new Error('Google Play provider is not enabled');
  }

  async verifyAndCapture(_params: VerifyParams): Promise<VerifyResult> {
    throw new Error('Google Play provider is not enabled');
  }

  async refund(_params: RefundParams): Promise<RefundResult> {
    throw new Error('Google Play provider is not enabled');
  }

  async handleWebhook(_payload: unknown, _headers: Record<string, string>): Promise<WebhookEvent> {
    throw new Error('Google Play provider is not enabled');
  }
}
