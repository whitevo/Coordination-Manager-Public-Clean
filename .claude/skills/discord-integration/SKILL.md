---
name: discord-integration
description: Covers the two Discord bots - the main bot in apps/discord-bot (slash commands, platform linking, announcements, channel sync, internal API) and the guardian in apps/discord-guardian (rule groups, message scanning, caching, flagged-message logs). Use when adding or changing slash commands, editing guardian moderation rules or actions, working on Discord account linking or link keys, posting announcements to channels, or guild and channel discovery. Not for the API-side middleware (use express-api) or table schemas (use supabase-database).
---

# discord-integration

First decide the target: `discord-bot` (steps 1-5) or `discord-guardian` (steps 6-8). Step 9 covers the shared linking tables.

## Workflow

1. **Main bot** (`Code/apps/discord-bot/`):
   - Intents: Guilds, GuildMessages, DirectMessages, MessageContent, GuildMembers (privileged ones only if needed).
   - Env: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `API_URL`, `FRONTEND_URL`, `BOT_API_SECRET`,
     `BOT_API_PORT` (default 3002), `SUPABASE_URL`, `SUPABASE_SECRET_KEY_LOCALHOST` / `SUPABASE_SECRET_KEY_PRODUCTION`, `DISABLE_BOT`. The
     bot refuses to start without `BOT_API_SECRET` (exits 0 so it shows as "disabled"); calls to the main
     API and to the bot's internal API carry it as `X-Bot-Secret` (API-side middleware: `express-api`;
     var list: `environment-variables`). Missing token/client id or Supabase config also exit 0.
   - Each bot reads `DISCORD_BOT_TOKEN` from its own app `.env`; never share one token between bots.
   - NODE_ENV=production selects PRODUCTION; other modes select LOCALHOST. The selected key is required; no legacy fallback.

2. **Slash commands** (existing):
   - `/link <key>` and the DM fallback both call `linkDiscordAccount` (`link-flow.ts`): validate the key, reject
     used/expired keys or another user's key, deactivate old integrations, expire the key (single use), start
     the background guild sync.
   - `/status` shows link status; `/channels` lists channels the bot can post in; `/feedback <message>` submits platform feedback.
   - `/optout status|undo` (`optout-flow.ts`): show or remove all of the user's `dm_opt_outs` rows (global and per-sender).
   - Register with `REST.put(Routes.applicationCommands(clientId), { body: commands })`; handle in
     `client.on(Events.InteractionCreate, ...)`.
   - Only `/link` defers (`deferReply({ flags: 64 })`); the others use `reply({ flags: 64 })`.
   - Put command logic in a module with injected deps (`link-flow.ts`, `optout-flow.ts`, `dm-flow.ts`) so it is unit
     testable; `index.ts` has top-level side effects and no tests.

3. **Add a slash command**:
   - Add a `SlashCommandBuilder` entry to the commands array, add options, add a handler case in the
     InteractionCreate listener (`deferReply()` for long operations).
   - Test in a specific guild before global registration.

4. **Bot internal API** (Express, port `BOT_API_PORT`, default 3002):
   - `POST /sync-channels` - guild channel sync (checks bot and user permissions separately).
   - `POST /list-dm-members` - SSE stream: phase 1 discovery, phase 2 paginated by cursor in 1000-item batches.
   - `POST /check-permissions` - batch permission checks by channel ID.
   - `POST /guild-emojis` - custom emojis from guilds the user shares with the bot.
   - `POST /delete-messages` - deletes posted channel messages / DMs (`delete-flow.ts`, max 500 items, unknown
     message counts as deleted); called by `POST /api/announcements/schedules/:id/delete-messages`, which
     enforces schedule ownership and records `announcement_delivery_log.deleted_at` / `delete_error`.
   - Guild sync upserts channels with conflict resolution to preserve user selections.

