-- =============================================================================
-- Migration 006 — Wallet balances and transaction ledger
-- =============================================================================
--
-- wallet_balances holds the current balance of each virtual-currency type per
-- user.  This is in-game currency (e.g. "coins") distinct from real money.
--
-- Real-money transactions flow through orders → payments → entitlements.
-- A currency_pack purchase results in a wallet_transaction that credits the
-- balance.  In-game spending debits it.
--
-- wallet_transactions is an append-only ledger.  balance_after is stored on
-- each row so any point-in-time balance can be reconstructed without a full
-- table scan.  This mirrors a double-entry bookkeeping approach and makes
-- fraud investigation straightforward.
--
-- Neither table is exposed in the player-facing API in the MVP.
-- The routes are stubbed and gated behind COMMERCE_ENABLED.
-- =============================================================================

-- ─── wallet_balances ─────────────────────────────────────────────────────────

CREATE TABLE wallet_balances (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Internal currency name.  'coins' is the only currency in MVP.
  -- Extensible: add 'gems', 'tokens', etc. by inserting new rows.
  currency   VARCHAR(16) NOT NULL DEFAULT 'coins',
  balance    BIGINT      NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_wallet_user_currency UNIQUE (user_id, currency)
);

CREATE INDEX idx_wallet_user_id ON wallet_balances (user_id);

-- ─── wallet_transactions ─────────────────────────────────────────────────────

CREATE TYPE wallet_tx_kind AS ENUM ('credit', 'debit');

CREATE TABLE wallet_transactions (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID           NOT NULL REFERENCES users (id),
  wallet_id     UUID           NOT NULL REFERENCES wallet_balances (id),
  kind          wallet_tx_kind NOT NULL,
  -- Always positive; direction is captured by `kind`
  amount        BIGINT         NOT NULL CHECK (amount > 0),
  -- Snapshot of balance after this transaction for audit / debugging
  balance_after BIGINT         NOT NULL CHECK (balance_after >= 0),
  -- Optional link to the real-money order that caused this credit (currency_pack)
  order_id      UUID           REFERENCES orders (id),
  description   TEXT,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallet_tx_user_id  ON wallet_transactions (user_id);
CREATE INDEX idx_wallet_tx_order_id ON wallet_transactions (order_id) WHERE order_id IS NOT NULL;
