/**
 * Public Coordination Calendar listing lifecycle.
 *
 * Any-week calendars (general weekday availability, `config.hideDateNumbers`)
 * have no meaningful end date, so their public listing window is activity
 * driven:
 *   1. Listed for LISTING_GRACE_DAYS after creation.
 *   2. After that, listed until LISTING_GRACE_DAYS after the last planned
 *      meeting. Each newly planned meeting pushes the window forward.
 *   3. When the window passes with no further planned meeting, the calendar is
 *      archived (`archived_at`). Planning a new meeting un-archives it.
 *   4. Owners can also archive an any-week calendar manually
 *      (`config.archived`). The sweep keeps it archived until the owner
 *      un-archives it or a new meeting is planned.
 *
 * Dated calendars keep their existing behaviour (archived once the configured
 * end date has passed) and are not touched here.
 */
import { supabaseAdmin } from '../supabaseClient.js';

export const LISTING_GRACE_DAYS = 14;
const SWEEP_MIN_INTERVAL_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ArchivableCalendar {
  id: string;
  config?: Record<string, unknown> | null;
  created_at?: string | null;
  archived_at?: string | null;
  listing_expires_at?: string | null;
}

export interface CalendarMeeting {
  calendar_id: string;
  start_time?: string | null;
  end_time?: string | null;
  recurrence_rule?: Record<string, unknown> | null;
}

export function isAnyWeekCalendar(config?: Record<string, unknown> | null): boolean {
  return config?.hideDateNumbers === true;
}

/** Archived by the owner from the calendar settings (Archive option). */
export function isManuallyArchived(config?: Record<string, unknown> | null): boolean {
  return config?.archived === true;
}

/** meetings table stores naive timestamps; treat them as UTC. */
function parseTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const normalized = value.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const ms = new Date(normalized).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Last planned occurrence of a meeting, or `null` when the meeting recurs
 * without a fixed end (the calendar then never expires).
 */
function lastOccurrenceMs(meeting: CalendarMeeting): number | null | undefined {
  const rule = meeting.recurrence_rule;
  if (rule) {
    const endType = rule.endType;
    if (endType === 'on' && typeof rule.endDate === 'string') {
      return parseTimestamp(`${rule.endDate}T23:59:59`) ?? undefined;
    }
    return null; // 'never' / 'after' -> open ended
  }
  return parseTimestamp(meeting.end_time) ?? parseTimestamp(meeting.start_time) ?? undefined;
}

/**
 * Next check date for a calendar's public listing.
 * Returns `null` when the listing never expires.
 */
export function computeListingExpiry(
  calendar: ArchivableCalendar,
  meetings: CalendarMeeting[]
): Date | null {
  const createdMs = parseTimestamp(calendar.created_at) ?? Date.now();
  let latestMs = createdMs;

  for (const meeting of meetings) {
    const occurrence = lastOccurrenceMs(meeting);
    if (occurrence === null) return null;
    if (occurrence !== undefined && occurrence > latestMs) latestMs = occurrence;
  }

  return new Date(latestMs + LISTING_GRACE_DAYS * DAY_MS);
}

interface SweepResult {
  archived: number;
  unarchived: number;
}

/**
 * Recompute and persist archive state for every public any-week calendar.
 * Safe to call often -- writes only happen when state actually changes.
 */
export async function sweepPublicCalendarArchiveState(): Promise<SweepResult> {
  const result: SweepResult = { archived: 0, unarchived: 0 };

  const { data: calendars, error } = await supabaseAdmin
    .from('calendars')
    .select('id, config, created_at, archived_at, listing_expires_at')
    .eq('visibility', 'public');

  if (error || !calendars?.length) return result;

  const anyWeek = (calendars as ArchivableCalendar[]).filter(c => isAnyWeekCalendar(c.config));
  if (!anyWeek.length) return result;

  const { data: meetings } = await supabaseAdmin
    .from('meetings')
    .select('calendar_id, start_time, end_time, recurrence_rule')
    .in('calendar_id', anyWeek.map(c => c.id));

  const byCalendar = new Map<string, CalendarMeeting[]>();
  for (const meeting of (meetings || []) as CalendarMeeting[]) {
    const list = byCalendar.get(meeting.calendar_id);
    if (list) list.push(meeting);
    else byCalendar.set(meeting.calendar_id, [meeting]);
  }

  const now = Date.now();

  for (const calendar of anyWeek) {
    const expiry = computeListingExpiry(calendar, byCalendar.get(calendar.id) || []);
    const shouldArchive = isManuallyArchived(calendar.config) || (expiry !== null && expiry.getTime() < now);
    const isArchived = Boolean(calendar.archived_at);
    const expiryIso = expiry ? expiry.toISOString() : null;

    if (shouldArchive === isArchived && expiryIso === (calendar.listing_expires_at ?? null)) continue;

    const archivedAt = shouldArchive ? (calendar.archived_at ?? new Date().toISOString()) : null;
    const { error: updateError } = await supabaseAdmin
      .from('calendars')
      .update({ archived_at: archivedAt, listing_expires_at: expiryIso })
      .eq('id', calendar.id);

    if (updateError) continue;
    if (shouldArchive && !isArchived) result.archived += 1;
    if (!shouldArchive && isArchived) result.unarchived += 1;
  }

  return result;
}

let lastSweepAt = 0;
let inFlight: Promise<SweepResult> | null = null;

/**
 * Throttled sweep for use on read paths. Never rejects.
 */
export function scheduleArchiveSweep(): Promise<SweepResult> {
  if (inFlight) return inFlight;
  if (Date.now() - lastSweepAt < SWEEP_MIN_INTERVAL_MS) {
    return Promise.resolve({ archived: 0, unarchived: 0 });
  }
  lastSweepAt = Date.now();
  inFlight = sweepPublicCalendarArchiveState()
    .catch(err => {
      console.error('Calendar archive sweep failed:', err instanceof Error ? err.message : err);
      return { archived: 0, unarchived: 0 };
    })
    .finally(() => {
      inFlight = null;
    }) as Promise<SweepResult>;
  return inFlight;
}
