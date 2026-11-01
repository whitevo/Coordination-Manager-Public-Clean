import { Router, Response } from 'express';
import type { Router as RouterType } from 'express';
import { createHash } from 'crypto';
import { supabaseAdmin } from '../supabaseClient.js';
import { nanoid } from 'nanoid';
import { optionalAuthMiddleware, AuthenticatedRequest, hasCalendarEditPermissionAsync } from '../middleware/auth.js';
import { scheduleArchiveSweep } from '../services/calendar-archive.js';
import { getNotificationSettings, normalizeNotificationEmail, resolveOrganiser } from '../services/calendar-notifications.js';
import { safeErrorMessage, sanitizeString, sanitizeUUID } from '../middleware/validation.js';

const router: RouterType = Router();

// Apply optional auth to all routes — extracts user info when token present
router.use(optionalAuthMiddleware);

// --- Input validation helpers ---------------------------------

const CALENDAR_TITLE_MAX_LENGTH = 200;
const CALENDAR_CONFIG_MAX_BYTES = 20 * 1024;
const MAX_AVAILABILITY_CONVERSION_DAYS = 730;
const CALENDAR_PERMISSION_MAX_ENTRIES = 100;
const CALENDAR_PERMISSION_ENTRY_MAX_LENGTH = 320;
const CALENDAR_VISIBILITIES = ['public', 'unlisted'] as const;
const CREATOR_ACCOUNT_TYPES = ['google', 'traveler', 'cardano', 'managed_cardano'] as const;

type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function validateCalendarConfig(config: unknown): ValidationResult<Record<string, unknown>> {
  if (!isPlainObject(config)) return { ok: false, message: 'config must be an object' };
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(config), 'utf8');
  } catch {
    return { ok: false, message: 'config must be JSON serializable' };
  }
  if (size > CALENDAR_CONFIG_MAX_BYTES) {
    return { ok: false, message: `config must be at most ${CALENDAR_CONFIG_MAX_BYTES} bytes` };
  }
  return { ok: true, value: config };
}

function parseCalendarDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

function expandWeeklyAvailability(
  timeSlots: string[],
  startDate: Date,
  endDate: Date,
): string[] {
  const datesByWeekday: string[][] = Array.from({ length: 7 }, () => []);
  const date = new Date(startDate);
  while (date <= endDate) {
    datesByWeekday[date.getUTCDay()].push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }

  const expandedSlots = new Set<string>();
  for (const slot of timeSlots) {
    const match = /^(\d{4}-\d{2}-\d{2})_((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(slot);
    const weeklyDate = match ? parseCalendarDate(match[1]) : null;
    if (!match || !weeklyDate) {
      expandedSlots.add(slot);
      continue;
    }

    const time = match[2];
    for (const matchingDate of datesByWeekday[weeklyDate.getUTCDay()]) {
      expandedSlots.add(`${matchingDate}_${time}`);
    }
  }

  return [...expandedSlots];
}

function validateCalendarVisibility(visibility: unknown): ValidationResult<'public' | 'unlisted'> {
  if (typeof visibility === 'string' && (CALENDAR_VISIBILITIES as readonly string[]).includes(visibility)) {
    return { ok: true, value: visibility as 'public' | 'unlisted' };
  }
  return { ok: false, message: "visibility must be 'public' or 'unlisted'" };
}

function validateCalendarPermissions(permissions: unknown): ValidationResult<{ canEdit: string[] }> {
  if (!isPlainObject(permissions) || !Array.isArray(permissions.canEdit)) {
    return { ok: false, message: 'permissions must be an object with a canEdit array' };
  }
  const canEdit = permissions.canEdit as unknown[];
  if (canEdit.length > CALENDAR_PERMISSION_MAX_ENTRIES) {
    return { ok: false, message: `permissions.canEdit may contain at most ${CALENDAR_PERMISSION_MAX_ENTRIES} entries` };
  }
  const entries: string[] = [];
  for (const entry of canEdit) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > CALENDAR_PERMISSION_ENTRY_MAX_LENGTH) {
      return {
        ok: false,
        message: `permissions.canEdit entries must be strings of at most ${CALENDAR_PERMISSION_ENTRY_MAX_LENGTH} characters`,
      };
    }
    entries.push(entry);
  }
  return { ok: true, value: { canEdit: entries } };
}

