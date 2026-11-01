export type AddToCalendarDisplayMode = 'window' | 'panel'

export const ADD_TO_CALENDAR_MODE_STORAGE_KEY = 'mailbox:add-to-calendar-display-mode:v1'

export function readAddToCalendarDisplayMode(): AddToCalendarDisplayMode {
  if (typeof window === 'undefined') return 'window'
  try {
    return window.localStorage.getItem(ADD_TO_CALENDAR_MODE_STORAGE_KEY) === 'panel'
      ? 'panel'
      : 'window'
  } catch {
    return 'window'
  }
}

export function persistAddToCalendarDisplayMode(mode: AddToCalendarDisplayMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ADD_TO_CALENDAR_MODE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}