const SOURCE_ROUTES: Record<string, string> = {
  AddToCalendarShell: '/mailbox',
  AiChatPage: '/ai-chat',
  AiFeedbackPage: '/ai-feedback',
  AiGuideSidePanel: '/',
  AnnouncementsPage: '/distribute',
  CalendarPage: '/calendar',
  ChatSidePanel: '/',
  ConfirmDialog: '/coordinate-events',
  CoordinateEventsPage: '/coordinate-events',
  EventsCalendarPage: '/events-calendar',
  FeedbackSidePanel: '/',
  GuardianPage: '/guardian',
  HomePage: '/',
  Mailbox: '/mailbox',
  MailboxAutomationEditor: '/mailbox?tab=settings',
  MailboxAutomationPanel: '/mailbox?tab=settings',
  MailboxMassActionsPanel: '/mailbox',
  MailboxPage: '/mailbox',
  MailboxSortOrderEditor: '/mailbox?tab=settings',
  NetworkRelationsPage: '/admin/network-relations',
  PlatformOversightPage: '/admin/oversight',
  ResponsesTab: '/distribute?tab=responses',
  Settings: '/settings',
  SettingsPage: '/settings',
  SupportSidePanel: '/',
  TimeManagement: '/time-management',
  TimeManagementPage: '/time-management',
  TimezoneSearchPanel: '/settings',
  TimezoneSelector: '/settings',
  Toast: '/',
}

function getWebOrigin(): string {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:5173`
  }
  return window.location.origin
}

/** Extracts the leading PascalCase page/component token, e.g. 'ConfirmDialog' from 'ConfirmDialog panel'. */
function extractSource(usedOn: string): string {
  return usedOn.match(/^[A-Z][A-Za-z0-9]*/)?.[0] ?? usedOn.split('(')[0].trim()
}

export function getUsedOnHref(
  usedOn: string,
  entryId: string,
  category: string,
  recipe: string,
  conceptLabel: string,
  note?: string
): string | null {
  const source = extractSource(usedOn)
  const route = SOURCE_ROUTES[source]
  if (!route) return null

  const detailMatch = usedOn.match(/\(([^)]+)\)/)
  const url = new URL(route, getWebOrigin())
  url.searchParams.set('designSource', source)
  url.searchParams.set('designEntry', entryId)
  url.searchParams.set('designCategory', category)
  url.searchParams.set('designRecipe', recipe)
  url.searchParams.set('designConcept', conceptLabel)
  if (detailMatch?.[1]) url.searchParams.set('designDetail', detailMatch[1])
  if (note) url.searchParams.set('designHint', note)
  return url.toString()
}

/** Explains why a "used on" tag has no link -- it exists, it just has no single dedicated page route. */
export function explainMissingRoute(usedOn: string): string {
  const source = extractSource(usedOn)
  if (!/^[A-Z]/.test(source)) {
    return 'This is a descriptive note, not a linkable page or component.'
  }
  return `"${source}" exists in the app, but isn't a standalone page -- it's a shared panel, dialog, or sub-component rendered inside other pages. Open one of its other listed pages to find it in context.`
}