function validationError(res: Response, message: string) {
  return res.status(400).json({ error: 'VALIDATION_ERROR', message, statusCode: 400 });
}

// Create a new calendar
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const body: Record<string, unknown> = isPlainObject(req.body) ? req.body : {};
  const { config, permissions, visibility, creator_account_type } = body;
  const requestedId = body.id === undefined ? null : sanitizeUUID(body.id);
  if (body.id !== undefined && !requestedId) {
    return validationError(res, 'id must be a valid UUID');
  }

  // Creation requires a verified session (Google, wallet, or traveler); created_by
  // always comes from the token, never from the request body.
  const verifiedCreatedBy = req.userEmail || req.userId;
  if (!verifiedCreatedBy) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign in to create a calendar', statusCode: 401 });
  }

  const title = sanitizeString(body.title, CALENDAR_TITLE_MAX_LENGTH);
  if (!title) {
    return validationError(res, `title is required and must be at most ${CALENDAR_TITLE_MAX_LENGTH} characters`);
  }

  let validatedConfig: Record<string, unknown> = {};
  if (config !== undefined && config !== null) {
    const result = validateCalendarConfig(config);
    if (!result.ok) return validationError(res, result.message);
    validatedConfig = result.value;
  }

  let validatedVisibility: 'public' | 'unlisted' = 'unlisted';
  if (visibility !== undefined && visibility !== null) {
    const result = validateCalendarVisibility(visibility);
    if (!result.ok) return validationError(res, result.message);
    validatedVisibility = result.value;
  }

  let validatedPermissions: { canEdit: string[] } | undefined;
  if (permissions !== undefined && permissions !== null) {
    const result = validateCalendarPermissions(permissions);
    if (!result.ok) return validationError(res, result.message);
    validatedPermissions = result.value;
  }

  const validatedAccountType =
    typeof creator_account_type === 'string' && (CREATOR_ACCOUNT_TYPES as readonly string[]).includes(creator_account_type)
      ? creator_account_type
      : 'google';

  const hash = requestedId
    ? createHash('sha256').update(requestedId).digest('base64url').slice(0, 10)
    : nanoid(10);

  // Enforce title ↔ config.eventName sync: they must always match.
  // Title is the canonical name; config.eventName mirrors it for the calendar view.
  const syncedConfig = { ...validatedConfig, eventName: title };

  const { data, error } = await supabaseAdmin
    .from('calendars')
    .insert([
      {
        ...(requestedId ? { id: requestedId } : {}),
        hash,
        title,
        config: syncedConfig,
        permissions: validatedPermissions,
        created_by: verifiedCreatedBy,
        visibility: validatedVisibility,
        creator_account_type: validatedAccountType,
      }
    ])
    .select()
    .single();

  if (error) {
    const isIdempotencyConflict = requestedId && error.code === '23505';
    if (isIdempotencyConflict) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('calendars')
        .select('*')
        .eq('id', requestedId)
        .eq('created_by', verifiedCreatedBy)
        .maybeSingle();

      if (existingError) {
        return res.status(500).json({ error: 'Could not confirm calendar creation' });
      }
      if (
        existing &&
        existing.title === title &&
        JSON.stringify(existing.config) === JSON.stringify(syncedConfig) &&
        JSON.stringify(existing.permissions) === JSON.stringify(validatedPermissions ?? null) &&
        existing.visibility === validatedVisibility &&
        existing.creator_account_type === validatedAccountType
      ) {
        return res.status(200).json(existing);
      }
      if (existing) return res.status(409).json({ error: 'Calendar idempotency key conflicts with an existing calendar' });
    }

    return res.status(400).json({ error: safeErrorMessage(error) });
  }
  res.status(201).json(data);
});

