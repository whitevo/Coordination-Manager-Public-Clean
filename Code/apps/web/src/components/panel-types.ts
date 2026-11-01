export const PANEL_IDS = ['ai', 'feedback', 'chat', 'support', 'commons'] as const

export type ActivePanelId = (typeof PANEL_IDS)[number]

export type PanelId = ActivePanelId | null

export function isPanelId(value: unknown): value is ActivePanelId {
  return typeof value === 'string' && (PANEL_IDS as readonly string[]).includes(value)
}
