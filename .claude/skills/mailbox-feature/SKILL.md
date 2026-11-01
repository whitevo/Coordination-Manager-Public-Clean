---
name: mailbox-feature
description: Gives the dependency map, change workflow, and test map for the Mailbox feature (Gmail/Outlook sync, automation rules, AI assessment and drafts, invitations) in apps/api and MailboxPage. Use when changing mailbox routes, services, or MailboxPage, debugging sync (stuck progress, missing messages, cursors), editing automation rules, adding endpoints, or writing mailbox tests.
---

# mailbox-feature

Full architecture (data model, API list, sequence diagram, security notes, test map):
`docs/public/MAILBOX_ARCHITECTURE.md` (rendered at `/guides/mailbox-architecture` in `Code/apps/docs`).
API files live in `Code/apps/api/src/{routes,services}/`. Web: the page and its `mailbox-*.ts` helpers live in `Code/apps/web/src/pages/`, editors/panels in `src/components/`.

## Dependency map (read before editing)

```
routes/mailbox.ts
  -> mailbox-sync.ts (runMailboxAccountSync, runPersistedMailboxAutoSync)
       -> mailbox-provider-sync.ts (syncMailboxProviderDelta, Gmail/Graph calls)
            -> mailbox-oauth.ts (token refresh)
            -> mailbox-credentials.ts (encrypted token read)
       -> mailbox-invitations.ts (extractInvitationsForAccount)
  -> mailbox-automation.ts (rule evaluation) -> mailbox-assessment.ts (AI scoring)
  -> mailbox-draft.ts (AI draft generation; called from routes/mailbox.ts for the agent_prompt action)
  -> mailbox-default-rules.ts (seed rules on connect)
  -> mailbox-analytics.ts (read-only aggregation)
  -> mailbox-send.ts (drafts/send)
  -> mailbox-threading.ts (Thread View grouping conditions)

MailboxPage.tsx
  -> mailbox-filters.ts, mailbox-sort.ts (pure state logic, unit-testable)
  -> mailbox-automation.ts / mailbox-automation-assistant.ts (client-side rule validation + AI assistant parsing -- separate from the API's mailbox-automation.ts, keep in sync manually)
  -> mailbox-page-helpers.ts (sanitized HTML iframe, invitation formatting)
  -> mailbox-ai-access.ts (per-tier AI feature gating)
  -> mailbox-notifications.ts, mailbox-pending-trash.ts, mailbox-scan-count.ts (new-mail badge, instant trash projection, scan counts)
  -> components/MailboxSortOrderEditor, MailboxAutomationEditor, MailboxAutomationPanel, MailboxMassActionsPanel
```

## Workflow: feature change

1. **Locate the layer**: sync/provider (`mailbox-provider-sync.ts`, `mailbox-sync.ts`), rule/automation
   (`mailbox-automation.ts`, `mailbox-assessment.ts`), data shape (route handler + migration), or UI
   (`MailboxPage.tsx` + helpers). Most bugs live at a layer boundary (e.g. sync writes a shape the route
   does not expect).
2. **Check the map** for callers; grep the exported symbol before editing.
3. **Account status and cursors**:
   - Routes set `mail_accounts.status = 'connected'` only when an account is first connected. All sync
     transitions (`syncing`/`connected`/`error`) belong to `mailbox-sync.ts`; never change them from route
     handlers, so the 120s timeout (it bounds the whole pipeline: provider delta, automation hook,
     invitation extraction), error classification, and audit-event logging stay consistent.
   - Finalizing writes are checked: a failed cursor, quick-gap, or `mail_accounts` write throws via
     `assertSyncStateWrite` and the sync ends in `error` ("Could not save mailbox sync progress...").
     Only the success audit insert is log-only. Keep new state writes on the checked path.
   - `mail_sync_cursors` is per `(account_id, resource_type)`. Reset only via the account sync path
     (`reset_cursor` option or `/accounts/:id/reset-cursor`), not a raw DB update. A reset nulls the
     `messages` cursor, so the next sync re-fetches everything from `now - daysBack` (the account's
     saved `sync_options.daysBack`, 1-365). The reset-cursor response returns that value as `days_back`
     with "Sync cursor reset. The next sync will re-fetch emails from the past N days."; say so
     whenever you recommend a reset.
   - Quick sync (`new_mail_only`) pages down to the `quick_sync_after` watermark with caps (3 top pages
     per stream, 5 gap pages per run, 45s budget). On a cap it stores gap state in a
     `mail_sync_cursors` row with `resource_type = 'messages_quick_gap'` and keeps the watermark until
     the gap closes; `resolveNextQuickSyncAfter` (`mailbox-sync.ts`) never moves it backward or past
     now. Stored Outlook gap tokens are followed only if they are Graph URLs. Tests:
     `mailbox-provider-incremental.test.ts`, `mailbox-sync.test.ts`.
