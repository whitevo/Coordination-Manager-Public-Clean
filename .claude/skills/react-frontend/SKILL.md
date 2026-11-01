---
name: react-frontend
description: Guides how to code React 19 frontend work in Code/apps/web - components, pages, hooks, contexts, routing in App.tsx, data fetching with dedupedGet, loading/error states, and ThemeContext. Use when the user asks to create or edit a React component, page, or hook, add a route, fetch data, use Auth/Theme/LearnerMode/AiAssistant contexts, or wire state and events for a modal or panel. Which component, variant, color, motion or overlay layer to use comes from design-system.
---

# react-frontend

All paths are under `Code/apps/web/`. Use the `@/` alias (resolves to `./src`).
This skill covers **how** to code it; for any UI choice (which primitive,
variant, color token, motion, overlay layer) follow the `design-system` skill.

## Workflow

1. **File location**:
   - Pages `src/pages/{FeatureName}Page.tsx`; components `src/components/{FeatureName}.tsx` (newer ones kebab-case)
   - Hooks `src/hooks/use-{feature-name}.ts` (kebab-case; a few live in `src/lib/`, e.g. `use-timezones.ts`);
     contexts `src/contexts/{FeatureName}Context.tsx`
   - Services `src/lib/{feature-name}.ts`

2. **Build the component**:
   - Build UI from the primitives in `src/components/ui/` (barrel `index.ts`) instead of
     hand-styled elements; the current list, defaults and variants are in design-system.
   - Props via a TypeScript interface; colors via token classes (`bg-background`, `text-foreground`,
     `border-border`, `bg-danger`) that flip under `.dark` automatically. Add a `dark:` variant only
     when no token covers the case; never a raw palette class. `date-fns` for dates.
   - Object parameter when a function takes 3+ arguments.
   - `ConfirmDialog` (default export of `src/components/ConfirmDialog.tsx`) for yes/no decisions; it
     defaults to `intent="danger"` / "Delete", so pass `intent="primary"` for non-destructive ones.
     `LearnerHelpIcon` for contextual help (shown when learnerMode is on or the user is unauthenticated).
   - Never hardcode API URLs; use `VITE_API_URL`. Session data goes in `sessionStorage`. Logout (`signOut()` in
     `src/lib/auth-service.ts`) clears all of sessionStorage but only a fixed `USER_SPECIFIC_KEYS` list in
     localStorage: add any new per-user localStorage key to that list.
   - Extract logic into hooks when a component grows complex.

3. **Contexts** (nesting in `main.tsx`):
   ErrorBoundary > BrowserRouter > SetupProvider > AuthProvider > ThemeProvider > LearnerModeProvider >
   ToastProvider > AppWithRecovery > App
   - `useAuth()` -> `{ user, isAuthenticated, isTraveler, isCardano }`
   - `useTheme()` -> `{ isDark, mode, activeThemeId, customThemes }`
   - `useLearnerMode()` -> `{ learnerMode }`
   - `useAiAssistant()` -> `{ pageContext, setPageContext }`; `AiAssistantProvider` is mounted inside
     `Layout`, so outside Layout routes it silently returns no-op defaults
   - `LayoutContext` provides the side panel slots (`LeftPanelSlot`, `RightPanelSlot`, `LeftPanelPortal`)

4. **Data fetching** (client in `src/lib/api-client.ts`):
   - Use `dedupedGet(url, config?)` for GETs (coalesces identical concurrent calls by URL+params).
   - Axios interceptor injects the Supabase token (session lookup raced against 3s; requests time
     out at 30s). A 401 triggers one single-flight token refresh and a retry; it redirects to login only
     when the refresh itself fails with a session-ending error, otherwise the request just rejects.
   - Handle loading, error, and empty states. Early-return a loading/error view only for the initial
     load when no usable content exists; background refresh loading/errors keep the content, local
     drafts, selection, and viewport.
   - Rate-limit soft warning: listen for `RATE_LIMIT_WARN_EVENT` (admins: persisted in localStorage
     until dismissed or logout, no expiry; users: auto-clears after 2 min without new warnings).
   - Collection pilots (currently `FeedbackPage`) use `useResourceReconciliation`;
     call `guard.beginMutation(id)` before a write and `guard.endMutation(op)` after.
     - `guard.read` owns shared-read metadata; do not wrap it in a second deduplication layer.
     - Partial observations only upsert; failed reads never imply deletion.
     - Use operation-owned rollback, not a whole-list snapshot; preserve later/unrelated work.
     - Motion is presentation-only (`useListPresence` for list exits); respect reduced motion and inert ghosts.
     - Run shared contracts plus domain regressions; add an executable catalog scenario for new behavior.
     - Tier 1 guards do not prove causal server ACK coverage, safe retries, or cross-device conflict ordering.
     - Contract: `docs/public/UI_STATE_RECONCILIATION.md`.

5. **Routing** (`src/App.tsx`):
   - Lazy-load every page: `const NewPage = lazy(() => import('./pages/NewPage'))`; Suspense fallback is a
     full-screen centered spinner.
   - Outside Layout: auth (`/auth/login`, `/auth/callback`), guest (`/join/invite/:code`,
     `/join/:hash`), and legal/standalone pages (`/policy`, `/privacy`, `/trademark`, `/terms`,
     `/email-abuse`, `/zoom-review`, `/proposals/*`).
   - One `<Route path="/" element={<Layout key={user?.id ?? 'anon'} />}>` holds the rest (remounts on account
     switch; `/setup` only when `isSetupAccessible()`). Public pages sit directly in it;
     protected pages sit in a nested pathless `<Route element={<ProtectedRoute><Outlet /></ProtectedRoute>}>`.
   - Fallback `<Route path="*" element={<NotFoundPage />} />`. Use a `key` prop to force remount on
     param change. BrowserRouter uses v7 future flags `v7_relativeSplatPath`, `v7_startTransition`.

## Gotchas

- `ErrorBoundary` already wraps the whole app (render errors show a reload button).
- Layout has a health-check banner (polls `/health` every 30s, shows after 2 failures).
