/**
 * E2E: Mailbox trash exit sequence (single email + whole thread)
 *
 * Pre-conditions:
 *  - Web dev server running (pnpm dev:web) -- the API is fully mocked here.
 *  - Either E2E_USER_EMAIL / E2E_USER_PASSWORD for a real login, or the default mocked
 *    Supabase session (needs VITE_SUPABASE_URL in apps/web/.env*, or E2E_SUPABASE_URL).
 *
 * Regression for: after a trashed row finished its exit, the filter effect re-added it as a
 * "filter-vanishing" row, so an empty slot reappeared for ~1.6s and the exit (plus the Thread
 * Viewer collapse) played a second time before the rows below snapped up.
 *
 * Every animation frame is sampled during the delete and the test asserts:
 *  - a trashed row never comes back once it has left the DOM,
 *  - its opacity never rises again once the exit started,
 *  - it never switches to the slow filter-hide transition,
 *  - the row count never grows, and the rows below only ever move up -- smoothly, with no
 *    single-frame jump close to a full row height.
 */
import { test, expect, type Page } from '@playwright/test'
import { signInMailboxTest } from './mailbox-test-auth'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173'
const TRASH_LATENCY_MS = 700
const OBSERVE_MS = 2600
const UNTRASH_LATENCY_MS = 1500

interface MockMessage {
  id: string
  account_id: string
  account: { id: string; provider: string; address: string; display_name: string; identity_group: string }
  thread_id: string
  subject: string
  from_name: string
  from_email: string
  to_emails: string
  cc_emails: null
  bcc_emails: null
  received_at: string
  preview: string
  body_text: string
  is_read: boolean
  is_archived: boolean
  is_provider_trashed: boolean
  is_provider_junk: boolean
  is_provider_sent: boolean
  has_attachments: boolean
  user_tag_ids: string[]
}

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

function buildMessages(): MockMessage[] {
  const now = Date.now()
  const messages: MockMessage[] = []
  // thread-multi holds three emails so "Trash thread" removes several rows at once.
  const layout = [
    'thread-0',
    'thread-multi',
    'thread-2',
    'thread-multi',
    'thread-4',
    'thread-multi',
    'thread-6',
    'thread-7',
    'thread-8',
    'thread-9',
  ]
  layout.forEach((threadId, i) => {
    messages.push({
      id: `msg-${i}`,
      account_id: ACCOUNT.id,
      account: {
        id: ACCOUNT.id,
        provider: ACCOUNT.provider,
        address: ACCOUNT.address,
        display_name: ACCOUNT.display_name,
        identity_group: ACCOUNT.identity_group,
      },
      thread_id: threadId,
      subject:
        threadId === 'thread-multi'
          ? 'Multi thread'
          : threadId === 'thread-9'
            ? 'RE: [EXTERNAL] Re: An unusually long subject line that would push the card wider than the inbox column'
            : `Single email ${i}`,
      from_name: `Sender ${i}`,
      from_email: `sender${i}@example.com`,
      to_emails: 'a@example.com',
      cc_emails: null,
      bcc_emails: null,
      received_at: new Date(now - i * 60_000).toISOString(),
      preview: `Preview ${i}`,
      body_text: `Body ${i}`,
      is_read: true,
      is_archived: false,
      // Trashed in an earlier session, so "Show All" still lists it with a restore button.
      is_provider_trashed: threadId === 'thread-9',
      is_provider_junk: false,
      is_provider_sent: false,
      has_attachments: false,
      user_tag_ids: [],
    })
  })
  return messages
}

