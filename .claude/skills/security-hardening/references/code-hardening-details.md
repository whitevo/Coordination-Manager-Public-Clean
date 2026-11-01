# Code Hardening Details

Rarely needed detail moved out of SKILL.md.

## Contents
- NanoID note
- Protected URL locations
- CORS
- Logging
- Discord bot
- WebSocket security (when added)

## NanoID note

NanoID(10) has ~1 trillion combinations. This provides defense-in-depth against
enumeration but is less collision-resistant than the default NanoID(21). Back it with
rate limiting + monitoring to make brute-force attempts noisy and expensive.

## Protected URL locations (isSafeUrl or inline scheme check)

Under `Code/apps/web/src/`. `isSafeUrl` is defined in `lib/calendar-utils.ts`.

- `pages/CalendarPage.tsx` -- meeting links, community resource URLs
- `pages/CoordinateEventsPage.tsx` -- event meeting links, sub-meeting links
- `pages/EventsCalendarPage.tsx` -- event meeting links
- `pages/MeetingPage.tsx` -- meeting join button
- `components/MeetingSidePanel.tsx` -- Luma event URL, Zoom auth URL
- `pages/GuestBookingPage.tsx` -- onboarding URL
- `pages/TimeManagementPage.tsx`, `pages/time-management-markdown-composer.tsx`, `lib/note-link-utils.ts` -- note and markdown links
- `pages/SettingsPage.tsx` -- Google/Zoom OAuth redirects (inline `^https://` check)
- `pages/GuardianPage.tsx` -- bot invite URL (inline `^https://` check)
- `pages/MailboxPage.tsx` -- invite location before `window.open` (inline `^https?://` check)
- local `LinkifyText` functions in `CoordinateEventsPage.tsx` and `MeetingPage.tsx` -- regex-extracted, only match `https?://`
- `lib/link-safety.ts` -- display-only helpers for the mailbox viewer (not a scheme guard)

## CORS

- Strict allowlist for `Access-Control-Allow-Origin` (never `*`, never reflect Origin)
- The API currently allows requests with no `Origin` header (`Code/apps/api/src/index.ts`); do not treat CORS as a barrier for non-browser clients
- CORS is NOT CSRF protection -- it only controls browser cross-origin requests

## Logging

- Use `morgan('short')` or custom format in production (not `'dev'`)

## Discord bot

- Always set `allowedMentions: { parse: [] }` to suppress @everyone/@here
- Validate announcement content length before sending (Discord limit: 2000 chars; API cap `ANNOUNCEMENT_BODY_MAX_LENGTH` is 1800 in `Code/apps/api/src/middleware/validation.ts`)
- API-to-bot and bot-to-API calls use the `X-Bot-Secret` header, verified with `timingSafeEqual()` (bot internal API on port 3002)
- `BOT_API_SECRET` has no fallback default; the bot refuses to start without it. Keep it that way

## WebSocket security (no WebSockets in the code today; verified, no `ws`/socket.io dependency)

- Validate `Origin` header during handshake (prevent Cross-Site WebSocket Hijacking)
- Use `wss://` (TLS) for all socket traffic carrying sensitive data
- Authenticate during handshake AND validate authorization per message type
- DoS controls: connection limits, per-user limits, message size limits
  (recommend 64KB max), rate limiting per connection, heartbeats, backpressure
- Rotate tokens for long-lived connections
- Log security events (auth failures, validation failures, rate-limit triggers) without sensitive payload or token data
- Never `eval()` message content -- use `JSON.parse()` only
- Log connect/disconnect, auth failures, validation failures without logging tokens
- Testing: use ZAP's WebSocket tab to intercept/replay/fuzz
