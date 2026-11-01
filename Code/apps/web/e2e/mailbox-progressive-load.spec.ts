/**
 * E2E: Mailbox progressive loading behavior
 *
 * Pre-conditions:
 *  - Dev stack running (pnpm dev:stack from repo root)
 *  - E2E_USER_EMAIL and E2E_USER_PASSWORD set in env (test account)
 *
 * All /api/mailbox/** calls are intercepted and served from an in-memory fixture so the
 * scanning/caching behavior is fully deterministic regardless of real account data.
 *
 * Covers:
 *  1. The inbox scans progressively (visible "Checking X of Y..." steps) and caps the
 *     rendered list at exactly one page (30) once the target is reached -- it must not
 *     overshoot to a larger number even when the underlying match burst exceeds the target.
 *  2. The "Load" button either hands off to a visible continuing scan -- picking up from
 *     wherever the background loop currently stands -- when the cache isn't ready yet, or
 *     reveals already-cached matches instantly (no visible re-scan) once it is.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173'
const TOTAL_MESSAGES = 270
const BURST_START = 120
const BURST_END = 150

interface MockAccount {
  id: string
  provider: 'gmail'
  address: string
  display_name: string | null
  identity_group: string
  status: 'connected'
  connected_at: string
  last_synced_at: string | null
  sync_error: string | null
}

const ACCOUNTS: MockAccount[] = [
  {
    id: 'acct-a',
    provider: 'gmail',
    address: 'a@example.com',
    display_name: 'Account A',
    identity_group: 'personal',
    status: 'connected',
    connected_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    sync_error: null,
  },
  {
    id: 'acct-b',
    provider: 'gmail',
    address: 'b@example.com',
    display_name: 'Account B',
    identity_group: 'personal',
    status: 'connected',
    connected_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    sync_error: null,
  },
]

// Sparse baseline (1 in 9) plus a dense burst window -- this creates a scan that takes many
// chunks to fill a page, with a burst that can overshoot the target in a single chunk (the
// exact scenario the display-cap/cache logic needs to handle correctly).
function isAccountBIndex(i: number): boolean {
  if (i >= BURST_START && i < BURST_END) return i % 3 === 0
  return i % 9 === 0
}

function buildMockMessages(total: number) {
  const messages = []
  for (let i = 0; i < total; i++) {
    const isB = isAccountBIndex(i)
    const accountId = isB ? 'acct-b' : 'acct-a'
    const account = isB ? ACCOUNTS[1] : ACCOUNTS[0]
    messages.push({
      id: `msg-${i}`,
      account_id: accountId,
      account: { address: account.address, identity_group: account.identity_group, display_name: account.display_name },
      thread_id: `thread-${i}`,
      subject: `Test email ${i}`,
      from_name: 'Sender',
      from_email: 'sender@example.com',
      to_emails: 'me@example.com',
      cc_emails: null,
      bcc_emails: null,
      received_at: new Date(Date.now() - i * 60_000).toISOString(),
      preview: 'preview text',
      is_read: true,
      is_archived: false,
      is_provider_trashed: false,
      has_attachments: false,
      user_tag_ids: [],
    })
  }
  return messages
}

async function mockMailboxApi(page: Page) {
  const messages = buildMockMessages(TOTAL_MESSAGES)
  const messagesRequestLog: number[] = []

  await page.route('**/api/mailbox/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (path.endsWith('/api/mailbox/accounts') && method === 'GET') {
      return route.fulfill({ json: { accounts: ACCOUNTS } })
    }
    if (path.endsWith('/api/mailbox/messages') && method === 'GET') {
      const limit = Number(url.searchParams.get('limit')) || 30
      messagesRequestLog.push(limit)
      // A small deterministic delay keeps the scan/prefetch timing observable and race-free in tests.
      await new Promise((resolve) => setTimeout(resolve, 120))
      return route.fulfill({ json: { messages: messages.slice(0, limit), total: messages.length } })
    }
    if (path.endsWith('/api/mailbox/preferences/tags')) {
      return route.fulfill({ json: { tags: [] } })
    }
    if (path.endsWith('/api/mailbox/people')) {
      return route.fulfill({ json: { people: [] } })
    }
    if (path.endsWith('/api/mailbox/invitations/extract')) {
      return route.fulfill({ json: {} })
    }
    if (path.endsWith('/api/mailbox/invitations')) {
      return route.fulfill({ json: { invitations: [] } })
    }
    if (path.endsWith('/api/mailbox/rules')) {
      return route.fulfill({ json: { rules: [] } })
    }
    return route.fulfill({ json: {} })
  })

  return { messagesRequestLog }
}

async function excludeAccountA(page: Page) {
  await page.getByRole('button', { name: 'Additional Filters' }).click()
  const expandToggle = page.getByTitle(/expand account list|collapse account list/i)
  if ((await expandToggle.getAttribute('aria-expanded')) !== 'true') {
    await expandToggle.click()
  }
  await page.locator('label', { hasText: 'a@example.com' }).locator('input[type="checkbox"]').uncheck()
}

