-- =============================================================================
-- Migration 003 — Commerce schema: products, pricing, orders, payments,
--                 entitlements, and inventory
-- =============================================================================
--
-- Design decisions:
--
--   All commerce tables exist in the schema from day one so the game tables
--   can reference them via FK once the feature is enabled.  In the MVP release
--   NO commerce routes are exposed — the tables are simply empty.
--
--   products / product_prices are split because one product can have multiple
--   prices: a PayPal price in USD on web, an Apple IAP price in different
--   currencies, and a Google Play price.  The `platform` column drives which
--   SDK the client uses to initiate payment.
--
--   orders represent a user's intent to purchase before the payment processor
--   confirms.  This decouples our records from provider-specific webhooks.
--
--   payments hold the raw provider confirmation data (provider_receipt_json)
--   so we can re-verify receipts server-side (Apple/Google) or reconcile with
--   PayPal without losing information.
--
--   entitlements are the source of truth for what features a user has access
--   to.  They are checked at feature-gate time, not payments or orders.
--   entitlements.payment_id links to the specific payment that created the
--   entitlement, enabling full auditability.  Manually granted entitlements
--   (admin/promo) have payment_id = NULL.
--
--   user_inventory stores cosmetic items a user has acquired.  Each item has
--   a stable item_key (e.g. 'card_back_gold') so the game client can apply it.
--
--   None of these tables have application-level access controls yet
--   (that is a server-layer concern), but they are designed for it:
--   every row carries user_id, enabling row-level security if PostgreSQL
--   RLS is added later.
-- =============================================================================

-- ─── product_type enum ───────────────────────────────────────────────────────

CREATE TYPE product_type AS ENUM ('cosmetic', 'currency_pack', 'subscription');

-- ─── products ────────────────────────────────────────────────────────────────

CREATE TABLE products (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(128) NOT NULL,
  description   TEXT,
  product_type  product_type NOT NULL,
  -- Feature flag: false hides the product without deleting it
  is_active     BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Arbitrary metadata (e.g. { "cardBack": "gold", "avatarFrame": "diamond" })
  metadata_json JSONB        NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_active_type ON products (product_type) WHERE is_active = TRUE;

-- ─── product_prices ──────────────────────────────────────────────────────────
--
-- One row per (product, platform).  `platform` values:
--   'web_paypal'   — PayPal JS SDK on web
--   'ios_iap'      — StoreKit / Apple IAP
--   'android_iap'  — Google Play Billing
--
-- external_product_id is the store-specific SKU / plan identifier:
--   Apple:   bundle ID suffix (e.g. 'com.calash.cosmetic.classic')
--   Google:  product ID in Play Console
--   PayPal:  plan ID for subscriptions; empty for one-time orders

CREATE TABLE product_prices (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID        NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  platform            VARCHAR(16) NOT NULL,
  currency            CHAR(3)     NOT NULL DEFAULT 'USD',
  -- Stored as integer cents to avoid floating-point issues
  amount_cents        INT         NOT NULL CHECK (amount_cents >= 0),
  external_product_id TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_prices_product_platform UNIQUE (product_id, platform)
);

CREATE INDEX idx_prices_product_id ON product_prices (product_id);
CREATE INDEX idx_prices_platform   ON product_prices (platform) WHERE is_active = TRUE;

-- ─── orders ──────────────────────────────────────────────────────────────────
--
-- An order is created the moment a user initiates a purchase (status: pending).
-- It is flipped to 'paid' once the provider confirms payment.
-- status transitions: pending → paid | failed | cancelled; paid → refunded

CREATE TYPE order_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'cancelled');

