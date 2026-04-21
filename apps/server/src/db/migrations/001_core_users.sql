-- =============================================================================
-- Migration 001 — Core users, authentication, and player profiles
-- =============================================================================
--
-- Design decisions:
--
--   users       is the identity anchor — intentionally minimal.
--               It owns only the email (the canonical identifier we use for
--               login) and timestamps.  All mutable display data lives in
--               player_profiles so the two concerns don't bleed together.
--
--   auth_accounts separates "how did this user authenticate" from "who are
--               they".  One user can have multiple accounts (password today,
--               Google tomorrow, Apple on mobile in the future) without
--               schema changes.  The `provider` enum is the only place we
--               enumerate login methods.
--
--   player_profiles holds the public-facing game identity.  Keeping it
--               separate from auth means mobile clients can display profiles
--               without ever seeing auth data, and we can evolve the two
--               independently.
--
--   UUIDs are used for all primary keys.  They are safe to expose in URLs
--   and API responses without leaking row counts or sequential IDs.
--   gen_random_uuid() requires PostgreSQL 13+ (no extension needed).
-- =============================================================================

-- Track which migrations have been applied.
-- This table is created by the migration runner before any migration runs;
-- it is included here as documentation of the convention.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version      VARCHAR(255) PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── users ───────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        VARCHAR(320) UNIQUE NOT NULL,   -- max valid email length per RFC 5321
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);

-- ─── auth_accounts ───────────────────────────────────────────────────────────

-- provider values: 'password' | 'google' | 'apple' | 'facebook'
-- 'apple' and OAuth providers are placeholders for the mobile release.
CREATE TABLE auth_accounts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider             VARCHAR(32) NOT NULL,
  -- For OAuth providers this is the provider-issued user ID.
  -- For 'password' accounts it is NULL (the email on users acts as the identifier).
  provider_account_id  TEXT,
  -- Only populated for provider = 'password'.  Bcrypt hash stored here.
  password_hash        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One account per provider per user
  CONSTRAINT uq_auth_accounts_user_provider UNIQUE (user_id, provider),
  -- OAuth accounts must have a provider_account_id
  CONSTRAINT chk_auth_accounts_provider_id
    CHECK (provider = 'password' OR provider_account_id IS NOT NULL)
);

CREATE INDEX idx_auth_accounts_user_id ON auth_accounts (user_id);
CREATE INDEX idx_auth_accounts_provider_account ON auth_accounts (provider, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

-- ─── player_profiles ─────────────────────────────────────────────────────────

CREATE TABLE player_profiles (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         UNIQUE NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  username      VARCHAR(32)  UNIQUE NOT NULL,
  display_name  VARCHAR(64),
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_player_profiles_username_length CHECK (char_length(username) >= 3)
);

CREATE INDEX idx_player_profiles_user_id  ON player_profiles (user_id);
CREATE INDEX idx_player_profiles_username ON player_profiles (username);
