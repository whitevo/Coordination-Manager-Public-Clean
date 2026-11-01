interface DiffuseTimeBackgroundFillOptions {
  fadeStart?: boolean
  fadeEnd?: boolean
}

function clampOpacity(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 1
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

function hexToRgba(hex: string, alpha: number): string {
  if (!isHexColor(hex)) {
    return `rgba(14, 165, 233, ${clampOpacity(alpha)})`
  }

  const clean = hex.slice(1)
  const red = Number.parseInt(clean.slice(0, 2), 16)
  const green = Number.parseInt(clean.slice(2, 4), 16)
  const blue = Number.parseInt(clean.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${clampOpacity(alpha)})`
}

export function buildDiffuseTimeBackgroundFill(
  color: string,
  opacity: number,
  options: DiffuseTimeBackgroundFillOptions = {},
): string {
  const coreOpacity = clampOpacity(opacity)
  const edgeOpacity = coreOpacity * 0.45
  const startOpacity = options.fadeStart === false ? coreOpacity : edgeOpacity
  const endOpacity = options.fadeEnd === false ? coreOpacity : edgeOpacity

  return `linear-gradient(180deg, ${hexToRgba(color, startOpacity)} 0%, ${hexToRgba(color, coreOpacity)} 20%, ${hexToRgba(color, coreOpacity)} 80%, ${hexToRgba(color, endOpacity)} 100%)`
}

const PRIMARY_TIMEZONE_PRESERVE_RE = /\b(keep|preserve|leave)\b.{0,28}\b(primary|default|main)\b.{0,28}\b(timezone|time zone|utc)\b/i
const PRIMARY_TIMEZONE_CHANGE_RE = /\b(primary|default|main)\s+(timezone|time zone)\b|\b(timezone|time zone)\s+(primary|default|main)\b|\b(set|switch|change|make|replace)\b.{0,36}\b(primary|default|main)\b.{0,36}\b(timezone|time zone)\b/i

export function isExplicitPrimaryTimezoneChangeRequest(message: string): boolean {
  if (!message.trim()) return false
  if (PRIMARY_TIMEZONE_PRESERVE_RE.test(message)) return false
  return PRIMARY_TIMEZONE_CHANGE_RE.test(message)
}

function inferIanaFromFreeText(text: string): string | null {
  if (!text.trim()) return null
  if (/\beston/i.test(text)) return 'Europe/Tallinn'

  const ianaMatch = text.match(/\b([A-Za-z_]+\/[A-Za-z_]+)\b/)
  if (ianaMatch?.[1]) {
    return ianaMatch[1]
  }

  const lower = text.toLowerCase()
  if (lower.includes('utc')) return 'UTC'
  return null
}

export function inferRequestedTimezoneForAiResponse(
  userMessage: string,
  explanation?: string,
  summary?: string,
): string | null {
  const fromUser = inferIanaFromFreeText(userMessage)
  if (fromUser && fromUser !== 'UTC') return fromUser

  const fromExplanation = inferIanaFromFreeText(explanation || '')
  if (fromExplanation && fromExplanation !== 'UTC') return fromExplanation

  const fromSummary = inferIanaFromFreeText(summary || '')
  if (fromSummary && fromSummary !== 'UTC') return fromSummary

  return null
}

export interface AiAccessibleTimeItem {
  id: string
  title: string
  time: {
    startUtc: string
    endUtc: string
  }
}

export interface AiTimeItemDurationResult {
  title: string
  occurrenceCount: number
  totalMinutes: number
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function findTimeItemDurationByTitle(
  message: string,
  items: AiAccessibleTimeItem[],
): AiTimeItemDurationResult | null {
  const normalizedMessage = normalizeSearchText(message)
  const matchingItems = items.filter((item) => {
    const normalizedTitle = normalizeSearchText(item.title)
    return normalizedTitle.length > 0 && normalizedMessage.includes(normalizedTitle)
  })

  if (matchingItems.length === 0) return null

  const uniqueOccurrences = new Map<string, AiAccessibleTimeItem>()
  for (const item of matchingItems) {
    const occurrenceKey = `${item.id}:${item.time.startUtc}`
    if (!uniqueOccurrences.has(occurrenceKey)) uniqueOccurrences.set(occurrenceKey, item)
  }

  const totalMinutes = Array.from(uniqueOccurrences.values()).reduce((total, item) => {
    const durationMinutes = (Date.parse(item.time.endUtc) - Date.parse(item.time.startUtc)) / 60000
    return Number.isFinite(durationMinutes) && durationMinutes > 0 ? total + durationMinutes : total
  }, 0)

  const title = matchingItems[0].title
  return {
    title,
    occurrenceCount: uniqueOccurrences.size,
    totalMinutes,
  }
}
