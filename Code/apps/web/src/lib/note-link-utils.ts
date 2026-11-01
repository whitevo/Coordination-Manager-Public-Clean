import { isSafeUrl } from './calendar-utils'

export function isSafeNoteLinkTarget(value: string): boolean {
  const trimmed = value.trim()
  if (/\\|%5c/i.test(trimmed) || [...trimmed].some(character => {
    const code = character.charCodeAt(0)
    return code <= 32 || code === 127
  })) return false
  const isAbsolute = isSafeUrl(trimmed)
  if (!isAbsolute && !/^\/(?!\/)/.test(trimmed)) return false
  try {
    const base = 'https://note-link.invalid'
    const url = new URL(trimmed, base)
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      (isAbsolute || url.origin === base)
  } catch {
    return false
  }
}
