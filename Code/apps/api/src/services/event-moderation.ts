import { supabaseAdmin } from '../supabaseClient.js'

export type EventModerationTargetType = 'user_event' | 'meeting'

export async function setEventTargetsSuspended(
  targets: Array<{ target_type: EventModerationTargetType; target_id: string }>,
  flagId: string,
  isSuspended: boolean,
): Promise<void> {
  if (targets.length === 0) return
  const now = new Date().toISOString()
  const rows = targets.map(target => ({
    target_type: target.target_type,
    target_id: target.target_id,
    is_suspended: isSuspended,
    suspension_reason_flag_id: isSuspended ? flagId : null,
    suspended_at: isSuspended ? now : null,
    restored_at: isSuspended ? null : now,
    updated_at: now,
  }))
  const { error } = await supabaseAdmin
    .from('public_event_moderation_state')
    .upsert(rows, { onConflict: 'target_type,target_id' })
  if (error) throw error
}

export async function clearEventTargetsSuspension(
  targets: Array<{ target_type: EventModerationTargetType; target_id: string }>,
): Promise<void> {
  if (targets.length === 0) return
  const now = new Date().toISOString()
  const rows = targets.map(target => ({
    target_type: target.target_type,
    target_id: target.target_id,
    is_suspended: false,
    suspension_reason_flag_id: null,
    suspended_at: null,
    restored_at: now,
    updated_at: now,
  }))
  const { error } = await supabaseAdmin
    .from('public_event_moderation_state')
    .upsert(rows, { onConflict: 'target_type,target_id' })
  if (error) throw error
}

export async function refreshEventTargetSuspensions(
  targets: Array<{ target_type: EventModerationTargetType; target_id: string }>,
  fallbackFlagId: string,
): Promise<void> {
  const expandedTargets: Array<{ target_type: EventModerationTargetType; target_id: string }> = []
  const seenKeys = new Set<string>()

  for (const t of targets) {
    const key = `${t.target_type}:${t.target_id}`
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      expandedTargets.push(t)
    }

    if (t.target_type === 'user_event') {
      const { data: ue } = await supabaseAdmin
        .from('user_events')
        .select('external_event_id')
        .eq('id', t.target_id)
        .maybeSingle()
      if (ue?.external_event_id) {
        const mKey = `meeting:${ue.external_event_id}`
        if (!seenKeys.has(mKey)) {
          seenKeys.add(mKey)
          expandedTargets.push({ target_type: 'meeting', target_id: ue.external_event_id })
        }
      }
    } else if (t.target_type === 'meeting') {
      const { data: ues } = await supabaseAdmin
        .from('user_events')
        .select('id')
        .eq('external_event_id', t.target_id)
      for (const row of ues || []) {
        const uKey = `user_event:${row.id}`
        if (!seenKeys.has(uKey)) {
          seenKeys.add(uKey)
          expandedTargets.push({ target_type: 'user_event', target_id: row.id })
        }
      }
    }
  }

  for (const target of expandedTargets) {
    const { data: associations, error: associationsError } = await supabaseAdmin
      .from('event_flag_targets')
      .select('flag_id, status')
      .eq('target_type', target.target_type)
      .eq('target_id', target.target_id)
      .in('status', ['pending', 'expired'])
    if (associationsError) throw associationsError

    const blockingFlagIds = (associations || [])
      .filter(association => association.status === 'expired')
      .map(association => association.flag_id)
    const pendingFlagIds = (associations || [])
      .filter(association => association.status === 'pending')
      .map(association => association.flag_id)

    if (pendingFlagIds.length > 0) {
      const { data: removalFlags, error: flagsError } = await supabaseAdmin
        .from('event_flags')
        .select('id')
        .in('id', pendingFlagIds)
        .eq('flag_type', 'removal')
      if (flagsError) throw flagsError
      blockingFlagIds.push(...(removalFlags || []).map(flag => flag.id))
    }

    await setEventTargetsSuspended(
      [target],
      blockingFlagIds[0] || fallbackFlagId,
      blockingFlagIds.length > 0,
    )
  }
}

export async function expireOverdueEventFlags(): Promise<void> {
  const now = new Date().toISOString()

  // 1. Expire overdue confirmation flags (7 days)
  const { data: overdueConfirmationFlags, error: confError } = await supabaseAdmin
    .from('event_flags')
    .select('id')
    .eq('flag_type', 'confirmation')
    .eq('status', 'pending')
    .lt('respond_by', now)
  if (confError) throw confError

  for (const flag of overdueConfirmationFlags || []) {
    const { data: pendingTargets, error: targetsError } = await supabaseAdmin
      .from('event_flag_targets')
      .select('target_type, target_id')
      .eq('flag_id', flag.id)
      .eq('status', 'pending')
    if (targetsError) throw targetsError
    if (!pendingTargets || pendingTargets.length === 0) continue

    await setEventTargetsSuspended(pendingTargets, flag.id, true)
    const { error: targetUpdateError } = await supabaseAdmin
      .from('event_flag_targets')
      .update({ status: 'expired', responded_at: now })
      .eq('flag_id', flag.id)
      .eq('status', 'pending')
    if (targetUpdateError) throw targetUpdateError

    const { error: flagUpdateError } = await supabaseAdmin
      .from('event_flags')
      .update({ status: 'expired', resolved_at: now })
      .eq('id', flag.id)
    if (flagUpdateError) throw flagUpdateError

    const { error: actionError } = await supabaseAdmin.from('event_flag_actions').insert({
      flag_id: flag.id,
      action: 'expired',
      actor_type: 'system',
      details: { expired_target_count: pendingTargets.length },
    })
    if (actionError) throw actionError
  }

  // 2. Auto-approve overdue removal flags (14 days)
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data: overdueRemovalFlags, error: remError } = await supabaseAdmin
    .from('event_flags')
    .select('id')
    .eq('flag_type', 'removal')
    .eq('status', 'pending')
    .lt('created_at', fourteenDaysAgo)
  if (remError) throw remError

  for (const flag of overdueRemovalFlags || []) {
    const { data: pendingTargets, error: targetsError } = await supabaseAdmin
      .from('event_flag_targets')
      .select('target_type, target_id')
      .eq('flag_id', flag.id)
      .eq('status', 'pending')
    if (targetsError) throw targetsError
    if (!pendingTargets || pendingTargets.length === 0) continue

    // For user_events targets, set is_public = false so they are un-published
    const userEventIds = pendingTargets
      .filter(t => t.target_type === 'user_event')
      .map(t => t.target_id)
    if (userEventIds.length > 0) {
      await supabaseAdmin
        .from('user_events')
        .update({ is_public: false, updated_at: now })
        .in('id', userEventIds)
    }

    await setEventTargetsSuspended(pendingTargets, flag.id, true)
    const { error: targetUpdateError } = await supabaseAdmin
      .from('event_flag_targets')
      .update({ status: 'removal_accepted', responded_at: now })
      .eq('flag_id', flag.id)
      .eq('status', 'pending')
    if (targetUpdateError) throw targetUpdateError

    const { error: flagUpdateError } = await supabaseAdmin
      .from('event_flags')
      .update({ status: 'removal_accepted', resolved_at: now })
      .eq('id', flag.id)
    if (flagUpdateError) throw flagUpdateError

    const { error: actionError } = await supabaseAdmin.from('event_flag_actions').insert({
      flag_id: flag.id,
      action: 'auto_removal_accepted',
      actor_type: 'system',
      details: { auto_accepted_target_count: pendingTargets.length },
    })
    if (actionError) throw actionError
  }
}