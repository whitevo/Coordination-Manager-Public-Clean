# Coordination Manager Testing Guide

This guide describes the testing architecture, environments, and execution workflows across the Coordination Manager monorepo.

---

## 1. Testing Philosophy & Execution Models

To balance fast feedback, deterministic CI verification, and friction-free AI-assisted development, Coordination Manager uses two complementary execution models:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      AI / Automated Workflow                           │
│  - Method: Local MCP Test Runner (tools/test-runner-mcp/index.js)     │
│  - Interface: JSON-RPC over stdio (tools: run_vitest, run_typecheck,   │
│               run_lint, run_playwright, run_custom_scenario)          │
│  - Benefits: Zero terminal approval popups, ANSI-stripped output,      │
│              custom test scenario parameters without shell scripting  │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                   Developer / Operational Workflow                     │
│  - Method: Interactive PowerShell Terminal & pnpm Workspaces          │
│  - Interface: CLI commands (pnpm test, pnpm dev:stack, scripts/*.ps1) │
│  - Benefits: Interactive watch modes, full terminal logs, live server │
│              orchestration, multi-step release loops                   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. MCP vs. Terminal: When to Use Which

| Task / Scenario | Recommended Method | Why |
| :--- | :---: | :--- |
| **Unit & Integration Tests** (`vitest`) | **Local MCP Runner** | One-shot execution; structured JSON-RPC returns exact failure diffs without terminal approval friction. |
| **Typechecks & Linters** (`tsc`, `eslint`) | **Local MCP Runner** | Fast verification; clean output without shell escaping errors. |
| **E2E Browser Tests** (`playwright`) | **Local MCP Runner** | Headless browser test execution with clean exit code resolution. |
| **Custom Scenario / Env Tests** | **Local MCP Runner** | Pass custom CLI arguments and environment variables directly in JSON. |
| **Interactive Test Watch Mode** (`vitest --watch`) | **Terminal** | Developer interactive TDD sessions requiring hot reloading. |
| **Stack & Server Orchestration** (`start.ps1`, `pnpm dev:stack`) | **Terminal** | Long-running daemon processes listening on network ports. |
| **Release & Git Pipelines** (`release-open-source-loop.ps1`) | **Terminal** | Multi-phase operational workflows with Git staging and remote branching. |

---

## 3. Test Suites & Architecture

The monorepo contains several test layers across different packages:

### a) Web Frontend (`Code/apps/web`)
- **Framework**: Vitest + React Testing Library + JSDOM
- **Concurrency**: capped at one Vitest worker to avoid CPU contention and false editor-test timeouts in the default workspace run. Assertions and test timeouts remain unchanged.
- **Location**: `src/pages/__tests__/`, `src/components/__tests__/`, `src/lib/__tests__/`
- **Coverage Areas**:
  - Time Management matrix, Tiptap markdown editor synchronization, and multi-select cohorts
  - Availability calendar grid interactions, timezone selection, and event overlaps
  - Navigation, theme toggles, and authentication state wrappers
  - Feedback and Support saved status ordering after page remount, server-paginated
    card selection, next-page prefetch, and page-size changes. Restoring a saved
    order must reload the corresponding page data, not just reorder the controls.

### b) Express API Backend (`Code/apps/api`)
- **Framework**: Vitest + Supertest with mocked Supabase client
- **Location**:
  - `src/routes/__tests__/`: Endpoint validation, route authorization, and rate limiting (12+ suites)
  - `src/services/__tests__/`: Mailbox OAuth sync, Turnstile captcha, SMTP email dispatch, account merging
  - `src/middleware/__tests__/`: Auth middleware, string/UUID sanitization, error handlers
  - `src/__tests__/public-server/`: Live smoke tests running against deployed staging/production API

### c) Discord Bot & Guardian (`Code/apps/discord-bot`, `Code/apps/discord-guardian`)
- **Framework**: Vitest
- **Location**: `src/__tests__/`
- **Coverage Areas**:
  - Discord DM state machines and interactive calendar scheduling commands
  - Guardian moderation rules, message-history checks, and timeseries rate tracking

### d) Browser End-to-End (`Code/apps/web/e2e`)
- **Framework**: Playwright
- **Coverage Areas**:
  - Full browser lifecycle tests (login flows, left-panel close behaviors, modal interactions)

### Dev stack health and CSS regression checks

From the repository root:

```powershell
powershell -NoProfile -File .\scripts\test-dev-health.ps1
pnpm --dir Code/apps/docs exec node scripts/verify-css.mjs
```

The health regression script uses temporary logs, mocked HTTP responses, and a
short-lived native process. It does not start or stop the running stack. It covers
warning/error classification, CSS probes, summary exit codes, and native
stdout/stderr capture. The CSS check runs a fresh docs PostCSS/Vite transform and
asserts that generated declarations retain source filenames.

Live verification: `pnpm dev:health:localhost`. In addition to HTTP availability,
health checks request the web and docs CSS entrypoints (`?direct`) to exercise
PostCSS and reject HTML fallbacks or empty CSS. Service windows persist stdout
and stderr in `.cm-dev-logs/`, reset on stack startup.

- `PASS`: transport and console diagnostics are clean.
- `WARN`: services respond, but warnings/deprecations remain or logs are
  missing/empty. The summary explicitly reports warnings; exit code remains 0.
- `FAIL`: transport/CSS probes fail, a log cannot be read, or console errors
  occur. Exit code is 1. Errors take precedence over warning text on the same line.

By default the checker scans the entire current-session log, so a one-time
warning cannot disappear behind later output. `-LogTailLines N` explicitly limits
the scan if needed. The checker reports diagnostics; it never edits source or
automatically suppresses warnings.

The docs animation keyframes live in CSS rather than the legacy Tailwind config.
Config-generated keyframes had no source filename, triggering Vite's PostCSS
missing-`from` warning even though those declarations contained no asset URLs.
Moving the same definitions to CSS preserves their source metadata and animation
behavior without filtering out the warning or changing dependencies.

### e) Conditional Time Item recurrence (disposable PostgreSQL)

Migrations 034 and 035 change database triggers, locking, unique occurrence windows,
and latest-only Time Item completion.
Mocked API tests cannot prove those guarantees. Run the SQL lifecycle and two-connection
concurrency tests in a new disposable database named `conditional_recurrence_test`.
Never run the fixture against an application database.

From the repository root, using Docker and PowerShell:

```powershell
docker run --name cm-recurrence-test --env POSTGRES_HOST_AUTH_METHOD=trust --env POSTGRES_DB=conditional_recurrence_test --detach postgres:16-alpine
docker exec cm-recurrence-test pg_isready -U postgres -d conditional_recurrence_test
Get-Content -Raw "Code\packages\database\tests\conditional-recurrence-fixture.sql" | docker exec -i cm-recurrence-test psql -U postgres -d conditional_recurrence_test -v ON_ERROR_STOP=1
Get-Content -Raw "Code\packages\database\migrations\archive\034_time_item_conditional_recurrence.sql" | docker exec -i cm-recurrence-test psql -U postgres -d conditional_recurrence_test -v ON_ERROR_STOP=1
Get-Content -Raw "Code\packages\database\migrations\archive\035_time_item_completion.sql" | docker exec -i cm-recurrence-test psql -U postgres -d conditional_recurrence_test -v ON_ERROR_STOP=1
Get-Content -Raw "Code\packages\database\tests\conditional-recurrence.sql" | docker exec -i cm-recurrence-test psql -U postgres -d conditional_recurrence_test -v ON_ERROR_STOP=1
Get-Content -Raw "Code\packages\database\tests\conditional-recurrence-concurrency.sql" | docker exec -i cm-recurrence-test psql -U postgres -d conditional_recurrence_test -v ON_ERROR_STOP=1
docker stop cm-recurrence-test
docker rm cm-recurrence-test
```

Wait for `pg_isready` to report readiness before applying the fixture. The lifecycle
suite checks schedule alignment, UTC/DST behavior, end-time gating, future-only
catch-up, preserved duration/configuration, ownership, immutable history, atomic latest-only
item completion, reset completion on new occurrences, and stable completion timestamps on retries.
The concurrency suite holds one transaction open while a second generator waits,
then verifies duplicate suppression and generation blocked by committed completion.
Reapply migrations 034 then 035 to verify idempotence; 035 must remain the final completion function.

---

## 4. Local MCP Test Runner Reference

The local test runner server is located in `tools/test-runner-mcp/index.js` and registered as `test-runner` in the repo-root `.mcp.json`. Both are maintainer-local tooling and are not included in the public repository; public contributors use the terminal workflow above.

### Available Tools & Parameter Reference

#### 1. `run_vitest`
Runs Vitest tests deterministically across packages.
```json
{
  "app": "web",                          // "web" | "api" | "discord-bot" | "discord-guardian" | "docs" | "all"
  "testPath": "TimeManagementPage.test", // optional file path or regex filter
  "testNamePattern": "multi-select",     // optional -t pattern filter
  "runInBand": false,                    // run serially with --no-threads
  "updateSnapshots": false,              // update snapshots with -u
  "coverage": false,                     // generate coverage report
  "reporter": "default",                 // "default" | "dot" | "verbose" | "json"
  "timeoutMs": 180000
}
```

#### 2. `run_typecheck`
Runs TypeScript compilation checks (`tsc --noEmit`).
```json
{
  "app": "all",                          // "all" | "web" | "api" | "discord-bot" | "discord-guardian" | "docs"
  "timeoutMs": 120000
}
```

#### 3. `run_lint`
Runs ESLint on specified files or whole packages.
```json
{
  "app": "web",                          // "web" | "api" | "docs" | "all"
  "files": ["src/pages/HomePage.tsx"],   // optional specific relative files
  "fix": false,                          // auto-fix fixable issues
  "timeoutMs": 120000
}
```

#### 4. `run_playwright`
Runs Playwright end-to-end browser suites.
```json
{
  "app": "web",
  "testPath": "time-management",         // optional spec path
  "headed": false,                       // run with browser UI visible
  "project": "chromium",                 // "chromium" | "firefox" | "webkit"
  "timeoutMs": 240000
}
```

#### 5. `run_custom_scenario`
Runs arbitrary custom testing scenarios with tailored arguments and environment overrides.
```json
{
  "app": "web",                          // target directory
  "tool": "vitest",                      // "vitest" | "tsc" | "eslint" | "playwright" | "pnpm"
  "args": ["run", "--reporter=verbose"], // CLI arguments
  "env": { "TEST_MODE": "mocked" },      // custom environment variables
  "timeoutMs": 180000
}
```

---

## 5. Developer Terminal Command Cheat Sheet

For interactive terminal sessions, execute from repository root or the `Code/` directory:

### Monorepo-Wide (From Root)
```powershell
pnpm test             # Run all tests across all packages
pnpm lint             # Lint all packages
pnpm typecheck        # Typecheck all packages
pnpm verify:release   # Full preflight quality & security checks
```

### Targeted Package Testing
```powershell
# Web frontend
pnpm --dir ./Code/apps/web vitest run
pnpm --dir ./Code/apps/web vitest run src/pages/__tests__/TimeManagementPage.test.tsx

# API backend
pnpm --dir ./Code/apps/api vitest run
pnpm --dir ./Code/apps/api test:public   # Run live server smoke tests

# Discord bots
pnpm --dir ./Code/apps/discord-bot vitest run
pnpm --dir ./Code/apps/discord-guardian vitest run
```

---

## 6. Repository Skills & Cross-References

Refresh/mutation/motion changes must also run the shared contracts and affected
domain regressions in [UI State and Refresh Reliability](./UI_STATE_RECONCILIATION.md).
Use delayed/out-of-order observations and inspect intermediate membership; final
screenshots alone can miss temporary resurrection. Initial loading may replace an
empty view, but a background read failure must preserve usable content. Native
pointer and keyboard verification remains necessary alongside fixture tests.

The following Claude & Copilot skills govern testing, quality assurance, and deployment standards in this codebase:

| Skill | Purpose & Relationship |
| :--- | :--- |
| **`testing-strategy`** | Definitive patterns for Vitest, React Testing Library, Supertest, and Supabase mock chains. |
| **`security-hardening`** | Gitleaks secrets detection, dependency audits, CSP headers, and security premerge checks. |
| **`dev-server-workflow`** | Safe startup, port checks, and teardown for the 5 local development services. |
| **`open-source-pipeline`** | Pre-sync verification, automated test validation, and sanitized release packaging. |
| **`react-frontend`** | Standards for React component test harnesses and hook testing. |
| **`express-api`** | Standards for Express route test suites, Supertest integration, and error response validation. |
