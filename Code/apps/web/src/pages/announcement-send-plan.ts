export interface EmailRecipientRow {
  key: string
  display_name: string
  email: string | null
  email_display: string
  source: 'manual' | 'calendar' | 'friendlist'
  source_detail: string
  status_label: string
  status_color: string
  selectable: boolean
}

interface RecipientSources {
  contacts: Array<{ id: string; email: string; display_name: string | null; opted_out: boolean; notification_disabled: boolean }>
  friends: Array<{ user_id: string; display_name: string; email: string | null }>
  participants: Array<{ username: string; email: string | null; email_status: string; calendar_ids: string[] }>
  calendarIds: readonly string[]
  calendars: Array<{ id: string; title: string }>
}

export interface EmailRecipientProjection extends EmailRecipientRow {
  deliveryEmail: string | null
}

export function buildEmailRecipientRows({ contacts, friends, participants, calendarIds, calendars }: RecipientSources): EmailRecipientProjection[] {
  const rows: EmailRecipientProjection[] = []
  for (const contact of contacts) {
    rows.push({
      key: `manual:${contact.id}`,
      display_name: contact.display_name || contact.email.split('@')[0],
      email: contact.email,
      deliveryEmail: contact.email,
      email_display: contact.email,
      source: 'manual',
      source_detail: '',
      status_label: contact.opted_out ? 'Opted out' : contact.notification_disabled ? 'Disabled' : 'Active',
      status_color: contact.opted_out ? 'text-danger' : contact.notification_disabled ? 'text-warning' : 'text-success',
      selectable: !contact.opted_out && !contact.notification_disabled,
    })
  }
  for (const friend of friends) {
    rows.push({
      key: `friendlist:${friend.user_id}`,
      display_name: friend.display_name,
      email: friend.email,
      deliveryEmail: friend.email,
      email_display: friend.email || 'N/A',
      source: 'friendlist',
      source_detail: '',
      status_label: friend.email ? 'Active' : 'No Email',
      status_color: friend.email ? 'text-success' : 'text-muted-foreground',
      selectable: Boolean(friend.email),
    })
  }
  const active = new Set(calendarIds)
  const names = new Map(calendars.map(calendar => [calendar.id, calendar.title]))
  for (const participant of participants) {
    const matched = participant.calendar_ids.filter(id => active.has(id))
    if (!matched.length) continue
    const visible = participant.email_status === 'visible' && Boolean(participant.email)
    const hidden = participant.email_status === 'hidden'
    const disabled = participant.email_status === 'disabled'
    rows.push({
      key: `calendar:${participant.username}`,
      display_name: participant.username,
      email: visible ? participant.email : null,
      deliveryEmail: visible || hidden ? participant.email : null,
      email_display: visible ? (participant.email ?? 'N/A') : hidden ? 'Email Exists' : 'N/A',
      source: 'calendar',
      source_detail: Array.from(new Set(matched.map(id => names.get(id) || id))).join(', '),
      status_label: visible || hidden ? 'Active' : disabled ? 'Disabled' : 'No Email',
      status_color: visible || hidden ? 'text-success' : disabled ? 'text-warning' : 'text-muted-foreground',
      selectable: visible || hidden,
    })
  }
  return rows.sort((a, b) => Number(b.selectable) - Number(a.selectable) || a.display_name.localeCompare(b.display_name))
}

export function uniquePollOptions<T extends { emoji: string; text: string }>(options: T[]): T[] {
  const seen = new Set<string>()
  return options.filter(option => {
    if (!option.text.trim() || seen.has(option.emoji)) return false
    seen.add(option.emoji)
    return true
  })
}

export function buildReminderPlans<Meeting, Offset>({
  meetings, offsets, startTime, offsetTime, now,
}: {
  meetings: Meeting[]
  offsets: Offset[]
  startTime: (meeting: Meeting) => number
  offsetTime: (offset: Offset) => number
  now: number
}): {
  plans: Array<{ meeting: Meeting; offset: Offset; scheduledAt: string }>
  skipped: Array<{ meeting: Meeting; offset: Offset }>
} {
  const plans: Array<{ meeting: Meeting; offset: Offset; scheduledAt: string }> = []
  const skipped: Array<{ meeting: Meeting; offset: Offset }> = []
  for (const meeting of meetings) {
    const start = startTime(meeting)
    for (const offset of offsets) {
      const time = start - offsetTime(offset)
      if (time < now + 60_000) skipped.push({ meeting, offset })
      else plans.push({ meeting, offset, scheduledAt: new Date(time).toISOString() })
    }
  }
  return { plans, skipped }
}