// Get calendar by hash
router.get('/:hash', async (req: AuthenticatedRequest, res: Response) => {
  const { hash } = req.params;
  const { data, error } = await supabaseAdmin
    .from('calendars')
    .select('*')
    .eq('hash', hash)
    .single();

  if (error) return res.status(404).json({ error: 'Calendar not found' });

  // Compute ownership flags server-side so frontend doesn't need to guess identity formats
  let is_owner = false;
  let has_edit_permission = false;

  if (req.userId) {
    const { isCreator, canEdit } = await hasCalendarEditPermissionAsync(data, req);
    is_owner = isCreator;
    has_edit_permission = canEdit;
  }

  // Resolve creator display name so frontend never shows raw emails
  const creator_display_name = await resolveCreatorDisplayName(data.created_by);

  // Check if the requesting user is friends with the calendar creator
  let is_friend_with_creator = false;
  if (req.userId && !is_owner && data.created_by) {
    is_friend_with_creator = await checkFriendWithCreator(req.userId, data.created_by);
  }

  res.json({ ...data, is_owner, has_edit_permission, creator_display_name, is_friend_with_creator });
});

/**
 * Resolve a single created_by value to its public display name.
 * Returns the display_name, traveler_name, or wallet_address — never the raw email.
 * Falls back to null if no user is found or no public name is set.
 */
async function resolveCreatorDisplayName(createdBy: string | null | undefined): Promise<string | null> {
  if (!createdBy) return null;
  const map = await buildCreatorNameMap([createdBy]);
  return map.get(createdBy) || null;
}

/**
 * Build a map from created_by values to public display names.
 * created_by may be a UUID (userId), email, traveler_name, or wallet_address —
 * we run separate queries per type to avoid UUID cast errors in Supabase.
 */
async function buildCreatorNameMap(creatorIds: string[]): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  if (!creatorIds.length) return nameMap;

  // Partition creator IDs by type so each query targets the correct column
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Fake-email patterns used for non-Google accounts (e.g. wallet-xxx@cardano.wallet, traveler-xxx@traveler.local)
  const fakeEmailPattern = /@(cardano\.wallet|traveler\.local)$/i;
  const uuids: string[] = [];
  const emails: string[] = [];
  const fakeEmails: string[] = []; // wallet / traveler pseudo-emails
  const names: string[] = [];
  for (const id of creatorIds) {
    if (uuidPattern.test(id)) uuids.push(id);
    else if (fakeEmailPattern.test(id)) fakeEmails.push(id);
    else if (id.includes('@')) emails.push(id);
    else names.push(id);
  }

  // Run queries in parallel — one per column type
  const selectCols = 'id, email, display_name, traveler_name, wallet_address';
  type UserLookupRow = { id?: string; email?: string; display_name?: string | null; traveler_name?: string | null; wallet_address?: string | null };
  const queries: PromiseLike<UserLookupRow[]>[] = [];
  if (uuids.length) {
    queries.push(
      supabaseAdmin.from('users').select(selectCols).in('id', uuids).then(r => r.data || [])
    );
  }
  if (emails.length) {
    queries.push(
      supabaseAdmin.from('users').select(selectCols).in('email', emails).then(r => r.data || [])
    );
  }
  // Fake emails (wallet / traveler) — the user's id column holds the UUID that was used
  // to create the fake email, so look up by id extracted from the prefix, or by email column
  // since some implementations store the fake email there too
  if (fakeEmails.length) {
    queries.push(
      supabaseAdmin.from('users').select(selectCols).in('email', fakeEmails).then(r => r.data || [])
    );
    // Also try traveler_name for traveler accounts
    queries.push(
      supabaseAdmin.from('users').select(selectCols).in('traveler_name', fakeEmails).then(r => r.data || [])
    );
  }
  if (names.length) {
    // Names could be traveler_name or wallet_address — check both
    queries.push(
      supabaseAdmin.from('users').select(selectCols).in('traveler_name', names).then(r => r.data || [])
    );
    queries.push(
      supabaseAdmin.from('users').select(selectCols).in('wallet_address', names).then(r => r.data || [])
    );
  }

  const results = await Promise.all(queries);
  const allUsers = results.flat();

  // Build lookup: created_by value → public display name.
  // Priority: display_name > traveler_name > wallet_address (truncated).
  // Never expose raw emails.
  for (const u of allUsers) {
    const displayName = u.display_name || u.traveler_name || null;
    const walletShort = u.wallet_address
      ? `${u.wallet_address.slice(0, 8)}...${u.wallet_address.slice(-6)}`
      : null;
    const publicName = displayName || walletShort || null;
    if (publicName) {
      if (u.id) nameMap.set(u.id, publicName);
      if (u.email) nameMap.set(u.email, publicName);
      if (u.traveler_name) nameMap.set(u.traveler_name, publicName);
      if (u.wallet_address) nameMap.set(u.wallet_address, publicName);
    }
  }

  // For any fake-email created_by values that weren't found via DB lookup,
  // generate a readable fallback from the fake email itself
  for (const fe of fakeEmails) {
    if (!nameMap.has(fe)) {
      if (fe.endsWith('@cardano.wallet')) {
        // Extract "wallet-0161985f4b18302a7035" → show truncated wallet ID
        const prefix = fe.replace('@cardano.wallet', '');
        const walletId = prefix.replace(/^wallet-/, '');
        nameMap.set(fe, walletId.length > 14 ? `${walletId.slice(0, 8)}...${walletId.slice(-6)}` : walletId);
      } else if (fe.endsWith('@traveler.local')) {
        const prefix = fe.replace('@traveler.local', '');
        nameMap.set(fe, prefix.replace(/^traveler-/, ''));
      }
    }
  }

  return nameMap;
}