5. **DM fallback handler** (non-slash messages): stop/opt-out/unsubscribe keywords insert into `dm_opt_outs`;
   a message that looks like a link key (`sc-` prefix or 20+ hex/dash chars) runs the same
   `linkDiscordAccount` as `/link`; anything else gets help text. Opt-out replies point to `/optout undo`.
   Button flows (`dm_subscribe:`, `dm_optout:`) live in `dm-flow.ts`.
   - Announcements: `processAnnouncements` polls `announcement_schedules` every 30s (`status=pending`,
     `source_env=NODE_ENV`, 10 per batch); items more than 15 minutes past `scheduled_at` are auto-cancelled.

6. **Guardian** (`Code/apps/discord-guardian/`, own token and client):
   - Intents: Guilds, GuildMembers, GuildMessages, MessageContent, GuildMessageReactions, DirectMessages, DirectMessageReactions. Env: `DISCORD_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY_LOCALHOST` / `SUPABASE_SECRET_KEY_PRODUCTION`, `DISABLE_BOT`; optional `GUARDIAN_INSTANCE_LABEL`, `GUARDIAN_FORCE_TAKEOVER` (single-instance lock in `guardian_instance_lock`). It reads no `DISCORD_CLIENT_ID`.
   - Rule groups (global, not per guild): `{ id, name, is_enabled, action_delete_message, action_timeout_member, action_timeout_duration, action_ban_member }`.
   - Rules: `{ id, group_id, pattern, pattern_type ('regex'|'wildcard'), is_enabled }`.
   - Wildcard `*` compiles to `.*` (escape all other regex chars, case-insensitive).

7. **Guardian scanning** (short-circuit, first match wins), in order: forum post title (starter
   message only), message content, forwarded snapshots, embeds (title, description, url, author, footer,
   provider, image/thumbnail/video URLs, fields combined), attachment URLs and filenames. Replied-to (referenced) messages are
   deliberately not scanned.
   - On match run group actions in order: flag log, delete, timeout; ban runs last, after the user DM (2.5s delay). Actions are logged in `guardian_action_log`; the ban registry lives in `ban-registry.ts`.
   - Reason format: `Guardian auto-<action>: matched rule group "<name>"`.
   - Moderator undo (API, not the bot): `POST /api/guardian/flagged/:id/unban|untimeout` (`routes/guardian-actions.ts`)
     calls Discord REST with `GUARDIAN_BOT_TOKEN`, logs `unban`/`unmute` with `actor_user_id`, and refuses (409) to
     unban a user on the global Ban list -- remove them from the Ban list instead.

8. **Guardian caching and logging**:
   - Rules refresh every 30s from Supabase, so rule changes take up to 30s to propagate; ignored roles
     (key `guild_id:role_id`), disabled channels, category and thread defaults, and notification config
     refresh every 60s; compiled RegExp cache rebuilt on refresh.
   - Tables: `guardian_message_log` (all scanned), `guardian_flagged_messages` (violations only).
     Edits get a separate row with an incremented version number.

9. **Platform-Discord linking** (schemas: `supabase-database`):
   - `discord_integrations`: `{ user_id, link_key, link_key_expires_at, discord_user_id, bot_verified, is_active }`.
     There is no separate keys table: the API (`POST /api/discord/generate-key`) writes `sc-` + 32 hex into
     `link_key` with a 24-hour expiry. A successful link sets `link_key_expires_at` to the link time, so the
     key cannot be reused.
   - `discord_guild_channels`: discovered channels per guild; the FK cascades on integration row delete, not on
     deactivation (`DELETE /api/discord/integration` only sets `is_active=false`).
   - `guardian_server_roles`: role data for guardian ignore lists (`is_ignored`).

## Gotchas

- Handle Discord 429 rate limits.
- Log bot security events (token use, permission errors) without logging tokens.
- Grant minimal bot permissions; audit privileged intents (MessageContent, GuildMembers, GuildPresences) periodically.

## Key files

- `Code/apps/discord-bot/src/` - bot commands
- `Code/apps/discord-guardian/src/` - guardian rules
- `Code/apps/api/src/routes/discord.ts` - Discord routes
- `Code/packages/database/migrations/` - integration tables
