// Cache that paints pages like Time Management and Mailbox instantly with the last known
// data -- both on client-side route navigation AND on a full page reload/refresh -- while a
// background refresh reconciles any server-side changes. Backed by sessionStorage (survives
// reload, cleared when the tab/window closes) with an in-memory Map layered on top so repeat
// reads within the same page life skip JSON parsing.
type CacheEntry = { value: unknown; updatedAt: number }

const STORAGE_PREFIX = 'session-data-cache:'
const memoryCache = new Map<string, CacheEntry>()

function readFromStorage(key: string): CacheEntry | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<CacheEntry>
    if (typeof parsed?.updatedAt !== 'number') return undefined
    return { value: parsed.value, updatedAt: parsed.updatedAt }
  } catch {
    return undefined
  }
}

function writeToStorage(key: string, entry: CacheEntry): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry))
  } catch {
    // Best-effort only -- quota exceeded or storage disabled (e.g. private browsing) must not break the page.
  }
}

function readEntry(key: string): CacheEntry | undefined {
  const cached = memoryCache.get(key)
  if (cached) return cached
  const stored = readFromStorage(key)
  if (stored) memoryCache.set(key, stored)
  return stored
}

export function getSessionCacheValue<T>(key: string): T | undefined {
  return readEntry(key)?.value as T | undefined
}

export function setSessionCacheValue<T>(key: string, value: T): void {
  const entry: CacheEntry = { value, updatedAt: Date.now() }
  memoryCache.set(key, entry)
  writeToStorage(key, entry)
}

export function isSessionCacheFresh(key: string, maxAgeMs: number): boolean {
  const entry = readEntry(key)
  return Boolean(entry && Date.now() - entry.updatedAt <= maxAgeMs)
}

export function clearSessionCacheValue(key: string): void {
  memoryCache.delete(key)
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + key)
  } catch {
    // Best-effort only.
  }
}

