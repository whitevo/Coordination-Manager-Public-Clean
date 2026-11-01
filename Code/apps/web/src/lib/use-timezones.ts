import { useState, useCallback } from 'react'
import { MAX_TIMEZONES, findTimezone, detectLocalTimezone } from './timezone-data'
import type { TimezoneEntry } from './timezone-data'

export const STORAGE_KEY = 'coordination-timezones'

/** Remove timezone state from localStorage (call on logout) */
export function clearTimezoneStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

export interface TimezoneState {
  /** Primary timezone IANA identifier */
  primary: string
  /** Additional timezone IANA identifiers (up to 2) */
  additional: string[]
}

interface TimezoneOptions {
  initialState?: TimezoneState
  persist?: boolean
}

function loadState(): TimezoneState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as TimezoneState
      if (parsed.primary && Array.isArray(parsed.additional)) {
        return parsed
      }
    }
  } catch {
    // ignore
  }
  // No stored preference yet -- default to the browser's local IANA timezone
  // (detected via Intl.DateTimeFormat, no IP lookup or network request involved).
  return { primary: detectLocalTimezone(), additional: [] }
}

function saveState(state: TimezoneState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export interface UseTimezonesReturn {
  /** Primary timezone IANA identifier */
  primary: string
  /** Additional timezone IANA identifiers */
  additional: string[]
  /** All active timezones (primary + additional) */
  all: string[]
  /** Set the primary timezone */
  setPrimary: (iana: string) => void
  /** Add an additional timezone (max 2) */
  addTimezone: (iana: string) => void
  /** Remove an additional timezone by IANA id */
  removeTimezone: (iana: string) => void
  /** Replace a timezone at a specific slot (0 = primary, 1-2 = additional) */
  replaceTimezone: (slot: number, iana: string) => void
  /** Whether more timezones can be added */
  canAddMore: boolean
  /** Get TimezoneEntry for a given IANA id */
  getEntry: (iana: string) => TimezoneEntry | undefined
}

/**
 * Reusable hook for managing selected timezones.
 * Persists to localStorage. Can be used on any page.
 *
 * @param overridePrimary - If provided, overrides the primary timezone
 *   (e.g. when a calendar has a fixed timezone set by creator).
 *   User can still add additional display timezones.
 * @param options - Optional initial state and persistence policy for isolated
 *   views such as guest invites. Existing callers keep their saved preferences.
 */
export function useTimezones(overridePrimary?: string, options?: TimezoneOptions): UseTimezonesReturn {
  const [state, setState] = useState<TimezoneState>(() => {
    const loaded = options?.initialState ?? loadState()
    if (overridePrimary) {
      return { ...loaded, primary: overridePrimary }
    }
    return loaded
  })

  const primary = overridePrimary || state.primary
  const persist = options?.persist ?? true
  const persistState = useCallback((next: TimezoneState) => {
    if (persist) saveState(next)
  }, [persist])

  const setPrimary = useCallback((iana: string) => {
    setState((prev) => {
      // Remove from additional if it was there
      const additional = prev.additional.filter((a) => a !== iana)
      const next = { primary: iana, additional }
      persistState(next)
      return next
    })
  }, [persistState])

  const addTimezone = useCallback((iana: string) => {
    setState((prev) => {
      if (iana === prev.primary) return prev
      if (prev.additional.includes(iana)) return prev
      if (prev.additional.length >= MAX_TIMEZONES - 1) return prev
      const next = { ...prev, additional: [...prev.additional, iana] }
      persistState(next)
      return next
    })
  }, [persistState])

  const removeTimezone = useCallback((iana: string) => {
    setState((prev) => {
      const next = { ...prev, additional: prev.additional.filter((a) => a !== iana) }
      persistState(next)
      return next
    })
  }, [persistState])

  const replaceTimezone = useCallback((slot: number, iana: string) => {
    setState((prev) => {
      if (slot === 0) {
        const additional = prev.additional.filter((a) => a !== iana)
        const next = { primary: iana, additional }
        persistState(next)
        return next
      }
      const idx = slot - 1
      const additional = [...prev.additional]
      // Remove iana from other slots if present
      const existingIdx = additional.indexOf(iana)
      if (existingIdx !== -1) additional.splice(existingIdx, 1)
      additional[idx] = iana
      const next = { ...prev, additional: additional.filter(Boolean) }
      persistState(next)
      return next
    })
  }, [persistState])

  const getEntry = useCallback((iana: string) => findTimezone(iana), [])

  return {
    primary,
    additional: state.additional,
    all: [primary, ...state.additional],
    setPrimary,
    addTimezone,
    removeTimezone,
    replaceTimezone,
    canAddMore: state.additional.length < MAX_TIMEZONES - 1,
    getEntry,
  }
}
