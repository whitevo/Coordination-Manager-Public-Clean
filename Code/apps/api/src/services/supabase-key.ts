export const SUPABASE_SERVER_KEY_NAMES = [
  'SUPABASE_SECRET_KEY_LOCALHOST',
  'SUPABASE_SECRET_KEY_PRODUCTION',
] as const

export function getSupabaseSecretKeyName(env: NodeJS.ProcessEnv = process.env): string {
  return env.NODE_ENV === 'production'
    ? 'SUPABASE_SECRET_KEY_PRODUCTION'
    : 'SUPABASE_SECRET_KEY_LOCALHOST'
}

export function getSupabaseServerKey(env: NodeJS.ProcessEnv = process.env): {
  name: string
  value: string | undefined
} {
  const name = getSupabaseSecretKeyName(env)
  return { name, value: env[name] }
}
