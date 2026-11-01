/**
 * Explicit token lookups for the design system's semantic layer.
 *
 * Every mapping here is a literal class string. Tailwind class names are never
 * built by interpolating a runtime value (`bg-${tone}-subtle`), because such
 * classes are invisible to the JIT scanner and get purged from the bundle.
 */

/** The hue-locked outcome roles. `primary` is excluded: it is theme-owned. */
export type SemanticRole = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

/** Emphasis of an interactive surface. */
export type Emphasis = 'solid' | 'outline' | 'ghost'

/**
 * What an interactive surface means. `primary` follows the active theme.
 *
 * `success`, `info` and `warning` are status-bearing intents: use them only
 * when the action itself carries that status (save-state feedback after a save
 * succeeded, a "link exists" tile, an action inside a warning banner). They are
 * never decoration, and an intended outcome is not a result: Save is `primary`
 * before it runs.
 */
export type Intent = 'primary' | 'neutral' | 'danger' | 'success' | 'info' | 'warning'

/** Normalized status vocabulary used by StatusBadge and friends. */
export type StatusTone =
  | 'neutral'
  | 'info'
  | 'pending'
  | 'active'
  | 'success'
  | 'warning'
  | 'error'

/**
 * Status tone -> visual role. `active` maps to the theme primary because
 * "currently happening" is an interaction state, not an outcome.
 */
export const STATUS_TONE_ROLE: Record<StatusTone, SemanticRole | 'primary'> = {
  neutral: 'neutral',
  info: 'info',
  pending: 'warning',
  active: 'primary',
  success: 'success',
  warning: 'warning',
  error: 'danger',
}

/** Soft chip surface per tone: tinted background, matching text, matching border. */
export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-neutral-subtle text-neutral border-neutral-muted',
  info: 'bg-info-subtle text-info border-info-muted',
  pending: 'bg-warning-subtle text-warning border-warning-muted',
  active: 'bg-primary-subtle text-primary border-primary-muted',
  success: 'bg-success-subtle text-success border-success-muted',
  warning: 'bg-warning-subtle text-warning border-warning-muted',
  error: 'bg-danger-subtle text-danger border-danger-muted',
}

/** Solid surface per tone, for toasts and other high-emphasis feedback. */
export const STATUS_TONE_SOLID_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-neutral text-neutral-foreground',
  info: 'bg-info text-info-foreground',
  pending: 'bg-warning text-warning-foreground',
  active: 'bg-primary text-primary-foreground',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  error: 'bg-danger text-danger-foreground',
}

/** Interactive surface classes, keyed by emphasis then intent. */
export const BUTTON_INTENT_CLASS: Record<Emphasis, Record<Intent, string>> = {
  solid: {
    primary: 'bg-primary text-primary-foreground hover:opacity-90 active:opacity-80',
    neutral: 'bg-muted text-muted-foreground hover:bg-muted/80 active:bg-muted/70',
    danger: 'bg-danger text-danger-foreground hover:opacity-90 active:opacity-80',
    success: 'bg-success text-success-foreground hover:opacity-90 active:opacity-80',
    info: 'bg-info text-info-foreground hover:opacity-90 active:opacity-80',
    warning: 'bg-warning text-warning-foreground hover:opacity-90 active:opacity-80',
  },
  outline: {
    primary: 'border border-primary-muted bg-primary-subtle text-primary hover:bg-primary-muted',
    neutral: 'border border-border bg-background text-foreground hover:bg-muted',
    danger: 'border border-danger-muted bg-danger-subtle text-danger hover:bg-danger-muted',
    success: 'border border-success-muted bg-success-subtle text-success hover:bg-success-muted',
    info: 'border border-info-muted bg-info-subtle text-info hover:bg-info-muted',
    warning: 'border border-warning-muted bg-warning-subtle text-warning hover:bg-warning-muted',
  },
  ghost: {
    primary: 'text-primary hover:bg-primary-subtle',
    neutral: 'text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'text-danger hover:bg-danger-subtle',
    success: 'text-success hover:bg-success-subtle',
    info: 'text-info hover:bg-info-subtle',
    warning: 'text-warning hover:bg-warning-subtle',
  },
}

/**
 * Pressed-state surface for ToggleButton, keyed by intent. `primary` is the
 * default and matches the original pressed recipe.
 */
export const TOGGLE_PRESSED_CLASS: Record<Intent, string> = {
  primary: 'border-primary-muted bg-primary-subtle text-primary',
  neutral: 'border-neutral-muted bg-neutral-subtle text-foreground',
  danger: 'border-danger-muted bg-danger-subtle text-danger',
  success: 'border-success-muted bg-success-subtle text-success',
  info: 'border-info-muted bg-info-subtle text-info',
  warning: 'border-warning-muted bg-warning-subtle text-warning',
}

/** Control sizes shared by Button, ToggleButton and SegmentedControl. */
export type ControlSize = 'micro' | 'compact' | 'standard'

/**
 * Text-control geometry per size. `micro` is for dense rows, grid header
 * controls and in-input clear buttons only. `h-6` is 1.5rem, which stays at
 * or above the 24px minimum target size at any root font of 16px or more;
 * `min-w-6` keeps a short label from shrinking the target below that.
 */
export const CONTROL_SIZE_CLASS: Record<ControlSize, string> = {
  micro: 'h-6 min-w-6 gap-1 px-1.5 text-xs',
  compact: 'h-8 gap-1.5 px-2.5 text-xs',
  standard: 'h-10 gap-2 px-3 text-sm',
}

/** Feature identity accents. Semantic meaning always overrides these. */
export type FeatureAccent = 'ai' | 'chat' | 'support' | 'feedback' | 'commons'

export const FEATURE_ACCENT_TEXT: Record<FeatureAccent, string> = {
  ai: 'text-feature-ai',
  chat: 'text-feature-chat',
  support: 'text-feature-support',
  feedback: 'text-feature-feedback',
  commons: 'text-feature-commons',
}

export const FEATURE_ACCENT_BORDER: Record<FeatureAccent, string> = {
  ai: 'border-feature-ai',
  chat: 'border-feature-chat',
  support: 'border-feature-support',
  feedback: 'border-feature-feedback',
  commons: 'border-feature-commons',
}
