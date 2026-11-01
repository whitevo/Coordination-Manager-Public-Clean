---
name: coordination-calendar
description: Guides the core calendar domain - calendar config and hash URLs, availability add/remove slots, meetings with JSON recurrence rules (RFC 5545 RRULE only for Google export), overlap detection, iCal export, and the CalendarPage grid. Use when editing calendar CRUD, availability submission, meeting recurrence or weekday logic, Google Calendar export or sync, overlap suggestions, config intervals and hours, Zoom links, or guest join flow.
---

# coordination-calendar

## Workflow

1. **Calendar data model** (routes `Code/apps/api/src/routes/calendars.ts`):
   - Calendar: `{ id, hash, title, config, permissions, visibility, created_by, creator_account_type }` (`creator_account_type` defaults to `'google'`, no CHECK)
   - Config (JSONB): `{ eventName, timeInterval (15/30/60), customStartDate, customEndDate (YYYY-MM-DD), startHour, endHour, skippedDays, hideDateNumbers, socialLinks, onboardingUrl, communityResources }`
   - `title` is canonical; `config.eventName` MUST stay in sync (server enforces this)
   - Hash: nanoid(10) for public URLs (`/calendar/{hash}`)
   - Create (`POST /api/calendars`) requires a verified session (Google, wallet, or traveler JWT) and returns 401 without one; `created_by` comes from the token, never from the request body
   - Visibility: `'public'` (listed on `/calendars`) or `'unlisted'` (default; URL-only access)

2. **Availability** (routes `Code/apps/api/src/routes/availability.ts`):
   - Table: `availability { id, calendar_id, username, time_slots (JSONB) }`
   - Time slots: ISO 8601 cell IDs, format `YYYY-MM-DDThh:mm`, e.g. `["2025-01-15T09:00", "2025-01-15T09:30"]` (the grid UI uses `YYYY-MM-DD_hh:mm` cell IDs and converts)
   - Submission modes: `add` (merge with existing) or `remove` (subtract from existing)
   - Unique constraint `(calendar_id, username)` -- one submission per participant
   - Anonymous usernames MUST be allowed (no auth for guests on the `/join/:hash` route); `username` is client-supplied, `user_id` is set only from the verified JWT
   - By design, anyone with the hash can add or remove slots under any username (no per-participant ownership check) so groups can adjust each other's entries; do not add one unless asked
   - Import: `ImportAvailabilityModal` copies the user's past availability from other calendars (`GET /api/availability/user/past`), not iCal

3. **Meetings with recurrence** (routes `Code/apps/api/src/routes/meetings.ts`):
   - Meeting: `{ id, calendar_id, title, description, start_time, end_time, duration_minutes, meeting_link, time_slots, recurrence_rule (JSONB) }`; `start_time`/`end_time` are plain TIMESTAMP, treated as UTC
   - RecurrenceRule (`Code/apps/web/src/lib/recurrence.ts`):
     ```
     type: 'none' | 'weekly' | 'biweekly' | 'monthly' | 'monthlyWeek' | 'custom'
     interval?: number
     unit?: 'day' | 'week' | 'month'
     weekDays?: number[]  (0=Mon..6=Sun)
     endType?: 'never' | 'on' | 'after'
     endDate?: string (YYYY-MM-DD)
     endCount?: number
     monthWeeks?: number[]  (monthlyWeek only, 1-4)
     weekOffsetDays?: number
     exceptions?: string[]  (YYYY-MM-DD)
     ```
   - `recurrence_rule` is stored as this JSON object, not an RRULE string. An RFC 5545 RRULE is built only for Google export, by `buildRRuleFromRecurrence(rule, dtStartISO)` in `Code/apps/api/src/routes/calendar-sources.ts`, e.g. `"FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;UNTIL=20260630T235959Z"`
   - Google export (helpers in `Code/apps/api/src/services/google-calendar-api.ts`): meetings export is create-only. Time Management items sync through `google_event_links` (`services/google-event-sync.ts`, `/api/google-sync`). Edits that leave the standard rule need extra Google steps: deleted occurrences become EXDATE (and cancel any earlier override), and "this item only" replacements (`series_id` + `original_start_time`) become instance overrides. Changes push automatically only when the item's "Keep Google copy in sync" is on; otherwise the status shows "Out of date on Google"
   - `ical-expander` only parses external ICS feeds (`calendar-sources.ts`, `user-events.ts`); meeting occurrences are expanded by `getRecurringEventStartsInRange()` (web, `lib/recurrence.ts`) and `resolveCurrentOccurrence()` (`meetings.ts`)
   - Meeting links: manual URL or auto-generated via Zoom OAuth (`POST /api/zoom/create-meeting`). Zoom OAuth tokens are private; only expose generated meeting links.

4. **Frontend CalendarPage grid** (`Code/apps/web/src/pages/CalendarPage.tsx`; ICS export and link helpers in `Code/apps/web/src/lib/calendar-utils.ts`):
   - View modes: `'visitor'` (submit availability) vs `'admin'` (manage calendar)
   - Intervals: 15, 30, or 60 minutes (per calendar)
   - Overlap detection: count participants available per slot, highlight optimal times
   - `DualThumbSlider` selects meeting hour ranges; `MeetingSidePanel` opens from the calendar for meeting details and actions
   - Grid cell IDs are UTC date and time (a meeting saves `start_time` as `${date}T${time}:00Z`). Visible recurring occurrences come from `getRecurringCellIdsInWeek()` in `lib/recurrence.ts`, a wrapper over the shared expander that Home, Events and Time Management also use; do not re-add a private recurrence copy in CalendarPage
   - `getWeekdayIndexFromIsoDate()` (`lib/recurrence.ts`) converts ISO date to 0=Mon..6=Sun

5. **Guest flow** (`/join/:hash`): distraction-free layout (no main navigation), no auth, anonymous username, submit availability directly, return to calendar view after submission.

6. **Discovery pages**:
   - `/calendars` -- public calendar listing with search and filters (`/events` redirects here)
   - `/events-calendar` -- calendar-grid view of public events

7. **Ownership and permissions**:
   - Server computes `is_owner` and `has_edit_permission` flags per request
   - Resolve display names via `buildCreatorNameMap()` to avoid leaking emails
   - Calendar `permissions` JSONB: `{ canEdit: string[] }` (emails or user IDs)
