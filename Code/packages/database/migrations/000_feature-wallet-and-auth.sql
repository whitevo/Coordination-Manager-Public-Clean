-- Consolidated feature migration file: feature-wallet-and-auth
-- Generated from incremental files for easier agent navigation.
-- Keep statements idempotent when adding future changes.

-- ============================================================
-- BEGIN SOURCE: 006_cardano_wallets.sql
-- ============================================================
-- ============================================================
-- Migration 006: Cardano Wallet Authentication Support
-- Adds wallet_address column to users and wallet_challenges table
-- ============================================================

-- 1. Expand account_type to include 'cardano'
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_account_type_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_account_type_check
  CHECK (account_type IN ('google', 'traveler', 'cardano'));

-- 2. Add wallet columns to users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS wallet_address TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stake_address TEXT;

-- 3. Unique index on wallet address (NULLs allowed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wallet_address_unique
  ON public.users(wallet_address)
  WHERE wallet_address IS NOT NULL;

-- 4. Wallet challenge nonces (short-lived, backend-managed)
CREATE TABLE IF NOT EXISTS public.wallet_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_challenges_expires
  ON public.wallet_challenges(expires_at);

CREATE INDEX IF NOT EXISTS idx_wallet_challenges_address
  ON public.wallet_challenges(wallet_address);

-- RLS — only service role can manage challenges
ALTER TABLE public.wallet_challenges ENABLE ROW LEVEL SECURITY;

-- No permissive policies needed — the API uses supabaseAdmin
-- (service_role) which bypasses RLS entirely.

-- 5. Periodic cleanup function for expired challenges
CREATE OR REPLACE FUNCTION cleanup_expired_wallet_challenges()
RETURNS void AS $$
BEGIN
  DELETE FROM public.wallet_challenges
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';


-- END SOURCE: 006_cardano_wallets.sql

-- ============================================================
-- BEGIN SOURCE: 059_managed_wallet.sql
-- ============================================================
-- ============================================================
-- Migration 059: Managed Wallet Support
-- Adds encrypted_wallet_blob column so users can have an
-- app-generated (non-custodial) Cardano identity key stored
-- encrypted on our server. The blob is AES-256-GCM encrypted
-- with a device-local key; the platform can never decrypt it.
-- ============================================================

-- 1. Add encrypted blob column
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS encrypted_wallet_blob TEXT;

-- 2. Expand account_type constraint to allow 'managed_cardano'
--    (an app-generated identity, distinct from a real CIP-30 wallet)
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_account_type_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_account_type_check
  CHECK (account_type IN ('google', 'traveler', 'cardano', 'managed_cardano'));

-- 3. Index on wallet_address already exists from migration 006;
--    managed wallet addresses start with 'managed_' so they
--    are naturally distinct from bech32/hex CIP-30 addresses.


-- END SOURCE: 059_managed_wallet.sql


-- BEGIN SOURCE: 033_account_merge_tokens.sql
-- Single-use, short-lived account merge tokens. Only a SHA-256 hash of the token is stored.
CREATE TABLE IF NOT EXISTS public.account_merge_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  source_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_account_type TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_merge_tokens_expires_at
  ON public.account_merge_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_account_merge_tokens_source_user_id
  ON public.account_merge_tokens(source_user_id);

ALTER TABLE public.account_merge_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_merge_tokens FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.account_merge_tokens TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'account_merge_tokens'
      AND policyname = 'Deny direct client access to account merge tokens'
  ) THEN
    CREATE POLICY "Deny direct client access to account merge tokens"
      ON public.account_merge_tokens FOR ALL USING (false) WITH CHECK (false);
  END IF;
END $$;
-- END SOURCE: 033_account_merge_tokens.sql

-- BEGIN SOURCE: 031_auth_trusted_app_metadata.sql
-- Backfill identity-linking fields into auth.users.raw_app_meta_data.
--
-- The API now reads wallet_address, account_type and redirect_to_user_id ONLY from
-- app_metadata (service-role writable). raw_user_meta_data is user-writable through
-- supabase.auth.updateUser, so it is never copied as-is: every value below comes from
-- server-controlled data (public.users rows, or the server-generated account emails).
--
-- Legacy redirect_to_user_id values in raw_user_meta_data are intentionally NOT copied.
-- Those came from wallets unlinked while signed in with the wallet session; such
-- sessions must sign in with Google again.
--
-- Run as the database owner (Supabase SQL editor). Idempotent: only fills missing keys.

DO $$
BEGIN
  -- 1. Accounts with a profile row: account_type and wallet_address from public.users.
  UPDATE auth.users AS au
  SET raw_app_meta_data = COALESCE(au.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('account_type', u.account_type)
    || CASE WHEN u.wallet_address IS NOT NULL
         THEN jsonb_build_object('wallet_address', u.wallet_address)
         ELSE '{}'::jsonb END
  FROM public.users AS u
  WHERE u.id = au.id
    AND u.account_type IS NOT NULL
    AND NOT (COALESCE(au.raw_app_meta_data, '{}'::jsonb) ? 'account_type');

  -- 2. Merged wallet logins (no profile row of their own): keep the wallet link only when
  --    the server-generated email matches the wallet and a surviving profile owns it.
  UPDATE auth.users AS au
  SET raw_app_meta_data = COALESCE(au.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('account_type', 'cardano', 'wallet_address', au.raw_user_meta_data->>'wallet_address')
  WHERE au.email = 'wallet-' || left(au.raw_user_meta_data->>'wallet_address', 20) || '@cardano.wallet'
    AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = au.id)
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.wallet_address = au.raw_user_meta_data->>'wallet_address')
    AND NOT (COALESCE(au.raw_app_meta_data, '{}'::jsonb) ? 'wallet_address');

  -- 3. Server-created accounts that have not created a profile yet: type from the email.
  UPDATE auth.users AS au
  SET raw_app_meta_data = COALESCE(au.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('account_type',
         CASE
           WHEN au.email LIKE 'traveler-%@guest.local' THEN 'traveler'
           WHEN au.email LIKE 'managed-%@wallet.local' THEN 'managed_cardano'
         END)
  WHERE (au.email LIKE 'traveler-%@guest.local' OR au.email LIKE 'managed-%@wallet.local')
    AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = au.id)
    AND NOT (COALESCE(au.raw_app_meta_data, '{}'::jsonb) ? 'account_type');
END $$;
-- END SOURCE: 031_auth_trusted_app_metadata.sql
