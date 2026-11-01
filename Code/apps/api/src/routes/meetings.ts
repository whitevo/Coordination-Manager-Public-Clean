import { Router, Response } from 'express';
import type { Router as RouterType } from 'express';
import { supabaseAdmin } from '../supabaseClient.js';
import { optionalAuthMiddleware, AuthenticatedRequest, hasCalendarEditPermission, hasCalendarEditPermissionAsync } from '../middleware/auth.js';
import { sanitizeUUID, safeErrorMessage } from '../middleware/validation.js';

/** Ensure a timestamp string has a UTC suffix (meetings table uses plain TIMESTAMP) */
const ensureUTC = (ts: string) =>
  ts && !ts.endsWith('Z') && !ts.includes('+') ? ts + 'Z' : ts;

/** Human-readable source label for a standalone public event (user_events row) */
function describeEventSource(sourceType: string, sourceDisplayName?: string): string {
  if (sourceDisplayName) return sourceDisplayName;
  if (sourceType === 'google_oauth' || sourceType === 'google_public_url') return 'Google Calendar';
  if (sourceType === 'coordination_calendar') return 'Coordination Calendar';
  return 'Manually added';
}

// ─── Recurrence occurrence resolution ───────────────────────
// A shared meeting link (/meeting/:id) always points at the series' original
// row, so a recurring meeting's stored start_time/end_time is only ever the
// very first occurrence. Recompute the currently-relevant occurrence (the one
// in progress, or otherwise the next upcoming one) so the shared link stays
// accurate as the series continues.

