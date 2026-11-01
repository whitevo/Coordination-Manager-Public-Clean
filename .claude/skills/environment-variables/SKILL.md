---
name: environment-variables
description: Defines environment variable structure across the Coordination Manager apps - public vs private classification, per-app .env and .env.example files, where to source values, and Vercel and Railway deployment variables. Use when adding or auditing an environment variable, setting up a developer's local env, configuring deployment variables, debugging missing config, or adding an integration that needs API keys. Not for deployment platform config (use deployment) or secret rotation (use security-hardening).
---

# environment-variables

## Workflow

1. **Classify the variable.** Anything `VITE_*` is public (browser); everything else stays server-side. Project-specific notes:
   - `SUPABASE_KEY` (API, anon key) / `VITE_SUPABASE_ANON_KEY` (web) - public, safe (RLS); no code reads a bare `SUPABASE_ANON_KEY`
   - `SUPABASE_SECRET_KEY_LOCALHOST` / `SUPABASE_SECRET_KEY_PRODUCTION` - server-side only (API, Discord bot, guardian); NODE_ENV=production selects PRODUCTION, other modes select LOCALHOST. No legacy service-role or opposite-environment fallback; never frontend
   - `JWT_SECRET` - backend only; HMAC signing for OAuth state and wallet credentials (API refuses to start without it unless ALLOW_INSECURE_DEV_SIGNING=true)
   - `DISCORD_BOT_TOKEN` - bot apps only; separate token per bot. The API also holds `GUARDIAN_BOT_TOKEN` + `GUARDIAN_CLIENT_ID` (guardian admin routes); the API never reads `DISCORD_BOT_TOKEN`, only `DISCORD_CLIENT_ID` (bot invite URL)
   - `BOT_API_SECRET` - bot-to-API internal auth; must match on both sides (middleware: express-api; bot side: discord-integration). API also needs `BOT_API_URL` (default http://localhost:3002)
   - `AI_API_KEY`, `ASI_API_KEY` - backend only (AI_API_KEY for the default provider, OpenAI; ASI_API_KEY optional, enables the asi1-mini per-user model choice)
   - `SMTP_PASS`, `SMTP_ENCRYPTION_KEY` - backend only; key is 64 hex chars for AES-256-GCM (format iv:authTag:ciphertext)
   - `MAILBOX_ENCRYPTION_KEY` - backend only; 64 hex chars for AES-256-GCM (OAuth tokens and IMAP-style credentials at rest). Falls back to `SMTP_ENCRYPTION_KEY` if unset, but set both independently in production so rotating one does not silently rotate the other
   - `MAILBOX_GOOGLE_CLIENT_SECRET`, `MAILBOX_MICROSOFT_CLIENT_SECRET` - backend only; Microsoft has no fallback. Google ID and secret must both be set, otherwise Gmail falls back to the calendar `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` pair (a separate OAuth client is recommended: own consent screen and scopes)
   - `MAILBOX_GMAIL_REDIRECT_URI`, `MAILBOX_OUTLOOK_REDIRECT_URI` - server config, not secret; set explicitly in production. If unset the server derives the URI from the request `Host` header (weaker fallback) and it must still match a pre-registered URI
   - `ZOOM_CLIENT_SECRET` - backend only
   - `TURNSTILE_SECRET_KEY` - backend only (verify side)

2. **Pick the .env file** (each app also has `.env.example`):
   | App | File | Key variables |
   |-----|------|---------------|
   | API | `Code/apps/api/.env` | SUPABASE_*, JWT_SECRET, NODE_ENV, FRONTEND_URL, AI_API_KEY, BOT_API_SECRET, BOT_API_URL, DISCORD_CLIENT_ID, GUARDIAN_BOT_TOKEN, GUARDIAN_CLIENT_ID, PORT; feature groups: SMTP_*, ZOOM_*, MAILBOX_*, ASI_API_KEY |
   | Web | `Code/apps/web/.env` | VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_TURNSTILE_SITE_KEY, VITE_DISCORD_CLIENT_ID (public bot invite link) |
   | Discord Bot | `Code/apps/discord-bot/.env` | DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, SUPABASE_URL, SUPABASE_SECRET_KEY_LOCALHOST / SUPABASE_SECRET_KEY_PRODUCTION, API_URL, FRONTEND_URL, BOT_API_SECRET, BOT_API_PORT |
   | Guardian | `Code/apps/discord-guardian/.env` | DISCORD_BOT_TOKEN (separate), SUPABASE_URL, SUPABASE_SECRET_KEY_LOCALHOST / SUPABASE_SECRET_KEY_PRODUCTION, DISABLE_BOT (true for local dev). `DISCORD_CLIENT_ID` is in its example but the guardian code never reads it (setup docs only). |
   | Docs | `Code/apps/docs/.env` | VITE_API_URL (no `.env.example`) |

   **Optional / less common** (API unless noted; read via `process.env`):
   - AI: `AI_PROVIDER` (default openai), `AI_MODEL`, `AI_BASE_URL`, `ASI_BASE_URL`, `ASI_MODEL` (default asi1-mini), `AI_ASSESSMENT_PROMPT_VERSION`
   - Google: `GOOGLE_CALENDAR_REDIRECT_URI`, `GOOGLE_REDIRECT_URI` (setup allowlist only)
   - Background sync: `MAILBOX_SERVER_AUTO_SYNC_ENABLED|INTERVAL_MS|MAX_ACCOUNTS`, `USER_EVENTS_SERVER_AUTO_SYNC_ENABLED|INTERVAL_MS|MAX_USERS`
   - Zoom/Luma: `ZOOM_VERIFICATION_TOKEN`, `ZOOM_ENCRYPTION_KEY`, `LUMA_ENCRYPTION_KEY` (both fall back to `ENCRYPTION_KEY`)
   - URLs: `PUBLIC_API_URL`, `API_URL`; dev only: `ALLOW_INSECURE_DEV_SIGNING`
   - Guardian: `GUARDIAN_INSTANCE_LABEL`, `GUARDIAN_FORCE_TAKEOVER`
   - `DATABASE_URL` is for psql migrations only, not read at runtime
   - `apps/api/.env.example` lists all of these (optional ones commented out with their defaults) and starts with agent guidance: placeholders only, add every new `process.env` var there with a one-line comment.
   - The Setup wizard (`/setup`, `services/local-config.ts` whitelist) writes the app `.env` files; bots exit 0 when disabled or unconfigured.

3. **Add to `.env.example`** with a placeholder (`your_supabase_url`, `<64-hex-chars>`), grouped under headers (Database, OAuth, Discord, AI, SMTP, ...). Then add the real value to the git-ignored `.env`.

4. **Source the value**:
   | Variable | Source |
   |----------|--------|
   | SUPABASE_URL, SUPABASE_KEY, SUPABASE_SECRET_KEY_LOCALHOST / SUPABASE_SECRET_KEY_PRODUCTION | Supabase Dashboard > Settings > API |
   | JWT_SECRET | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | SMTP_ENCRYPTION_KEY | 64 hex chars, same method as JWT_SECRET (per-user SMTP password encryption) |
   | MAILBOX_ENCRYPTION_KEY | Same 64-hex method; use a distinct value, do not reuse SMTP_ENCRYPTION_KEY in production |
   | GOOGLE_CLIENT_* | Google Cloud Console > Credentials |
   | DISCORD_BOT_TOKEN | Discord Developer Portal > Bot (separate per bot) |
   | AI_API_KEY | OpenAI Dashboard > API Keys |
   | ASI_API_KEY | ASI platform (optional second model) |
   | TURNSTILE_SECRET_KEY | Cloudflare Dashboard > Turnstile |
   | ZOOM_CLIENT_* | Zoom App Marketplace > Build > OAuth |
   | MAILBOX_GOOGLE_CLIENT_*, MAILBOX_GMAIL_REDIRECT_URI | Google Cloud Console > Credentials - separate client from calendar's `GOOGLE_CLIENT_*`, scoped to `gmail.modify`/`gmail.send` (plus `userinfo.email`); add the redirect URI to Authorized redirect URIs. Console scopes must match exactly - no `gmail.readonly`/`gmail.compose` |
   | MAILBOX_MICROSOFT_CLIENT_*, MAILBOX_OUTLOOK_REDIRECT_URI | Azure Portal > App registrations - scopes `Mail.ReadWrite`/`Mail.Send`/`offline_access`/`User.Read`; add the redirect URI to the app registration |

5. **Deployment** (build/service config: `deployment`): Vercel (Project Settings > Environment Variables) gets `VITE_*` vars only. Railway (Service > Variables) gets all non-VITE backend vars, per service (API and Guardian); the main Discord bot has no documented host. Use different credentials for Production vs Development.

6. **Run the safety checklist** (fix and re-check any failure):
   - [ ] No secrets in `VITE_*` variables; `.env` and `.env.local` are git-ignored
   - [ ] `SUPABASE_SECRET_KEY_LOCALHOST` / `SUPABASE_SECRET_KEY_PRODUCTION` only in server-side .env files (API, bot, guardian), never frontend
   - [ ] Discord bots use separate tokens; `BOT_API_SECRET` matches bot and API
   - [ ] Production and development use different credentials
   - [ ] New variable is in the app's `.env.example` with a placeholder
   - [ ] `MAILBOX_ENCRYPTION_KEY` is set (no silent fallback to `SMTP_ENCRYPTION_KEY`) and backed up somewhere recoverable - losing it makes every stored mailbox credential undecryptable
   - [ ] `MAILBOX_GMAIL_REDIRECT_URI` / `MAILBOX_OUTLOOK_REDIRECT_URI` set to the production API URL and registered in the Google Cloud Console OAuth client and Azure App registration
