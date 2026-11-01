import dotenv from 'dotenv'
dotenv.config({ quiet: true })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const secretKeyName = process.env.NODE_ENV === 'production'
  ? 'SUPABASE_SECRET_KEY_PRODUCTION'
  : 'SUPABASE_SECRET_KEY_LOCALHOST'
const supabaseServiceKey = process.env[secretKeyName]
if (supabaseServiceKey !== undefined && !supabaseServiceKey.trim()) {
  throw new Error(`${secretKeyName} is empty`)
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.error(`Missing SUPABASE_URL or ${secretKeyName}`)
  process.exit(1)
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
