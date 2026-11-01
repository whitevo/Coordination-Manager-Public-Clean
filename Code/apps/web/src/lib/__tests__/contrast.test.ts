import { describe, expect, it } from 'vitest'
import { contrastRatio, parseHexColor, readableForegroundFor } from '../contrast'

describe('parseHexColor', () => {
  it('accepts shorthand and full hex', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHexColor('3b82f6')).toEqual({ r: 59, g: 130, b: 246 })
  })

  it('rejects anything else', () => {
    expect(parseHexColor('rgb(0,0,0)')).toBeNull()
    expect(parseHexColor('#12345')).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('returns the full range for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })

  it('returns 1 for identical colours', () => {
    expect(contrastRatio('#3b82f6', '#3b82f6')).toBeCloseTo(1, 5)
  })
})

describe('readableForegroundFor', () => {
  it('picks dark text on light category colours', () => {
    expect(readableForegroundFor('#fde68a')).toBe('#111827')
  })

  it('picks light text on dark category colours', () => {
    expect(readableForegroundFor('#1e3a8a')).toBe('#ffffff')
  })

  it('always clears AA for normal text on either choice', () => {
    const samples = ['#fde68a', '#1e3a8a', '#10b981', '#ec4899', '#64748b', '#ffffff', '#000000']
    for (const background of samples) {
      const ratio = contrastRatio(readableForegroundFor(background), background)
      expect(ratio, `contrast on ${background}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('falls back to dark text on an unparseable value', () => {
    expect(readableForegroundFor('not-a-colour')).toBe('#111827')
  })
})
