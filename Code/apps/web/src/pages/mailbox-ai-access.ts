/**
 * Catalog of the mailbox data the AI assistant may read, grouped by the database
 * tables it is backed by. Each entry maps one data source to the assistant
 * abilities that source unlocks, so the settings page can explain a toggle
 * instead of only naming it. Access is opt-out: everything is on by default and
 * only applies while the user is talking to the assistant inside the Mailbox.
 */

export type MailboxAiAccessId =
  | 'messages'
  | 'drafts'
  | 'tags'
  | 'rules'
  | 'contacts'
  | 'accounts'
  | 'invitations'
  | 'actionHistory'

export interface MailboxAiAccessEntry {
  id: MailboxAiAccessId
  label: string
  /** Database tables the assistant reads when this entry is enabled. */
  tables: string[]
  /** What the assistant can do because it can read those tables. */
  abilities: string[]
  /** 'active' entries already reach the assistant; 'planned' ones are reserved. */
  status: 'active' | 'planned'
}

export const MAILBOX_AI_ACCESS_ENTRIES: readonly MailboxAiAccessEntry[] = [
  {
    id: 'messages',
    label: 'Emails and threads',
    tables: ['mail_messages', 'mail_threads'],
    abilities: [
      'Read the email you have open and the messages currently listed.',
      'Turn a concrete sender, subject, or body phrase into an automation check.',
      'Summarise or compare threads you are looking at.',
    ],
    status: 'active',
  },
  {
    id: 'tags',
    label: 'Mailbox tags',
    tables: ['mail_user_preferences.mailbox_tags'],
    abilities: [
      'Refer to your existing tags by their real name.',
      'Propose add-tag and remove-tag steps instead of inventing labels.',
    ],
    status: 'active',
  },
  {
    id: 'rules',
    label: 'Automation rules',
    tables: ['mail_rules'],
    abilities: [
      'Read the rules you already saved so it avoids duplicates.',
      'Write a new rule into the builder as a trial run for you to review.',
    ],
    status: 'active',
  },
  {
    id: 'drafts',
    label: 'Drafts',
    tables: ['mail_drafts'],
    abilities: [
      'Propose reply text for the thread you have open.',
      'Refine an unsent draft you are already editing.',
    ],
    status: 'active',
  },
  {
    id: 'contacts',
    label: 'Contacts and identities',
    tables: ['mail_contacts', 'mail_contact_identities'],
    abilities: [
      'Recognise who a correspondent is across several addresses.',
      'Group suggestions by person rather than by raw email address.',
    ],
    status: 'planned',
  },
  {
    id: 'accounts',
    label: 'Connected accounts',
    tables: ['mail_accounts'],
    abilities: [
      'Know which mailbox an email arrived in and which identity group it belongs to.',
      'Scope a suggestion to one account instead of every mailbox.',
    ],
    status: 'active',
  },
  {
    id: 'invitations',
    label: 'Calendar invitations',
    tables: ['mail_invitations'],
    abilities: [
      'Read invitations parsed out of your mail.',
      'Suggest which calendar an invitation should be added to.',
    ],
    status: 'planned',
  },
  {
    id: 'actionHistory',
    label: 'Action history',
    tables: ['mail_action_events'],
    abilities: [
      'See what you previously junked, archived, or trashed.',
      'Base suggestions on how you already handle similar mail.',
    ],
    status: 'planned',
  },
] as const

export type MailboxAiAccessConfig = Record<MailboxAiAccessId, boolean>

export const DEFAULT_MAILBOX_AI_ACCESS: MailboxAiAccessConfig = MAILBOX_AI_ACCESS_ENTRIES.reduce(
  (acc, entry) => {
    acc[entry.id] = true
    return acc
  },
  {} as MailboxAiAccessConfig
)

export function buildMailboxAiAccess(enabled: boolean): MailboxAiAccessConfig {
  return MAILBOX_AI_ACCESS_ENTRIES.reduce((acc, entry) => {
    acc[entry.id] = enabled
    return acc
  }, {} as MailboxAiAccessConfig)
}

export function normalizeMailboxAiAccess(value: unknown): MailboxAiAccessConfig {
  const source =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return MAILBOX_AI_ACCESS_ENTRIES.reduce((acc, entry) => {
    acc[entry.id] = typeof source[entry.id] === 'boolean' ? (source[entry.id] as boolean) : true
    return acc
  }, {} as MailboxAiAccessConfig)
}

/** Composes the feedback message auto-filed when a user clicks "Request feature" on a planned AI data source. */
export function buildMailboxFeatureRequestMessage(entry: MailboxAiAccessEntry): string {
  return [
    `Feature request: wire up the "${entry.label}" mailbox AI assistant data source.`,
    '',
    `Tables involved: ${entry.tables.join(', ')}`,
    '',
    'Requested abilities once wired:',
    ...entry.abilities.map((ability) => `- ${ability}`),
  ].join('\n')
}
