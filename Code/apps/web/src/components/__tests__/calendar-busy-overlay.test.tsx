import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CalendarBusyOverlay from '../calendar-busy-overlay'
import { CALENDAR_BUSY_BLOCK_COUNT, getCalendarBusyColors } from '../../lib/calendar-busy-overlay'
import { PRESET_THEMES } from '../../lib/theme-types'

const THEME_IDS = [null, ...PRESET_THEMES.map(theme => theme.id), 'custom-theme']

describe('CalendarBusyOverlay', () => {
  it.each(THEME_IDS.flatMap(activeThemeId => [true, false].map(isDark => ({ activeThemeId, isDark }))))(
    'renders 14 equal filled blocks for $activeThemeId (dark: $isDark)',
    ({ activeThemeId, isDark }) => {
      const colors = getCalendarBusyColors(isDark, activeThemeId)
      const { container } = render(<CalendarBusyOverlay colors={colors} />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('preserveAspectRatio', 'none')
      expect(svg).toHaveClass('pointer-events-none')
      expect(container.querySelectorAll('line')).toHaveLength(0)
      const blocks = container.querySelectorAll('polygon')
      expect(blocks).toHaveLength(14)
      let previousTopEnd = 8
      let previousBottomEnd = 0
      blocks.forEach((block, index) => {
        const points = (block.getAttribute('points') ?? '').split(' ').map(point => point.split(',').map(Number))
        expect(points).toHaveLength(4)
        expect(points[0]).toEqual([previousTopEnd, 0])
        expect(points[3]).toEqual([previousBottomEnd, 100])
        expect(points[1][0] - points[0][0]).toBeCloseTo(92 / CALENDAR_BUSY_BLOCK_COUNT)
        expect(points[2][0] - points[3][0]).toBeCloseTo(92 / CALENDAR_BUSY_BLOCK_COUNT)
        expect(points[0][0] - points[3][0]).toBeCloseTo(8)
        expect(points[1][0] - points[2][0]).toBeCloseTo(8)
        points.forEach(([x, y]) => {
          expect(x).toBeGreaterThanOrEqual(0)
          expect(x).toBeLessThanOrEqual(100)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(100)
        })
        expect(block).toHaveAttribute('fill', colors[index % 2])
        expect(block).toHaveAttribute('fill-opacity', '0.4')
        expect(block).not.toHaveAttribute('stroke')
        previousTopEnd = points[1][0]
        previousBottomEnd = points[2][0]
      })
      expect(previousTopEnd).toBe(100)
      expect(previousBottomEnd).toBe(92)
    }
  )

  it('preserves the approved dark Forest colors', () => {
    expect(getCalendarBusyColors(true, 'preset-forest')).toEqual(['hsl(169 32% 57%)', 'hsl(215 15% 35%)'])
  })

  it('adapts the neutral companion to light and dark surfaces', () => {
    expect(getCalendarBusyColors(true, 'custom-theme')[1]).toContain('var(--background)')
    expect(getCalendarBusyColors(false, 'custom-theme')[1]).toContain('var(--foreground)')
    expect(getCalendarBusyColors(false, 'preset-forest')[0]).toContain('var(--primary)')
    expect(getCalendarBusyColors(false, null)[0]).toContain('var(--background)')
  })

  it('updates fills without changing geometry when the theme changes', () => {
    const { container, rerender } = render(<CalendarBusyOverlay colors={getCalendarBusyColors(true, 'preset-forest')} />)
    const points = Array.from(container.querySelectorAll('polygon'), block => block.getAttribute('points'))
    rerender(<CalendarBusyOverlay colors={getCalendarBusyColors(false, 'preset-ocean')} />)
    expect(Array.from(container.querySelectorAll('polygon'), block => block.getAttribute('points'))).toEqual(points)
    expect(container.querySelector('polygon')).toHaveAttribute('fill', getCalendarBusyColors(false, 'preset-ocean')[0])
  })
})