4. **Audit trail**: sync, rule runs, and account mutations write to `mail_audit_events`. A new mutating
   action needs a matching insert with `operation`, `outcome` AND a short `reason` (e.g.
   `until:2026-11-01T09:00Z`) -- `writeAuditEvent`'s `reason` parameter is optional, so do not pass
   `undefined`. Never message bodies, tokens, or headers in `reason`.
5. **Error classification**: a new sync failure path adds its pattern to the classifier in `mailbox-sync.ts`
   instead of falling through to the generic `"Mailbox sync failed"`.
6. **Rate limiter**: new endpoints calling an external provider or AI model go in the mailbox limiter group
   in `Code/apps/api/src/config/rate-limiters.ts`, not the global default.
7. **Input**: `sanitizeString`/`sanitizeUUID` on every new route parameter; re-derive
   `user_id`/`account_id` from `req.userId`/RLS, never from the client.
8. **New tables**: every `mail_*` table has RLS `USING (auth.uid() = user_id)` (directly or via join to
   `mail_accounts`); template in `Code/packages/database/migrations/000_feature-mailbox.sql`.

## Automation and AI guardrails

- Actions are a fixed list, `EXECUTABLE_AUTOMATION_ACTIONS` (`services/mailbox-automation.ts`): `trash`,
  `junk`, `archive`, `unarchive`, `mark_read`, `mark_unread`, `add_tag`, `remove_tag`, `agent_prompt`.
  They execute once a human sets `mode: active`; trashing/junking via automation is a real, opted-in
  capability. AI-authored rules are clamped to `mode: dry_run|disabled` by the prompt rules in
  `routes/ai-chat.ts` and the client parser `mailbox-automation-assistant.ts`, not by the rule-save
  endpoint; only a human can activate a rule from the UI.
- `DEFERRED_AUTOMATION_ACTIONS` (`reply`, `forward`) are never executed by the rule engine. They model
  sending and stay permanently non-executable; automation/AI must never send or forward mail.
- `agent_prompt` is implemented and is in `EXECUTABLE_AUTOMATION_ACTIONS`: on a human-activated rule match
  it calls `generateDraftReply()` (`mailbox-draft.ts`) with the step's `agentContext`/`agentIntent` and
  inserts a `mail_drafts` row (`status: 'draft'`); it never calls `POST /drafts/:id/send`. It has its own AI
  usage category (`mailbox_draft`) and per-run cap (`AUTOMATION_MAX_DRAFT_CALLS`), separate from
  `mailbox_assessment`.
- The same generator backs manual `POST /messages/:id/draft-suggestion` ("AI: Suggest reply" in compose),
  which only returns text for the human. Keep the asymmetry: AI/automation may create a draft, never send.
- Do not wire `reply`/`forward` into `EXECUTABLE_AUTOMATION_ACTIONS` or let AI output set `mode: active`
  without an explicit product decision and an update to the prompt-injection guardrails in
  `docs/public/MAILBOX_ARCHITECTURE.md` section 6 (Security Model).
- When asked for auto-forward/auto-reply, do not implement sending. Explain the draft-not-send rule and
  offer what the rules already support: an `agent_prompt` step that drafts the forward/reply for human
  review and manual send, and/or `add_tag` so matches land in a tagged view to forward by hand.