/**
 * Check if the requesting user is friends (connected) with the calendar creator.
 * Resolves the created_by value to a user UUID first, then checks user_connections.
 */
async function checkFriendWithCreator(requestingUserId: string, createdBy: string): Promise<boolean> {
  // Resolve created_by to a user UUID
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let creatorUserId: string | null;

  if (uuidPattern.test(createdBy)) {
    creatorUserId = createdBy;
  } else {
    // Look up user by email, traveler_name, or wallet_address
    const lookupField = createdBy.includes('@') ? 'email'
      : createdBy.startsWith('stake') || createdBy.startsWith('addr') ? 'wallet_address'
      : 'traveler_name';
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq(lookupField, createdBy)
      .maybeSingle();
    creatorUserId = data?.id || null;
  }

  if (!creatorUserId || creatorUserId === requestingUserId) return false;

  // Check if there's an active connection in either direction
  const { data: conn } = await supabaseAdmin
    .from('user_connections')
    .select('id')
    .eq('status', 'connected')
    .or(
      `and(user_a_id.eq.${requestingUserId},user_b_id.eq.${creatorUserId}),and(user_a_id.eq.${creatorUserId},user_b_id.eq.${requestingUserId})`
    )
    .maybeSingle();

  return !!conn;
}

/**
 * Enrich an array of calendars with creator_display_name, has_recurring_meetings
 * and last_meeting_at (used by the UI to show live vs archived state).
 */
