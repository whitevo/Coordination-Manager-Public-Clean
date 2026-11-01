# Coordination Manager — User Guide

> *"Plan your time, coordinate meetings, manage conversations, and support your community."*

---

## Public Discovery and Agent Navigation

The homepage, social previews, public page descriptions, and agent guide use the
same product wording. Public pages include initial HTML descriptions and links
for readers that do not run JavaScript; the interactive application still
requires JavaScript.

- [Documentation overview](https://coordinationmanager.com/docs/overview)
- [Agent API getting started](https://coordinationmanager.com/docs/getting-started)
- [Machine-readable agent guide](https://coordinationmanager.com/llms.txt)
- [Public sitemap](https://coordinationmanager.com/sitemap.xml)
- [Crawler guidance](https://coordinationmanager.com/robots.txt)

The sitemap is curated: it does not list personal calendars, meetings,
invitations, mailbox records, or account tools. Describing an authenticated
capability does not grant access to it. Agent integrations must follow the
documented authentication, scopes, limits, and human approval requirements.
Discovery guidance is not an authorization mechanism.

Product copy and eligible routes live in
[the discovery manifest](../../Code/shared/site-discovery.ts). The Vite discovery
plugin generates metadata, structured data, static page descriptions, the
sitemap, crawler guidance, and the agent guide during development and builds.
When adding an eligible route, update the manifest and its explicit rewrite in
[the hosting configuration](../../Code/apps/web/vercel.json), and run the
site-discovery and site-metadata tests. Changes reach public scrapers only after
deployment; cached previews may also require a recrawl.

The social preview uses a versioned PNG URL to avoid reusing the old tagline
image. After changing the tagline, build the web app, run
`pnpm --dir Code/apps/web generate:og-image`, and rebuild to include the updated
PNG. The generator uses Playwright Chromium; an installed browser channel can
be selected with `-- --channel msedge`. It reads the tagline from the built
agent guide rather than maintaining a second copy.

After `build:with-docs`, run
`pnpm --dir Code/apps/web verify:discovery` to check the production HTML,
canonicals, structured data, linked bundle files, fallback indexing policy,
discovery resources, and social preview dimensions.

---

## Events Calendar network filters

Network Relations apply only to the public Events Calendar at
`/events-calendar`, not to Coordinate Events, Time Management, or the original
calendar providers.

- A meeting can belong to multiple networks through source membership
  and matching mappings/rules. Matching any of its
  networks shows the meeting once, including when it was shared from several
  sources.
- Networks are meeting tags shown in one unified filter row, not separate
  custom-network and member-calendar filter systems. Sources without a
  configured network remain automatic tags. When a source's current name
  exactly matches a custom network name, all its meetings contribute to that
  network. Identically named unconfigured sources also share one automatic
  tag. Counts deduplicate meetings across every contributing rule and source.
  Explicit source renames take precedence over name matching. Retained names
  keep inferred source memberships connected after a tag is renamed or joined;
  they are never displayed in filter buttons.
- Click one network to filter and update the address bar. Use **Copy filter
  link** to share the view. The URL has one `network` parameter; clearing the
  filter removes it. Links identify networks independently of their names.
- To share several networks together, create a network in **Network Relations**
  and select its constituent networks. This is a live union: future matching
  meetings are included automatically, and the original networks remain
  available. Nested combinations are supported; cycles are rejected.
- Source owners and admins can rename a source network. After a network exists,
  its creator can also rename it. The filter shows only the new name, while
  network details preserve the original source name. Upstream calendar titles
  and meeting titles are not changed.
  Renamed sources remain in the collapsible **Source networks** list, with the
  current name on the left and the smaller original name on the right.
  They are not duplicated as standalone custom-network rows.
  Every source has an expandable panel for mappings, rules and combined-network
  members, including sources that have not been renamed. Opening a panel does
  not save anything. The first configuration save retains the source name and
  automatic meeting membership; no standalone custom row is created.
- The custom-network **Edit** button changes only its name. Use **Add network**
  beside **Combined networks** to add or remove members, then save the
  combination separately.
- **Assigned meetings** controls have been removed. Existing stored direct
  assignments are retained but no longer affect Events Calendar filters.
  Use **Direct Mappings** and **Auto-Match Rules** to tag meetings instead.
- Renaming to an existing network name joins it rather than creating another
  filter or deleting the original relationships. The destination filter
  includes both networks' current and future meetings. Old links redirect to
  that destination. Filter buttons show only the current network name.
  Management labels show the new name on the left, a left-pointing arrow,
  and the smaller original name on the right. Joined records remain
  in Network Relations for provenance; their owners do not gain permission
  to edit the destination network.
- Direct mappings match only the selected field exactly. For example, if a
  meeting is titled **MeTTa Coders** but its calendar is **SingularityNET**,
  select **Meeting title** for a `MeTTa Coders` mapping. Admins can edit a
  mapping and preview matching published events before saving.
- If filters cannot load, the error identifies the failed request and offers
  **Retry network filters**. A failed refresh preserves the last usable
  filters and selected view.
- Signed-in users can create networks and manage their own networks.
  Matching mappings/rules and network deletion remain admin-only.
- Deleting a network also deletes all networks joined into it (including
  chained joins), their mappings, rules and meeting assignments. References
  to those tags are removed from other combined networks automatically.
  Constituent networks of an ordinary combination are not deleted unless
  they also joined the deleted network. Meetings and provider calendars are
  never deleted by this action. Source calendars may reappear as automatic
  tags; removed canonical network links become unavailable.

For existing installations, apply
[`038_event_calendar_networks.sql`](../../Code/packages/database/migrations/archive/038_event_calendar_networks.sql)
followed by
[`039_network_rename_joins.sql`](../../Code/packages/database/migrations/archive/039_network_rename_joins.sql)
before enabling rename joins. The API continues to serve migration-038
filters during a rolling upgrade; joins report an explicit schema-required
error until 039 is applied. New installations include the same
schema in the consolidated network feature migration.
Automatic cascade deletion also requires
[`040_network_delete_cascade.sql`](../../Code/packages/database/migrations/archive/040_network_delete_cascade.sql)
after 039. Deploy the updated deletion confirmation alongside that migration.

Dialogs dismiss on an outside click only when both the pointer press and
release occur outside the panel. Selecting text inside a dialog and releasing
outside no longer closes it. Escape and the close button still work.

## Why Coordination Manager?

### The Driver

Coordinating time, meetings, messages, and communities across separate tools is often unnecessarily difficult. Existing tools are either too complex, locked behind access controls or paywalls, or don't respect the autonomy of participants.

**Coordination Manager** exists to respond to a clear organisational need: **empower people to organise their time, conversations, and communities with as little friction as possible.**

### Our Motivation

- **Equivalence** — Everyone's time matters equally.
- **Transparency** — Your data, your calendars, your choices should always be visible and under your control.
- **Continuous Improvement** — The tool itself evolves through open-source contribution and real user feedback.

---

## What Can You Do?

### Editing a meeting's date and time

In the New/Edit Meeting panel, choose **Edit date and time manually**. Enter
the date or UTC time directly (time uses `HH:mm`, 24-hour format), or use the
picker buttons. The time picker closes immediately after selecting either an
hour or a minute, even when selecting the current value. Reopen it to change
the other part. Minute choices follow the calendar's time interval.

Hovering or keyboard-focusing an entry area or its picker button highlights
both related borders together. Date and Time highlight separately; reduced
motion uses static outlines. **Apply** is highlighted for
pending changes and disabled when unchanged or incomplete/invalid. Selecting
values does not apply them automatically; **Cancel** discards the draft.

### Hiding synced busy periods

Expand **Calendar Syncs** on a coordination calendar to find **Hide busy** as
the first option when at least one Google Calendar source or Secret Swarm mode
is selected. Turn it on to hide busy shading and busy hover details; turn it
off to show them again. Source selections, syncing, exports, saved availability,
and busy-aware availability calculations are unchanged. Busy periods are shown
by default when you reload the page.

### Exporting meeting items to Secret Swarm modes

On a coordination calendar, expand **Calendar Syncs** and check destinations
under **Google Calendar** or **Secret Swarm**. Select meeting items using the
checkboxes in **Confirmed Meetings**, then choose **Export to Calendar**.
The same workflow sends selected meetings to checked Google OAuth calendars,
Secret Swarm modes, or both. Secret Swarm copies preserve the title, details,
meeting link, duration, and recurrence, and are private Time Management items.
This is an explicit export, not continuous two-way synchronization. It does
not change your availability selection or the original meetings. **Hide busy**
only affects busy visuals, not export destinations.

### Dismissing an untitled time selection

On the Time Management calendar outside the phone layout, an untitled selection
shows a neutral **X** button after **Full View**. Click it to clear the active
selection without saving or deleting an item. The button includes an **(ESC)**
hint when the selection is wide enough; Escape also clears the selection when
you are not typing in an editor. Manually entered draft details are preserved.
The button is not shown on phones or when the selection has a title.

### Guardian dashboard date filters

Guardian defaults to a two-week period with **To: NOW**. The NOW switch keeps the
selected period rolling: opening the page or refreshing any dashboard section
recalculates From and the current cutoff, including after local midnight.
Editing From manually keeps that start date fixed, even with NOW enabled.

Turn NOW off to show today's date in the editable To field. Fixed date ranges
use your browser's local calendar dates and include the entire To day; they do
not move on refresh. Turn NOW back on to resume the live cutoff. The same
boundaries apply to recent scans, flagged messages, filtered statistics, and
both activity charts. **Clear all** removes the date and other dashboard
filters, including NOW. Refresh the dashboard to load newly scanned messages.

### AI messages, limits, and availability

Your daily AI prompt allowance is separate from the model provider's capacity.
Even with prompts remaining, the selected model can be temporarily unavailable
or rate-limited by its provider. The error identifies the provider restriction;
try again later or choose another model in Settings > AI. Invalid messages and
failed provider requests do not spend a daily prompt. Automatic evaluated retries
do not spend an additional prompt.

AI messages accept up to 4,000 characters. The composer shows a character count
and reports oversized messages without cutting your text. A model can also reject
the combined message, conversation history, and page context for exceeding its
own size limit; this is reported separately from temporary provider throttling.

Your sent messages preserve line breaks, blank lines, indentation, and literal
Markdown markers. Long messages have **Show more** and **Show less** controls in
both the Assistance AI panel and the AI chat page. Long drafts scroll inside the
composer so the conversation remains visible.

### Timezone settings

The **Timezone** button opens a separate settings popup on phones and desktop;
it never expands the page header. This is shared by Time Manager, calendars,
Coordinate Events, account Settings, and guest booking.
Choose the primary or an additional timezone to edit it, or use **Add Timezone**.
Search and browser-timezone selection appear in the same popup. Selecting a
timezone returns to settings; the Back arrow returns without changing it.
Use **Close** or Escape to dismiss the popup. Existing display limits and saved
timezone preferences are unchanged.

### Timezone changes in Any Week calendars

In **Any Week** mode, selected timezones are checked for daylight-saving changes
in the current Monday-to-Sunday week and the following week. An extra
warning-colored time column appears before the affected weekday, showing the
city, old and new GMT offsets, transition date, and **This week** or **Next week**.
The normal time columns use the current week's Monday offsets; transition
columns show the adjusted times for their labeled dates.

The indicators stay consistent after refreshing or switching between **Dates**
and **Any Week**. Changes from earlier weeks or beyond next week are not shown.
These columns are informational: saved availability and meeting times do not
change. **Dates** mode continues to show changes only within the displayed days.

### Joining through an invite link

Invite links (`/join/:hash`) open a simplified availability calendar. Times start
in **UTC** on every visit, regardless of your browser timezone or the timezone
saved in the full Coordination Manager. Use the same compact timezone selector
as the full calendar: click **UTC** to open settings, then choose the primary timezone to search
for a city or apply your browser timezone. **Add Timezone** adds comparison time
columns, and **Remove timezone** removes them. Button labels and colors match the
full calendar.

Changing timezone updates the displayed times without clearing selected slots or
changing the availability being saved. Each time-column header shows its city,
timezone abbreviation, and live clock, and the time labels use the first visible
day's offset.
Weeks containing a daylight-saving change show an extra warning-colored time
column immediately before the affected day, matching the full calendar. Hovering
a slot shows its local date and time; availability cells remain free of text.
The red current-time line appears only when today's date and current UTC time
are in the displayed, selectable days and rendered time range. It updates while
the page is open without changing your selections.

This invite-page choice lasts
only for the current visit and does not change your account's timezone preference.

- **Mobile Navigation** -- Clicking a header navigation control closes open side panels before opening its menu or destination, including when selecting the current page. Panel shortcuts close the previous panels before opening the requested panel. Hiding a panel preserves its drafts and selections on the current page; editor dialogs and desktop navigation are unchanged.

- **Side Panel Scrolling** -- The coordination calendar's Tools cards and the Chat panel stay vertically centered when they fit. In shorter windows, content starts below the header and scrolls independently, keeping the first feature and final action reachable without hiding them behind the close button.

- **Plan Your Time** -- Organize personal schedules and recurring time blocks before coordinating with others.
  - The Time Management header hides its title when space is scarce and restores it when room is available. Week navigation and the date/timezone controls stay separate rather than overlapping.
  - On phones, tapping outside a Time Management context menu or inline confirmation only dismisses it. Tap again to select time, open an item, or activate the control underneath.
  - On phones, swipe inside the Time Management Tools panel to scroll its options. The header and close button stay visible while the options scroll independently of the calendar.
  - On phones, the Time Item full-view editor starts with formatting, location, and time-adjustment tools hidden. Tap **Reveal more tools** next to **Guiding** to show them with a half-second fade, slide, and scale animation and a two-second subtle highlight matching your theme. Reduced motion uses only a brief static highlight. There is no hide button; closing and reopening full view hides them again without clearing any location you entered. Swipe through the editor body to read all your notes; **Close** or **Cancel** stays beside the heading.
  - On phones, the Quick Objects **+N** button expands the remaining shortcuts inline; **Tools** opens template management separately. Choosing a Quick Object without a time range reveals the calendar and shows a ready cue. Tap a start time or hold and drag a range, then release to open the populated editor. You can start over an existing Time Item, including its edges, to place a separate overlapping item at the touched grid time without editing or moving the existing item. Swipe immediately to scroll instead.
  - Choose **Create new time item** from a Time Management grid context menu to open a fresh editor at the clicked slot, with a duration of one active grid interval. On desktop, right-click empty space, an existing item, or a selected range. On phones, hold an existing item still for half a second to open its menu; a quick tap keeps the usual item-selection behavior, and an immediate swipe scrolls. The new item can overlap existing items, including read-only connected-calendar items. Unsaved edits ask you to save and continue or keep editing; the new item is only created when you save it.
  - On the Time Management touch grid, tap empty space to open a new Time Item. Swipe immediately to scroll without selecting. Hold still for half a second to activate range selection, then drag up or down; keeping your finger near the grid's top or bottom edge scrolls while extending the range. Release to open the editor. You can also adjust the range in the editor without dragging.
  - On phones, choose **Move Item** (or **Cut Selected** for multiple items), then tap the destination on the grid to move there immediately, including over another item. Swiping still scrolls without moving anything. While a move is pending, holding no longer starts range selection. Recurring single items still ask which occurrences to change.
  - After saving a Time Item, selecting empty grid time starts a fresh blank item without needing Discard first. Only an unsaved new draft carries its content when you readjust its time. Unsaved edits to an existing item and failed saves remain protected.
  - Time Management marks daylight-saving clock changes for every displayed timezone with a warning-colored time column immediately before the affected day. Its header shows the old and new GMT offsets, and changed time labels are highlighted. Normal time axes use the first day of the displayed week; item and editor times use the item's date. On narrow screens, swipe horizontally to see the extra columns without squeezing day columns. These columns are informational and do not change saved item times.
  - To repeat a Time Item until you finish the series, choose **Recurrence > Ends > When marked as completed**. After the latest item ends, Time Management creates only the next future scheduled occurrence, skipping elapsed windows rather than backfilling them. Checks run when the page loads or refreshes and every 30 seconds while it remains open; there is no server-side background schedule when the page is closed. The schedule keeps the grid's existing UTC cadence and timezone display behavior.
  - Each generated occurrence has its own Time Item ID and shares one RecurrenceID. On the latest occurrence, **Complete recurrence**, immediately left of the Recurrence dropdown in both editors, stops repeats for the whole series and marks that current Time Item completed. Historical items keep their individual completion states. This preserves the schedule, ending condition, identities, and all existing occurrences. Historical items show the shared status and **Go to latest occurrence**; recurrence settings are changed on the latest active item. **Recurrence completed** is the series status; **Time Item completed** appears only on individually completed items. Use **Complete recurrence**, not **None**, to end an existing conditional series.
  - Active conditional recurrences use a curved upward-arrow icon with a dot and the tooltip **Repeats until marked as completed.** Completed series show a checked indicator and **Recurrence completed** in the editor. Conditional occurrences exported to Google are individual events, not unlimited Google recurrence rules; later occurrences are not automatically exported.
  - In a Time Item's context menu, select **Assign Category** to toggle its categories. On phones, the options expand inside the menu and scroll when needed; on larger screens, they open in a flyout kept within the viewport.
  - **Adjust selection time** and **Adjust Time** normally resize the chosen endpoint. If a step would reach or cross the other endpoint, both endpoints move instead, preserving the current duration. Adjustments can cross midnight; the grid follows the start into an adjacent week when needed. For example, **End -60m** on 10:00-10:30 moves the item to 09:00-09:30. Recurring items still ask which occurrences to change.
- **Sync Google Calendars** — Connect your accounts to see all your events in one place.
- **Share Availability** — Let others see when you're free, so scheduling becomes a conversation, not a negotiation.
- **Coordinate Meetings** — Find overlapping time across participants and create events that respect everyone's constraints.
- **Connect Your Mailbox** — Link a Gmail or Outlook account to search, organize, and automate your inbox, including AI-assisted automation rules that you review and activate yourself.
- **Distribute Messages** — Prepare and send communications through connected channels.
- **Support Communities** -- Configure Discord Guardian moderation tools for communities you manage.
- **Use Optional AI Assistants** — Get AI-assisted help drafting messages, finding scheduling slots, and configuring mailbox automation; AI features are optional and rate-limited per account (see [Limits](https://coordinationmanager.com/docs/limits)).
- **Stay Informed** — Get notified about schedule changes and upcoming events in real time.
- **Control Visibility** — Choose whether your calendars are **unlisted** (private link only) or **public** (discoverable).

---

## Getting Started

On phones, the main navigation menu scrolls independently when its links exceed the visible screen. This also works on Time Management, where the calendar keeps the surrounding page from scrolling.

### Choose How You Want to Participate

Coordination Manager offers **two ways to get started**, depending on your needs:

---

### Option A: Sign In with Google (Full Account)

For users who want persistent access, calendar sync, and full feature access.

Click **"Continue with Google"** on the login page. Your Google profile (name, email, avatar) is used to create your account. No separate password needed.

**Full account features:**
- Calendar sync with Google Calendar
- Create **public** or **unlisted** calendars
- Persistent profile and settings
- Your events are discoverable (if you choose)

---

### Option B: Continue as Traveler (Guest Account)

> *Just want to explore? No email, no password, no commitment.*

Click **"Continue as Traveler"** to get instant access with a randomly generated identity. You'll receive a unique **Traveler name** (e.g., *Wandering Falcon*, *Curious Tide*) and can start using the app immediately.

**Traveler features:**
- Create and manage **unlisted** calendars
- Schedule events with other users
- Full app experience — no feature walls

**Traveler limitations:**
- Calendars are always **unlisted** (not public)
- **No calendar sync** with external services
- Your account and data are **automatically deleted after 64 days**
- If you lose your browser session, your account cannot be recovered

> **Tip:** If you find the app useful, you can upgrade to a full Google account at any time from Settings. Your existing calendars and events will be preserved.

---

### After Signing In

1. **Set Your Availability** — Navigate to the **Availability** page to define your working hours and preferred meeting windows.
2. **Create or Join Calendars** — Use the **Calendar** page to create new shared calendars or join existing ones via link.
3. **Schedule Meetings** — Find times that work for everyone and create events that respect all participants' availability.

---

## Selecting Calendar Availability

Each selected cell represents the calendar's configured interval: 15, 30, or
60 minutes. In a 30-minute calendar, selecting 11:00 marks only 11:00-11:30;
select 11:30 as well to mark the full hour. Saving, reloading, or removing one
cell does not mark or remove its neighbor.

This applies to both dated calendars and any-week weekday availability.
On phones, tap to toggle one cell or hold and drag to select a range.

## Participation Update Emails

As a calendar organiser you can get an email when other people add, change,
or remove their availability. Open your calendar and choose **Edit**. Below
**Show Community Links and Resources** you will find **Participation Email
Notifications**. Its switch turns emails on or off even while the section is
collapsed; expand it to change the email or start time.

- Notifications are on by default when your account has an email address.
  Turn them off, or enter a different email to send them somewhere else.
- **Start notifying from** (optional) lets you share the calendar first:
  changes made before that time never send an email.
- Your own edits never send you an email.
- Changes are batched so you get few emails:
  - Changes only to times more than 1 hour in the past are ignored.
  - Changes to times within 1 hour of now are sent after about 2 minutes.
  - All other changes are collected for 15 minutes and then sent.
- One email covers all of your calendars. For each calendar it lists the
  name, a link, the total participant count, and who was added, changed,
  or removed.

## Managing Calendar Subscriptions

On **Coordinate Events** (`/coordinate-events`), open **Subscribed** to review
your coordination calendars in a table-style list.

- Each compact row shows the full calendar name, the last completed meeting's
  date (day, abbreviated month, year) in your selected primary timezone, and
  the number of upcoming meetings. Upcoming counts are green for one or more
  meetings and muted gray for zero. Meetings already underway are not counted
  as upcoming and are marked **Meeting in progress**.
- Select the calendar name to open it, or the **Unsubscribe** icon to stop
  following it. Unsubscribing also removes its subscribed meetings from your event grid;
  it does not delete the calendar or its meetings.
- A dash means no completed meetings; zero means no upcoming meetings. Timing errors
  are shown as unavailable, not as an empty schedule; use **Retry** to reload.
- These dates help you recognize older calendars, but do not automatically
  classify a calendar as outdated or measure its full usage period.

## Calendar Visibility

When creating a calendar, you choose its visibility:

| Visibility | Who Can See It | Who Can Create |
|-----------|----------------|----------------|
| **Unlisted** (default) | Only people with the direct link | All users (including Travelers) |
| **Public** | Anyone browsing the app | Full accounts only |

Travelers can only create **unlisted** calendars. To make a calendar public, sign in with Google.

### How long a public calendar stays listed

Public calendars are unlisted from the home page automatically once they go quiet:

- **Dated calendars** (a fixed date range) stay listed until their end date has passed.
- **Any-week calendars** (general weekday availability, no date numbers) stay listed for **2 weeks after creation**.
- After that, an any-week calendar stays listed until **2 weeks after the last planned meeting**. Every newly planned meeting extends the window by another 2 weeks.
- If no meeting is planned within that window, the calendar is **archived automatically**.
- Archived calendars are still visible in the **Coordination Calendars** list (past sections). They are hidden from the home page whenever 4 or more other calendars are active; if fewer are active, archived calendars fill the remaining slots.
- Planning a new meeting on an archived calendar re-activates it immediately.

---

## Your Data & Privacy

We take your privacy seriously. Coordination Manager only accesses the calendar data you explicitly authorise. Your Google account credentials are never stored by the application — authentication is handled securely through Google's OAuth 2.0 protocol via Supabase.

**Traveler accounts** are fully anonymous — no email or personal data is collected. Traveler data is automatically purged after 64 days.

If you connect a **Mailbox** account, only you can access its messages, and mailbox credentials are encrypted at rest. If you use an **AI-assisted feature**, only the minimum relevant context (your prompt, and the page or email you're working with) is sent to our AI provider to generate a response -- it is not used to train any model.

For full details, see our [Privacy Policy](PRIVACY_POLICY.md).

---

## Open Source & Transparency

Coordination Manager is built as an **open-source project**. In the spirit of S3.0 transparency, anyone can inspect how the software works, suggest improvements, or contribute:

**Repository:** [github.com/whitevo/Coordination-Manager](https://github.com/whitevo/Coordination-Manager)

We believe that the tools we use to organise should themselves be organised openly. Contributions, feedback, and feature requests are always welcome.

---

## Support

If you encounter any issues or have questions:

- **GitHub Issues** — [Report a bug or request a feature](https://github.com/whitevo/Coordination-Manager-Public-Clean/issues)
- **Email** — tevo@coordinationmanager.com

---

## System Requirements

- A modern web browser (Chrome, Firefox, Edge, Safari)
- A Google account for full features (optional — Traveler mode requires nothing)

---

*Last updated: February 2026*
