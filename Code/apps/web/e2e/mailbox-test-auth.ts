import type { Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function readSupabaseUrl(): string | null {
  if (process.env.E2E_SUPABASE_URL) return process.env.E2E_SUPABASE_URL
  for (const file of ['.env.local', '.env']) {
    const path = join(process.cwd(), file)
    if (!existsSync(path)) continue
    const match = readFileSync(path, 'utf8').match(/^VITE_SUPABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)
    if (match) return match[1].trim()
  }
  return null
}

export async function signInMailboxTest(page: Page): Promise<boolean> {
  const base = process.env.E2E_BASE_URL || 'http://localhost:5173'
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD
  if (email && password) {
    await page.goto(`${base}/auth/login`)
    await page.getByPlaceholder(/email/i).fill(email)
    await page.getByPlaceholder(/password/i).fill(password)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    await page.waitForURL(/\/dashboard|\/mailbox|\/calendar/i, { timeout: 15_000 })
    return true
  }

  const supabaseUrl = readSupabaseUrl()
  if (!supabaseUrl) return false
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: 'e2e-user',
    email: 'e2e@example.com',
    role: 'authenticated',
    aud: 'authenticated',
    exp: expiresAt,
  })}.e2e`
  const user = {
    id: 'e2e-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'e2e@example.com',
    app_metadata: { provider: 'google' },
    user_metadata: {},
    created_at: new Date().toISOString(),
  }
  const session = {
    access_token: accessToken,
    refresh_token: 'e2e-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user,
  }

  await page.route('**/auth/v1/**', (route) => route.fulfill({ json: user }))
  await page.route('**/api/auth/me', (route) => route.fulfill({
    json: { user: { id: user.id, email: user.email, accountType: 'google', roles: [] } },
  }))
  await page.addInitScript(
    ([key, value]) => window.sessionStorage.setItem(key, value),
    [storageKey, JSON.stringify(session)] as const
  )
  return true
}
