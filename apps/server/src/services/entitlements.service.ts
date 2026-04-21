/**
 * Entitlement service — single source of truth for what a user can access.
 *
 * Entitlements are written when a payment is verified or a subscription
 * renews, and revoked when a subscription lapses.  Feature gates MUST
 * query this table, not the payments or orders tables directly.
 *
 * Current SKU catalogue (see seed.ts for product_id values):
 *   cosmetic_pack_classic   — one-time purchase, permanent
 *   cosmetic_pack_neon      — one-time purchase, permanent
 *   premium_monthly         — subscription, expires_at set by subscription cycle
 */

import type { Pool } from 'pg';

export interface EntitlementRow {
  id: string;
  userId: string;
  productId: string;
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
         WHERE user_id = $1
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
      source: EntitlementRow['source'];
      granted_at: string;
      expires_at: string | null;
      revoked_at: string | null;
    }>(
      `SELECT id, user_id, product_id, source, granted_at, expires_at, revoked_at
       FROM entitlements
       WHERE user_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY granted_at DESC`,
      [userId],
    );

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      productId: r.product_id,
      source: r.source,
      grantedAt: r.granted_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
    }));
  }

  /** Grants an entitlement (idempotent via ON CONFLICT DO NOTHING on payment_id). */
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
      source: EntitlementRow['source'];
      granted_at: string;
      expires_at: string | null;
      revoked_at: string | null;
    }>(
      `INSERT INTO entitlements (user_id, product_id, source, payment_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO UPDATE
         SET expires_at = EXCLUDED.expires_at, revoked_at = NULL
       RETURNING id, user_id, product_id, source, granted_at, expires_at, revoked_at`,
      [params.userId, params.productId, params.source, params.paymentId ?? null, params.expiresAt ?? null],
    );

    const r = rows[0]!;
    return {
      id: r.id,
      userId: r.user_id,
      productId: r.product_id,
      source: r.source,
      grantedAt: r.granted_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
    };
  }

  /** Revokes all entitlements for a user/product (e.g. subscription cancelled). */
  async revoke(userId: string, productId: string): Promise<void> {
    await this.pool.query(
      `UPDATE entitlements
       SET revoked_at = NOW()
       WHERE user_id = $1 AND product_id = $2 AND revoked_at IS NULL`,
      [userId, productId],
    );
  }
}
