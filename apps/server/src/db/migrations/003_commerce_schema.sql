-- =============================================================================
-- Migration 003 — Commerce schema: products, pricing, orders, payments
-- =============================================================================
--
-- Design decisions:
--
--   All commerce tables exist in the schema from day one so the game tables
--   can reference them via FK once the feature is enabled.  However, in the
--   MVP release NO commerce routes are exposed — the tables are simply empty.
--
--   products / product_prices are split because one product can have multiple
--   prices: a PayPal price in USD on web, an Apple IAP price in different
--   currencies, and a Google Play price.  The `platform` column drives which
--   SDK the client uses to initiate payment.
--
--   orders represent a user's intent to purchase before the payment processor
--   confirms.  This decouples our records from provider-specific webhooks.
--
--   payments hold the raw provider confirmation data (receipt JSON) so we can
--   re-verify receipts server-side (Apple/Google) or reconcile with PayPal
--   without losing information.
--
--   entitlements are the source of truth for what features a user has access to.
--   They are checked at feature-gate time, not payments or orders.
--
--   user_inventory stores consumable/cosmetic items a user has collected.
--   It references entitlements so each inventory item is traceable to a payment.
--
--   None of these tables have application-level access controls yet
--   (that is a server-layer concern), but they are designed for it:
--   every row carries user_id, enabling straightforward row-level security
--   if PostgreSQL RLS is added later.
-- =============================================================================

-- ─── products ────────────────────────────────────────────────────────────────

CREATE TYPE product_type AS ENUM ('cosmetic', 'currency_pack', 'subscription');

CREATE TABLE products (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(128)  NOT NULL,
  description   TEXT,
  product_type  product_type  NOT NULL,
  -- Feature flag: set to false to hide the product without deleting it
  is_active     BOOLEAN       NOT NULL DEFAULT FALSE,
  -- Arbitrary metadata (e.g., { "cardBack": "gold", "avatarFrame": "diamond" })
  metadata_json JSONB         NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_active_type ON products (product_type) WHERE is_active = TRUE;

-- ─── product_prices ──────────────────────────────────────────────────────────

-- platform values: 'web_paypal' | 'ios_iap' | 'android_iap'
CREATE TABLE product_prices (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID        NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  platform         VARCHAR(16) NOT NULL,
  currency         CHAR(3)     NOT NULL DEFAULT 'USD',
  -- Store amount as integer cents to avoid floating-point issues
  amount_cents     INT         NOT NULL CHECK (amount_cents >= 0),
  -- The identifier used in the relevant store (Apple SKU, Google product ID,
  -- PayPal plan ID, etc.)
  store_product_id TEXT,
  is_active        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_prices_product_platform UNIQUE (product_id, platform)
);

CREATE INDEX idx_prices_product_id ON product_prices (product_id);
CREATE INDEX idx_prices_platform   ON product_prices (platform) WHERE is_active = TRUE;

-- ─── orders ──────────────────────────────────────────────────────────────────

CREATE TYPE order_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'cancelled');

CREATE TABLE orders (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES users (id),
  product_id       UUID         NOT NULL REFERENCES products (id),
  product_price_id UUID         NOT NULL REFERENCES product_prices (id),
  status           order_status NOT NULL DEFAULT 'pending',
  platform         VARCHAR(16)  NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id    ON orders (user_id);
CREATE INDEX idx_orders_status     ON orders (status);
CREATE INDEX idx_orders_product_id ON orders (product_id);

-- ─── payments ────────────────────────────────────────────────────────────────

CREATE TYPE payment_provider AS ENUM ('paypal', 'apple', 'google');
CREATE TYPE payment_status   AS ENUM ('pending', 'completed', 'failed', 'refunded');

CREATE TABLE payments (
  id                       UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 UUID             NOT NULL REFERENCES orders (id),
  user_id                  UUID             NOT NULL REFERENCES users (id),
  provider                 payment_provider NOT NULL,
  -- Transaction/purchase ID from the provider
  provider_transaction_id  TEXT             UNIQUE,
  -- Raw receipt or webhook payload for server-side verification (Apple/Google)
  provider_receipt_json    JSONB            NOT NULL DEFAULT '{}',
  amount_cents             INT              NOT NULL CHECK (amount_cents >= 0),
  currency                 CHAR(3)          NOT NULL DEFAULT 'USD',
  status                   payment_status   NOT NULL DEFAULT 'pending',
  created_at               TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_order_id    ON payments (order_id);
CREATE INDEX idx_payments_user_id     ON payments (user_id);
CREATE INDEX idx_payments_provider_tx ON payments (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

-- ─── entitlements ────────────────────────────────────────────────────────────
-- Source of truth for feature access.  Checked at feature-gate time.
-- A user with a valid (non-expired, non-revoked) entitlement has access.

CREATE TABLE entitlements (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id  UUID        NOT NULL REFERENCES products (id),
  -- null for manually-granted entitlements (dev/support grants)
  order_id    UUID        REFERENCES orders (id),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- null = permanent; set for time-limited subscriptions
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX idx_entitlements_user_id    ON entitlements (user_id);
CREATE INDEX idx_entitlements_product_id ON entitlements (product_id);
-- Partial index for active entitlement lookups (the hot path)
CREATE INDEX idx_entitlements_active ON entitlements (user_id, product_id)
  WHERE revoked_at IS NULL;

-- ─── user_inventory ──────────────────────────────────────────────────────────
-- Cosmetic / consumable items a user currently holds.
-- Linked to entitlements for auditability.

CREATE TABLE user_inventory (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id       UUID        NOT NULL REFERENCES products (id),
  entitlement_id   UUID        REFERENCES entitlements (id),
  acquired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Arbitrary item metadata (e.g., { "equipped": true, "variant": "gold" })
  metadata_json    JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_inventory_user_id    ON user_inventory (user_id);
CREATE INDEX idx_inventory_product_id ON user_inventory (product_id);
