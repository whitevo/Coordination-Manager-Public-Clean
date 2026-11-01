---
name: monorepo-conventions
description: Guides pnpm workspace work in the Coordination Manager monorepo - adding dependencies with --filter, root workspace scripts in Code/package.json, the shared packages/database package, concurrently-based multi-process dev, and cross-app build issues. Use when adding or updating dependencies, changing workspace scripts, fixing cross-package import or build errors, or running build, test or lint across apps. Not for starting or stopping the dev stack (use dev-server-workflow) or dependency review policy (use supply-chain-security).
---

# monorepo-conventions

## Workflow

1. **Add dependencies with a filter** (never add app-specific deps to root package.json):
   - `pnpm add <package> --filter @coordination-manager/{web|api|discord-bot|discord-guardian|docs}`
   - Dev deps: `pnpm add -D <package> --filter @coordination-manager/{app}`
   - Other filters: `@event-scheduler/database`
   - Use pnpm only (not npm or yarn). Review policy for new or updated dependencies: supply-chain-security.

2. **Run workspace scripts from `Code/`** (the pnpm workspace root; config in `Code/pnpm-workspace.yaml`, `Code/package.json`). Repo-root `package.json` forwards only dev, dev:{service}, build, test, lint, typecheck, format to `Code/` (plus its own `dev:stack*`, `dev:health*`, `dev:stop`); test:api, test:web, lint:fix and stop/restart scripts are `Code/`-only:
   - `pnpm dev` (all five services via concurrently), `pnpm dev:{web|api|bot|guardian|docs}`
   - `pnpm build` (`pnpm -r build`), `pnpm test` / `test:api` / `test:web` / `test:coverage` (`test:public` exists only in the api package: `pnpm --filter @coordination-manager/api test:public`)
   - `pnpm lint` / `lint:fix`, `pnpm typecheck`, `pnpm format`
   - Start, stop, restart and health of the dev stack: dev-server-workflow.
   - `pnpm -r` skips packages that lack the script: the bot and guardian have no `lint`, docs has no `test`, the guardian has no `typecheck`.

3. **Build details**:
   - The 4GB heap (`--max-old-space-size=4096`) is on the web `dev` script; `build` is `tsc && vite build`
   - `build:with-docs` (web package script) builds frontend + docs into one dist (used by Vercel)
   - Guardian supports `DISABLE_BOT=true` for local dev without Discord
   - pnpm security config (`allowBuilds`, `blockExoticSubdeps`, `minimumReleaseAge`, `overrides` in `Code/pnpm-workspace.yaml`): supply-chain-security

4. **Shared database package** (`Code/packages/database/`, package name `@event-scheduler/database`, a stale name from before the rename): SQL migrations plus a tiny `src/index.ts` built by `pnpm -r build`; private, not published, and not imported by any app. Run migrations via Supabase SQL Editor or Supabase CLI.

5. **Multi-process dev**: `concurrently` (not Turborepo). Each app has its own `dev` script. Hot reload is per app: Vite HMR for web and docs, tsx watch for API, bot and guardian.

6. **Formatting**: Prettier in `Code/.prettierrc`, EditorConfig in `Code/.editorconfig`.

7. **Engines**: Node >= 26.12.1 (`engines` in `Code/package.json` and the api/bot/guardian packages), pnpm >= 12.0.0 (packageManager pnpm@12.15.0). pnpm 11+ reads all settings from `Code/pnpm-workspace.yaml`, not the `"pnpm"` field of `package.json`. Recursive runs stop at the first failing package; add `--no-bail` (`pnpm -r --no-bail test`) to see every failure.

## Workspace layout

Workspace members (`Code/pnpm-workspace.yaml`): `apps/*`, `packages/database`.

```
Code/
  apps/api/              @coordination-manager/api (port 3001)
  apps/web/              @coordination-manager/web (port 5173)
  apps/discord-bot/      @coordination-manager/discord-bot (port 3002 internal API)
  apps/discord-guardian/ @coordination-manager/discord-guardian
  apps/docs/             @coordination-manager/docs (port 5174)
  packages/database/     @event-scheduler/database (SQL migrations + schema, not published)
  shared/                site-discovery.ts (shared TS file, NOT a workspace member)
```

## Gotchas

- NEVER use `Stop-Process -Name node` or `taskkill /IM node.exe /F` (kills VS Code). Use the stop script (dev-server-workflow).
