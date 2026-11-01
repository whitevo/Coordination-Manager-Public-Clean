---
name: testing-strategy
description: Guides test creation across the Coordination Manager monorepo - Vitest config, Supertest API route tests with the Supabase chain-mocking pattern, React Testing Library component tests, live server tests, and the MCP test runner. Use when writing or fixing tests for API endpoints or React components, changing vitest.config.ts, running tests, typechecks or linters, or verifying a regression fix.
---

# testing-strategy

Architecture docs: `docs/public/TESTING_GUIDE.md`. Related skills: react-frontend (component harnesses), express-api (route patterns), security-hardening (security regression tests), dev-server-workflow (health probes), open-source-pipeline (public-sync tests). Use Vitest (never Jest) and React Testing Library (never Enzyme).

## Workflow

1. **Locate or create the test file** (test type: unit, integration, or e2e). Existing suites are listed in the reference.
   - API route: `Code/apps/api/src/routes/__tests__/{route}.test.ts`
   - API middleware: `Code/apps/api/src/middleware/__tests__/{middleware}.test.ts`
   - API service: `Code/apps/api/src/services/__tests__/{service}.test.ts`
   - API general: `Code/apps/api/src/__tests__/{feature}.test.ts`
   - Live server: `Code/apps/api/src/__tests__/public-server/{suite}-live.test.ts`
   - Discord bot / guardian: `Code/apps/discord-bot/src/__tests__/`, `Code/apps/discord-guardian/src/__tests__/`
   - Frontend unit/component: always in a `__tests__/` folder beside the code -- `Code/apps/web/src/{pages,components,lib,hooks,contexts}/__tests__/` (nothing is colocated)
   - Browser E2E: `Code/apps/web/e2e/{feature}.spec.ts` (Playwright)

2. **API route test**: import Supertest and create a test app instance (fresh app per suite). Cover happy path, validation (400 with message), auth (401), and rate-limit headers. Name tests descriptively (`it('returns 400 when title is missing')`), group with `describe`.

3. **Supabase chain mocking** (CRITICAL -- follow exactly):
   ```ts
   const mockFrom = vi.fn()
   const mockSelect = vi.fn()
   const mockInsert = vi.fn()
   const mockEq = vi.fn()
   const mockSingle = vi.fn()
   // ... other chain methods

   // CORRECT: Return bare mock references -- do NOT call .mockReturnThis() here
   function createChain() {
     return {
       select: mockSelect,
       insert: mockInsert,
       eq: mockEq,
       single: mockSingle,
     }
   }

   vi.mock('../../supabaseClient.js', () => ({
     supabaseAdmin: {
       from: (...args: unknown[]) => { mockFrom(...args); return createChain() },
     },
   }))

   beforeEach(async () => {
     vi.clearAllMocks()
     // Set chain behavior AFTER clearing -- this is where .mockReturnThis() goes
     mockSelect.mockReturnThis()
     mockEq.mockReturnThis()
     mockInsert.mockReturnThis()
     await createApp()
   })
   ```
   - **NEVER** call `.mockReturnThis()` inside `createChain()` -- it gets re-invoked on every `from()` call and overwrites queued `mockResolvedValueOnce` values
   - **NEVER** use `vi.restoreAllMocks()` in afterEach -- it strips `vi.mock()` factory implementations. Use `vi.clearAllMocks()` instead
   - **NEVER** set `mockEq.mockResolvedValueOnce()` for a mid-chain `.eq()` call -- it changes the return from chain to promise, breaking subsequent chain methods. Only mock terminal methods (`.single()`, `.maybeSingle()`, `.order()` when terminal)
   - Chains ending in `.eq()` (e.g. `.update().eq().eq()`): the awaited chain object has no `.error` property (undefined = falsy = success). To simulate errors, use `mockImplementation` with a call counter
   - `.in().then()` patterns (like `buildCreatorNameMap`): add a `then` property to the chain: `then: (resolve) => resolve({ data: [], error: null })`
   - Chains ending in `.gte().lte()` (e.g. timeseries queries): mock the terminal `.lte()` with `mockResolvedValueOnce` once per query in call order

