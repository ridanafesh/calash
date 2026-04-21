-- =============================================================================
-- Migration 004 — Auth enhancements: nullable email, guest + Google providers
-- =============================================================================
--
-- Changes:
--   1. users.email becomes nullable so guest accounts can have no email.
--   2. auth_accounts constraint updated to allow 'guest' rows with no
--      provider_account_id (guests have no external identity yet).
-- =============================================================================

-- Allow guests (no email address)
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Relax the provider_account_id constraint:
--   password  → no provider_account_id (already allowed)
--   guest     → no provider_account_id (new)
--   all others (google, apple, …) → must have provider_account_id
ALTER TABLE auth_accounts
  DROP CONSTRAINT IF EXISTS chk_auth_accounts_provider_id;

ALTER TABLE auth_accounts
  ADD CONSTRAINT chk_auth_accounts_provider_id
  CHECK (
    provider IN ('password', 'guest')
    OR provider_account_id IS NOT NULL
  );