type CalendarRow = { id: string; created_by?: string | null; [key: string]: unknown };
async function enrichWithCreatorDisplayNames(calendars: CalendarRow[]): Promise<CalendarRow[]> {
  if (!calendars.length) return calendars;
  const creatorIds = [...new Set(calendars.map(c => c.created_by).filter((v): v is string => Boolean(v)))];
  const nameMap = await buildCreatorNameMap(creatorIds);

  const calendarIds = calendars.map(c => c.id);
  const { data: meetingRows } = await supabaseAdmin
    .from('meetings')
    .select('calendar_id, start_time, recurrence_rule')
    .in('calendar_id', calendarIds);

  // meetings table uses plain TIMESTAMP (no tz); treat values as UTC
  const ensureUTC = (ts: string) =>
    ts && !ts.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(ts) ? ts + 'Z' : ts;

  const recurringCalIds = new Set<string>();
  const lastMeetingAt = new Map<string, string>();
  for (const meeting of (meetingRows || []) as Array<{ calendar_id: string; start_time?: string | null; recurrence_rule?: unknown }>) {
    if (meeting.recurrence_rule) recurringCalIds.add(meeting.calendar_id);
    if (!meeting.start_time) continue;
    const startedAt = ensureUTC(meeting.start_time);
    const current = lastMeetingAt.get(meeting.calendar_id);
    if (!current || startedAt > current) lastMeetingAt.set(meeting.calendar_id, startedAt);
  }

  return calendars.map(cal => ({
    ...cal,
    creator_display_name: nameMap.get(cal.created_by || '') || null,
    has_recurring_meetings: recurringCalIds.has(cal.id),
    last_meeting_at: lastMeetingAt.get(cal.id) || null,
  }));
}

// List all calendars (optionally by user)
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  const { created_by, include_own } = req.query;

  // Refresh auto-archive state before listing (throttled internally)
  await scheduleArchiveSweep();

  if (created_by) {
    // Filter by specific user
    const query = supabaseAdmin.from('calendars').select('*').eq('created_by', created_by);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: safeErrorMessage(error) });
    return res.json(await enrichWithCreatorDisplayNames(data || []));
  }
  
  if (include_own) {
    // Return public calendars + user's own unlisted calendars
    // Use server-verified identity (from auth token) instead of client-supplied value
    // so that traveler accounts (whose created_by is a fake email) can find their calendars
    const ownerIdentity = req.userEmail || req.userId || (include_own as string);

    const { data: publicCals, error: pubError } = await supabaseAdmin
      .from('calendars')
      .select('*')
      .eq('visibility', 'public');
    
    if (pubError) return res.status(400).json({ error: safeErrorMessage(pubError) });
    
    // Query by both email and userId to cover all identity formats
    const ownQueries = [
      supabaseAdmin.from('calendars').select('*').eq('created_by', ownerIdentity).eq('visibility', 'unlisted'),
    ];
    // Also check userId if it differs from email
    if (req.userId && req.userId !== ownerIdentity) {
      ownQueries.push(
        supabaseAdmin.from('calendars').select('*').eq('created_by', req.userId).eq('visibility', 'unlisted')
      );
    }

    const ownResults = await Promise.all(ownQueries);
    const ownCals = ownResults.flatMap(r => r.data || []);
    
    // Merge and deduplicate by id
    const allCals = [...(publicCals || [])];
    const existingIds = new Set(allCals.map(c => c.id));
    for (const cal of ownCals) {
      if (!existingIds.has(cal.id)) {
        allCals.push(cal);
        existingIds.add(cal.id);
      }
    }
    
    return res.json(await enrichWithCreatorDisplayNames(allCals));
  }
  
  // Default: only public calendars
  const { data, error } = await supabaseAdmin.from('calendars').select('*').eq('visibility', 'public');
  if (error) return res.status(400).json({ error: safeErrorMessage(error) });
  res.json(await enrichWithCreatorDisplayNames(data || []));
});

