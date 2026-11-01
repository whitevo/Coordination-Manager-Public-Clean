---
name: deployment
description: Deploys the Coordination Manager frontend to Vercel and the API and Discord guardian to Railway - vercel.json security headers and SPA rewrites, nixpacks.toml, production env vars, secret rotation, post-deploy checks, and build troubleshooting. Use when deploying, fixing a failed Vercel or Railway build, changing vercel.json or nixpacks.toml, adding a custom domain, updating production env vars, or reviewing hosting config. Not for which env var belongs where (use environment-variables), secret rotation (use security-hardening), or CI workflows (use github-workflow).
---

# deployment

Target is one of: frontend (Vercel), backend API (Railway), guardian (Railway). Zero-build-minutes Vercel deploy: `scripts/deploy-vercel.ps1` (step 1).

Copy this checklist:
```
- [ ] Config change made (vercel.json / nixpacks.toml / env vars)
- [ ] `pnpm verify:release` passes (repo root; frozen install, typecheck, lint, test, OSV audit + gitleaks, build, web build:with-docs)
- [ ] Production env vars set on the right platform
- [ ] Deployed from main only (the step 1 CLI script bypasses this; production use only on purpose)
- [ ] Post-deploy checks (step 7) all pass
```

## Workflow

1. **Frontend (Vercel)** - auto-deploys from `main`; PRs get previews; domain `coordinationmanager.com`.
   - Root Directory `Code/apps/web`; Framework Vite; Build Command `pnpm run build:with-docs` (frontend + docs in one dist); Output `dist`; Install `pnpm install`
   - The 4GB heap flag (`--max-old-space-size=4096`) is only on the web `dev` script; `build` and `build:with-docs` have none
   - vercel.json buildCommand overrides the dashboard Build Command
   - Build fails on workspace deps: set `ENABLE_EXPERIMENTAL_COREPACK=1`
   - Local build + CLI push: `scripts/deploy-vercel.ps1` (needs Vercel CLI and the git-ignored root `.vercel/project.json` link via `vercel link`; runs `vercel build --prod` then `vercel deploy --prebuilt --prod`)
   - Node 26 everywhere: Vercel project 26.x, CI `node-version: 26`, nixpacks `nodejs_26`; engines require `>=26.12.1`. After a deploy, check the Vercel and Railway build logs show 26.x (if a platform cannot provide 26 yet, the engines check fails the build)
   - pnpm 12 (`packageManager: pnpm@12.15.0`): Node 26 no longer bundles corepack, so nixpacks installs pnpm with `npm install -g pnpm@12.15.0`; keep it in sync with `packageManager`

2. **`Code/apps/web/vercel.json`**:
   - Headers on all routes via `"source": "/(.*)"`: X-Content-Type-Options nosniff; X-Frame-Options DENY; Referrer-Policy strict-origin-when-cross-origin; Permissions-Policy camera=(), microphone=(), geolocation=(); HSTS max-age=31536000; includeSubDomains; strict CSP (script-src, style-src, connect-src tailored to the app)
   - Maintenance: the noindex `X-Robots-Tag` source is a hardcoded route-prefix regex (add new app routes there), and the CSP `script-src` holds one `sha256-` hash for an inline script (update it if that script changes)
   - Also noindex `X-Robots-Tag` on app routes and content types for llms.txt, robots.txt, sitemap. Rewrites: known marketing and docs pages -> their prerendered `index.html`; other `/docs/*` -> `/docs/app-shell.html`; everything else except assets, docs and .well-known -> `/app-shell.html`

3. **Frontend env vars** (Vercel Dashboard; different values per Production/Preview/Development): `VITE_API_URL` (production Railway API URL), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`.
   - Mark build-only secrets as sensitive in Vercel (unreadable after creation). Not for VITE_* vars, which are bundled.

4. **Backend (Railway)** - auto-deploys from `main`. Build config `Code/apps/api/nixpacks.toml`:
   ```
   [phases.setup] nixPkgs = ["nodejs_26"]; cmds = ["npm install -g pnpm@12.15.0"]
   [phases.install] cmds = ["pnpm install --frozen-lockfile"]
   [phases.build] cmds = ["pnpm build"]
   [start] cmd = "node dist/index.js"
   ```
   - Set `NODE_ENV=production` in Railway service variables: Railway does not set it, and without it trust proxy, secure cookies, production CORS and morgan 'short' stay off (the API logs a warning, `Code/apps/api/src/config/runtime-env.ts`)
   - Env vars: everything in `Code/apps/api/.env.example`; critical: SUPABASE_SECRET_KEY_PRODUCTION (NODE_ENV=production), JWT_SECRET, AI_API_KEY
   - `FRONTEND_URL` must be the production Vercel domain (CORS whitelist); update it when adding deployment URLs
   - `PORT` is Railway-assigned; do not hardcode
   - Use Railway sealed variables for highly sensitive values (service role key, JWT secret)
   - Never share secrets across production/preview/development

5. **Guardian (Railway)** - separate service, its own bot token (not the main bot's), needs SUPABASE_URL and SUPABASE_SECRET_KEY_PRODUCTION with NODE_ENV=production. Root Directory `Code/apps/discord-guardian`, Build Command `pnpm install && pnpm build` set explicitly (see its SETUP.md; no nixpacks.toml is committed there).
   - Main Discord bot (`apps/discord-bot`): no hosting config or deploy docs exist in the repo; where it runs in production is undocumented.

6. **Rotating secrets**: deploy new secret -> verify app works -> revoke old -> redeploy every service using it -> log the rotation. Rotation impact table and triggers: `security-hardening`.

7. **Post-deploy checks** (if any fails, fix and re-run the list):
   - [ ] Frontend loads at production URL
   - [ ] `GET /health` on the API host returns 200 (the route is `/health`, not `/api/health`)
   - [ ] OAuth callback URLs updated in Google Cloud Console
   - [ ] Mailbox vars set for production before any user connects a mailbox (redirect URIs registered, `MAILBOX_ENCRYPTION_KEY`); details in environment-variables
   - [ ] `NODE_ENV=production` set on the Railway API service (no startup warning in logs)
   - [ ] Supabase Auth redirect URLs include production domain
   - [ ] CORS whitelist includes production frontend URL
   - [ ] Security headers visible in browser Network tab
   - [ ] Refresh on /calendar/:hash returns the app, not 404
   - [ ] Rate limiter sees real IPs, not Railway proxy

## Gotchas

| Problem | Fix |
|---------|-----|
| Build OOM | `build` has no heap flag (the 4GB flag is on web `dev` only); set `NODE_OPTIONS=--max-old-space-size=4096` in the Vercel env if a build runs out of memory |
| 404 on page refresh | Check SPA rewrites in vercel.json |
| CORS errors | Add production URL via FRONTEND_URL |
| Rate limiter sees proxy IP | Confirm trust proxy is on (NODE_ENV check) |
| Env vars missing in frontend | Needs VITE_ prefix; redeploy after changes |

## Key files

- `Code/apps/web/vercel.json` - headers and rewrites
- `Code/apps/api/nixpacks.toml` - Railway build config
- `scripts/deploy-vercel.ps1` - local build + Vercel CLI deploy