async function mockApi(page: Page) {
  const messages = buildMessages()
  const trashRequests: string[] = []

  // The layout health probe hits the API root; an unmocked failure shows a banner that shifts the list.
  await page.route(/\/health(\?|$)/, (route) => route.fulfill({ json: { status: 'ok' } }))
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (path.endsWith('/api/auth/me')) {
      return route.fulfill({
        json: { user: { id: 'e2e-user', email: 'e2e@example.com', accountType: 'google', roles: [] } },
      })
    }
    if (path.endsWith('/api/mailbox/accounts') && method === 'GET') {
      return route.fulfill({ json: { accounts: [ACCOUNT] } })
    }
    if (path.endsWith('/api/mailbox/messages') && method === 'GET') {
      const limit = Number(url.searchParams.get('limit')) || 30
      await new Promise((resolve) => setTimeout(resolve, 80))
      return route.fulfill({
        json: { messages: messages.slice(0, limit), total: messages.length },
      })
    }
    const threadMatch = path.match(/\/api\/mailbox\/threads\/([^/]+)$/)
    const messageThreadMatch = path.match(/\/api\/mailbox\/messages\/([^/]+)\/thread$/)
    if ((threadMatch || messageThreadMatch) && method === 'GET') {
      const threadId = threadMatch
        ? decodeURIComponent(threadMatch[1])
        : messages.find((message) => message.id === decodeURIComponent(messageThreadMatch?.[1] ?? ''))
            ?.thread_id
      const threadMessages = messages.filter((message) => message.thread_id === threadId)
      return route.fulfill({
        json: {
          thread: { id: threadId, subject: threadMessages[0]?.subject ?? '', account_id: ACCOUNT.id },
          messages: threadMessages,
        },
      })
    }
    const trashMatch = path.match(/\/api\/mailbox\/messages\/([^/]+)\/trash$/)
    if (trashMatch && method === 'POST') {
      const id = decodeURIComponent(trashMatch[1])
      trashRequests.push(id)
      // Slow provider round-trip: background reads in this window still report the old flag.
      await new Promise((resolve) => setTimeout(resolve, TRASH_LATENCY_MS))
      const target = messages.find((message) => message.id === id)
      if (target) target.is_provider_trashed = true
      return route.fulfill({ json: { ok: true } })
    }
    const untrashMatch = path.match(/\/api\/mailbox\/messages\/([^/]+)\/untrash$/)
    if (untrashMatch && method === 'POST') {
      await new Promise((resolve) => setTimeout(resolve, UNTRASH_LATENCY_MS))
      const target = messages.find((message) => message.id === decodeURIComponent(untrashMatch[1]))
      if (target) target.is_provider_trashed = false
      return route.fulfill({ json: { ok: true } })
    }
    if (path.endsWith('/api/mailbox/preferences/tags')) return route.fulfill({ json: { tags: [] } })
    if (path.endsWith('/api/mailbox/people')) return route.fulfill({ json: { people: [] } })
    if (path.endsWith('/api/mailbox/invitations')) return route.fulfill({ json: { invitations: [] } })
    if (path.endsWith('/api/mailbox/rules')) return route.fulfill({ json: { rules: [] } })
    if (path.endsWith('/api/mailbox/drafts')) return route.fulfill({ json: { drafts: [] } })
    return route.fulfill({ json: {} })
  })

  return { trashRequests }
}

interface FrameRow {
  id: string
  top: number
  height: number
  opacity: number
  duration: string
}

/** Records every row's geometry/opacity on each animation frame for `durationMs`. */
async function startFrameRecorder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: FrameRow[][]; __recording: boolean }
    w.__frames = []
    w.__recording = true
    const tick = () => {
      if (!w.__recording) return
      const frame: FrameRow[] = []
      document.querySelectorAll<HTMLElement>('[data-testid="mailbox-message-slot"]').forEach((slot) => {
        const row = slot.querySelector<HTMLElement>('[data-testid="mailbox-message-row"]')
        if (!row) return
        const rect = slot.getBoundingClientRect()
        frame.push({
          id: slot.dataset.messageId ?? '',
          top: rect.top,
          height: rect.height,
          opacity: Number(getComputedStyle(row).opacity),
          duration: row.style.transitionDuration,
        })
      })
      w.__frames.push(frame)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function stopFrameRecorder(page: Page): Promise<FrameRow[][]> {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: FrameRow[][]; __recording: boolean }
    w.__recording = false
    return w.__frames
  })
}

