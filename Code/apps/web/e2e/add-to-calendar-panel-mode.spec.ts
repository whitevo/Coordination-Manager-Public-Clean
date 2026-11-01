/**
 * E2E: Mailbox "Add to calendar" window <-> side panel mode
 *
 * Pre-conditions:
 *  - Dev stack running (pnpm dev:stack from repo root)
 *  - E2E_USER_EMAIL and E2E_USER_PASSWORD set in env (test account)
 *
 * All mailbox/calendar-target API calls are intercepted so the invitation picker is
 * deterministic regardless of the test account's real data.
 *
 * Covers:
 *  1. The picker opens as a focus window by default and the dock button moves it into the
 *     right side panel.
 *  2. The mode preference is persisted in localStorage and survives a reload.
 *  3. The side-panel mode coexists with the mailbox Tags panel and the AI assistant panel --
 *     all three are visible at once, never overlap, and remain interactive.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173'
const MODE_STORAGE_KEY = 'mailbox:add-to-calendar-display-mode:v1'

const ACCOUNT = {
  id: 'acct-a',
  provider: 'gmail',
  address: 'a@example.com',
  display_name: 'Account A',
  identity_group: 'personal',
  status: 'connected',
  connected_at: new Date().toISOString(),
  last_synced_at: new Date().toISOString(),
  sync_error: null,
}

const INVITATION = {
  id: 'inv-1',
  message_id: 'msg-0',
  summary: 'Quarterly planning sync',
  location: 'https://meet.example.com/quarterly',
  organizer: 'organizer@example.com',
  starts_at: new Date(Date.now() + 86_400_000).toISOString(),
  ends_at: new Date(Date.now() + 90_000_000).toISOString(),
  status: 'CONFIRMED',
  provider_event_ref: null,
  source_email: 'organizer@example.com',
  source_deleted: false,
  uid: 'uid-1',
}

const MESSAGES = [
  {
    id: 'msg-0',
    account_id: ACCOUNT.id,
    account: {
      address: ACCOUNT.address,
      identity_group: ACCOUNT.identity_group,
      display_name: ACCOUNT.display_name,
    },
    thread_id: 'thread-0',
    subject: 'Quarterly planning sync',
    from_name: 'Organizer',
    from_email: 'organizer@example.com',
    to_emails: 'me@example.com',
    cc_emails: null,
    bcc_emails: null,
    received_at: new Date().toISOString(),
    preview: 'Invitation attached',
    is_read: true,
    is_archived: false,
    is_provider_trashed: false,
    has_attachments: true,
    user_tag_ids: [],
  },
]

async function mockApi(page: Page) {
  await page.route('**/api/mailbox/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/api/mailbox/accounts')) return route.fulfill({ json: { accounts: [ACCOUNT] } })
    if (path.endsWith('/api/mailbox/messages'))
      return route.fulfill({ json: { messages: MESSAGES, total: MESSAGES.length } })
    if (path.endsWith('/api/mailbox/preferences/tags'))
      return route.fulfill({ json: { tags: [{ id: 'tag-1', label: 'Planning', color: '#3b82f6' }] } })
    if (path.endsWith('/api/mailbox/people')) return route.fulfill({ json: { people: [] } })
    if (path.endsWith('/api/mailbox/invitations/extract')) return route.fulfill({ json: {} })
    if (path.endsWith('/api/mailbox/invitations'))
      return route.fulfill({ json: { invitations: [INVITATION] } })
    if (path.endsWith('/api/mailbox/rules')) return route.fulfill({ json: { rules: [] } })
    return route.fulfill({ json: {} })
  })

  await page.route('**/api/calendar-sources**', (route) =>
    route.fulfill({
      json: {
        sources: [
          {
            id: 'src-1',
            display_name: 'Work Google Calendar',
            source_type: 'google_oauth',
            is_active: true,
          },
        ],
      },
    })
  )
  await page.route('**/api/calendars**', (route) =>
    route.fulfill({
      json: {
        calendars: [
          {
            id: 'cal-1',
            hash: 'abcdefghij',
            title: 'Team coordination',
            visibility: 'private',
            created_by: 'me@example.com',
            updated_at: new Date().toISOString(),
          },
        ],
      },
    })
  )
  await page.route('**/api/time-management/modes**', (route) =>
    route.fulfill({ json: { modes: [] } })
  )
  await page.route('**/api/time-management/categories**', (route) =>
    route.fulfill({ json: { categories: [] } })
  )
}

async function login(page: Page) {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD
  await page.goto(`${BASE}/auth/login`)
  await page.getByPlaceholder(/email/i).fill(email!)
  await page.getByPlaceholder(/password/i).fill(password!)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/dashboard|\/mailbox|\/calendar/i, { timeout: 15_000 })
}

async function openInvitationPicker(page: Page) {
  await page.goto(`${BASE}/mailbox?tab=invitations`)
  const trigger = page.getByTestId('mailbox-invitation-add-to-calendar').first()
  await expect(trigger).toBeVisible({ timeout: 15_000 })
  await trigger.click()
}

/** A panel counts as visible only when it actually occupies horizontal space. */
async function panelWidth(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).first().boundingBox()
  return box?.width ?? 0
}

