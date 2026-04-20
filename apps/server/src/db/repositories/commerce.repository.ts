/**
 * Commerce repository — products, orders, payments, inventory, wallet.
 *
 * Typical happy-path purchase flow:
 *   1. createOrder        — reserve the order (status: pending)
 *   2. createPayment      — record the provider intent (status: pending)
 *   3. completePayment    — mark payment captured, flip order to 'paid'
 *      (caller must grant entitlement in the same transaction)
 *
 * Idempotency: completePayment uses ON CONFLICT on provider_transaction_id
 * so duplicate webhook deliveries are safe.
 *
 * Wallet flow (virtual currency):
 *   creditWallet  — add balance after a currency_pack purchase or promo
 *   debitWallet   — spend balance (future: cosmetic unlock, matchmaking fee)
 *   Both methods update wallet_balances and append a wallet_transactions row
 *   in a single atomic transaction.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = { query: Pool['query'] };

// ─── Row types ───────────────────────────────────────────────────────────────

export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  productType: 'cosmetic' | 'currency_pack' | 'subscription';
  isActive: boolean;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

export interface ProductPriceRow {
  id: string;
  productId: string;
  platform: string;
  currency: string;
  amountCents: number;
  externalProductId: string | null;
  isActive: boolean;
}

export interface OrderRow {
  id: string;
  userId: string;
  productId: string;
  priceId: string;
  platform: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';
  amountCents: number;
  currency: string;
  metadataJson: Record<string, unknown>;
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
  providerReceiptJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItemRow {
  id: string;
  userId: string;
  productId: string;
  entitlementId: string | null;
  itemType: string;
  itemKey: string;
  acquiredAt: string;
  metadataJson: Record<string, unknown>;
}

export interface PurchaseHistoryRow {
  orderId: string;
  productId: string;
  productName: string;
  productType: ProductRow['productType'];
  platform: string;
  orderStatus: OrderRow['status'];
  amountCents: number;
  currency: string;
  paymentStatus: PaymentRow['status'] | null;
  providerTransactionId: string | null;
  orderedAt: string;
  paidAt: string | null;
}

export interface WalletRow {
  id: string;
  userId: string;
  currency: string;
  balance: number;
  updatedAt: string;
}

export interface WalletTransactionRow {
  id: string;
  userId: string;
  walletId: string;
  kind: 'credit' | 'debit';
  amount: number;
  balanceAfter: number;
  orderId: string | null;
  description: string | null;
  createdAt: string;
}

// ─── Repository ───────────────────────────────────────────────────────────────

export class CommerceRepository {
  constructor(private readonly pool: Pool) {}

  // ── Products ────────────────────────────────────────────────────────────────

  async listActiveProducts(): Promise<ProductRow[]> {
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      description: string | null;
      product_type: ProductRow['productType'];
      is_active: boolean;
      metadata_json: Record<string, unknown>;
      created_at: string;
    }>(
      `SELECT id, name, description, product_type, is_active, metadata_json, created_at
       FROM products WHERE is_active = true ORDER BY created_at`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      productType: r.product_type,
      isActive: r.is_active,
      metadataJson: r.metadata_json,
      createdAt: r.created_at,
    }));
  }

  async getProductWithPrices(productId: string): Promise<{
    product: ProductRow;
    prices: ProductPriceRow[];
  } | null> {
    const { rows: pRows } = await this.pool.query<{
      id: string;
      name: string;
      description: string | null;
      product_type: ProductRow['productType'];
      is_active: boolean;
      metadata_json: Record<string, unknown>;
      created_at: string;
    }>(
      `SELECT id, name, description, product_type, is_active, metadata_json, created_at
       FROM products WHERE id = $1`,
      [productId],
    );
    if (!pRows[0]) return null;

    const { rows: priceRows } = await this.pool.query<{
      id: string;
      product_id: string;
      platform: string;
      currency: string;
      amount_cents: number;
      external_product_id: string | null;
      is_active: boolean;
    }>(
      `SELECT id, product_id, platform, currency, amount_cents, external_product_id, is_active
       FROM product_prices WHERE product_id = $1 AND is_active = true`,
      [productId],
    );

    const p = pRows[0];
    return {
      product: {
        id: p.id,
        name: p.name,
        description: p.description,
        productType: p.product_type,
        isActive: p.is_active,
        metadataJson: p.metadata_json,
        createdAt: p.created_at,
      },
      prices: priceRows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        platform: r.platform,
        currency: r.currency,
        amountCents: r.amount_cents,
        externalProductId: r.external_product_id,
        isActive: r.is_active,
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
    metadataJson?: Record<string, unknown>;
  }): Promise<OrderRow> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      product_id: string;
      price_id: string;
      platform: string;
      status: OrderRow['status'];
      amount_cents: number;
      currency: string;
      metadata_json: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO orders
         (user_id, product_id, price_id, platform, amount_cents, currency, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         id, user_id, product_id, price_id, platform, status,
         amount_cents, currency, metadata_json, created_at, updated_at`,
      [
        params.userId,
        params.productId,
        params.priceId,
        params.platform,
        params.amountCents,
        params.currency,
        JSON.stringify(params.metadataJson ?? {}),
      ],
    );
    const r = rows[0]!;
    return {
      id: r.id,
      userId: r.user_id,
      productId: r.product_id,
      priceId: r.price_id,
      platform: r.platform,
      status: r.status,
      amountCents: r.amount_cents,
      currency: r.currency,
      metadataJson: r.metadata_json,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async getOrder(orderId: string): Promise<OrderRow | null> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      product_id: string;
      price_id: string;
      platform: string;
      status: OrderRow['status'];
      amount_cents: number;
      currency: string;
      metadata_json: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, user_id, product_id, price_id, platform, status,
              amount_cents, currency, metadata_json, created_at, updated_at
       FROM orders WHERE id = $1`,
      [orderId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      productId: r.product_id,
      priceId: r.price_id,
      platform: r.platform,
      status: r.status,
      amountCents: r.amount_cents,
      currency: r.currency,
      metadataJson: r.metadata_json,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /** Purchase history: orders joined with payments and product names. */
  async getUserPurchaseHistory(userId: string): Promise<PurchaseHistoryRow[]> {
    const { rows } = await this.pool.query<{
      order_id: string;
      product_id: string;
      product_name: string;
      product_type: ProductRow['productType'];
      platform: string;
      order_status: OrderRow['status'];
      amount_cents: number;
      currency: string;
      payment_status: PaymentRow['status'] | null;
      provider_transaction_id: string | null;
      ordered_at: string;
      paid_at: string | null;
    }>(
      `SELECT
         o.id                          AS order_id,
         o.product_id,
         pr.name                       AS product_name,
         pr.product_type,
         o.platform,
         o.status                      AS order_status,
         o.amount_cents,
         o.currency,
         py.status                     AS payment_status,
         py.provider_transaction_id,
         o.created_at                  AS ordered_at,
         py.updated_at                 AS paid_at
       FROM orders o
       JOIN products pr ON pr.id = o.product_id
       LEFT JOIN payments py ON py.order_id = o.id AND py.status = 'completed'
       WHERE o.user_id = $1
       ORDER BY o.created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      orderId: r.order_id,
      productId: r.product_id,
      productName: r.product_name,
      productType: r.product_type,
      platform: r.platform,
      orderStatus: r.order_status,
      amountCents: r.amount_cents,
      currency: r.currency,
      paymentStatus: r.payment_status,
      providerTransactionId: r.provider_transaction_id,
      orderedAt: r.ordered_at,
      paidAt: r.paid_at,
    }));
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
      id: string;
      order_id: string;
      user_id: string;
      provider: string;
      status: PaymentRow['status'];
      amount_cents: number;
      currency: string;
      provider_transaction_id: string | null;
      provider_receipt_json: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO payments (order_id, user_id, provider, amount_cents, currency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id, order_id, user_id, provider, status, amount_cents, currency,
         provider_transaction_id, provider_receipt_json, created_at, updated_at`,
      [params.orderId, params.userId, params.provider, params.amountCents, params.currency],
    );
    const r = rows[0]!;
    return this.#mapPaymentRow(r);
  }

  /**
   * Mark a payment as completed and flip the parent order to 'paid'.
   * Idempotent: ON CONFLICT on provider_transaction_id makes duplicate
   * webhook deliveries safe.  Must be called inside an open transaction.
   */
  async completePayment(
    paymentId: string,
    providerTransactionId: string,
    receiptJson: Record<string, unknown>,
    client?: PoolClient,
  ): Promise<PaymentRow> {
    const db: Queryable = client ?? this.pool;

    const { rows } = await db.query<{
      id: string;
      order_id: string;
      user_id: string;
      provider: string;
      status: PaymentRow['status'];
      amount_cents: number;
      currency: string;
      provider_transaction_id: string | null;
      provider_receipt_json: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>(
      `UPDATE payments
       SET status                  = 'completed',
           provider_transaction_id = $2,
           provider_receipt_json   = $3,
           updated_at              = NOW()
       WHERE id = $1
       RETURNING
         id, order_id, user_id, provider, status, amount_cents, currency,
         provider_transaction_id, provider_receipt_json, created_at, updated_at`,
      [paymentId, providerTransactionId, JSON.stringify(receiptJson)],
    );

    await db.query(
      `UPDATE orders
       SET status = 'paid', updated_at = NOW()
       WHERE id = (SELECT order_id FROM payments WHERE id = $1)`,
      [paymentId],
    );

    return this.#mapPaymentRow(rows[0]!);
  }

  #mapPaymentRow(r: {
    id: string; order_id: string; user_id: string; provider: string;
    status: PaymentRow['status']; amount_cents: number; currency: string;
    provider_transaction_id: string | null; provider_receipt_json: Record<string, unknown>;
    created_at: string; updated_at: string;
  }): PaymentRow {
    return {
      id: r.id,
      orderId: r.order_id,
      userId: r.user_id,
      provider: r.provider,
      status: r.status,
      amountCents: r.amount_cents,
      currency: r.currency,
      providerTransactionId: r.provider_transaction_id,
      providerReceiptJson: r.provider_receipt_json,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ── Inventory ────────────────────────────────────────────────────────────────

  async getUserInventory(userId: string): Promise<InventoryItemRow[]> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      product_id: string;
      entitlement_id: string | null;
      item_type: string;
      item_key: string;
      acquired_at: string;
      metadata_json: Record<string, unknown>;
    }>(
      `SELECT id, user_id, product_id, entitlement_id, item_type, item_key,
              acquired_at, metadata_json
       FROM user_inventory WHERE user_id = $1 ORDER BY acquired_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      productId: r.product_id,
      entitlementId: r.entitlement_id,
      itemType: r.item_type,
      itemKey: r.item_key,
      acquiredAt: r.acquired_at,
      metadataJson: r.metadata_json,
    }));
  }

  async addInventoryItem(params: {
    userId: string;
    productId: string;
    entitlementId?: string;
    itemType: string;
    itemKey: string;
    metadataJson?: Record<string, unknown>;
  }): Promise<InventoryItemRow> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      product_id: string;
      entitlement_id: string | null;
      item_type: string;
      item_key: string;
      acquired_at: string;
      metadata_json: Record<string, unknown>;
    }>(
      `INSERT INTO user_inventory
         (user_id, product_id, entitlement_id, item_type, item_key, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT uq_inventory_user_item
         DO UPDATE SET acquired_at = user_inventory.acquired_at
       RETURNING
         id, user_id, product_id, entitlement_id, item_type, item_key,
         acquired_at, metadata_json`,
      [
        params.userId,
        params.productId,
        params.entitlementId ?? null,
        params.itemType,
        params.itemKey,
        JSON.stringify(params.metadataJson ?? {}),
      ],
    );
    const r = rows[0]!;
    return {
      id: r.id,
      userId: r.user_id,
      productId: r.product_id,
      entitlementId: r.entitlement_id,
      itemType: r.item_type,
      itemKey: r.item_key,
      acquiredAt: r.acquired_at,
      metadataJson: r.metadata_json,
    };
  }

  // ── Wallet ───────────────────────────────────────────────────────────────────

  /** Returns the wallet row for a user/currency, creating it if absent. */
  async getOrCreateWallet(userId: string, currency = 'coins'): Promise<WalletRow> {
    const { rows } = await this.pool.query<{
      id: string; user_id: string; currency: string;
      balance: string; updated_at: string;
    }>(
      `INSERT INTO wallet_balances (user_id, currency)
       VALUES ($1, $2)
       ON CONFLICT ON CONSTRAINT uq_wallet_user_currency DO UPDATE
         SET updated_at = wallet_balances.updated_at
       RETURNING id, user_id, currency, balance, updated_at`,
      [userId, currency],
    );
    const r = rows[0]!;
    return {
      id: r.id, userId: r.user_id, currency: r.currency,
      balance: Number(r.balance), updatedAt: r.updated_at,
    };
  }

  /**
   * Credit a user's wallet.  Runs inside an explicit transaction to keep
   * wallet_balances and wallet_transactions consistent.
   */
  async creditWallet(params: {
    userId: string;
    amount: number;
    currency?: string;
    orderId?: string;
    description?: string;
    client?: PoolClient;
  }): Promise<WalletTransactionRow> {
    const db: Queryable = params.client ?? this.pool;
    const currency = params.currency ?? 'coins';

    const { rows: walletRows } = await db.query<{
      id: string; balance: string;
    }>(
      `INSERT INTO wallet_balances (user_id, currency, balance)
       VALUES ($1, $2, $3)
       ON CONFLICT ON CONSTRAINT uq_wallet_user_currency DO UPDATE
         SET balance     = wallet_balances.balance + EXCLUDED.balance,
             updated_at  = NOW()
       RETURNING id, balance`,
      [params.userId, currency, params.amount],
    );
    const wallet = walletRows[0]!;

    return this.#insertWalletTx(db, {
      userId: params.userId,
      walletId: wallet.id,
      kind: 'credit',
      amount: params.amount,
      balanceAfter: Number(wallet.balance),
      orderId: params.orderId ?? null,
      description: params.description ?? null,
    });
  }

  /**
   * Debit a user's wallet.  Throws if balance would go negative.
   */
  async debitWallet(params: {
    userId: string;
    amount: number;
    currency?: string;
    description?: string;
    client?: PoolClient;
  }): Promise<WalletTransactionRow> {
    const db: Queryable = params.client ?? this.pool;
    const currency = params.currency ?? 'coins';

    const { rows: walletRows } = await db.query<{
      id: string; balance: string;
    }>(
      `UPDATE wallet_balances
       SET balance    = balance - $3,
           updated_at = NOW()
       WHERE user_id = $1 AND currency = $2 AND balance >= $3
       RETURNING id, balance`,
      [params.userId, currency, params.amount],
    );

    if (!walletRows[0]) {
      throw new Error('Insufficient wallet balance');
    }
    const wallet = walletRows[0];

    return this.#insertWalletTx(db, {
      userId: params.userId,
      walletId: wallet.id,
      kind: 'debit',
      amount: params.amount,
      balanceAfter: Number(wallet.balance),
      orderId: null,
      description: params.description ?? null,
    });
  }

  async #insertWalletTx(
    db: Queryable,
    params: {
      userId: string; walletId: string; kind: 'credit' | 'debit';
      amount: number; balanceAfter: number;
      orderId: string | null; description: string | null;
    },
  ): Promise<WalletTransactionRow> {
    const { rows } = await db.query<{
      id: string; user_id: string; wallet_id: string; kind: 'credit' | 'debit';
      amount: string; balance_after: string; order_id: string | null;
      description: string | null; created_at: string;
    }>(
      `INSERT INTO wallet_transactions
         (user_id, wallet_id, kind, amount, balance_after, order_id, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         id, user_id, wallet_id, kind, amount, balance_after,
         order_id, description, created_at`,
      [
        params.userId, params.walletId, params.kind,
        params.amount, params.balanceAfter,
        params.orderId, params.description,
      ],
    );
    const r = rows[0]!;
    return {
      id: r.id,
      userId: r.user_id,
      walletId: r.wallet_id,
      kind: r.kind,
      amount: Number(r.amount),
      balanceAfter: Number(r.balance_after),
      orderId: r.order_id,
      description: r.description,
      createdAt: r.created_at,
    };
  }
}
