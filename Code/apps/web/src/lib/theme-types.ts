// ─── Color Theme Types & Presets ──────────────────────────────────────
// Comprehensive theme system similar to Discord's approach:
// - Background, edges/borders, accents, icons are all customisable
// - Preset themes that combine 2-3 color elements
// - Custom themes saved per user

export interface ThemeColors {
  /** Page/card background */
  background: string
  /** Main text color */
  foreground: string
  /** Primary action color (buttons, links) */
  primary: string
  /** Text on primary-colored backgrounds */
  primaryForeground: string
  /** Secondary surfaces */
  secondary: string
  /** Text on secondary surfaces */
  secondaryForeground: string
  /** Accent highlights */
  accent: string
  /** Text on accent-colored surfaces */
  accentForeground: string
  /** Subdued surfaces (e.g. badges, subtle backgrounds) */
  muted: string
  /** Text on muted surfaces */
  mutedForeground: string
  /** Borders, dividers, input outlines */
  border: string
  /** Focus ring color */
  ring: string
  /** Icon color override (for visibility on dark/light backgrounds) */
  icon: string
}

export interface ColorTheme {
  id: string
  name: string
  colors: ThemeColors
  /** Whether this is a built-in preset or user-created */
  isPreset: boolean
  /** Preview gradient for the theme card */
  preview?: [string, string, string]
  createdAt?: string
}

/** Notification preferences embedded inside theme_preferences JSONB */
export interface NotificationPreferences {
  emailNotifications: boolean
  discordNotifications: boolean
  reminderTimes: string[]
  eventCreated: boolean
  eventUpdated: boolean
  eventCancelled: boolean
}

/** Calendar default parameters embedded inside theme_preferences JSONB */
export interface CalendarPreferences {
  defaultView: 'week' | 'day' | 'month'
  defaultTimeInterval: 15 | 30 | 60
  startHour: number
  endHour: number
  weekStartsOn: 0 | 1
  showWeekNumbers: boolean
  dateFormat?: 'dd.mm.yyyy' | 'mm/dd/yyyy' | 'yyyy-mm-dd'
}

/** AI model preference (user-selectable) */
export type AiModelId = 'openai' | 'asi1-mini'

export interface AiModelOption {
  id: AiModelId
  label: string
  provider: string
  costPerPrompt: string
  description: string
}

/** AI settings embedded inside theme_preferences JSONB */
export interface AiSettings {
  preferredModel: AiModelId
  /** Oversight/admin users can enable the sentiment analysis tool on AI chat */
  sentimentToolEnabled?: boolean
  /** Per-data-source permissions for the Time Management assistant. Defaults off. */
  timeManagementAiAccess?: Record<string, boolean>
}

export const AI_MODEL_OPTIONS: AiModelOption[] = [
  {
    id: 'openai',
    label: 'GPT-4o',
    provider: 'OpenAI',
    costPerPrompt: '$0.02',
    description: 'High-quality general purpose model. Default option.',
  },
  {
    id: 'asi1-mini',
    label: 'ASI1-mini',
    provider: 'ASI Alliance',
    costPerPrompt: '$0.01',
    description: 'Web3-native LLM designed for agentic AI. Lower cost.',
  },
]

// ─── AI Assistant Roles ─────────────────────────────────────────────────────────
export type AiRoleId = 'guider' | 'composer' | 'operator'

export interface AiRoleOption {
  id: AiRoleId
  label: string
  tag: string
  description: string
  color: string
}

export const AI_ROLE_OPTIONS: AiRoleOption[] = [
  {
    id: 'guider',
    label: 'Guider',
    tag: 'guider',
    description: 'General-purpose guide that helps you learn the platform, explains features, answers questions about coordination philosophy, and assists with onboarding.',
    color: 'purple',
  },
  {
    id: 'composer',
    label: 'Composer',
    tag: 'composer',
    description: 'Specialized assistant for drafting and refining announcements, configuring distribution targets, creating polls, and managing message tone and content.',
    color: 'sky',
  },
  {
    id: 'operator',
    label: 'Operator',
    tag: 'operator',
    description: 'Operational assistant for calendar configuration -- sets availability, adjusts time ranges, manages scheduling parameters, and interprets natural-language calendar commands.',
    color: 'emerald',
  },
]

/** Resolve the active AI role based on the current page context name. */
export function resolveAiRole(pageContextName: string | null): AiRoleId {
  if (pageContextName?.includes('Announcement')) return 'composer'
  if (
    pageContextName?.includes('Calendar') ||
    pageContextName?.includes('Availability') ||
    pageContextName?.includes('Time Management')
  ) {
    return 'operator'
  }
  return 'guider'
}

