/**
 * Entitlement service — single source of truth for what a user can access.
 *
 * Entitlements are written when a payment is verified or a subscription
 * renews, and revoked when a subscription lapses.  Feature gates MUST
 * query this table, not the payments or orders tables directly.
 *
 * source values:
 *   'purchase'     — granted after a successful payment (payment_id set)
 *   'subscription' — granted/renewed by a subscription webhook
 *   'promo'        — manual promotional grant (no payment)
 *   'admin'        — granted by support tooling
 *
 * Seed product IDs (see seed.ts):
 *   30000000-0000-0000-0000-000000000001  — Classic Card Pack (cosmetic)
 *   30000000-0000-0000-0000-000000000002  — Neon Card Pack (cosmetic)
 *   30000000-0000-0000-0000-000000000003  — Calash Premium Monthly (subscription)
 */

import type { Pool } from 'pg';

export interface EntitlementRow {
  id: string;
  userId: string;
  productId: string;
  paymentId: string | null;
  source: 'purchase' | 'subscription' | 'promo' | 'admin';
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export class EntitlementsService {
  constructor(private readonly pool: Pool) {}

  /** Returns true if the user has an active, non-expired entitlement for productId. */
  async hasEntitlement(userId: string, productId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM entitlements
         WHERE user_id   = $1
           AND product_id = $2
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
       ) AS exists`,
      [userId, productId],
    );
    return rows[0]?.exists ?? false;
  }

  /** Returns all active entitlements for a user. */
  async listEntitlements(userId: string): Promise<EntitlementRow[]> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      product_id: string;
      payment_id: string | null;
      source: EntitlementRow['source'];
      granted_at: string;
      expires_at: string | null;
      revoked_at: string | null;
    }>(
      `SELECT id, user_id, product_id, payment_id, source,
              granted_at, expires_at, revoked_at
       FROM entitlements
       WHERE user_id    = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY granted_at DESC`,
      [userId],
    );

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      productId: r.product_id,
      paymentId: r.payment_id,
      source: r.source,
      grantedAt: r.granted_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
    }));
  }

  /**
   * Grants an entitlement.
   *
   * Idempotent when paymentId is provided: a duplicate call with the same
   * paymentId updates expires_at and clears revoked_at rather than inserting
   * a second row.  Safe to call from webhook handlers.
   */
  async grant(params: {
    userId: string;
    productId: string;
    source: EntitlementRow['source'];
    paymentId?: string;
    expiresAt?: Date;
  }): Promise<EntitlementRow> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      product_id: string;
      payment_id: string | null;
      source: EntitlementRow['source'];
      granted_at: string;
      expires_at: string | null;
      revoked_at: string | null;
    }>(
      `INSERT INTO entitlements (user_id, product_id, source, payment_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO UPDATE
         SET expires_at = EXCLUDED.expires_at,
             revoked_at = NULL
       RETURNING id, user_id, product_id, payment_id, source,
                 granted_at, expires_at, revoked_at`,
      [
        params.userId,
        params.productId,
        params.source,
        params.paymentId ?? null,
        params.expiresAt ?? null,
      ],
    );

    const r = rows[0]!;
    return {
      id: r.id,
      userId: r.user_id,
      productId: r.product_id,
      paymentId: r.payment_id,
      source: r.source,
      grantedAt: r.granted_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
    };
  }

  /** Revokes all active entitlements for a user/product (e.g. subscription cancelled). */
  async revoke(userId: string, productId: string): Promise<void> {
    await this.pool.query(
      `UPDATE entitlements
       SET revoked_at = NOW()
       WHERE user_id   = $1
         AND product_id = $2
         AND revoked_at IS NULL`,
      [userId, productId],
    );
  }
}
