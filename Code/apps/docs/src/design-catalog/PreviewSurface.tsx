import type { CSSProperties, ReactNode } from 'react'
import type { ThemeColors } from '../../../web/src/lib/theme-types'

interface PreviewSurfaceProps {
  /** Render in the dark token surface when true, else light. */
  dark: boolean
  /** Optional web-app theme overlay. */
  colors?: ThemeColors
  /** Show the checkerboard frame behind the content. */
  checkered?: boolean
  children: ReactNode
}

/**
 * Wraps catalog content in the web-app HSL token surface so real recipes
 * (bg-primary, bg-card, border-border, ...) resolve. The `.cm-dark` modifier
 * flips light/dark independent of the (dark) docs theme.
 */
function getThemeStyle(colors?: ThemeColors): CSSProperties | undefined {
  if (!colors) return undefined

  return {
    '--background': colors.background,
    '--foreground': colors.foreground,
    '--primary': colors.primary,
    '--primary-foreground': colors.primaryForeground,
    '--secondary': colors.secondary,
    '--secondary-foreground': colors.secondaryForeground,
    '--accent': colors.accent,
    '--accent-foreground': colors.accentForeground,
    '--muted': colors.muted,
    '--muted-foreground': colors.mutedForeground,
    '--border': colors.border,
    '--ring': colors.ring,
    '--icon': colors.icon,
  } as CSSProperties
}

export function PreviewSurface({ dark, colors, checkered = true, children }: PreviewSurfaceProps) {
  return (
    <div
      className={`cm-preview ${dark ? 'cm-dark' : ''} ${checkered ? 'cm-preview-frame' : ''} flex min-h-[104px] items-center justify-center gap-3 rounded-lg border border-surface-700 p-4`}
      style={getThemeStyle(colors)}
    >
      {children}
    </div>
  )
}
