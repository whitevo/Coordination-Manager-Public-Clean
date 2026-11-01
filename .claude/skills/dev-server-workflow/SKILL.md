---
name: dev-server-workflow
description: Manages the 5 concurrent Coordination Manager dev services (web 5173, api 3001, bot 3002, guardian, docs 5174) - start.ps1 startup, safe stop via scripts/stop-servers.js, port conflicts, and health checks. Use when starting, stopping or restarting the dev stack, a port is already in use, a service fails to start, or services need verification. The localhost-only quick start (web, API, docs) is the /run-coordination-manager command.
---

# dev-server-workflow

Action is start, stop, restart, or verify; target is all (default) or one service. This skill owns start, stop, restart and health of the local stack.

## Ports

| Service | Package (@coordination-manager/) | Port | Command (`Code/` or repo root) |
|---------|------|------|---------|
| web | web | 5173 | `pnpm dev:web` |
| api | api | 3001 | `pnpm dev:api` |
| bot (internal API) | discord-bot | 3002 (env `BOT_API_PORT`, default 3002) | `pnpm dev:bot` |
| guardian | discord-guardian | none (no HTTP) | `pnpm dev:guardian` |
| docs | docs | 5174 | `pnpm dev:docs` |
| HMR | Vite | 24678 (stop-script cleanup target only; not set in vite.config.ts) | auto with web |

Web and docs use `strictPort: true`: a busy port fails the start instead of moving to another port.

## Workflow

1. **Start (script-first)**: from repo root run `./start.ps1` (wrapper: `pnpm dev:stack`). Localhost subset (web, API, docs; no bots): `pnpm dev:stack:localhost` (the `/run-coordination-manager` command).
   - It does: safe stop (`Code/scripts/stop-servers.js`) -> wait 2s for port release -> launch one PowerShell window per service via `run-dev-service.ps1` -> `check-health.ps1`
   - Use `./start.ps1 -SkipHealthCheck` (`pnpm dev:stack:no-check`) only when the user explicitly asks to skip checks
   - Single service: `pnpm dev:{service}` from `Code/` or repo root (root forwards to `Code/`)
   - `CM_USE_WT=1` opts into Windows Terminal tabs instead of separate windows

2. **Stop** (always through the stop script): `pnpm stop` (runs `node scripts/stop-servers.js`) or `pnpm stop:{web|api|guardian|bot|docs}` from `Code/`; from repo root only stop-all exists: `pnpm dev:stop`.
   - Matches processes by port (Windows `Get-NetTCPConnection`, macOS/Linux `lsof`) and by command-line pattern (all services, not only the bot), excludes VS Code (`Code` and `Code - Insiders`), asks for a graceful stop (`taskkill /PID` on Windows, SIGTERM elsewhere), waits 1.5s, then force kills survivors, then closes the service runner shells
   - A stop-all also deletes `.cm-dev-state.json`; stop markers go in `.cm-stop-markers/`
   - NEVER use `Stop-Process -Name node` or `taskkill /IM node.exe /F` - it kills VS Code

3. **Restart**: all - rerun `./start.ps1` (preferred). `pnpm restart` from `Code/` is different: stop, wait 2s, then `pnpm dev` (concurrently, in the current terminal, no health check). One service: `pnpm restart:{web|api|bot|guardian}` (there is no `restart:docs`).

4. **Port conflict**: find the owner (`Get-NetTCPConnection -LocalPort 5173 | Select-Object OwningProcess`, or `lsof -i :5173`). If VS Code owns it, do not kill it. Clear with `pnpm stop:{service}`.

5. **Verify** (re-run step 1 or 4 if anything fails): `pnpm dev:health` (`pnpm dev:health:localhost` for the subset) runs `check-health.ps1`.
   - It polls up to 45s and needs 4s of consecutive passes; exit code 1 on any FAIL. Web, docs and `http://localhost:3001/health` get HTTP 200 checks; bot is a TCP listener check on 3002; guardian is a node process whose command line contains `discord-guardian`.
   - It also scans the last 120 lines of each service log in `.cm-dev-logs/` (reset on start) for error keywords; a hit fails that service.
   - Bot: console shows "bot logged in as ..."; guardian: console shows rule loading
   - HMR: if hot reload is stuck, restart web

## Gotchas

- `Code/` is the pnpm workspace root (`Code/pnpm-workspace.yaml`). Repo-root `package.json` only forwards dev, dev:{service}, build, test, lint, typecheck, format via `pnpm --dir ./Code`, plus its own `dev:stack*`, `dev:health*` and `dev:stop` scripts; stop:{service}, restart*, test:api and test:web exist only in `Code/`.
- Port 3002 is the bot's internal API, not the guardian.
- All node processes killed (VS Code crash): restart VS Code, then `./start.ps1`.
- Bot fails with invalid token: check DISCORD_BOT_TOKEN in `Code/apps/discord-bot/.env`.
- Guardian errors on startup: set DISABLE_BOT=true or check SUPABASE_URL in its .env.
- The 4GB heap (`--max-old-space-size=4096`) is on the web `dev` script, not `build`; if the web dev server runs out of memory, restart web.

## Key files

- `start.ps1`, `check-health.ps1`, `run-dev-service.ps1` - repo root startup, health check, per-service window runner
- `Code/scripts/stop-servers.js` - safe stop script (run it from `Code/` as `node scripts/stop-servers.js`, or from root as `node ./Code/scripts/stop-servers.js`; accepts web, api, bot, guardian, docs, hmr)
- `.cm-dev-state.json`, `.cm-dev-logs/`, `.cm-stop-markers/` - runtime state, per-service logs, stop markers at repo root
