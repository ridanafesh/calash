/**
 * Payment provider registry.
 *
 * Providers are registered here and looked up by PaymentPlatform.
 * All providers are disabled by default (enabled: false).
 * No provider SDK code executes until a provider is enabled and a method
 * is actually called.
 */

import { PayPalProvider } from './paypal.provider.js';
import { AppleProvider } from './apple.provider.js';
import { GoogleProvider } from './google.provider.js';
import type { PaymentProvider, PaymentPlatform } from './types.js';

export type { PaymentProvider, PaymentPlatform };
export type {
  CreatePaymentIntentParams,
  PaymentIntentResult,
  VerifyParams,
  VerifyResult,
  RefundParams,
  RefundResult,
  WebhookEvent,
  WebhookEventType,
  ProviderName,
} from './types.js';

const providers: PaymentProvider[] = [
  new PayPalProvider(),
  new AppleProvider(),
  new GoogleProvider(),
];

/** Returns the provider for the given platform, or null if not found / disabled. */
export function getProvider(platform: PaymentPlatform): PaymentProvider | null {
  return providers.find((p) => p.platform === platform && p.enabled) ?? null;
}

/** Returns all registered providers (enabled or not) — used by admin endpoints. */
export function getAllProviders(): PaymentProvider[] {
  return [...providers];
}