test.describe('Mailbox - progressive loading', () => {
  test.beforeEach(async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL
    const password = process.env.E2E_USER_PASSWORD
    if (!email || !password) test.skip()

    await mockMailboxApi(page)

    await page.goto(`${BASE}/auth/login`)
    await page.getByPlaceholder(/email/i).fill(email!)
    await page.getByPlaceholder(/password/i).fill(password!)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    await page.waitForURL(/\/dashboard|\/mailbox|\/calendar/i, { timeout: 15_000 })

    await page.evaluate(() => localStorage.setItem('mailbox:load-limit:v1', '40'))
    await page.goto(`${BASE}/mailbox?tab=mailbox`)
    await expect(page.getByTestId('mailbox-workspace-loading')).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByTestId('mailbox-showing-count')).toBeVisible({ timeout: 15_000 })
  })

  test('scans progressively and caps the visible list at one page without overshooting', async ({ page }) => {
    await excludeAccountA(page)

    const progress = page.getByTestId('mailbox-checking-progress')
    const observedChecked: number[] = []

    // Sample the progress text while the background scan runs to confirm it advances in
    // multiple visible steps instead of jumping straight from a small number to the total.
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (await progress.isVisible().catch(() => false)) {
        const text = await progress.innerText().catch(() => '')
        const match = text.match(/Checking (\d+) of/)
        if (match) {
          const value = Number(match[1])
          if (observedChecked[observedChecked.length - 1] !== value) observedChecked.push(value)
        }
      } else if (observedChecked.length > 0) {
        break
      }
      await page.waitForTimeout(50)
    }

    await expect(progress).toHaveCount(0, { timeout: 20_000 })

    // Progressive: several distinct increasing checkpoints observed, not a single jump to the end.
    expect(observedChecked.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < observedChecked.length; i++) {
      expect(observedChecked[i]).toBeGreaterThan(observedChecked[i - 1])
    }
    expect(observedChecked[observedChecked.length - 1]).toBeLessThan(TOTAL_MESSAGES)

    // Capped exactly at the page target (30), even though the burst window can match more than
    // 30 messages in a single loaded chunk.
    await expect(page.getByTestId('mailbox-message-row')).toHaveCount(30)
    await expect(page.getByTestId('mailbox-showing-count')).toHaveText(/Showing 30 of 270 synced emails/)
    await expect(page.getByTestId('mailbox-load-more-button')).toBeVisible()

    await page.goto(`${BASE}/mailbox?tab=settings&settings=accounts`)
    await expect(
      page.locator('label', { hasText: 'Default messages to load' }).locator('input[type="number"]')
    ).toHaveValue('40')
  })

  test('Load hands off to a visible scan that continues from where the background prefetch stands', async ({ page }) => {
    await excludeAccountA(page)
    await expect(page.getByTestId('mailbox-checking-progress')).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByTestId('mailbox-message-row')).toHaveCount(30)

    const loadButton = page.getByTestId('mailbox-load-more-button')
    const progress = page.getByTestId('mailbox-checking-progress')

    // Clicked before the 300ms-delayed background prefetch has populated the cache, so this must
    // hand off to a visible scan (not silently drop the request or restart from scratch).
    await loadButton.click()
    await expect(progress).toBeVisible({ timeout: 1_000 })

    await expect(progress).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByTestId('mailbox-message-row')).toHaveCount(37, { timeout: 2_000 })

    // Everything matching has now been found and all synced emails are loaded -- nothing left to
    // add, so the panel reports completion instead of offering another Load.
    await expect(page.getByText(/All emails have been loaded\./)).toBeVisible({ timeout: 5_000 })
  })

  test('Load reveals already-cached matches instantly once the background prefetch has caught up', async ({ page }) => {
    await excludeAccountA(page)
    await expect(page.getByTestId('mailbox-checking-progress')).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByTestId('mailbox-message-row')).toHaveCount(30)

    // Give the silent background prefetch (300ms scheduling delay + ~4 chunk requests) time to
    // finish loading and caching the remaining matches before we click.
    await page.waitForTimeout(1_500)

    const loadButton = page.getByTestId('mailbox-load-more-button')
    const progress = page.getByTestId('mailbox-checking-progress')

    await loadButton.click()
    // Cached reveal should not flash a visible re-scan indicator.
    await expect(progress).toHaveCount(0)
    await expect(page.getByTestId('mailbox-message-row')).toHaveCount(37, { timeout: 1_000 })

    // Everything matching has now been found and all synced emails are loaded -- nothing left to
    // add, so the panel reports completion instead of offering another Load.
    await expect(page.getByText(/All emails have been loaded\./)).toBeVisible({ timeout: 5_000 })
  })
})
