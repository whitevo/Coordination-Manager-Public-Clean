export const QUICK_PIN_BUTTON_BASE_CLASS = 'flex h-6 w-6 items-center justify-center rounded border bg-linear-to-r shadow-xs transition-all duration-700 hover:scale-105'
export const QUICK_PIN_BUTTON_PINNED_CLASS = 'border-success-muted from-success-subtle via-success-subtle to-info-subtle text-success shadow-[0_0_0_1px_hsl(var(--success)/0.24),0_0_10px_hsl(var(--success)/0.16)] hover:shadow-[0_0_0_1px_hsl(var(--success)/0.32),0_0_14px_hsl(var(--success)/0.24)]'
export const QUICK_PIN_BUTTON_UNPINNED_CLASS = 'border-warning-muted from-warning-subtle via-warning-subtle to-warning-muted text-foreground shadow-[0_0_0_1px_hsl(var(--warning)/0.14)] hover:shadow-[0_0_9px_hsl(var(--warning)/0.18)]'
export const QUICK_PIN_BUTTON_STYLE = {
  backgroundSize: '220% 220%',
  animation: 'aiColorCycle 36s ease-in-out infinite',
} as const