CREATE TABLE orders (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users (id),
  product_id    UUID         NOT NULL REFERENCES products (id),
  price_id      UUID         NOT NULL REFERENCES product_prices (id),
  status        order_status NOT NULL DEFAULT 'pending',
  platform      VARCHAR(16)  NOT NULL,
  amount_cents  INT          NOT NULL CHECK (amount_cents >= 0),
  currency      CHAR(3)      NOT NULL DEFAULT 'USD',
  metadata_json JSONB        NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id    ON orders (user_id);
CREATE INDEX idx_orders_status     ON orders (status);
CREATE INDEX idx_orders_product_id ON orders (product_id);

-- ─── payments ────────────────────────────────────────────────────────────────
--
-- A payment record is created when a provider intent is initiated.
-- provider_receipt_json stores the raw response so receipts can be re-verified.
-- provider_transaction_id has a UNIQUE constraint to guard against duplicate
-- webhook deliveries.

CREATE TYPE payment_provider AS ENUM ('paypal', 'apple', 'google');
CREATE TYPE payment_status   AS ENUM ('pending', 'completed', 'failed', 'refunded');

CREATE TABLE payments (
  id                      UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                UUID             NOT NULL REFERENCES orders (id),
  user_id                 UUID             NOT NULL REFERENCES users (id),
  provider                payment_provider NOT NULL,
  provider_transaction_id TEXT             UNIQUE,
  provider_receipt_json   JSONB            NOT NULL DEFAULT '{}',
  amount_cents            INT              NOT NULL CHECK (amount_cents >= 0),
  currency                CHAR(3)          NOT NULL DEFAULT 'USD',
  status                  payment_status   NOT NULL DEFAULT 'pending',
  created_at              TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_order_id    ON payments (order_id);
CREATE INDEX idx_payments_user_id     ON payments (user_id);
CREATE INDEX idx_payments_provider_tx ON payments (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

-- ─── entitlements ────────────────────────────────────────────────────────────
--
-- Source of truth for feature access.  Always query this table at gate time,
-- never orders or payments directly.
--
-- A valid entitlement:  revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
--
-- source values:
--   'purchase'     — granted after a verified payment
--   'subscription' — granted/renewed by a recurring subscription webhook
--   'promo'        — granted as a promotional reward (no payment)
--   'admin'        — manually granted by support / admin tooling
--
-- payment_id links to the specific payment that created this entitlement.
-- NULL for admin/promo grants.  The unique partial index on payment_id makes
-- entitlement grants idempotent (safe to retry on duplicate webhooks).

CREATE TABLE entitlements (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id  UUID        NOT NULL REFERENCES products (id),
  payment_id  UUID        REFERENCES payments (id),
  source      VARCHAR(16) NOT NULL DEFAULT 'purchase',
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL = permanent; set for time-limited subscriptions
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX idx_entitlements_user_id    ON entitlements (user_id);
CREATE INDEX idx_entitlements_product_id ON entitlements (product_id);
-- Hot-path: active entitlement lookups
CREATE INDEX idx_entitlements_active ON entitlements (user_id, product_id)
  WHERE revoked_at IS NULL;
-- Enables ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL idempotency
CREATE UNIQUE INDEX idx_entitlements_payment_id ON entitlements (payment_id)
  WHERE payment_id IS NOT NULL;

-- ─── user_inventory ──────────────────────────────────────────────────────────
--
-- Cosmetic / consumable items a user currently holds.
-- item_type:  broad category ('card_back', 'avatar_frame', 'table_theme', …)
-- item_key:   stable unique identifier for the specific variant
--             (e.g. 'card_back_gold', 'avatar_frame_diamond')
-- entitlement_id links each item back to the purchase that granted it.

CREATE TABLE user_inventory (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id     UUID         NOT NULL REFERENCES products (id),
  entitlement_id UUID         REFERENCES entitlements (id),
  item_type      VARCHAR(64)  NOT NULL,
  item_key       VARCHAR(128) NOT NULL,
  acquired_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  metadata_json  JSONB        NOT NULL DEFAULT '{}',

  CONSTRAINT uq_inventory_user_item UNIQUE (user_id, item_key)
);

CREATE INDEX idx_inventory_user_id    ON user_inventory (user_id);
CREATE INDEX idx_inventory_product_id ON user_inventory (product_id);
