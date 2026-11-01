import { supabase } from './supabase.js'

export interface GuardianChannelMetadata {
  guild_id: string
  guild_name: string
  channel_id: string
  channel_name: string
  channel_type: number
  parent_id: string | null
  synced_at: string
}

export interface GuardianRoleMetadata {
  guild_id: string
  guild_name: string
  role_id: string
  role_name: string
  role_color: number
  role_position: number
  synced_at: string
}

function changedRows<T extends object>(
  incoming: T[],
  existing: T[],
  id: keyof T,
  fields: Array<keyof T>,
): T[] {
  const byId = new Map(existing.map(row => [row[id], row]))
  return incoming.filter(row => {
    const previous = byId.get(row[id])
    return !previous || fields.some(field => row[field] !== previous[field])
  })
}

async function loadMetadata<T>(
  fetchPage: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  while (true) {
    const { data, error } = await fetchPage(offset)
    if (error) throw error
    if (!data?.length) return rows
    rows.push(...data)
    offset += data.length
  }
}

export async function syncGuardianChannelMetadata(
  guildId: string,
  incoming: GuardianChannelMetadata[],
  defaultMonitoring: (row: GuardianChannelMetadata) => boolean,
): Promise<number> {
  if (incoming.length === 0) return 0
  const existing: GuardianChannelMetadata[] = await loadMetadata(offset => supabase
    .from('guardian_server_channels')
    .select('guild_id, guild_name, channel_id, channel_name, channel_type, parent_id, synced_at')
    .eq('guild_id', guildId)
    .order('channel_id')
    .range(offset, offset + 999))
  const existingIds = new Set(existing.map(row => row.channel_id))
  const changes = changedRows(incoming, existing, 'channel_id', [
    'guild_name', 'channel_name', 'channel_type', 'parent_id',
  ])
  if (changes.length === 0) return 0
  const additions = changes.filter(row => !existingIds.has(row.channel_id))
    .map(row => ({ ...row, is_monitored: defaultMonitoring(row) }))
  const updates = changes.filter(row => existingIds.has(row.channel_id))
  // Separate batches keep new-channel defaults out of existing-row conflict updates.
  if (additions.length > 0) {
    const { error } = await supabase.from('guardian_server_channels')
      .upsert(additions, { onConflict: 'guild_id,channel_id', ignoreDuplicates: true })
    if (error) throw error
  }
  if (updates.length > 0) {
    const { error } = await supabase.from('guardian_server_channels')
      .upsert(updates, { onConflict: 'guild_id,channel_id' })
    if (error) throw error
  }
  return changes.length
}

export async function syncGuardianRoleMetadata(
  guildId: string,
  incoming: GuardianRoleMetadata[],
): Promise<number> {
  if (incoming.length === 0) return 0
  const existing: GuardianRoleMetadata[] = await loadMetadata(offset => supabase
    .from('guardian_server_roles')
    .select('guild_id, guild_name, role_id, role_name, role_color, role_position, synced_at')
    .eq('guild_id', guildId)
    .order('role_id')
    .range(offset, offset + 999))
  const changes = changedRows(incoming, existing, 'role_id', [
    'guild_name', 'role_name', 'role_color', 'role_position',
  ])
  if (changes.length === 0) return 0
  const { error } = await supabase.from('guardian_server_roles')
    .upsert(changes, { onConflict: 'guild_id,role_id' })
  if (error) throw error
  return changes.length
}
