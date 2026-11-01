import { describe, expect, it } from 'vitest'
import { isNavQuickToolVisible } from '../nav-quick-tool-visibility'

describe('nav quick-tool visibility', () => {
  it.each(['admin-oversight', 'admin-users'])('hides %s without admin block power', (key) => {
    expect(isNavQuickToolVisible(key, false)).toBe(false)
    expect(isNavQuickToolVisible(key, true)).toBe(true)
  })

  it('keeps Guardian visible like its existing menu entry and preserves hidden saved preferences', () => {
    const saved = ['guardian', 'admin-users', 'calendars', 'admin-oversight']
    expect(saved.filter(key => isNavQuickToolVisible(key, false))).toEqual(['guardian', 'calendars'])
    expect(saved.filter(key => isNavQuickToolVisible(key, true))).toEqual(saved)
    expect(saved).toEqual(['guardian', 'admin-users', 'calendars', 'admin-oversight'])
  })
})