interface RecurrenceRule {
  type?: string;
  interval?: number;
  unit?: string;
  weekDays?: number[];
  weekOffsetDays?: number;
  monthWeeks?: number[];
  endType?: string;
  endDate?: string;
  endCount?: number;
  exceptions?: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RECURRENCE_MAX_LOOKAHEAD_DAYS = 365 * 20;

function getRecurrenceWeekdayIndex(date: Date): number {
  const jsDay = date.getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun
}

function getWeekOfMonth(date: Date): number {
  return Math.floor((date.getUTCDate() - 1) / 7) + 1;
}

function isRecurringOccurrenceDate(candidate: Date, baseStart: Date, rule: RecurrenceRule): boolean {
  const dayDiff = Math.floor((candidate.getTime() - baseStart.getTime()) / DAY_MS);
  if (dayDiff < 0) return false;

  if (rule.type === 'weekly' || rule.type === 'biweekly') {
    const interval = rule.type === 'biweekly' ? 14 : 7;
    return dayDiff % interval === 0 && getRecurrenceWeekdayIndex(candidate) === getRecurrenceWeekdayIndex(baseStart);
  }

  if (rule.type === 'monthly') {
    return candidate.getUTCDate() === baseStart.getUTCDate();
  }

  if (rule.type === 'monthlyWeek') {
    if (getRecurrenceWeekdayIndex(candidate) !== getRecurrenceWeekdayIndex(baseStart)) return false;
    const allowedWeeks = rule.monthWeeks && rule.monthWeeks.length > 0 ? rule.monthWeeks : [getWeekOfMonth(baseStart)];
    return allowedWeeks.includes(getWeekOfMonth(candidate));
  }

  if (rule.type !== 'custom') return false;

  const interval = rule.interval || 1;
  const unit = rule.unit || 'week';
  if (unit === 'day') return dayDiff % interval === 0;

  if (unit === 'week') {
    const allowedWeekDays = rule.weekDays && rule.weekDays.length > 0 ? rule.weekDays : [getRecurrenceWeekdayIndex(baseStart)];
    // Monday-start week cycles, matching isRecurringOccurrenceDate in web lib/recurrence.ts.
    const weekDiff = Math.floor((dayDiff + (rule.weekOffsetDays ?? getRecurrenceWeekdayIndex(baseStart))) / 7);
    return weekDiff % interval === 0 && allowedWeekDays.includes(getRecurrenceWeekdayIndex(candidate));
  }

  const monthDiff = (candidate.getUTCFullYear() - baseStart.getUTCFullYear()) * 12 + (candidate.getUTCMonth() - baseStart.getUTCMonth());
  return candidate.getUTCDate() === baseStart.getUTCDate() && monthDiff % interval === 0;
}

/**
 * Resolve the occurrence of a recurring meeting that should be shown right
 * now: the one currently in progress, else the next upcoming one, else (the
 * series has ended) the final occurrence.
 */
function resolveCurrentOccurrence(
  startTime: string,
  endTime: string,
  rule: RecurrenceRule | null | undefined,
  now: Date = new Date()
): { start: string; end: string } {
  const baseStart = new Date(ensureUTC(startTime));
  const baseEnd = new Date(ensureUTC(endTime));
  const durationMs = baseEnd.getTime() - baseStart.getTime();

  if (!rule || !rule.type || rule.type === 'none' || Number.isNaN(baseStart.getTime()) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return { start: ensureUTC(startTime), end: ensureUTC(endTime) };
  }

  const endDate = rule.endType === 'on' && rule.endDate ? new Date(`${rule.endDate}T23:59:59Z`) : null;
  const exceptionDates = rule.exceptions && rule.exceptions.length > 0 ? new Set(rule.exceptions) : null;
  const maxCount = rule.endType === 'after' && rule.endCount ? rule.endCount : Infinity;

  let lastOccurrenceStart = baseStart;
  let matchedCount = 0;

  for (let offset = 0; offset <= RECURRENCE_MAX_LOOKAHEAD_DAYS; offset++) {
    const candidate = new Date(baseStart.getTime() + offset * DAY_MS);
    if (endDate && candidate.getTime() > endDate.getTime()) break;
    if (!isRecurringOccurrenceDate(candidate, baseStart, rule)) continue;

    matchedCount++;
    if (matchedCount > maxCount) break;

    const dateKey = candidate.toISOString().slice(0, 10);
    if (exceptionDates && exceptionDates.has(dateKey)) continue;

    lastOccurrenceStart = candidate;
    const occurrenceEnd = new Date(candidate.getTime() + durationMs);
    // Currently in progress, or the next one still to come -- this is the occurrence to show.
    if (occurrenceEnd.getTime() > now.getTime()) {
      return { start: candidate.toISOString(), end: occurrenceEnd.toISOString() };
    }
  }

  // Series has no more occurrences at/after now -- show the last one that occurred.
  return { start: lastOccurrenceStart.toISOString(), end: new Date(lastOccurrenceStart.getTime() + durationMs).toISOString() };
}

const router: RouterType = Router();

// Apply optional auth to all routes
router.use(optionalAuthMiddleware);

// Create a new meeting (requires being the calendar creator)
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const { calendar_hash, title, description, start_time, end_time, duration_minutes, meeting_link, time_slots, recurrence_rule } = req.body;
  const requestedId = req.body?.id === undefined ? null : sanitizeUUID(req.body.id);

  if (!calendar_hash || !title || !start_time || !end_time || !duration_minutes || !time_slots) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (req.body?.id !== undefined && !requestedId) {
    return res.status(400).json({ error: 'id must be a valid UUID' });
  }