function assertSmoothExit(frames: FrameRow[][], deletedIds: string[]) {
  if (process.env.E2E_DUMP_FRAMES) {
    for (const id of deletedIds) {
      const timeline = frames.map((frame, index) => {
        const row = frame.find((entry) => entry.id === id)
        return row
          ? `${index}: op=${row.opacity.toFixed(3)} h=${row.height.toFixed(1)} top=${row.top.toFixed(1)} d=${row.duration} n=${frame.length}`
          : `${index}: gone n=${frame.length}`
      })
      console.log(`--- ${id}\n${timeline.join('\n')}`)
    }
  }
  expect(frames.length).toBeGreaterThan(20)
  const deleted = new Set(deletedIds)
  const initial = frames[0]
  const rowHeight = Math.max(...initial.map((row) => row.height))

  for (const id of deletedIds) {
    let left = false
    let exitStarted = false
    let lastOpacity = 1
    for (const frame of frames) {
      const row = frame.find((entry) => entry.id === id)
      if (!row) {
        left = true
        continue
      }
      expect(left, `${id} reappeared after leaving the list`).toBe(false)
      expect(row.duration, `${id} replayed the slow filter-hide exit`).not.toBe('1600ms')
      if (row.opacity < 0.99) exitStarted = true
      if (exitStarted) {
        expect(row.opacity, `${id} faded back in during its exit`).toBeLessThanOrEqual(lastOpacity + 0.02)
      }
      lastOpacity = row.opacity
    }
    expect(left, `${id} never left the list`).toBe(true)
  }

  // Count never grows and the remaining rows only glide upward, never in one big jump.
  let previous = initial
  for (const frame of frames.slice(1)) {
    expect(frame.length).toBeLessThanOrEqual(previous.length)
    for (const row of frame) {
      if (deleted.has(row.id)) continue
      const before = previous.find((entry) => entry.id === row.id)
      if (!before) continue
      const delta = before.top - row.top
      expect(delta, `${row.id} moved down`).toBeGreaterThanOrEqual(-0.5)
      // Several slots collapsing above a row add up, so the per-frame budget scales with them.
      const startTop = initial.find((entry) => entry.id === row.id)?.top ?? row.top
      const collapsingAbove = Math.max(
        1,
        initial.filter((entry) => deleted.has(entry.id) && entry.top < startTop).length
      )
      expect(delta, `${row.id} snapped up by ${delta}px in one frame`).toBeLessThan(
        rowHeight * 0.6 * collapsingAbove
      )
    }
    previous = frame
  }

  // Final layout: survivors close the gaps completely.
  const final = frames[frames.length - 1]
  expect(final.some((row) => deleted.has(row.id))).toBe(false)
  const survivors = initial.filter((row) => !deleted.has(row.id))
  survivors.forEach((row, index) => {
    const finalRow = final.find((entry) => entry.id === row.id)
    expect(finalRow, `${row.id} disappeared`).toBeTruthy()
    expect(Math.abs((finalRow?.top ?? 0) - initial[index].top)).toBeLessThan(2)
  })
}

