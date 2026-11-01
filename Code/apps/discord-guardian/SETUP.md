# Demon X - Setup & Deployment Guide

## 1. Create a Discord Bot Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it (e.g. "Demon X")
3. Go to the **Bot** tab:
   - Click **Reset Token** to generate a bot token - save this as `DISCORD_BOT_TOKEN`
   - Under **Privileged Gateway Intents**, enable:
     - **Message Content Intent** (required to read message text)
     - **Server Members Intent** (optional, for member info)
   - Uncheck **Public Bot** if you want to restrict who can add it
4. Go to the **OAuth2** tab:
   - Copy the **Client ID** - save this as `DISCORD_CLIENT_ID`

## 2. Invite the Bot to Your Server

Build an invite URL with the required permissions:

```
https://discord.com/api/oauth2/authorize?client_id=1481711580285763817&permissions=274877975552&scope=bot
```

Permissions included (274877975552):
- Read Messages/View Channels
- Read Message History
- Send Messages (for future alert features)
- Manage Messages (for future auto-delete features)

Replace `YOUR_CLIENT_ID` with your actual Client ID, then open the URL in a browser and select your server.

## 3. Environment Variables

Copy the `.env.example` file:

```bash
cp .env.example .env
```

Fill in the values:

| Variable | Description | Where to get it |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from Developer Portal | Bot tab > Reset Token |
| `DISCORD_CLIENT_ID` | OAuth2 Client ID | OAuth2 tab |
| `SUPABASE_URL` | Supabase project URL | Supabase Dashboard > Settings > API |
| `SUPABASE_SECRET_KEY_LOCALHOST` | Same local secret API key as API/coordinator (full DB access) | Supabase Dashboard > Settings > API Keys |
| `SUPABASE_SECRET_KEY_PRODUCTION` | Same production secret API key as API/coordinator (full DB access); requires `NODE_ENV=production` | Supabase Dashboard > Settings > API Keys |
| `GUARDIAN_INSTANCE_LABEL` | *(optional)* Human-readable tag shown in logs, e.g. `local-dev` or `railway-prod`. Defaults to host name. | You choose |
| `GUARDIAN_FORCE_TAKEOVER` | *(optional)* Set to `true` on a local instance to forcibly steal the leader lease from production so your local code handles events while production stays connected but idle. Leave unset in production. | You choose |

**Important:** The bot uses a privileged server secret (not an anon/public key)
because it reads/writes Guardian tables directly. Use separate local/production
keys; these still bypass RLS. `NODE_ENV=production` selects the production setting;
other modes select localhost. The selected setting is required; legacy
service-role fallback is not supported, and one environment never uses the
other environment's key.

### Single-instance leader lease

Multiple guardian processes (e.g. local dev + Railway production) can be
running at the same time without duplicating actions. On boot, every instance
competes for a singleton row in `guardian_instance_lock`; only the lease
holder ("leader") processes Discord events. Followers stay connected to the
gateway but ignore events, so failover is near-instant.

- The leader heartbeats every 10 seconds.
- If the heartbeat goes stale for 30 seconds, any follower may take over.
- Set `GUARDIAN_FORCE_TAKEOVER=true` on your local `.env` to steal the lease
  from production immediately when you want to test new code against the
  live guild. Remove (or set back to `false`) and restart to hand the lease
  back to production once the stale window elapses.

## 4. Database Migration

Run the migration to create the Guardian tables:

```bash
# Connect to your Supabase SQL editor or use psql
# Execute the contents of:
# Code/packages/database/migrations/000_feature-discord-guardian.sql
```

Or via the Supabase Dashboard:
1. Go to **SQL Editor**
2. Paste the contents of `000_feature-discord-guardian.sql`
3. Click **Run**

## 5. Local Development

```bash
cd Code/apps/discord-guardian
pnpm install
pnpm dev
```

The bot will connect to Discord and start scanning messages in all guilds it has been invited to.

## 6. Railway Deployment

### Create a New Service

1. Go to [Railway](https://railway.app) and open your project
2. Click **New Service** > **GitHub Repo**
3. Select the Coordination Manager repository
4. In the service settings:
   - **Root Directory:** `Code/apps/discord-guardian`
   - **Build Command:** `pnpm install && pnpm build` (set this explicitly; there is no nixpacks.toml for the guardian)
   - **Start Command:** `pnpm start` (auto-detected)

### Set Environment Variables

In the Railway service settings, add:

```
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
SUPABASE_URL=your_supabase_url
NODE_ENV=production
SUPABASE_SECRET_KEY_PRODUCTION=your_supabase_secret_api_key
```

### Deploy

Railway will auto-deploy on push to main. You can also trigger a manual deploy from the Railway dashboard.

### Verify

Check the Railway logs - you should see:
```
Demon X ready as DemonX#1234
Loaded X rules across Y groups
```

## 7. Configure Rules via the Web Dashboard

1. Go to your Coordination Manager web app
2. Navigate to **Tools > Discord Guardian** (requires Moderator role)
3. In the **Configuration** tab:
   - Create rule groups (e.g. "URL-Encoded Phishing Links", "Scam Phrases")
   - Add regex or wildcard patterns to each group
   - Enable/disable groups and individual rules
4. The bot reloads rules from the database every 30 seconds

### Example Patterns

**Wildcard patterns** (use `*` for partial matching):
- `*%2E%78%79%7A*` - URL-encoded `.xyz` domains
- `*discord.gg*` - Discord invite links
- `*free nitro*` - Common scam phrase

**Regex patterns:**
- `(%[0-9a-fA-F]{2}){3,}` - Multiple consecutive URL-encoded chars
- `https?://[^\s]*\.(xyz|tk|ml|ga|cf)(/|$|\s)` - Suspicious TLDs
- `(?i)claim.*(?:nitro|prize|reward)` - Claim scam phrases

## Architecture Notes

- The bot scans 4 message sources: direct content, replied/quoted messages, forwarded messages (snapshots), and embeds
- Scanned messages are logged for 7 days (auto-pruned) for dashboard stats
- Flagged messages include the matched pattern, source type, and author info
- The bot shares the same Supabase database as the main Coordination Manager
- The web dashboard at `/guardian` is gated by the `moderator` role via Supabase RLS
