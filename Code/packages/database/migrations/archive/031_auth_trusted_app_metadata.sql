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