test.describe('Mailbox - trash exit sequence', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await mockApi(page)
    if (!(await signInMailboxTest(page))) test.skip()
    await page.goto(`${BASE}/mailbox?tab=mailbox`)
    await expect(page.getByTestId('mailbox-message-row').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('mailbox-message-row')).toHaveCount(10)
    // Let initial thread auto-open / prefetch settle so it doesn't pollute the frame samples.
    await page.waitForTimeout(800)
  })

  test('single email delete exits once and the list closes the gap smoothly', async ({ page }) => {
    const slot = page.locator('[data-message-id="msg-2"]')
    await slot.hover()
    await startFrameRecorder(page)
    await slot.getByRole('button', { name: 'Move to trash', exact: true }).click()
    await page.waitForTimeout(OBSERVE_MS)
    const frames = await stopFrameRecorder(page)

    assertSmoothExit(frames, ['msg-2'])
    await expect(page.getByTestId('mailbox-message-row')).toHaveCount(9)
  })

  test('back-to-back single deletes never resurrect an earlier row', async ({ page }) => {
    await startFrameRecorder(page)
    for (const id of ['msg-0', 'msg-4']) {
      const slot = page.locator(`[data-message-id="${id}"]`)
      await slot.hover()
      await slot.getByRole('button', { name: 'Move to trash', exact: true }).click()
      await page.waitForTimeout(450)
    }
    await page.waitForTimeout(OBSERVE_MS)
    const frames = await stopFrameRecorder(page)

    assertSmoothExit(frames, ['msg-0', 'msg-4'])
    await expect(page.getByTestId('mailbox-message-row')).toHaveCount(8)
  })

  test('multi-email thread delete removes every row in one smooth sequence', async ({ page }) => {
    await page.locator('[data-message-id="msg-1"]').getByTestId('mailbox-message-row').click()
    const trashThread = page.getByRole('button', { name: 'Move 3 emails to provider trash' })
    await expect(trashThread).toBeEnabled({ timeout: 10_000 })
    await trashThread.click()
    const confirm = page.getByRole('button', { name: 'Move to trash', exact: true }).last()

    await startFrameRecorder(page)
    await confirm.click()
    await page.waitForTimeout(OBSERVE_MS)
    const frames = await stopFrameRecorder(page)

    assertSmoothExit(frames, ['msg-1', 'msg-3', 'msg-5'])
    await expect(page.getByTestId('mailbox-message-row')).toHaveCount(7)
  })

  test('restore flips the row immediately without waiting for the provider', async ({ page }) => {
    const slot = page.locator('[data-message-id="msg-9"]')
    await slot.scrollIntoViewIfNeeded()
    await slot.hover()
    const restore = slot.getByRole('button', { name: 'Restore from provider trash', exact: true })
    await expect(restore).toBeVisible()
    await restore.click()
    // The mocked untrash takes 1.5s; the UI must not wait for it.
    await expect(restore).toHaveCount(0, { timeout: 400 })
    await expect(slot.getByRole('button', { name: 'Move to trash', exact: true })).toBeVisible({
      timeout: 400,
    })
    await page.waitForTimeout(UNTRASH_LATENCY_MS + 600)
    await expect(slot.getByRole('button', { name: 'Restore from provider trash', exact: true })).toHaveCount(0)
  })
})

test.describe('Mailbox - narrow inbox card layout', () => {
  test('action buttons stay inside every card when the inbox column is narrow', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 })
    await mockApi(page)
    if (!(await signInMailboxTest(page))) test.skip()
    await page.goto(`${BASE}/mailbox?tab=mailbox`)
    await expect(page.getByTestId('mailbox-message-row')).toHaveCount(10, { timeout: 20_000 })
    await page.waitForTimeout(800)

    const overflow = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="mailbox-message-slot"]')).flatMap((slot) => {
        const row = slot.querySelector('[data-testid="mailbox-message-row"]')
        const list = slot.parentElement
        if (!row || !list) return []
        const rowRect = row.getBoundingClientRect()
        const listRect = list.getBoundingClientRect()
        const issues: string[] = []
        if (rowRect.right > listRect.right + 1) {
          issues.push(`${slot.getAttribute('data-message-id')} card wider than list`)
        }
        for (const button of Array.from(row.querySelectorAll('button'))) {
          const rect = button.getBoundingClientRect()
          if (rect.right > rowRect.right + 1 || rect.left < rowRect.left - 1) {
            issues.push(`${slot.getAttribute('data-message-id')} ${button.getAttribute('aria-label')}`)
          }
        }
        return issues
      })
    )
    expect(overflow).toEqual([])
  })
})
