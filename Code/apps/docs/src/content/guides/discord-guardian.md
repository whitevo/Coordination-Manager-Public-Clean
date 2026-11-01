# Discord Guardian

Discord Guardian is the moderator dashboard and bot workflow for scanning Discord messages, applying configurable actions, and reviewing what happened. It is available to users with the **[Moderator Role](https://coordinationmanager.com/settings?tab=profile&section=role-learner)**.

Use the dashboard when you need to answer three questions:

- What messages did Guardian scan or flag?
- Which rule and automatic action caused a result?
- Does a user need moderator review or a manual Discord action?

## Access and permissions

The page is protected by the **[Moderator Role](https://coordinationmanager.com/settings?tab=profile&section=role-learner)**. If you can sign in but cannot open the dashboard, ask a SingularityNET Ambassador Program Moderators WG members to grant access.

The Guardian bot also needs the Discord permissions required for the actions you enable. A failed action appears in the System Log with the reason, such as a missing permission. A rule can be configured correctly while its Discord action still fails if the bot role or a channel override does not allow it.

## Dashboard

The Dashboard tab is the operational view.

### Filters and statistics

The date controls, rule-group filter, and user filter apply to the statistics and both message tables. The summary cards show:

- Messages Scanned: messages inspected by Guardian.
- Flagged: messages that matched an enabled rule.
- Users Flagged: distinct users represented by the filtered results.

Use the category chips below the filters to focus on a rule group quickly. The Refresh Now button reloads the dashboard data. The displayed timestamps in the message tables are UTC.

### Activity charts

Activity Over Time compares scanned messages, flagged messages, and affected users. Moderation Actions Over Time separates automatic deletes, timeouts, and bans. These charts help identify a sudden spike and distinguish message volume from actual actions.

### System Log

System Log is a collapsed list of failed bot actions. Open it when the dashboard shows a result that does not match the configured action, or when a user reports that a timeout or deletion did not happen. Check the target, channel, action, and failure reason before changing the rule.

### Flagged Messages

Flagged Messages shows the matched message, server, channel, user, source, rule group, and actions recorded for the message. Select a row to expand its content. Links open the original Discord location, and the user ID button copies the Discord user ID for moderator work.

A flagged row may show one or more of these outcomes:

- Flag only: Guardian recorded the match but did not take an automatic moderation action.
- Deleted: the matching message was deleted.
- Timeout: Discord temporarily restricted the member.
- Banned: the member was removed from the server.

Guardian can scan direct message content as well as referenced replies, forwarded content, embeds, attachment URLs, and filenames. The Source value helps explain what matched.

### Recent Scanned Messages

Recent Scanned Messages is the audit view for scanned messages, including messages that were not flagged. Expand it when you need to confirm that a channel is being monitored or compare normal traffic with flagged traffic.

The **Show settings-skipped messages** switch in Filters is off by default and applies only to Recent Scanned Messages. Turn it on to include messages that Guardian received but did not scan because the author has an ignored role, the channel is not monitored, or a thread's parent channel is not monitored. These rows show **Skipped** and the reason, not a successful scan. Category defaults and channel overrides continue to determine effective monitoring. Skipped rows never contribute to Messages Scanned or the scanned series in Activity Over Time.

The Status column stays compact so Content gets the remaining space. Long skip reasons are shortened visually; hover over the status or expand the message row to read the full reason. The switch includes recorded skipped rows, not messages reclassified using current settings. If no skip reasons were recorded, enabling it will not change the results.

After restarts or reconnects, Guardian ignores message-create events older than one hour and stale updates before scanning, logging, flagging, or taking moderation actions. It does not perform a startup history sweep. A genuine edit made within the last hour can still be scanned and moderated even if the original message is older, preventing an edit-based moderation bypass. Existing audit history remains available through the date filters; older rows without skip metadata cannot be reliably reclassified.

## Ban List

Open **Ban List** to manage reviewed bad-actor IDs globally across **all existing and future servers connected to Demon X**. There are no server selections, reason/source inputs, or register-only option.

The importing user must be a Guardian website moderator with an active, bot-verified Discord link. They do not need Discord membership or Ban Members permission in each server. Demon X must have **Ban Members** permission, and Discord's role hierarchy still applies. Server owners, the requesting moderator, and Demon X itself are protected.

The workflow has three steps:

1. **Enter Discord IDs**: paste up to 1000 IDs separated by spaces, commas, or newlines, then submit for review. IDs are validated, deduplicated, and kept as exact strings. This step creates a review job only; it does not register or ban accounts.
2. **Review and confirm**: the working table shows each ID's current member-server count and whether it is already in the global registry. Incomplete or failed lookups are not shown as zero. Membership checks run in persisted ten-pair chunks with Discord rate-limit handling and resume after restarts. Working jobs expire after 24 hours; a completed preview is valid for 30 minutes. Select **Update Ban Registry and execute bans**, then confirm the global scope. Demon X rechecks every server's permissions asynchronously before atomically adding new IDs and queueing their bans. A changed server set, expired preview, protected account, or missing permission blocks the update and reports an error. Existing IDs are not requeued by reimporting them.
3. **Global ban registry**: the final table lists **Discord ID**, **Date added (UTC)**, **Times booted**, and **Last booted**, plus row-selection checkboxes and pagination. It has no status or reason columns. Ban and unban failures appear separately above the table, not as successful empty results.

Automatic registry and active-review reads run at most once every **two minutes**, only while Ban List is open and the browser page is visible. Opening the tab, submitting an operation, and the manual **Refresh** button read immediately. Confirmed, failed, and expired previews stop automatic polling. Background reads preserve rows, selection, drafts, and the viewport; the loading message is only shown before usable registry data exists.

Confirmation progress follows the server's review state rather than leaving a permanent request-accepted message. While server permissions are being rechecked, another submission is disabled. Once the server confirms registration, the Working dashboard and submitted IDs clear for the next list; a completion notice disappears after ten seconds. This means bans were queued, not that every Discord action succeeded. Failed or expired reviews retain the IDs and errors for resubmission.

Use **Filter IDs** to paste up to 1000 Discord IDs separated by spaces, commas, or newlines. **Apply ID filter** shows matching active registry accounts. Select individual rows, **Select page**, or **Select all matching** (including other matching pages). **Remove and unban selected** requires explicit confirmation naming the IDs and global scope. Removal immediately stops Guardian enforcement and queues Discord unbans across all connected servers and previously recorded server/account pairs. Audit rows, boot counts, and removal receipts are retained. Missing permissions or other unban failures are reported separately; a queued operation does not mean every server has already unbanned the account. Re-adding a removed ID preserves historical counts and queues fresh bans.

Newly registered IDs are pre-banned even when absent from a server. Enforcement is event-driven: imports, member arrivals, newly connected servers, reconnects, and leadership acquisition trigger work. There is no every-minute registry sweep and no normal-message-triggered ban-list check. Recovery pages through active registry IDs to catch arrivals missed while offline; it does not crawl every member in every server. Join events received while a ban is processing are retained. Existing-ban checks bypass Discord's cache so a later Discord unban/rejoin cannot evade enforcement. Queue processing continues on a five-second worker interval; transient failures have bounded retries and stalled claims recover after five minutes. No Discord message history is deleted.

Ban/unban operations recheck current registry intent and their claim immediately before the Discord write. Completion reports queue a compensating action when an old Discord write finishes after a newer removal or re-add. Run only the matching new worker version during rollout; old workers do not understand unban jobs.

**Times booted** counts confirmed bans of present members only, not absent-account pre-bans, already-existing bans, duplicate submissions, or retry attempts. Removal receipts and counters commit atomically and are deduplicated by operation. If the bot crashes after Discord accepts a ban but before any receipt is persisted, recovery does not invent an unverified removal count. Historical per-server registrations are consolidated by ID using the earliest enabled entry's added date; historical removal counts start at zero because old ban statuses cannot prove member removals.

**Last booted** uses confirmed removal receipts, shows **Never** when none exist, and updates locally without API reads. It displays one whole unit at a time: seconds below 120 seconds (starting at 1), minutes below 120 minutes, hours below 48 hours, days below 14 days, weeks below four weeks, calendar months below 24 complete months (at least one month at the four-week boundary), then calendar years. The exact recorded timestamp is available on hover.

The issuer's website moderator role and verified Discord link are revalidated before confirmation and each ban/unban. Revocation stops subsequent actions with an explicit failure. Removal is global; it is not a per-server exception.

### Deployment prerequisites

Fresh databases receive the Guardian schema from `000_feature-discord-guardian.sql`. Existing databases must apply the historical upgrades `migrations/archive/024_guardian_settings_skips.sql`, `025_guardian_ban_registry.sql`, `027_guardian_global_bans.sql`, and `028_guardian_ban_management.sql` before deploying matching API, web, and Guardian versions. Stop the old Guardian worker during this coordinated rollout: the management migration adds unban jobs, replaces event/recovery semantics, and explicitly retires the old periodic reconciliation RPC. Do not run mixed old/new workers against the upgraded schema. Starting the new worker enforces active IDs globally, including previously uncovered servers.

Migration 028 backfills last-booted timestamps only from confirmed removal receipts, not from `banned_at` or attempt timestamps. It does not perform Discord writes or remove registry IDs itself.

The registry, preview jobs, and removal receipts are service-only with RLS enabled; browsers cannot write queue claims directly. Ensure Demon X has the **Server Members Intent** enabled in the Discord Developer Portal for membership lookups and join enforcement; the bot already requests this intent. The new Guardian worker must be deployed and hold the leader lease for review jobs to progress.

## Configuration

The Configuration tab controls rule groups and the actions attached to them.

### Rule groups

Create a named group for a moderation concern, then add rules to it. Groups can be enabled or disabled as a unit. A group can contain:

- Regex rules for structured matching.
- Wildcard rules where `*` means any sequence of characters.
- Optional descriptions so another moderator can understand the intent.

Guardian validates regex syntax and rejects patterns that are too long or resemble common catastrophic-backtracking patterns. Prefer small, specific rules and test them against realistic messages.

### Automatic actions

Each rule group can enable these actions:

- Delete Message: remove the matching message.
- Timeout Member: apply a Discord timeout for a selected period, from one minute through 28 days.
- Ban Member: permanently ban a matching member.

Actions run in order: delete first, then timeout or ban. Use a timeout instead of an automatic ban when you want the member to retain a review path. Guardian changes are cached by the bot and may take up to 30 seconds to take effect.

Automatic bans are intentionally treated as an exceptional setting. A ban removes the member immediately and does not provide an in-bot appeal reaction or self-service return path.

## Server Settings

Server Settings controls per-server behavior.

### Role-based whitelisting

Expand a server and mark trusted roles as Ignored to stop Guardian from scanning messages from members with those roles. This can reduce noise for moderators, administrators, or other trusted operators. Role-ignore changes may take up to 60 seconds to reach the bot.

### Notification channels

Choose an actions log channel for bot moderation actions and a user feedback channel for appeal signals. If no separate feedback channel is selected, feedback falls back to the actions log channel. Save the server settings after choosing the channels.

Keep these channels private to the moderation team. User reactions can include the member's Discord ID, username, server, channel, and the flagged content needed for review.

## Channel Settings

Channel Settings controls where Guardian scans messages. Sync Channels refreshes the channel list from Discord. Disable monitoring for channels that should not be scanned, such as read-only announcements, bot commands, or internal administration channels.

Guardian's periodic channel and role discovery compares stored metadata before
writing. Unchanged checks do not upsert rows merely to refresh `synced_at`; that
field now reflects the last stored metadata write, not every polling pass.
Manual Sync Channels also skips unchanged metadata while retaining its checked
channel count. Renames, type/parent changes, role color/position changes, and new
entries are persisted. Existing monitoring and thread-default choices are preserved.
Discovery intervals, message-event processing, and moderation rules are unchanged.

Channel monitoring changes may take up to 60 seconds to reach the bot. After changing a channel, use Recent Scanned Messages to confirm the result after the cache window.

## The user appeal process

When Guardian flags a message and does not ban the member, it sends the original author a direct message with the result and the preserved message content. The user can react to that DM with one of four requests:

- False flag: the user says the match was a mistake.
- Republish: the user asks for the message to be posted again.
- Unmute: the user asks for the timeout to be removed.
- Escalate: the user asks for urgent moderator attention.

The bot records one response of each type per flagged message and forwards the signal to the configured user feedback channel. Reactions help moderators prioritize the queue; they are not an automatic decision.

### Does an admin have to manually unmute the user?

Yes, for the current implementation. An Unmute reaction records the request and notifies moderators, but it does not call Discord to remove the timeout. A moderator must review the message and then manually remove the timeout in Discord, or allow the configured timeout duration to expire.

The same principle applies to other appeal requests:

| User request | What Guardian does | Moderator action |
| --- | --- | --- |
| False flag | Records and forwards the request | Review the rule match and decide whether the action was appropriate |
| Republish | Records and forwards the request | Decide whether the original message may be reposted |
| Unmute | Records and forwards the request | Remove the Discord timeout manually if the appeal is accepted |
| Escalate | Records and forwards the request | Review it as a priority |

Guardian does not currently provide an in-dashboard response queue or an automatic resolution action for these reactions. Moderators should record the decision in their normal moderation process and communicate the outcome to the user.

### Automatic bans and appeals

Automatic bans are different. When a rule group applies an automatic ban, the bot sends an informational DM but does not add appeal reactions. The user cannot start an appeal through Guardian, and only a server moderator can manually unban the member. For serious but reviewable violations, configure Delete Message plus a long Timeout instead of automatic Ban Member.

## Recommended operating procedure

1. Start in Dashboard and filter the relevant time period or rule group.
2. Open the flagged row and inspect the original content, matched text, source, and recorded action.
3. Check System Log if the recorded result is missing or failed.
4. Review user feedback in the configured feedback channel.
5. For an accepted timeout appeal, manually remove the timeout in Discord.
6. For a ban, use the server's normal moderator unban process; Guardian cannot do this through an appeal reaction.
7. Revisit the rule group if false flags repeat. Narrow the pattern or adjust the action before enabling it again.

## Important limitations

- Rule and role changes can take up to 30 seconds to propagate.
- Guardian records and displays moderation activity, but user reactions are not a substitute for a moderator decision.
- Automatic ban has no Guardian self-service appeal path.
- A successful appeal does not republish, unmute, or unban a member automatically.
- Bot permissions and channel overrides can prevent a configured action from succeeding.
