import type { SupabaseClient } from '@supabase/supabase-js'

// /optout status and /optout undo. Opt-outs live in dm_opt_outs:
// sender_user_id null = all bot DMs blocked; set = one sender blocked.

export interface OptOutDeps {
  supabase: SupabaseClient
}

interface OptOutRow {
  sender_user_id: string | null
  reason: string | null
}

async function loadOptOuts(deps: OptOutDeps, discordUserId: string): Promise<OptOutRow[] | null> {
  const { data, error } = await deps.supabase
    .from('dm_opt_outs')
    .select('sender_user_id, reason')
    .eq('recipient_discord_id', discordUserId)
  if (error) {
    console.error('Failed to load DM opt-outs:', error)
    return null
  }
  return (data ?? []) as OptOutRow[]
}

export async function describeOptOutStatus(deps: OptOutDeps, discordUserId: string): Promise<string> {
  const rows = await loadOptOuts(deps, discordUserId)
  if (!rows) return 'Something went wrong reading your DM settings. Please try again.'
  if (rows.length === 0) {
    return 'You receive DMs from Swarm Coordinator. Reply `stop` in a DM with the bot to opt out of all DMs.'
  }
  const blockedAll = rows.some(r => r.sender_user_id === null)
  const senderCount = rows.filter(r => r.sender_user_id !== null).length
  const lines: string[] = []
  if (blockedAll) lines.push('All DMs from Swarm Coordinator are blocked for you.')
  if (senderCount > 0) lines.push(`You blocked DMs from ${senderCount} sender(s).`)
  lines.push('Use `/optout undo` to receive DMs again.')
  return lines.join('\n')
}

export async function undoOptOuts(deps: OptOutDeps, discordUserId: string): Promise<string> {
  const rows = await loadOptOuts(deps, discordUserId)
  if (!rows) return 'Something went wrong reading your DM settings. Please try again.'
  if (rows.length === 0) return 'You have no DM opt-outs to undo. You already receive DMs from Swarm Coordinator.'

  const { error } = await deps.supabase
    .from('dm_opt_outs')
    .delete()
    .eq('recipient_discord_id', discordUserId)
  if (error) {
    console.error('Failed to remove DM opt-outs:', error)
    return 'Something went wrong removing your opt-out. Please try again.'
  }
  return `Done. Removed ${rows.length} opt-out(s); you will receive DMs from Swarm Coordinator again. Reply \`stop\` in a DM to opt out at any time.`
}
