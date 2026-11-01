/** Relative luminance per WCAG 2.x, from an 8-bit sRGB channel triple. */
function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Parses `#rgb` or `#rrggbb`. Returns null for anything else. */
export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const value = hex.trim().replace(/^#/, '')
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

/** WCAG contrast ratio between two hex colours, or null if either is unparseable. */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseHexColor(foreground)
  const bg = parseHexColor(background)
  if (!fg || !bg) return null
  const lf = relativeLuminance(fg.r, fg.g, fg.b)
  const lb = relativeLuminance(bg.r, bg.g, bg.b)
  const lighter = Math.max(lf, lb)
  const darker = Math.min(lf, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

const DARK_TEXT = '#111827'
const LIGHT_TEXT = '#ffffff'

/**
 * Picks the readable text colour for an arbitrary user-chosen background.
 *
 * Needed because category colours are picked by users, so contrast cannot be
 * guaranteed by a token. Falls back to dark text on an unparseable value.
 */
export function readableForegroundFor(background: string): string {
  const withDark = contrastRatio(DARK_TEXT, background)
  const withLight = contrastRatio(LIGHT_TEXT, background)
  if (withDark === null || withLight === null) return DARK_TEXT
  return withDark >= withLight ? DARK_TEXT : LIGHT_TEXT
}
