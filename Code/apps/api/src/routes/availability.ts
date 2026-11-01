import { Router, Response } from 'express';
import type { Router as RouterType } from 'express';
import { supabaseAdmin } from '../supabaseClient.js';
import { optionalAuthMiddleware, authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { safeErrorMessage } from '../middleware/validation.js';
import { notifyParticipationChange } from '../services/calendar-notifications.js';

const router: RouterType = Router();

// Apply optional auth to all routes
router.use(optionalAuthMiddleware);

// Save/update user availability for a calendar
// mode: 'add' (default) merges new slots with existing, 'remove' subtracts slots from existing
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const { calendar_hash, username, time_slots, mode = 'add' } = req.body;

  if (!calendar_hash || !username || !time_slots) {
    return res.status(400).json({ error: 'Missing required fields: calendar_hash, username, time_slots' });
  }

  if (mode !== 'add' && mode !== 'remove') {
    return res.status(400).json({ error: 'Invalid mode. Must be "add" or "remove"' });
  }

  try {
    // First get the calendar ID from the hash
    const { data: calendar, error: calendarError } = await supabaseAdmin
      .from('calendars')
      .select('id, created_by, config')
      .eq('hash', calendar_hash)
      .single();

    if (calendarError || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    // Fetch existing availability for this user
    const { data: existing } = await supabaseAdmin
      .from('availability')
      .select('time_slots')
      .eq('calendar_id', calendar.id)
      .eq('username', username)
      .single();

    let mergedSlots: string[];
    if (mode === 'add') {
      const existingSet = new Set<string>(existing?.time_slots || []);
      for (const slot of time_slots) existingSet.add(slot);
      mergedSlots = Array.from(existingSet);
    } else {
      // mode === 'remove'
      const removeSet = new Set<string>(time_slots);
      mergedSlots = (existing?.time_slots || []).filter((s: string) => !removeSet.has(s));
    }

    // If removing resulted in empty slots, delete the record entirely
    if (mergedSlots.length === 0) {
      await supabaseAdmin
        .from('availability')
        .delete()
        .eq('calendar_id', calendar.id)
        .eq('username', username);

      notifyParticipationChange({
        calendar,
        participantName: String(username),
        before: existing?.time_slots,
        after: [],
        actor: { userId: req.userId, email: req.userEmail },
      });

      // Auto-subscribe still applies
      if (req.userId) {
        try {
          await supabaseAdmin
            .from('calendar_subscriptions')
            .upsert(
              { user_id: req.userId, calendar_id: calendar.id },
              { onConflict: 'user_id,calendar_id', ignoreDuplicates: true }
            )
        } catch {
          // Non-critical
        }
      }

      return res.json({ success: true, time_slots: [] });
    }

    // Upsert availability with merged slots
    const { data, error } = await supabaseAdmin
      .from('availability')
      .upsert(
        {
          calendar_id: calendar.id,
          username,
          time_slots: mergedSlots,
          updated_at: new Date().toISOString(),
          ...(req.userId ? { user_id: req.userId } : {})
        },
        {
          onConflict: 'calendar_id,username'
        }
      )
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: safeErrorMessage(error) });
    }

    notifyParticipationChange({
      calendar,
      participantName: String(username),
      before: existing?.time_slots,
      after: mergedSlots,
      actor: { userId: req.userId, email: req.userEmail },
    });

    // Auto-subscribe: if the user is logged in, subscribe them to this calendar
    if (req.userId) {
      try {
        await supabaseAdmin
          .from('calendar_subscriptions')
          .upsert(
            { user_id: req.userId, calendar_id: calendar.id },
            { onConflict: 'user_id,calendar_id', ignoreDuplicates: true }
          )

        // Sync Discord DM subscription status so the bot knows this user subscribed
        await supabaseAdmin
          .from('dm_calendar_invites')
          .update({ status: 'subscribed', updated_at: new Date().toISOString() })
          .eq('calendar_id', calendar.id)
          .eq('cm_user_id', req.userId)
      } catch {
        // Non-critical -- don't fail the availability save
      }
    }

    res.json(data);
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Get all availability for a calendar (public read)
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

    // Get all availability for this calendar
    const { data, error } = await supabaseAdmin
      .from('availability')
      .select('*')
      .eq('calendar_id', calendar.id)
      .order('created_at', { ascending: true });

    if (error) {
      return res.status(400).json({ error: safeErrorMessage(error) });
    }

    res.json(data);
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Delete user availability
router.delete('/', async (req: AuthenticatedRequest, res: Response) => {
  const { calendar_hash, username } = req.body;

  if (!calendar_hash || !username) {
    return res.status(400).json({ error: 'Missing required fields: calendar_hash, username' });
  }

  try {
    // Get calendar ID from hash
    const { data: calendar, error: calendarError } = await supabaseAdmin
      .from('calendars')
      .select('id, created_by, config')
      .eq('hash', calendar_hash)
      .single();

    if (calendarError || !calendar) {
      return res.status(404).json({ error: 'Calendar not found' });
    }

    const { data: existing } = await supabaseAdmin
      .from('availability')
      .select('time_slots')
      .eq('calendar_id', calendar.id)
      .eq('username', username)
      .maybeSingle();

    // Delete availability
    const { error } = await supabaseAdmin
      .from('availability')
      .delete()
      .eq('calendar_id', calendar.id)
      .eq('username', username);

    if (error) {
      return res.status(400).json({ error: safeErrorMessage(error) });
    }

    notifyParticipationChange({
      calendar,
      participantName: String(username),
      before: existing?.time_slots,
      after: [],
      actor: { userId: req.userId, email: req.userEmail },
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// ─── GET /api/availability/user/past ────────────────────────
// Fetch availability entries the logged-in user has submitted
// across all calendars (excluding a given calendar).
// Uses the user_id column to identify the user's own entries.
// Query params: ?exclude_hash=<current_calendar_hash>

router.get('/user/past', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const excludeHash = typeof req.query.exclude_hash === 'string' ? req.query.exclude_hash : undefined;

  try {
    // 1. Fetch all availability records belonging to this user
    const { data: avail, error: availErr } = await supabaseAdmin
      .from('availability')
      .select('calendar_id, username, time_slots, updated_at')
      .eq('user_id', req.userId);

    if (availErr) return res.status(400).json({ error: safeErrorMessage(availErr) });
    if (!avail || avail.length === 0) return res.json({ entries: [] });

    // 2. Collect unique calendar IDs and fetch their details
    const calendarIds = [...new Set(avail.map(a => a.calendar_id))];

    const { data: calendars, error: calErr } = await supabaseAdmin
      .from('calendars')
      .select('id, hash, title, config')
      .in('id', calendarIds);

    if (calErr) return res.status(400).json({ error: safeErrorMessage(calErr) });
    if (!calendars || calendars.length === 0) return res.json({ entries: [] });

    const calMap = new Map(calendars.map(c => [c.id, c]));

    // 3. Exclude the current calendar
    const excludeCalendarIds = new Set(
      calendars.filter(c => c.hash === excludeHash).map(c => c.id)
    );
    const filtered = avail.filter(a => !excludeCalendarIds.has(a.calendar_id));
    if (filtered.length === 0) return res.json({ entries: [] });

    // 4. Build response entries
    const entries = filtered.map(a => {
      const cal = calMap.get(a.calendar_id);
      const slots: string[] = a.time_slots || [];

      let minDate = '';
      let maxDate = '';
      for (const slot of slots) {
        const date = slot.split('_')[0];
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }

      const intervalMinutes = cal?.config?.timeInterval || 30;
      const entryCount = slots.length * (intervalMinutes / 60);

      return {
        calendar_id: a.calendar_id,
        calendar_hash: cal?.hash || '',
        calendar_title: cal?.title || 'Untitled',
        username: a.username,
        time_slots: slots,
        date_range: minDate && maxDate ? `${minDate} - ${maxDate}` : '',
        entry_count: entryCount,
        updated_at: a.updated_at,
      };
    });

    res.json({ entries });
  } catch {
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

export default router;