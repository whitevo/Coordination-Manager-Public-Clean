# Test catalog

Existing test suites and what each covers. Read when deciding where a new test
belongs or whether a suite already exists.

## API route tests (`Code/apps/api/src/routes/__tests__/`; partial list, see the directory for the rest)

- `auth.test.ts` -- POST /guest, GET /me, PUT /profile, POST /logout
- `calendars.test.ts` -- POST /, GET /:hash
- `availability.test.ts` -- POST add/remove, GET /:hash, DELETE
- `meetings.test.ts` -- POST, GET /single/:id, GET /:hash, PUT, DELETE
- `discord.test.ts` -- GET /integration, POST /generate-key, DELETE /integration, GET /guilds
- `connections.test.ts` -- POST /invites, POST /invites/accept, GET /, DELETE
- `admin.test.ts` -- GET user list, POST silence, POST unsilence, POST moderator
- `feedback.test.ts` -- POST, GET, PATCH /:id
- `email-contacts.test.ts` -- GET, POST
- `wallet-auth.test.ts` -- POST /challenge, POST /verify, session handling
- `calendar-sources.test.ts` -- GET, POST, DELETE, Google OAuth callback, busy times
- `user-events.test.ts` -- manual items, imported-event reconciliation
- `guardian.test.ts` -- /access, rule-groups CRUD, rules CRUD + bulk, notification-channels validation, timeseries bucketing, reconcile-state, bot-invite, message-history, server roles/channels

## Middleware, service, and general tests

- Middleware (`Code/apps/api/src/middleware/__tests__/`):
  - `auth.test.ts` -- authMiddleware, optionalAuthMiddleware
  - `validation.test.ts` -- sanitizeString, sanitizeUUID, safeErrorMessage
  - `error-handler.test.ts` -- error handler middleware
- Services (`Code/apps/api/src/services/__tests__/`):
  - `signup-rate-tracker.test.ts` -- rate tracking, captcha status
  - `email.test.ts` -- SMTP email sending
  - `captcha.test.ts` -- Turnstile captcha verification
  - `account-merge.test.ts` -- createMergeToken, mergeAccounts
  - `google-event-sync.test.ts` -- Google payload (RRULE/EXDATE, instance overrides), Google-side change detection
- General (`Code/apps/api/src/__tests__/`):
  - `timezone-handling.test.ts` -- timezone parsing and conversion

## Live server tests (`Code/apps/api/src/__tests__/public-server/`)

- `server-health.test.ts` -- health check endpoint
- `auth-flow-live.test.ts` -- OAuth, traveler, wallet auth flows
- `wallet-auth-live.test.ts` -- CIP-30 signing end-to-end
- `public-data-live.test.ts` -- public calendar/meeting reads
- `integrations-live.test.ts` -- Discord, calendar integrations

## Discord bot (`Code/apps/discord-bot/src/__tests__/`)

- `dm-flow.test.ts` -- DM flow state machine

## Browser E2E (`Code/apps/web/e2e/`, Playwright)

- Mailbox flows (`mailbox-*.spec.ts`), quick menu navigation, add-to-calendar panel mode, asset recovery, design snapshot

## Frontend (`Code/apps/web/src/lib/__tests__/`; also `pages/`, `components/`, `hooks/`, `contexts/` `__tests__`)

- `calendar-utils.test.ts` -- calendar utility functions
- `calendar-overlap-layout.test.ts` -- overlap layout algorithm
- `timezone-data.test.ts` -- timezone data handling
- Many more suites live in `Code/apps/web/src/pages/__tests__/`
