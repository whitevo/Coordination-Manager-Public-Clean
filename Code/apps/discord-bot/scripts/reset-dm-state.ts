/**
 * Reset all DM subscription state for a Discord user so the bot
 * treats them as a first-time contact.
 *
 * Usage:
 *   npx tsx scripts/reset-dm-state.ts <discord_username>
 *
 * Example:
 *   npx tsx scripts/reset-dm-state.ts some_discord_user
 *
 * Uses the bot's environment-selected Supabase secret API key.
 */
import dotenv from 'dotenv'
dotenv.config()

import { supabase as configuredSupabase, missingSupabaseEnvVars } from '../src/supabase.js'

if (!configuredSupabase) {
  console.error('Missing Supabase configuration: ' + missingSupabaseEnvVars.join(', '))
  process.exit(1)
}

const supabase = configuredSupabase

const username = process.argv[2]
if (!username) {
  console.error('Usage: npx tsx scripts/reset-dm-state.ts <discord_username>')
  process.exit(1)
}

async function main() {
  // 1. Look up Discord user ID + CM user ID from discord_integrations
  //    (may have multiple rows -- prefer the active one)
  const { data: integrations, error: intErr } = await supabase
    .from('discord_integrations')
    .select('discord_user_id, user_id, is_active')
    .eq('discord_username', username)
    .order('is_active', { ascending: false })

  if (intErr) {
    console.error('Error looking up discord_integrations:', intErr.message)
    process.exit(1)
  }
  if (!integrations?.length) {
    console.error(`No discord_integrations record found for username "${username}"`)
    process.exit(1)
  }

  const integration = integrations[0]
  const discordId = integration.discord_user_id
  const cmUserId = integration.user_id
  console.log(`Found: discord_user_id=${discordId}, cm_user_id=${cmUserId}`)

  // 2. Delete from dm_calendar_invites (calendar-level invite state)
  const { count: invites } = await supabase
    .from('dm_calendar_invites')
    .delete({ count: 'exact' })
    .eq('recipient_discord_id', discordId)
  console.log(`Deleted ${invites ?? 0} dm_calendar_invites rows`)

  // 3. Delete from dm_first_contacts (sender-level first-contact tracking)
  const { count: firstContacts } = await supabase
    .from('dm_first_contacts')
    .delete({ count: 'exact' })
    .eq('recipient_discord_id', discordId)
  console.log(`Deleted ${firstContacts ?? 0} dm_first_contacts rows`)

  // 4. Delete from dm_opt_ins (backward compat)
  const { count: optIns } = await supabase
    .from('dm_opt_ins')
    .delete({ count: 'exact' })
    .eq('recipient_discord_id', discordId)
  console.log(`Deleted ${optIns ?? 0} dm_opt_ins rows`)

  // 5. Delete from dm_opt_outs
  const { count: optOuts } = await supabase
    .from('dm_opt_outs')
    .delete({ count: 'exact' })
    .eq('recipient_discord_id', discordId)
  console.log(`Deleted ${optOuts ?? 0} dm_opt_outs rows`)

  // 6. Delete web calendar_subscriptions for the CM user
  if (cmUserId) {
    const { count: subs } = await supabase
      .from('calendar_subscriptions')
      .delete({ count: 'exact' })
      .eq('user_id', cmUserId)
    console.log(`Deleted ${subs ?? 0} calendar_subscriptions rows`)
  } else {
    console.log('No CM user ID -- skipping calendar_subscriptions')
  }

  console.log('\nDone. Bot will now treat this user as a first-time contact.')
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
