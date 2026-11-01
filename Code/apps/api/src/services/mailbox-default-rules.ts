import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '../supabaseClient.js'
import { MAX_AUTOMATION_RULES, normalizeAutomationRule, toRuleColumns } from './mailbox-automation.js'

export const DEFAULT_PHISHING_TAG_LABEL = 'Possible Phishing'
const DEFAULT_PHISHING_TAG_COLOR = '#dc2626'

interface MailboxTagRecordLike {
  id: string
  label: string
  color: string
  sort_order: number
}

/** Raw rule definitions normalized/validated by `normalizeAutomationRule` before persisting. */
function buildDefaultAutomationRuleDefinitions(tagId: string): Array<Record<string, unknown>> {
  return [
    {
      name: 'Suspicious language: urgent account verification',
      mode: 'disabled',
      match: 'any',
      steps: [
        { kind: 'condition', field: 'subject', operator: 'contains_characters', value: 'verify your account' },
        { kind: 'condition', field: 'subject', operator: 'contains_characters', value: 'account suspended' },
        { kind: 'condition', field: 'subject', operator: 'contains_characters', value: 'unusual sign-in activity' },
        { kind: 'condition', field: 'body', operator: 'contains_characters', value: 'confirm your password' },
        { kind: 'condition', field: 'body', operator: 'contains_characters', value: 'seed phrase' },
        { kind: 'condition', field: 'body', operator: 'contains_characters', value: 'recovery phrase' },
        { kind: 'action', action: 'add_tag', value: tagId },
      ],
    },
    {
      name: 'AI check: credential request under urgency',
      mode: 'disabled',
      match: 'all',
      steps: [
        {
          kind: 'condition',
          field: 'assessment',
          assessmentContext:
            "Note the sender's claimed identity or brand, the specific action requested (sign in, verify, pay, share a code/password/seed phrase), any urgency or threat language, and whether the sender's address matches a domain you'd expect for that brand.",
          assessmentIntent:
            'Decide whether this email is likely a phishing or scam attempt impersonating a brand, a service, or a person to get the recipient to reveal credentials, click a suspicious link, or send money.',
          assessmentScoreThreshold: 0.75,
        },
        { kind: 'action', action: 'add_tag', value: tagId },
      ],
    },
  ]
}

async function ensureDefaultPhishingTag(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('mail_user_preferences')
    .select('mailbox_tags')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error

  const existingTags: MailboxTagRecordLike[] = Array.isArray(data?.mailbox_tags) ? data!.mailbox_tags : []
  const existing = existingTags.find((tag) => tag.label?.toLowerCase() === DEFAULT_PHISHING_TAG_LABEL.toLowerCase())
  if (existing) return existing.id

  const newTag: MailboxTagRecordLike = {
    id: randomUUID(),
    label: DEFAULT_PHISHING_TAG_LABEL,
    color: DEFAULT_PHISHING_TAG_COLOR,
    sort_order: existingTags.length,
  }

  const { error: upsertError } = await supabaseAdmin
    .from('mail_user_preferences')
    .upsert({ user_id: userId, mailbox_tags: [...existingTags, newTag] }, { onConflict: 'user_id' })

  if (upsertError) throw upsertError
  return newTag.id
}

/**
 * Idempotently gives a user the "Possible Phishing" tag and the two default scam-detection
 * automation rules, both created disabled -- users opt in by switching mode to dry_run/active.
 * Safe to call repeatedly (e.g. on every account connect): a tag/rule already present by
 * label/name is left untouched, so this never duplicates or overwrites a user's own rules.
 */
export async function ensureDefaultMailboxAutomationSetup(
  userId: string,
): Promise<{ tagId: string; rulesCreated: string[] }> {
  const tagId = await ensureDefaultPhishingTag(userId)

  const { data: existingRules, error: rulesError } = await supabaseAdmin
    .from('mail_rules')
    .select('name')
    .eq('user_id', userId)

  if (rulesError) throw rulesError

  const existingNames = new Set(((existingRules || []) as { name: string }[]).map((row) => row.name.toLowerCase()))
  let ruleCount = existingRules?.length ?? 0
  const rulesCreated: string[] = []

  for (const raw of buildDefaultAutomationRuleDefinitions(tagId)) {
    if (existingNames.has((raw.name as string).toLowerCase())) continue
    if (ruleCount >= MAX_AUTOMATION_RULES) break

    const definition = normalizeAutomationRule(raw)
    if (!definition) continue

    const columns = toRuleColumns(definition)
    const { error: insertError } = await supabaseAdmin
      .from('mail_rules')
      .insert({
        user_id: userId,
        account_id: null,
        name: definition.name,
        conditions: columns.conditions,
        actions: columns.actions,
        mode: definition.mode,
        stop_processing: definition.stopProcessing,
      })

    if (insertError) throw insertError
    ruleCount += 1
    rulesCreated.push(definition.name)
  }

  return { tagId, rulesCreated }
}