// Transfer ownership when a traveler upgrades to a Google account
router.patch('/:hash/transfer-ownership', async (req: AuthenticatedRequest, res: Response) => {
  const { hash } = req.params;
  const { previousCreatorId } = req.body;

  // Require authentication
  if (!req.userId || !req.userEmail) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!previousCreatorId) {
    return res.status(400).json({ error: 'previousCreatorId is required' });
  }

  try {
    // Get the calendar
    const { data: calendar, error: fetchError } = await supabaseAdmin
      .from('calendars')
      .select('*')
      .eq('hash', hash)
      .single();

    if (fetchError || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    // Verify the calendar was created by the traveler (previousCreatorId must match created_by)
    if (calendar.created_by !== previousCreatorId) {
      return res.status(403).json({ error: 'Previous creator ID does not match' });
    }

    // Only allow transfer from traveler accounts
    if (calendar.creator_account_type !== 'traveler') {
      return res.status(403).json({ error: 'Ownership transfer is only allowed from traveler accounts' });
    }

    // Update the calendar: transfer ownership to the new authenticated user
    const canEdit = calendar.permissions?.canEdit || [];
    const newCanEdit = [...new Set([...canEdit, req.userEmail, req.userId])];

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('calendars')
      .update({
        created_by: req.userEmail,
        creator_account_type: 'google',
        permissions: { ...calendar.permissions, canEdit: newCanEdit }
      })
      .eq('hash', hash)
      .select()
      .single();

    if (updateError) {
      return res.status(400).json({ error: safeErrorMessage(updateError) });
    }

    res.json(updated);
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Update calendar settings (title, config, visibility)
// --- Organiser change-notification settings --------------------
// Private to the calendar creator. Stored outside calendars.config because
// config is readable by anyone with the hash.

async function loadOwnedCalendar(req: AuthenticatedRequest, res: Response) {
  if (!req.userId) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required', statusCode: 401 });
    return null;
  }
  const { data: calendar } = await supabaseAdmin
    .from('calendars')
    .select('id, created_by, permissions')
    .eq('hash', req.params.hash)
    .maybeSingle();
  if (!calendar) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Calendar not found', statusCode: 404 });
    return null;
  }
  const { isCreator } = await hasCalendarEditPermissionAsync(calendar, req);
  if (!isCreator) {
    res.status(403).json({ error: 'FORBIDDEN', message: 'Only the calendar organiser can manage notifications', statusCode: 403 });
    return null;
  }
  return calendar as { id: string; created_by: string };
}

async function notificationSettingsResponse(calendar: { id: string; created_by: string }, req: AuthenticatedRequest) {
  const [settings, organiser] = await Promise.all([
    getNotificationSettings(calendar.id),
    resolveOrganiser(calendar.created_by),
  ]);
  const defaultEmail = organiser.email ?? normalizeNotificationEmail(req.userEmail);
  return {
    enabled: settings.enabled,
    email: settings.email,
    notifyFrom: settings.notify_from,
    defaultEmail,
    effectiveEmail: normalizeNotificationEmail(settings.email) ?? defaultEmail,
  };
}

router.get('/:hash/notification-settings', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const calendar = await loadOwnedCalendar(req, res);
    if (!calendar) return;
    res.json(await notificationSettingsResponse(calendar, req));
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: safeErrorMessage(err), statusCode: 500 });
  }
});

router.put('/:hash/notification-settings', async (req: AuthenticatedRequest, res: Response) => {
  const body: Record<string, unknown> = isPlainObject(req.body) ? req.body : {};
  if (typeof body.enabled !== 'boolean') {
    return validationError(res, 'enabled must be a boolean');
  }

  let email: string | null = null;
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    email = normalizeNotificationEmail(body.email);
    if (!email) return validationError(res, 'email must be a valid email address');
  }

  let notifyFrom: string | null = null;
  if (body.notifyFrom !== undefined && body.notifyFrom !== null && body.notifyFrom !== '') {
    const parsed = typeof body.notifyFrom === 'string' ? new Date(body.notifyFrom) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return validationError(res, 'notifyFrom must be an ISO date-time or null');
    }
    notifyFrom = parsed.toISOString();
  }

  try {
    const calendar = await loadOwnedCalendar(req, res);
    if (!calendar) return;
    const { error } = await supabaseAdmin
      .from('calendar_notification_settings')
      .upsert(
        {
          calendar_id: calendar.id,
          enabled: body.enabled,
          email,
          notify_from: notifyFrom,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'calendar_id' },
      );
    if (error) {
      return res.status(400).json({ error: 'SAVE_FAILED', message: safeErrorMessage(error), statusCode: 400 });
    }
    res.json(await notificationSettingsResponse(calendar, req));
  } catch (err) {
    res.status(500).json({ error: 'INTERNAL_ERROR', message: safeErrorMessage(err), statusCode: 500 });
  }
});

