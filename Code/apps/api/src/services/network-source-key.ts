import { createHash } from 'crypto'

/** Public identity without disclosing the private calendar_sources id. */
export function getNetworkSourceKey(sourceType: string, sourceId: string | null | undefined): string | undefined {
  if (!sourceId) return undefined
  const type = sourceType === 'coordination_calendar' ? 'coordination_calendar'
    : sourceType === 'google_oauth' || sourceType === 'google_public_url' ? 'calendar_source'
    : null
  return type ? `source_${createHash('sha256').update(`${type}:${sourceId}`).digest('hex')}` : undefined
}