4. **Isolation techniques**:
   - Dynamic import so env vars load before init: `const { service } = await import('./module')`
   - `vi.stubEnv('VAR_NAME', 'value')` for env-conditional logic; `vi.stubGlobal('fetch', mockFn)` for HTTP calls
   - Tests needing real credentials: `it.skipIf(!CREDS_AVAILABLE)(...)`, not `it.skip()`
   - **Env-var-gated handlers** (e.g. routes that early-return 500 if `GUARDIAN_BOT_TOKEN` is missing): set the env var inside the test with try/finally restore. Do NOT rely on global setup -- other tests may delete it.
   - **Role-based guards**: when a route uses `hasRole(req, 'moderator')`, mock `hasRole` in the auth-mock factory as `(req, role) => req.userRoles?.includes(role) ?? false` and toggle a `let mockUserRoles` between tests
   - Do not test Supabase RLS directly -- that is database-level

5. **Frontend test** (`Code/apps/web/`, Vitest + React Testing Library):
   - Mock contexts (AuthContext, ThemeContext) with test providers
   - Mock API calls with `vi.mock()` for the api-client
   - Cover: renders, expected content, interactions, loading and error states, auth-gated content hidden when unauthenticated, LearnerHelpIcon visible when learnerMode on or unauthenticated

6. **Browser E2E** (Playwright, `Code/apps/web/playwright.config.ts`, `testDir: ./e2e`): the config starts no server, so run the web app first (`pnpm dev:web` or `pnpm dev:stack`); it targets `E2E_BASE_URL` or `http://localhost:5173`. Run with `pnpm --dir Code/apps/web test:e2e` (`test:e2e:ui` for the UI runner) or MCP `run_playwright`.

7. **Run and verify** (loop: run, fix failures, re-run until green).
   - **AI agent mode** -- prefer the MCP test runner (`.mcp.json` entry `test-runner` -> `tools/test-runner-mcp/index.js`; no terminal approval, ANSI-stripped output):
     - `run_vitest` -- params `app`, `testPath`, `testNamePattern`, `runInBand`, `coverage`, `reporter`, `timeoutMs`
     - `run_typecheck` -- `app` (web, api, discord-bot, discord-guardian, docs, all)
     - `run_lint` -- `files: [...]`, `fix: true`
     - `run_playwright` -- E2E browser tests
     - `run_custom_scenario` -- custom flags and environment overrides
   - **Terminal mode**:
     - All unit tests: `pnpm test` (or `cd Code/apps/api && npx vitest run`)
     - API only: `cd Code && pnpm test:api` (or `pnpm --dir ./Code/apps/api vitest run`)
     - Frontend only: `pnpm test:web` (or `pnpm --dir ./Code/apps/web vitest run`, or `pnpm test:web:copilot` from the repo root)
     - Coverage: `cd Code/apps/api && pnpm test:coverage`; web: `pnpm test:coverage`
     - Typecheck: `pnpm typecheck`; full preflight: `pnpm verify:release` (install, typecheck, lint, tests, audit, builds)

## Gotchas

- Live server tests (`src/__tests__/public-server/`) are excluded from `pnpm test`. From `Code/apps/api`: `pnpm test:public` targets production, `pnpm test:server` targets `http://localhost:3001`; both honour `TEST_SERVER_URL` (20s timeouts).
- A full web run can time out the heavy TimeManagement editor suites (and the reconciliation contract test) under parallel load. Re-run the failing files alone before treating them as regressions.
- Clean up test data in afterAll/afterEach; use `beforeAll`/`afterAll` for setup/teardown.

## References

- [references/test-catalog.md](references/test-catalog.md) -- read when choosing where a new test belongs or checking which suites exist.