  try {
    // Get calendar from hash
    const { data: calendar, error: calendarError } = await supabaseAdmin
      .from('calendars')
      .select('id, created_by, permissions, visibility, config')
      .eq('hash', calendar_hash)
      .single();

    if (calendarError || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    // Verify requester is creator/editor, or if calendar is public/subscribed
    const { canEdit } = await hasCalendarEditPermissionAsync(calendar, req);
    let allowed = canEdit || (calendar as { visibility?: string }).visibility === 'public';
    if (!allowed && req.userId) {
      const { data: sub } = await supabaseAdmin
        .from('calendar_subscriptions')
        .select('id')
        .eq('user_id', req.userId)
        .eq('calendar_id', calendar.id)
        .maybeSingle();
      if (sub) allowed = true;
    }

    if (!allowed) {
      return res.status(403).json({ error: 'You do not have permission to create meetings on this calendar' });
    }

    // Use server-verified identity for created_by
    const created_by = req.userEmail || req.userId;
    const matchesExistingMeeting = (existing: Record<string, unknown> | null) =>
      Boolean(
        existing &&
        existing.calendar_id === calendar.id &&
        existing.created_by === created_by &&
        existing.title === title &&
        (existing.description ?? null) === (description ?? null) &&
        (existing.meeting_link ?? null) === (meeting_link ?? null) &&
        new Date(String(existing.start_time)).getTime() === new Date(String(start_time)).getTime() &&
        new Date(String(existing.end_time)).getTime() === new Date(String(end_time)).getTime() &&
        existing.duration_minutes === duration_minutes &&
        JSON.stringify(existing.time_slots) === JSON.stringify(time_slots) &&
        JSON.stringify(existing.recurrence_rule ?? null) === JSON.stringify(recurrence_rule || null)
      );

    if (requestedId) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('meetings')
        .select('*')
        .eq('id', requestedId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        if (matchesExistingMeeting(existing as Record<string, unknown>)) {
          return res.status(200).json(existing);
        }
        return res.status(409).json({ error: 'Meeting idempotency key conflicts with an existing meeting' });
      }
    }

    // Create meeting
    const { data, error } = await supabaseAdmin
      .from('meetings')
      .insert([
        {
          ...(requestedId ? { id: requestedId } : {}),
          calendar_id: calendar.id,
          title,
          description,
          start_time,
          end_time,
          duration_minutes,
          meeting_link,
          created_by,
          time_slots,
          recurrence_rule: recurrence_rule || null
        }
      ])
      .select()
      .single();

    if (error) {
      if (requestedId && error.code === '23505') {
        const { data: existing, error: existingError } = await supabaseAdmin
          .from('meetings')
          .select('*')
          .eq('id', requestedId)
          .maybeSingle();
        if (existingError) throw existingError;
        if (matchesExistingMeeting(existing as Record<string, unknown> | null)) {
          return res.status(200).json(existing);
        }
        return res.status(409).json({ error: 'Meeting idempotency key conflicts with an existing meeting' });
      }
      return res.status(400).json({ error: safeErrorMessage(error) });
    }

    // Planning a meeting re-opens the public listing window and clears a manual archive
    const calendarConfig = (calendar as { config?: unknown }).config;
    if (
      calendarConfig
      && typeof calendarConfig === 'object'
      && !Array.isArray(calendarConfig)
      && (calendarConfig as Record<string, unknown>).archived === true
    ) {
      const { archived: _archived, ...restConfig } = calendarConfig as Record<string, unknown>;
      await supabaseAdmin
        .from('calendars')
        .update({ config: restConfig, archived_at: null, listing_expires_at: null })
        .eq('id', calendar.id);
    } else {
      await supabaseAdmin
        .from('calendars')
        .update({ archived_at: null, listing_expires_at: null })
        .eq('id', calendar.id)
        .not('archived_at', 'is', null);
    }

    res.status(201).json(data);
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Get a single meeting or standalone public event by ID (public).
// Serves both Coordination Calendar meetings (meetings table) and
// standalone public events (user_events table) behind one shareable
// landing page URL (/meeting/:id).
router.get('/single/:meetingId', async (req: AuthenticatedRequest, res: Response) => {
  const meetingId = sanitizeUUID(req.params.meetingId);
  if (!meetingId) {
    return res.status(404).json({ error: 'Meeting not found' });
  }

  try {
    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('*, calendars!inner(hash, title, visibility)')
      .eq('id', meetingId)
      .single();

    if (meeting) {
      const occurrence = resolveCurrentOccurrence(meeting.start_time, meeting.end_time, meeting.recurrence_rule);
      return res.json({
        meeting: {
          id: meeting.id,
          kind: 'calendar',
          title: meeting.title,
          description: meeting.description,
          location: null,
          start_time: occurrence.start,
          end_time: occurrence.end,
          duration_minutes: meeting.duration_minutes,
          meeting_link: meeting.meeting_link,
          calendar_hash: (meeting.calendars as { hash?: string; title?: string } | null)?.hash,
          calendar_title: (meeting.calendars as { hash?: string; title?: string } | null)?.title,
        },
      });
    }

    // Fall back to a standalone public event (no parent Coordination Calendar)
    const { data: event } = await supabaseAdmin
      .from('user_events')
      .select('id, title, description, meeting_link, location, start_time, end_time, source_type, source_id, is_public, recurrence_rule')
      .eq('id', meetingId)
      .eq('is_public', true)
      .single();

    if (!event) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    let sourceDisplayName: string | undefined;
    if (event.source_id) {
      const { data: source } = await supabaseAdmin
        .from('calendar_sources')
        .select('display_name')
        .eq('id', event.source_id)
        .maybeSingle();
      sourceDisplayName = source?.display_name;
    }

    const durationMinutes = Math.max(0, Math.round(
      (new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 60000
    ));
    const occurrence = resolveCurrentOccurrence(event.start_time, event.end_time, event.recurrence_rule);

    res.json({
      meeting: {
        id: event.id,
        kind: 'event',
        title: event.title,
        description: event.description,
        location: event.location,
        start_time: occurrence.start,
        end_time: occurrence.end,
        duration_minutes: durationMinutes,
        meeting_link: event.meeting_link,
        source_label: describeEventSource(event.source_type, sourceDisplayName),
      },
    });
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Get all meetings for a calendar (public read)
router.get('/:hash', async (req: AuthenticatedRequest, res: Response) => {
  const { hash } = req.params;

  try {
    // Get calendar ID from hash
    const { data: calendar, error: calendarError } = await supabaseAdmin
      .from('calendars')
      .select('id')
      .eq('hash', hash)
      .single();

    if (calendarError || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    // Get all meetings for this calendar
    const { data, error } = await supabaseAdmin
      .from('meetings')
      .select('*')
      .eq('calendar_id', calendar.id)
      .order('start_time', { ascending: true });

    if (error) {
      return res.status(400).json({ error: safeErrorMessage(error) });
    }

    // Ensure timestamps have UTC suffix (meetings uses plain TIMESTAMP column)
    const normalized = (data || []).map(m => ({
      ...m,
      start_time: ensureUTC(m.start_time),
      end_time: ensureUTC(m.end_time),
    }));

    res.json(normalized);
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Update a meeting (requires being the calendar creator)
router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { title, description, start_time, end_time, duration_minutes, meeting_link, time_slots, recurrence_rule } = req.body;

  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Get the meeting and its calendar to verify ownership
    const { data: meeting, error: meetingError } = await supabaseAdmin
      .from('meetings')
      .select('id, calendar_id')
      .eq('id', id)
      .single();

    if (meetingError || !meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const { data: calendar, error: calError } = await supabaseAdmin
      .from('calendars')
      .select('created_by, permissions')
      .eq('id', meeting.calendar_id)
      .single();

    if (calError || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    const { canEdit: hasPermission } = hasCalendarEditPermission(calendar, req);
    if (!hasPermission) {
      return res.status(403).json({ error: 'Only the calendar creator can update meetings' });
    }

    const { data, error } = await supabaseAdmin
      .from('meetings')
      .update({
        title,
        description,
        start_time,
        end_time,
        duration_minutes,
        meeting_link,
        time_slots,
        recurrence_rule: recurrence_rule !== undefined ? (recurrence_rule || null) : undefined,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: safeErrorMessage(error) });
    }

    res.json(data);
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Delete a meeting (requires being the calendar creator)
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Get the meeting and its calendar to verify ownership
    const { data: meeting, error: meetingError } = await supabaseAdmin
      .from('meetings')
      .select('id, calendar_id')
      .eq('id', id)
      .single();

    if (meetingError || !meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const { data: calendar, error: calError } = await supabaseAdmin
      .from('calendars')
      .select('created_by, permissions')
      .eq('id', meeting.calendar_id)
      .single();

    if (calError || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    const { canEdit: hasPermission } = hasCalendarEditPermission(calendar, req);
    if (!hasPermission) {
      return res.status(403).json({ error: 'Only the calendar creator can delete meetings' });
    }

    const { error } = await supabaseAdmin
      .from('meetings')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(400).json({ error: safeErrorMessage(error) });
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

export default router;