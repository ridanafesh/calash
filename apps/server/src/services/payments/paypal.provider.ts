/**
 * PayPal provider stub.
 *
 * Disabled until a PayPal developer account and OAuth credentials are
 * configured.  Set COMMERCE_ENABLED=true and PAYPAL_CLIENT_ID /
 * PAYPAL_CLIENT_SECRET to activate.
 *
 * Real implementation steps:
 *   1. POST /v1/oauth2/token to get a bearer token
 *   2. POST /v2/checkout/orders to create an order (createPaymentIntent)
 *   3. POST /v2/checkout/orders/:id/capture (verifyAndCapture)
 *   4. POST /v2/payments/captures/:id/refund (refund)
 *   5. Verify webhook signature with PayPal-Transmission-* headers
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

export class PayPalProvider implements PaymentProvider {
  readonly name = 'paypal' as const;
  readonly platform = 'web_paypal' as const;
  readonly enabled = false;

  async createPaymentIntent(_params: CreatePaymentIntentParams): Promise<PaymentIntentResult> {
    throw new Error('PayPal provider is not enabled');
  }

  async verifyAndCapture(_params: VerifyParams): Promise<VerifyResult> {
    throw new Error('PayPal provider is not enabled');
  }

  async refund(_params: RefundParams): Promise<RefundResult> {
    throw new Error('PayPal provider is not enabled');
  }

  async handleWebhook(_payload: unknown, _headers: Record<string, string>): Promise<WebhookEvent> {
    throw new Error('PayPal provider is not enabled');
  }
}