test.describe('Mailbox - Add to calendar display mode', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD) test.skip()
    await page.setViewportSize({ width: 1600, height: 900 })
    await mockApi(page)
    await login(page)
    await page.evaluate((key) => window.localStorage.removeItem(key), MODE_STORAGE_KEY)
  })

  test('opens as a focus window and docks into the right side panel', async ({ page }) => {
    await openInvitationPicker(page)

    await expect(page.getByTestId('add-to-calendar-window')).toBeVisible()
    await expect(page.getByTestId('add-to-calendar-side-panel')).toHaveCount(0)

    await page.getByTestId('add-to-calendar-mode-toggle').click()

    await expect(page.getByTestId('add-to-calendar-side-panel')).toBeVisible()
    await expect(page.getByTestId('add-to-calendar-window')).toHaveCount(0)
    // Content survives the move.
    await expect(page.getByRole('button', { name: 'Download ICS' })).toBeVisible()
    await expect(page.getByText('Work Google Calendar')).toBeVisible()

    // No dimming overlay in panel mode -- the invitation list behind it stays clickable.
    await expect(page.getByTestId('mailbox-invitation-add-to-calendar').first()).toBeEnabled()
  })

  test('returns to focus window mode from the side panel', async ({ page }) => {
    await openInvitationPicker(page)
    await page.getByTestId('add-to-calendar-mode-toggle').click()
    await expect(page.getByTestId('add-to-calendar-side-panel')).toBeVisible()

    await page.getByTestId('add-to-calendar-mode-toggle').click()

    await expect(page.getByTestId('add-to-calendar-window')).toBeVisible()
    await expect(page.getByTestId('add-to-calendar-side-panel')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Download ICS' })).toBeVisible()
  })

  test('persists the chosen mode in browser storage across reloads', async ({ page }) => {
    await openInvitationPicker(page)
    await page.getByTestId('add-to-calendar-mode-toggle').click()
    await expect(page.getByTestId('add-to-calendar-side-panel')).toBeVisible()

    expect(await page.evaluate((key) => window.localStorage.getItem(key), MODE_STORAGE_KEY)).toBe(
      'panel'
    )

    await openInvitationPicker(page)
    await expect(page.getByTestId('add-to-calendar-side-panel')).toBeVisible()
    await expect(page.getByTestId('add-to-calendar-window')).toHaveCount(0)

    await page.getByTestId('add-to-calendar-mode-toggle').click()
    expect(await page.evaluate((key) => window.localStorage.getItem(key), MODE_STORAGE_KEY)).toBe(
      'window'
    )

    await openInvitationPicker(page)
    await expect(page.getByTestId('add-to-calendar-window')).toBeVisible()
  })

  test('closes from the side panel without leaving layout artifacts', async ({ page }) => {
    await openInvitationPicker(page)
    await page.getByTestId('add-to-calendar-mode-toggle').click()
    await expect(page.getByTestId('add-to-calendar-side-panel')).toBeVisible()

    await page.getByRole('button', { name: 'Close calendar picker' }).click()

    await expect(page.getByTestId('add-to-calendar-side-panel')).toHaveCount(0)
    await expect(page.getByTestId('add-to-calendar-window')).toHaveCount(0)
    await expect(page.getByTestId('mailbox-invitation-add-to-calendar').first()).toBeVisible()
  })

  test('coexists side by side with the Tags panel and the AI assistant panel', async ({ page }) => {
    await openInvitationPicker(page)
    await page.getByTestId('add-to-calendar-mode-toggle').click()
    await expect(page.getByTestId('add-to-calendar-side-panel')).toBeVisible()

    // Tags panel only lives on the Mailbox tab; the picker must survive the tab switch.
    await page.getByRole('button', { name: /^Mailbox$/ }).first().click()
    await expect(page.getByTestId('add-to-calendar-side-panel')).toBeVisible()

    await page.getByRole('button', { name: 'Open mailbox tag library' }).click()
    await expect(page.getByText('Tag Library')).toBeVisible()

    // Layout owns the assistant panel and exposes it through this global event.
    await page.evaluate(() => window.dispatchEvent(new Event('openAiPanel')))
    await expect(page.getByTestId('ai-guide-side-panel').getByText('AI Assistant')).toBeVisible()

    const tagsBox = await page.getByTestId('mailbox-tags-side-panel').boundingBox()
    const calendarBox = await page.getByTestId('add-to-calendar-side-panel').boundingBox()
    const aiBox = await page.getByTestId('ai-guide-side-panel').boundingBox()

    expect(tagsBox).not.toBeNull()
    expect(calendarBox).not.toBeNull()
    expect(aiBox).not.toBeNull()

    // All three occupy real horizontal space at the same time.
    expect(tagsBox!.width).toBeGreaterThan(100)
    expect(calendarBox!.width).toBeGreaterThan(100)
    expect(aiBox!.width).toBeGreaterThan(100)

    // Left-to-right ordering with no overlap: tags | main | add-to-calendar | ai.
    expect(tagsBox!.x + tagsBox!.width).toBeLessThanOrEqual(calendarBox!.x + 1)
    expect(calendarBox!.x + calendarBox!.width).toBeLessThanOrEqual(aiBox!.x + 1)
    expect(aiBox!.x + aiBox!.width).toBeLessThanOrEqual(1600 + 1)

    // Every panel is still interactive while the other two are open.
    await expect(page.getByRole('button', { name: 'Download ICS' })).toBeEnabled()
    await page.getByTestId('add-to-calendar-mode-toggle').click()
    await expect(page.getByTestId('add-to-calendar-window')).toBeVisible()
    await expect(page.getByTestId('mailbox-tags-side-panel')).toBeVisible()
    expect(await panelWidth(page, 'ai-guide-side-panel')).toBeGreaterThan(100)
  })
})