/** Stored in the DB as theme_preferences JSONB */
export interface ThemePreferences {
  /**
   * Light or dark appearance. 'system' is deprecated: the option was removed
   * from Settings, and ThemeContext migrates a stored 'system' once to the OS
   * preference at load time. It stays in the type because older localStorage
   * and account JSONB can still contain it.
   */
  mode: 'light' | 'dark' | 'system'
  /** Color-theme overlay applied when dark mode is active */
  darkThemeId: string | null
  /** Color-theme overlay applied when light mode is active */
  lightThemeId: string | null
  customThemes: ColorTheme[]
  /** Notification preferences stored alongside theme data */
  notificationSettings?: NotificationPreferences
  /** Calendar default parameters stored alongside theme data */
  calendarSettings?: CalendarPreferences
  /** AI model and behaviour preferences */
  aiSettings?: AiSettings
  /**
   * Whether the Theme (palette) button is pinned to the nav menu bar.
   * Missing means true, so new users and older saved preferences see it.
   */
  showNavThemeToggle?: boolean
}

// --- Defaults for new users ------------------------------------------------

/** Color overlay applied in dark mode for users without a saved preference ("Dark Forest"). */
export const DEFAULT_DARK_THEME_ID = 'preset-forest'

/** localStorage key holding the resolved overlay so index.html can paint it before React mounts. */
export const ACTIVE_THEME_CACHE_KEY = 'theme-active-colors'

/** Preferences for a visitor or account that has never saved a theme choice. */
export function createDefaultThemePreferences(): ThemePreferences {
  return {
    mode: 'dark',
    darkThemeId: DEFAULT_DARK_THEME_ID,
    lightThemeId: null,
    customThemes: [],
  }
}

// ─── CSS Variable names mapped to ThemeColors keys ────────────────────

export const COLOR_VAR_MAP: Record<keyof ThemeColors, string> = {
  background: '--background',
  foreground: '--foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  border: '--border',
  ring: '--ring',
  icon: '--icon',
}

// Friendly labels for each color role
export const COLOR_LABELS: Record<keyof ThemeColors, string> = {
  background: 'Background',
  foreground: 'Text',
  primary: 'Primary',
  primaryForeground: 'Primary Text',
  secondary: 'Secondary',
  secondaryForeground: 'Secondary Text',
  accent: 'Accent',
  accentForeground: 'Accent Text',
  muted: 'Muted',
  mutedForeground: 'Muted Text',
  border: 'Borders',
  ring: 'Focus Ring',
  icon: 'Icons',
}

// Groups for the UI (Discord-style sections)
export const COLOR_GROUPS = [
  {
    label: 'Backgrounds',
    description: 'Surface and card colors',
    keys: ['background', 'secondary', 'muted'] as (keyof ThemeColors)[],
  },
  {
    label: 'Text & Icons',
    description: 'Content and icon colors',
    keys: ['foreground', 'mutedForeground', 'icon'] as (keyof ThemeColors)[],
  },
  {
    label: 'Accents',
    description: 'Primary actions, highlights, focus rings',
    keys: ['primary', 'accent', 'ring'] as (keyof ThemeColors)[],
  },
  {
    label: 'Accent Text',
    description: 'Text on colored surfaces',
    keys: ['primaryForeground', 'secondaryForeground', 'accentForeground'] as (keyof ThemeColors)[],
  },
  {
    label: 'Edges',
    description: 'Borders and dividers',
    keys: ['border'] as (keyof ThemeColors)[],
  },
]

// ─── Default light/dark base values (match index.css) ─────────────────

export const DEFAULT_LIGHT: ThemeColors = {
  background: '0 0% 100%',
  foreground: '222.2 47.4% 11.2%',
  primary: '222 47% 11%',
  primaryForeground: '0 0% 98%',
  secondary: '210 40% 96.1%',
  secondaryForeground: '222.2 47.4% 11.2%',
  accent: '210 40% 96.1%',
  accentForeground: '222.2 47.4% 11.2%',
  muted: '210 40% 96.1%',
  mutedForeground: '215.4 16.3% 46.9%',
  border: '214.3 31.8% 91.4%',
  ring: '215 20.2% 65.1%',
  icon: '222.2 47.4% 11.2%',
}

export const DEFAULT_DARK: ThemeColors = {
  background: '222.2 47.4% 10%',
  foreground: '0 0% 98%',
  primary: '0 0% 98%',
  primaryForeground: '222 47% 11%',
  secondary: '217.2 32.6% 18.5%',
  secondaryForeground: '0 0% 98%',
  accent: '217.2 32.6% 22.5%',
  accentForeground: '0 0% 98%',
  muted: '217.2 32.6% 14.5%',
  mutedForeground: '215 20.2% 65.1%',
  border: '217.2 32.6% 22.5%',
  ring: '215 20.2% 65.1%',
  icon: '0 0% 98%',
}

