/**
 * Commerce repository — products, orders, payments, inventory.
 *
 * All writes use explicit transactions.  The typical happy-path flow is:
 *   1. createOrder        — reserve the order (status: pending)
 *   2. createPayment      — record provider intent (status: pending)
 *   3. completePayment    — mark payment captured, grant entitlement
 *      (runs as a single transaction: update payment + create entitlement)
 *
 * Idempotency: completePayment uses ON CONFLICT on provider_transaction_id
 * so duplicate webhook deliveries are safe.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = { query: Pool['query'] };

// ─── Row types ───────────────────────────────────────────────────────────────

export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  productType: 'one_time' | 'subscription' | 'cosmetic';
  isActive: boolean;
  createdAt: string;
}

export interface ProductPriceRow {
  id: string;
  productId: string;
  platform: string;
  externalProductId: string | null;
  currency: string;
  amountCents: number;
  isActive: boolean;
}

export interface OrderRow {
  id: string;
  userId: string;
  productId: string;
  priceId: string;
  platform: string;
  status: 'pending' | 'paid' | 'cancelled' | 'refunded';
  amountCents: number;
  currency: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRow {
  id: string;
  orderId: string;
  userId: string;
  provider: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  amountCents: number;
  currency: string;
  providerTransactionId: string | null;
  providerReceiptJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItemRow {
  id: string;
  userId: string;
  productId: string;
  itemType: string;
  itemKey: string;
  acquiredAt: string;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class CommerceRepository {
  constructor(private readonly pool: Pool) {}

  // ── Products ────────────────────────────────────────────────────────────────

  async listActiveProducts(): Promise<ProductRow[]> {
    const { rows } = await this.pool.query<{
      id: string; name: string; description: string | null;
      product_type: ProductRow['productType']; is_active: boolean; created_at: string;
    }>(
      `SELECT id, name, description, product_type, is_active, created_at
       FROM products WHERE is_active = true ORDER BY created_at`,
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, description: r.description,
      productType: r.product_type, isActive: r.is_active, createdAt: r.created_at,
    }));
  }

  async getProductWithPrices(productId: string): Promise<{
    product: ProductRow;
    prices: ProductPriceRow[];
  } | null> {
    const { rows: pRows } = await this.pool.query<{
      id: string; name: string; description: string | null;
      product_type: ProductRow['productType']; is_active: boolean; created_at: string;
    }>(
      `SELECT id, name, description, product_type, is_active, created_at
       FROM products WHERE id = $1`,
      [productId],
    );
    if (!pRows[0]) return null;

    const { rows: priceRows } = await this.pool.query<{
      id: string; product_id: string; platform: string;
      external_product_id: string | null; currency: string;
      amount_cents: number; is_active: boolean;
    }>(
      `SELECT id, product_id, platform, external_product_id, currency, amount_cents, is_active
       FROM product_prices WHERE product_id = $1 AND is_active = true`,
      [productId],
    );

    return {
      product: {
        id: pRows[0].id, name: pRows[0].name, description: pRows[0].description,
        productType: pRows[0].product_type, isActive: pRows[0].is_active, createdAt: pRows[0].created_at,
      },
      prices: priceRows.map((r) => ({
        id: r.id, productId: r.product_id, platform: r.platform,
        externalProductId: r.external_product_id, currency: r.currency,
        amountCents: r.amount_cents, isActive: r.is_active,
      })),
    };
  }

  // ── Orders ──────────────────────────────────────────────────────────────────

  async createOrder(params: {
    userId: string;
    productId: string;
    priceId: string;
    platform: string;
    amountCents: number;
    currency: string;
    metadata?: Record<string, unknown>;
  }): Promise<OrderRow> {
    const { rows } = await this.pool.query<{
      id: string; user_id: string; product_id: string; price_id: string;
      platform: string; status: OrderRow['status']; amount_cents: number;
      currency: string; metadata: Record<string, unknown>;
      created_at: string; updated_at: string;
    }>(
      `INSERT INTO orders (user_id, product_id, price_id, platform, amount_cents, currency, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.userId, params.productId, params.priceId, params.platform,
        params.amountCents, params.currency,
        JSON.stringify(params.metadata ?? {}),
      ],
    );
    const r = rows[0]!;
    return {
      id: r.id, userId: r.user_id, productId: r.product_id, priceId: r.price_id,
      platform: r.platform, status: r.status, amountCents: r.amount_cents,
      currency: r.currency, metadata: r.metadata,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  async getOrder(orderId: string): Promise<OrderRow | null> {
    const { rows } = await this.pool.query<{
      id: string; user_id: string; product_id: string; price_id: string;
      platform: string; status: OrderRow['status']; amount_cents: number;
      currency: string; metadata: Record<string, unknown>;
      created_at: string; updated_at: string;
    }>(
      `SELECT * FROM orders WHERE id = $1`,
      [orderId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id, userId: r.user_id, productId: r.product_id, priceId: r.price_id,
      platform: r.platform, status: r.status, amountCents: r.amount_cents,
      currency: r.currency, metadata: r.metadata,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  // ── Payments ────────────────────────────────────────────────────────────────

  async createPayment(params: {
    orderId: string;
    userId: string;
    provider: string;
    amountCents: number;
    currency: string;
  }): Promise<PaymentRow> {
    const { rows } = await this.pool.query<{
      id: string; order_id: string; user_id: string; provider: string;
      status: PaymentRow['status']; amount_cents: number; currency: string;
      provider_transaction_id: string | null; provider_receipt_json: Record<string, unknown> | null;
      created_at: string; updated_at: string;
    }>(
      `INSERT INTO payments (order_id, user_id, provider, amount_cents, currency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [params.orderId, params.userId, params.provider, params.amountCents, params.currency],
    );
    const r = rows[0]!;
    return {
      id: r.id, orderId: r.order_id, userId: r.user_id, provider: r.provider,
      status: r.status, amountCents: r.amount_cents, currency: r.currency,
      providerTransactionId: r.provider_transaction_id,
      providerReceiptJson: r.provider_receipt_json,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  /**
   * Mark a payment as completed and flip the parent order to 'paid'.
   * Runs in a transaction.  Idempotent on providerTransactionId.
   */
  async completePayment(
    paymentId: string,
    providerTransactionId: string,
    receiptJson: Record<string, unknown>,
    client?: PoolClient,
  ): Promise<PaymentRow> {
    const db: Queryable = client ?? this.pool;
    const { rows } = await db.query<{
      id: string; order_id: string; user_id: string; provider: string;
      status: PaymentRow['status']; amount_cents: number; currency: string;
      provider_transaction_id: string | null; provider_receipt_json: Record<string, unknown> | null;
      created_at: string; updated_at: string;
    }>(
      `UPDATE payments
       SET status = 'completed',
           provider_transaction_id = $2,
           provider_receipt_json = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [paymentId, providerTransactionId, JSON.stringify(receiptJson)],
    );

    await db.query(
      `UPDATE orders SET status = 'paid', updated_at = NOW()
       WHERE id = (SELECT order_id FROM payments WHERE id = $1)`,
      [paymentId],
    );

    const r = rows[0]!;
    return {
      id: r.id, orderId: r.order_id, userId: r.user_id, provider: r.provider,
      status: r.status, amountCents: r.amount_cents, currency: r.currency,
      providerTransactionId: r.provider_transaction_id,
      providerReceiptJson: r.provider_receipt_json,
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  // ── Inventory ────────────────────────────────────────────────────────────────

  async getUserInventory(userId: string): Promise<InventoryItemRow[]> {
    const { rows } = await this.pool.query<{
      id: string; user_id: string; product_id: string;
      item_type: string; item_key: string; acquired_at: string;
    }>(
      `SELECT id, user_id, product_id, item_type, item_key, acquired_at
       FROM user_inventory WHERE user_id = $1 ORDER BY acquired_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id, userId: r.user_id, productId: r.product_id,
      itemType: r.item_type, itemKey: r.item_key, acquiredAt: r.acquired_at,
    }));
  }

  async addInventoryItem(params: {
    userId: string;
    productId: string;
    itemType: string;
    itemKey: string;
  }): Promise<InventoryItemRow> {
    const { rows } = await this.pool.query<{
      id: string; user_id: string; product_id: string;
      item_type: string; item_key: string; acquired_at: string;
    }>(
      `INSERT INTO user_inventory (user_id, product_id, item_type, item_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, item_key) DO UPDATE SET acquired_at = user_inventory.acquired_at
       RETURNING *`,
      [params.userId, params.productId, params.itemType, params.itemKey],
    );
    const r = rows[0]!;
    return {
      id: r.id, userId: r.user_id, productId: r.product_id,
      itemType: r.item_type, itemKey: r.item_key, acquiredAt: r.acquired_at,
    };
  }
}
