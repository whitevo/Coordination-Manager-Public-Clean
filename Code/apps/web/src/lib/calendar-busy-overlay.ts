export const CALENDAR_BUSY_BLOCK_COUNT = 14

export function getCalendarBusyColors(isDark: boolean, activeThemeId: string | null): readonly [string, string] {
  if (isDark && activeThemeId === 'preset-forest') {
    return ['hsl(169 32% 57%)', 'hsl(215 15% 35%)']
  }

  return isDark
    ? [
        'color-mix(in srgb, hsl(var(--primary)) 55%, hsl(var(--muted-foreground)))',
        'color-mix(in srgb, hsl(var(--background)) 60%, hsl(var(--muted-foreground)))',
      ]
    : [
        'color-mix(in srgb, hsl(var(--primary)) 55%, hsl(var(--background)))',
        'color-mix(in srgb, hsl(var(--foreground)) 60%, hsl(var(--muted-foreground)))',
      ]
}
