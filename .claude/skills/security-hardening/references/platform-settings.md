# Platform Dashboard Settings

Configuration tables for each platform's security settings.
These are **manual dashboard actions** -- they cannot be automated via code.

> **NOTE**: These paths and settings are specific to the Coordination Manager project.
> Adjust service names, URLs, and project IDs for other deployments.

## Supabase (Manual -- Dashboard)

| Setting | Action |
|---------|--------|
| RLS on ALL tables | Verify green "RLS" badge on every table |
| Auth rate limits | Lower email sign-ups/hr and token refreshes/hr to reasonable numbers |
| JWT expiry | Set to 3600s (1 hour) or less |
| Email confirmations | Enable "Confirm email" for account verification |
| Unused auth providers | Disable providers not in use |
| pgAudit extension | Enable to audit DDL and writes on sensitive tables |

## Vercel (Manual -- Dashboard)

| Setting | Action |
|---------|--------|
| Deployment Protection | Enable for preview deployments |
| RBAC | Restrict Admin role to core team |
| Git branch protection | Only deploy from `main`; require PR reviews |

## Railway (Manual -- Dashboard)

| Setting | Action |
|---------|--------|
| Private networking | Enable between API and Discord bot; use internal DNS |
| Environment isolation | Separate production and staging secrets |
| Restart policy | Set crash restart limits to detect crash loops |

## Discord Developer Portal (Manual -- Dashboard)

| Setting | Action |
|---------|--------|
| Privileged Intents | `MessageContent` is required by the guardian (message scanning) and by the main bot's DM link-key flow; keep it enabled for those bots. Review `GuildMembers` too (the main bot uses it) |
| Bot Permissions | Verify minimum permissions (currently 3072: Send Messages + Read Message History) |
| Bot Token | Regenerate if ever exposed in commits or logs |

## Secret Rotation Schedule

No repo document sets a fixed interval: `SECURITY.md` says secrets are rotated
"according to risk", and `docs/private/security-key-rotation-runbook.md` lists the triggers
and the per-secret inventory. Use the Secrets lifecycle section of the security-automation
reference (listed in SKILL.md), which follows the runbook.