- HTML email has two independent XSS layers (server `sanitize-html` + client sandboxed iframe without
  `allow-scripts`/`allow-same-origin`). Treat them as a matched pair; never remove either.

## Workflow: tests

Add tests where the map says (test map: `docs/public/MAILBOX_ARCHITECTURE.md` section 8):

- Route/endpoint -> `Code/apps/api/src/routes/__tests__/mailbox.test.ts`, all four cases: 401 without
  auth, 404 for another user's message/account, 400 on invalid input, happy path (incl. the audit row).
  Auth comes from `router.use(authMiddleware)` in `routes/mailbox.ts`, but this test file's auth mock
  always sets a user; for the 401 case make it toggleable with a hoisted flag
  (`vi.hoisted(() => ({ authenticated: true }))`, as in `routes/__tests__/calendars.test.ts`).
- Sync behavior (cursors, batching, provider quirks) -> `Code/apps/api/src/services/__tests__/mailbox-provider-sync.test.ts`
  (incremental deltas: `mailbox-provider-incremental.test.ts`); status/timeout/error classification -> `mailbox-sync.test.ts`.
- Automation condition/action -> `.../services/__tests__/mailbox-automation.test.ts`; if it touches AI
  scoring also `mailbox-assessment.test.ts` and re-check quota accounting in `ai-usage.ts`.
- Invitation/ICS parsing -> `.../services/__tests__/mailbox-invitations.test.ts` with a realistic VCALENDAR
  fixture (include UID + SEQUENCE to test dedupe).
- Filter/sort/pull-slider logic (pure functions, unit tests over page render) -> matching file in
  `Code/apps/web/src/pages/__tests__/` or `Code/apps/web/src/lib/__tests__/`.
- Automation UI/assistant -> `Code/apps/web/src/pages/__tests__/mailbox-automation.test.ts` or
  `mailbox-automation-assistant.test.ts`.
- Browser flows (OAuth connect, progressive load, trash sequence, thread view settings, tab animation) ->
  `Code/apps/web/e2e/mailbox-*.spec.ts` (Playwright; needs the web app running).
- Scoped runs first: from `Code/apps/api`, `pnpm exec vitest --run src/routes/__tests__/mailbox.test.ts`;
  from `Code/apps/web`, `pnpm exec vitest --run src/pages/__tests__/mailbox-*.test.ts`.

## Gotchas

- "Stuck at 99%" progress means the account never left `syncing`: look for an unhandled throw before the
  `finally`-equivalent status update in `mailbox-sync.ts`, not the UI progress component. The fix
  always finalizes in `mailbox-sync.ts`: status `error` + classified message + a `sync_account`
  failure row in `mail_audit_events` (reason = the classified message), plus a test in `mailbox-sync.test.ts`.
- Missing recent messages after sync usually means a stale/rejected cursor, not a filter bug; reproduce
  with `reset_cursor: true` first, and state that the reset makes the next sync re-fetch from `daysBack`.
- Per-message provider calls or DB queries pass small tests but hit rate limits at real inbox sizes; batch
  (concurrency-limited fetches, single `.in(...)` lookups, bulk upserts).
- Vague errors ("sync failed") are a regression; map each failure path to a classified message.
- Bulk action outcome v1: preserve aggregate fields; validate ordered per-message indexes/action values
  client-side. Treat `uncertain` as unresolved, not a rejection or automatic retry; bookkeeping warnings do
  not undo known-applied effects.
- Page wiring can differ from the original Tier 1 pilot. Inspect the owning code before assuming shared
  hooks are installed; do not overwrite newer page edits with an older migration wholesale.

## Related docs

- `docs/public/UI_STATE_RECONCILIATION.md` - Tier 1 collection guards, immediate trash projection, one
  row-presence owner, regression gates. Preserve the user's filter; partial GET absence is not deletion.
  Strong server/provider guarantees remain pending.
- `docs/private/SECURITY_HARDENING_REPORT_2026-08-27.md` - mailbox security review findings.
