const PUBLIC_EVENTS_SYNC_EVENT = 'cm:public-events-sync'
const PUBLIC_EVENTS_SYNC_STORAGE_KEY = 'cm-public-events-sync'

export function notifyPublicEventsSync(reason: string): void {
  if (typeof window === 'undefined') return

  const payload = {
    reason,
    updatedAt: Date.now(),
  }

  window.dispatchEvent(new CustomEvent(PUBLIC_EVENTS_SYNC_EVENT, { detail: payload }))

  try {
    localStorage.setItem(PUBLIC_EVENTS_SYNC_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore private mode and quota failures.
  }
}

export function subscribePublicEventsSync(onSync: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  let debounceTimer: number | null = null

  const schedule = () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer)
    }
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null
      onSync()
    }, 120)
  }

  const handleSyncEvent = () => {
    schedule()
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== PUBLIC_EVENTS_SYNC_STORAGE_KEY || !event.newValue) return
    schedule()
  }

  window.addEventListener(PUBLIC_EVENTS_SYNC_EVENT, handleSyncEvent)
  window.addEventListener('storage', handleStorage)

  return () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer)
      debounceTimer = null
    }
    window.removeEventListener(PUBLIC_EVENTS_SYNC_EVENT, handleSyncEvent)
    window.removeEventListener('storage', handleStorage)
  }
}