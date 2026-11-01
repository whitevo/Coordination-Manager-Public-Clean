import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseSecretKeyName, getSupabaseServerKey } from '../src/services/supabase-key.js'

dotenv.config({
  path: fileURLToPath(new URL('../.env', import.meta.url)),
  quiet: true,
})

const url = process.env.SUPABASE_URL
const { name, value: key } = getSupabaseServerKey()
if (!url || !key?.startsWith('sb_secret_')) {
  throw new Error(`Set SUPABASE_URL and an sb_secret_ value in ${getSupabaseSecretKeyName()} before verification`)
}
console.log(`Verifying configured credential from ${name} (value hidden)`)

// A standalone client avoids starting the API, sync jobs, or Discord bots.
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) => fetch(input, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    }),
  },
})

const database = await client.from('users').select('id').limit(0)
if (database.error) {
  throw new Error(`Read-only database verification failed (HTTP ${database.status}); no records or credentials printed`)
}
console.log('PASS: secret API key accepted for a zero-row database query')

const auth = await client.auth.admin.listUsers({ page: 1, perPage: 1 })
if (auth.error) {
  throw new Error(`Read-only admin Auth verification failed (HTTP ${auth.error.status ?? 'unknown'}); no records or credentials printed`)
}
console.log('PASS: secret API key accepted for read-only admin Auth access')
console.log('No users or records were created, updated, or deleted. Login flows remain unverified.')
