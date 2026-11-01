import dotenv from 'dotenv'
dotenv.config({ quiet: true })

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const secretKeyName = process.env.NODE_ENV === 'production'
  ? 'SUPABASE_SECRET_KEY_PRODUCTION'
  : 'SUPABASE_SECRET_KEY_LOCALHOST'
const supabaseServerKey = process.env[secretKeyName]
if (supabaseServerKey !== undefined && !supabaseServerKey.trim()) {
  throw new Error(`${secretKeyName} is empty`)
}

export const missingSupabaseEnvVars: string[] = [
  ...(!supabaseUrl ? ['SUPABASE_URL'] : []),
  ...(!supabaseServerKey ? [secretKeyName] : []),
]

export const isSupabaseConfigured = missingSupabaseEnvVars.length === 0

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseServerKey as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  : null