router.patch('/:hash', async (req: AuthenticatedRequest, res: Response) => {
  const { hash } = req.params;
  const body: Record<string, unknown> = isPlainObject(req.body) ? req.body : {};
  const { config: rawConfig, visibility: rawVisibility } = body;

  // Require authentication
  if (!req.userId || !req.userEmail) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Validate provided fields before touching the database
  let title: string | undefined;
  if (body.title !== undefined) {
    const sanitizedTitle = sanitizeString(body.title, CALENDAR_TITLE_MAX_LENGTH);
    if (!sanitizedTitle) {
      return validationError(res, `title must be a non-empty string of at most ${CALENDAR_TITLE_MAX_LENGTH} characters`);
    }
    title = sanitizedTitle;
  }

  let config: Record<string, unknown> | undefined;
  if (rawConfig !== undefined) {
    const result = validateCalendarConfig(rawConfig);
    if (!result.ok) return validationError(res, result.message);
    config = result.value;
  }

  let visibility: 'public' | 'unlisted' | undefined;
  if (rawVisibility !== undefined) {
    const result = validateCalendarVisibility(rawVisibility);
    if (!result.ok) return validationError(res, result.message);
    visibility = result.value;
  }

  try {
    // Get the calendar to check permissions
    const { data: calendar, error: fetchError } = await supabaseAdmin
      .from('calendars')
      .select('*')
      .eq('hash', hash)
      .single();

    if (fetchError || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    // Verify edit permission using server-verified identity
    const { canEdit: hasPermission } = await hasCalendarEditPermissionAsync(calendar, req);

    if (!hasPermission) {
      return res.status(403).json({ error: 'You do not have permission to edit this calendar' });
    }

    // Build update payload — only include fields that were provided
    const updatePayload: Record<string, unknown> = {};
    if (title !== undefined) updatePayload.title = title;
    if (config !== undefined) updatePayload.config = config;
    if (visibility !== undefined) updatePayload.visibility = visibility;

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Enforce title ↔ config.eventName sync so the name is consistent everywhere.
    // If title is changing, push it into config.eventName.
    // If only config is changing and it has a new eventName, update title to match.
    if (title !== undefined && updatePayload.config) {
      (updatePayload.config as Record<string, unknown>).eventName = title;
    } else if (title !== undefined) {
      // config wasn't provided — merge eventName into the existing config
      const existingConfig = calendar.config || {};
      updatePayload.config = { ...existingConfig, eventName: title };
    } else if (updatePayload.config && (updatePayload.config as Record<string, unknown>).eventName) {
      // config.eventName changed but title wasn't explicitly sent — sync title from it
      const syncedTitle = sanitizeString((updatePayload.config as Record<string, unknown>).eventName, CALENDAR_TITLE_MAX_LENGTH);
      if (!syncedTitle) {
        return validationError(res, `config.eventName must be a non-empty string of at most ${CALENDAR_TITLE_MAX_LENGTH} characters`);
      }
      (updatePayload.config as Record<string, unknown>).eventName = syncedTitle;
      updatePayload.title = syncedTitle;
    }

    const currentConfig = isPlainObject(calendar.config) ? calendar.config : {};

    // Manual archive (config.archived) is only valid for Any Week calendars.
    // It keeps the format and participation, and only moves the calendar out
    // of the active listings until it is un-archived or a meeting is planned.
    if (config !== undefined) {
      const nextConfig = updatePayload.config as Record<string, unknown>;
      if (nextConfig.archived === true && nextConfig.hideDateNumbers === true) {
        if (!calendar.archived_at) updatePayload.archived_at = new Date().toISOString();
      } else {
        delete nextConfig.archived;
        if (currentConfig.archived === true) {
          updatePayload.archived_at = null;
          updatePayload.listing_expires_at = null;
        }
      }
    }

    const shouldExpandWeeklyAvailability = config !== undefined
      && currentConfig.hideDateNumbers === true
      && config.hideDateNumbers === false;
    let convertedAvailability: Array<{ username: string; time_slots: string[] }> | undefined;

    if (shouldExpandWeeklyAvailability && config) {
      const startDate = parseCalendarDate(config.customStartDate);
      const endDate = parseCalendarDate(config.customEndDate);
      const rangeDayCount = startDate && endDate
        ? Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
        : 0;
      if (
        !startDate
        || !endDate
        || startDate > endDate
        || rangeDayCount > MAX_AVAILABILITY_CONVERSION_DAYS
      ) {
        return validationError(res, `Switching from Any Week requires a valid date range of at most ${MAX_AVAILABILITY_CONVERSION_DAYS} days`);
      }

      const { data: availabilityRows, error: availabilityError } = await supabaseAdmin
        .from('availability')
        .select('id, username, time_slots')
        .eq('calendar_id', calendar.id)
        .order('created_at', { ascending: true });

      if (availabilityError) {
        return res.status(400).json({ error: safeErrorMessage(availabilityError) });
      }

      const convertedRows: Array<{ id: string; username: string; time_slots: string[] }> = [];
      for (const row of availabilityRows || []) {
        if (
          !isPlainObject(row)
          || typeof row.id !== 'string'
          || typeof row.username !== 'string'
          || !isStringArray(row.time_slots)
        ) {
          return res.status(500).json({ error: 'Calendar availability data is invalid' });
        }
        convertedRows.push({
          id: row.id,
          username: row.username,
          time_slots: expandWeeklyAvailability(row.time_slots, startDate, endDate),
        });
      }

      convertedAvailability = convertedRows.map(({ username, time_slots }) => ({ username, time_slots }));
      const updatedAt = new Date().toISOString();
      // Keep the calendar in weekly mode until every participation row is readable in date mode.
      for (const row of convertedRows) {
        const { error } = await supabaseAdmin
          .from('availability')
          .update({ time_slots: row.time_slots, updated_at: updatedAt })
          .eq('id', row.id);
        if (error) {
          return res.status(400).json({ error: safeErrorMessage(error) });
        }
      }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('calendars')
      .update(updatePayload)
      .eq('hash', hash)
      .select()
      .single();

    if (updateError) {
      return res.status(400).json({ error: safeErrorMessage(updateError) });
    }

    res.json(convertedAvailability ? { ...updated, convertedAvailability } : updated);
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Delete a calendar by hash (cascades to availability and meetings)
router.delete('/:hash', async (req: AuthenticatedRequest, res: Response) => {
  const { hash } = req.params;

  // Require authentication for delete operations
  if (!req.userId || !req.userEmail) {
    return res.status(401).json({ error: 'Authentication required to delete a calendar' });
  }

  try {
    // Get the calendar to check ownership
    const { data: calendar, error: fetchError } = await supabaseAdmin
      .from('calendars')
      .select('*')
      .eq('hash', hash)
      .single();

    if (fetchError || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    // Verify ownership using server-verified identity (not client-supplied)
    const { canEdit: hasPermission } = await hasCalendarEditPermissionAsync(calendar, req);

    if (!hasPermission) {
      return res.status(403).json({ error: 'You do not have permission to delete this calendar' });
    }

    // Delete the calendar (availability and meetings cascade via foreign keys)
    const { error: deleteError } = await supabaseAdmin
      .from('calendars')
      .delete()
      .eq('hash', hash);

    if (deleteError) {
      return res.status(400).json({ error: safeErrorMessage(deleteError) });
    }

    res.json({ message: 'Calendar deleted successfully' });
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

export default router;