// ─── Preset Themes ────────────────────────────────────────────────────
// Each preset defines overrides for DARK mode; light mode colors auto-adapt

export const PRESET_THEMES: ColorTheme[] = [
  {
    id: 'preset-ocean',
    name: 'Ocean',
    isPreset: true,
    preview: ['210 80% 50%', '190 70% 50%', '220 60% 15%'],
    colors: {
      background: '220 60% 8%',
      foreground: '200 20% 95%',
      primary: '210 80% 50%',
      primaryForeground: '0 0% 100%',
      secondary: '215 50% 15%',
      secondaryForeground: '200 20% 90%',
      accent: '190 70% 50%',
      accentForeground: '0 0% 100%',
      muted: '215 40% 18%',
      mutedForeground: '210 20% 60%',
      border: '215 40% 22%',
      ring: '210 60% 55%',
      icon: '200 20% 90%',
    },
  },
  {
    id: 'preset-forest',
    name: 'Forest',
    isPreset: true,
    preview: ['150 60% 40%', '130 50% 45%', '160 40% 10%'],
    colors: {
      background: '160 40% 7%',
      foreground: '140 15% 93%',
      primary: '150 60% 40%',
      primaryForeground: '0 0% 100%',
      secondary: '155 35% 14%',
      secondaryForeground: '140 15% 90%',
      accent: '130 50% 45%',
      accentForeground: '0 0% 100%',
      muted: '155 30% 16%',
      mutedForeground: '150 15% 55%',
      border: '155 30% 20%',
      ring: '150 40% 50%',
      icon: '140 15% 88%',
    },
  },
  {
    id: 'preset-sunset',
    name: 'Sunset',
    isPreset: true,
    preview: ['20 85% 55%', '35 80% 50%', '15 50% 10%'],
    colors: {
      background: '15 50% 7%',
      foreground: '30 20% 93%',
      primary: '20 85% 55%',
      primaryForeground: '0 0% 100%',
      secondary: '18 40% 14%',
      secondaryForeground: '30 20% 90%',
      accent: '35 80% 50%',
      accentForeground: '0 0% 10%',
      muted: '18 35% 16%',
      mutedForeground: '20 20% 55%',
      border: '18 35% 20%',
      ring: '20 65% 55%',
      icon: '30 20% 88%',
    },
  },
  {
    id: 'preset-lavender',
    name: 'Lavender',
    isPreset: true,
    preview: ['270 60% 60%', '290 50% 55%', '265 45% 12%'],
    colors: {
      background: '265 45% 8%',
      foreground: '270 15% 93%',
      primary: '270 60% 60%',
      primaryForeground: '0 0% 100%',
      secondary: '268 35% 15%',
      secondaryForeground: '270 15% 90%',
      accent: '290 50% 55%',
      accentForeground: '0 0% 100%',
      muted: '268 30% 17%',
      mutedForeground: '270 15% 55%',
      border: '268 30% 22%',
      ring: '270 40% 60%',
      icon: '270 15% 88%',
    },
  },
  {
    id: 'preset-rose',
    name: 'Rose',
    isPreset: true,
    preview: ['340 70% 55%', '350 60% 50%', '335 40% 10%'],
    colors: {
      background: '335 40% 7%',
      foreground: '340 15% 93%',
      primary: '340 70% 55%',
      primaryForeground: '0 0% 100%',
      secondary: '338 35% 14%',
      secondaryForeground: '340 15% 90%',
      accent: '350 60% 50%',
      accentForeground: '0 0% 100%',
      muted: '338 30% 16%',
      mutedForeground: '340 15% 55%',
      border: '338 30% 20%',
      ring: '340 50% 55%',
      icon: '340 15% 88%',
    },
  },
  {
    id: 'preset-teal',
    name: 'Teal',
    isPreset: true,
    preview: ['175 70% 40%', '185 60% 45%', '180 40% 10%'],
    colors: {
      background: '180 40% 6%',
      foreground: '175 15% 93%',
      primary: '175 70% 40%',
      primaryForeground: '0 0% 100%',
      secondary: '178 35% 13%',
      secondaryForeground: '175 15% 90%',
      accent: '185 60% 45%',
      accentForeground: '0 0% 100%',
      muted: '178 30% 15%',
      mutedForeground: '175 15% 55%',
      border: '178 30% 19%',
      ring: '175 50% 50%',
      icon: '175 15% 88%',
    },
  },
  {
    id: 'preset-amber',
    name: 'Amber',
    isPreset: true,
    preview: ['40 90% 50%', '30 80% 50%', '35 50% 10%'],
    colors: {
      background: '35 50% 6%',
      foreground: '40 15% 93%',
      primary: '40 90% 50%',
      primaryForeground: '0 0% 10%',
      secondary: '38 40% 13%',
      secondaryForeground: '40 15% 90%',
      accent: '30 80% 50%',
      accentForeground: '0 0% 10%',
      muted: '38 35% 15%',
      mutedForeground: '40 15% 55%',
      border: '38 35% 19%',
      ring: '40 70% 55%',
      icon: '40 15% 88%',
    },
  },
  {
    id: 'preset-indigo',
    name: 'Indigo',
    isPreset: true,
    preview: ['240 60% 55%', '220 55% 50%', '235 50% 12%'],
    colors: {
      background: '235 50% 8%',
      foreground: '230 15% 93%',
      primary: '240 60% 55%',
      primaryForeground: '0 0% 100%',
      secondary: '237 40% 15%',
      secondaryForeground: '230 15% 90%',
      accent: '220 55% 50%',
      accentForeground: '0 0% 100%',
      muted: '237 35% 17%',
      mutedForeground: '235 15% 55%',
      border: '237 35% 22%',
      ring: '240 40% 55%',
      icon: '230 15% 88%',
    },
  },
  {
    id: 'preset-coral',
    name: 'Coral',
    isPreset: true,
    preview: ['10 75% 55%', '0 65% 50%', '5 45% 10%'],
    colors: {
      background: '5 45% 7%',
      foreground: '10 15% 93%',
      primary: '10 75% 55%',
      primaryForeground: '0 0% 100%',
      secondary: '8 35% 14%',
      secondaryForeground: '10 15% 90%',
      accent: '0 65% 50%',
      accentForeground: '0 0% 100%',
      muted: '8 30% 16%',
      mutedForeground: '10 15% 55%',
      border: '8 30% 20%',
      ring: '10 55% 55%',
      icon: '10 15% 88%',
    },
  },
  {
    id: 'preset-mint',
    name: 'Mint',
    isPreset: true,
    preview: ['160 55% 45%', '170 50% 50%', '165 40% 10%'],
    colors: {
      background: '165 40% 6%',
      foreground: '160 15% 93%',
      primary: '160 55% 45%',
      primaryForeground: '0 0% 100%',
      secondary: '163 35% 13%',
      secondaryForeground: '160 15% 90%',
      accent: '170 50% 50%',
      accentForeground: '0 0% 100%',
      muted: '163 30% 15%',
      mutedForeground: '160 15% 55%',
      border: '163 30% 19%',
      ring: '160 35% 50%',
      icon: '160 15% 88%',
    },
  },
  {
    id: 'preset-plum',
    name: 'Plum',
    isPreset: true,
    preview: ['300 50% 45%', '280 45% 50%', '295 40% 10%'],
    colors: {
      background: '295 40% 7%',
      foreground: '300 10% 93%',
      primary: '300 50% 45%',
      primaryForeground: '0 0% 100%',
      secondary: '297 30% 14%',
      secondaryForeground: '300 10% 90%',
      accent: '280 45% 50%',
      accentForeground: '0 0% 100%',
      muted: '297 25% 16%',
      mutedForeground: '300 10% 55%',
      border: '297 25% 20%',
      ring: '300 35% 50%',
      icon: '300 10% 88%',
    },
  },
  {
    id: 'preset-sky',
    name: 'Sky',
    isPreset: true,
    preview: ['200 75% 50%', '210 65% 55%', '205 50% 12%'],
    colors: {
      background: '205 50% 8%',
      foreground: '200 15% 93%',
      primary: '200 75% 50%',
      primaryForeground: '0 0% 100%',
      secondary: '203 40% 15%',
      secondaryForeground: '200 15% 90%',
      accent: '210 65% 55%',
      accentForeground: '0 0% 100%',
      muted: '203 35% 17%',
      mutedForeground: '200 15% 55%',
      border: '203 35% 22%',
      ring: '200 55% 55%',
      icon: '200 15% 88%',
    },
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────

/** Convert HSL string "H S% L%" to hex color for <input type="color"> */
export function hslToHex(hsl: string): string {
  const parts = hsl.trim().split(/\s+/)
  if (parts.length < 3) return '#888888'
  const h = parseFloat(parts[0])
  const s = parseFloat(parts[1]) / 100
  const l = parseFloat(parts[2]) / 100

  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** Convert hex "#RRGGBB" to HSL string "H S% L%" */
export function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return '0 0% 50%'

  const r = parseInt(result[1], 16) / 255
  const g = parseInt(result[2], 16) / 255
  const b = parseInt(result[3], 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/** Generate a new unique ID for custom themes */
export function generateThemeId(): string {
  return `custom-${crypto.randomUUID()}`
}
