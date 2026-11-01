/**
 * E2E: Mailbox tab navigation animation
 *
 * Pre-conditions:
 *  - Dev stack running (pnpm dev:stack from repo root)
 *  - E2E_USER_EMAIL and E2E_USER_PASSWORD set in env (test account)
 *
 * All /api/mailbox/** calls are stubbed so the page renders instantly and the animation
 * timing is not affected by real data loading.
 *
 * Covers:
 *  1. The thread wave travels between main tabs for several navigation combinations.
 *  2. The randomised threads fan out while travelling, differ in brightness and converge
 *     ghostly on the destination tab.
 *  3. The newly selected tab fades its active background in across the 2s sequence while the
 *     tab being left fades out much faster.
 *  4. Settings sub-tabs animate with the same effect.
 *  5. A quick link inside the Mailbox tab (Go to Automations) drives the same travel
 *     animation on the main tab bar and lands the sub-tab bar on Automations.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173'
const SEQUENCE_MS = 2000
const FADE_OUT_MS = 600
const SAMPLE_MS = 2600

interface AnimationSample {
  t: number
  left: number
  traveling: string | null
  opacity: number | null
  leavingOpacity: number | null
  threadCount: number
  threadSpread: number
  threadOpacities: number[]
}

declare global {
  interface Window {
    __tabAnimationSamples?: AnimationSample[]
  }
}

async function stubMailboxApi(page: Page) {
  await page.route('**/api/mailbox/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/api/mailbox/accounts')) return route.fulfill({ json: { accounts: [] } })
    if (path.endsWith('/api/mailbox/messages')) return route.fulfill({ json: { messages: [], total: 0 } })
    if (path.endsWith('/api/mailbox/preferences/tags')) return route.fulfill({ json: { tags: [] } })
    if (path.endsWith('/api/mailbox/people')) return route.fulfill({ json: { people: [] } })
    if (path.endsWith('/api/mailbox/invitations')) return route.fulfill({ json: { invitations: [] } })
    if (path.endsWith('/api/mailbox/rules')) return route.fulfill({ json: { rules: [] } })
    return route.fulfill({ json: {} })
  })
}

/**
 * Installs a per-frame recorder before the navigation is triggered; sampling has to be
 * running already when the click happens, otherwise the first frames of the 2s effect
 * are missed.
 */
async function startSampling(page: Page, testId: string, durationMs = SAMPLE_MS + 1000) {
  await page.evaluate(
    ({ testId, durationMs }) => {
      window.__tabAnimationSamples = []
      const start = performance.now()
      const loop = () => {
        const indicator = document.querySelector(`[data-testid="${testId}-indicator"]`)
        const background = document.querySelector(`[data-testid="${testId}-active-bg"]`)
        const leaving = document.querySelector(`[data-testid="${testId}-leaving-bg"]`)
        const elapsed = performance.now() - start
        if (indicator) {
          const threads = Array.from(indicator.querySelectorAll('.tab-thread'))
          const threadLefts = threads.map((thread) => thread.getBoundingClientRect().left)
          window.__tabAnimationSamples?.push({
            t: elapsed,
            left: indicator.getBoundingClientRect().left,
            traveling: indicator.getAttribute('data-traveling'),
            opacity: background ? Number(getComputedStyle(background).opacity) : null,
            leavingOpacity: leaving ? Number(getComputedStyle(leaving).opacity) : null,
            threadCount: threads.length,
            threadSpread: threadLefts.length ? Math.max(...threadLefts) - Math.min(...threadLefts) : 0,
            threadOpacities: threads.map((thread) => Number(getComputedStyle(thread).opacity)),
          })
        }
        if (elapsed < durationMs) requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    },
    { testId, durationMs }
  )
}

async function collectSamples(page: Page): Promise<AnimationSample[]> {
  await page.waitForTimeout(SAMPLE_MS)
  const samples = await page.evaluate(() => window.__tabAnimationSamples ?? [])
  expect(samples.length, 'sampler should have recorded frames').toBeGreaterThan(10)
  return samples
}

function assertTravelled(samples: AnimationSample[], targetLeft: number) {
  const distinctPositions = new Set(samples.map((sample) => Math.round(sample.left)))
  expect(distinctPositions.size, 'wave should move through intermediate positions').toBeGreaterThan(4)

  expect(samples.some((sample) => sample.traveling === 'true'), 'wave should report travelling').toBe(true)
  expect(samples[samples.length - 1].traveling, 'travel should end within the 2s sequence').toBe('false')

  const settled = samples.filter((sample) => sample.t >= SEQUENCE_MS)
  expect(settled.length).toBeGreaterThan(0)
  const finalLeft = settled[settled.length - 1].left
  expect(Math.abs(finalLeft - samples[0].left), 'wave should end on a different tab').toBeGreaterThan(2)
  expect(Math.abs(finalLeft - targetLeft), 'wave should land on the selected tab').toBeLessThanOrEqual(2)
}

function assertThreadsWaved(samples: AnimationSample[]) {
  const travelling = samples.filter((sample) => sample.traveling === 'true')
  expect(travelling.length).toBeGreaterThan(0)
  expect(Math.max(...travelling.map((sample) => sample.threadSpread)), 'threads should trail apart mid-flight').toBeGreaterThan(10)

  const counts = new Set(travelling.map((sample) => sample.threadCount))
  for (const count of counts) {
    expect(count, 'randomised thread count stays within the designed range').toBeGreaterThanOrEqual(4)
    expect(count).toBeLessThanOrEqual(7)
  }

  // Leading threads burn bright while the trailing ones stay ghostly.
  const brightnessSpread = Math.max(
    ...travelling
      .filter((sample) => sample.threadOpacities.length > 1)
      .map((sample) => Math.max(...sample.threadOpacities) - Math.min(...sample.threadOpacities))
  )
  expect(brightnessSpread, 'threads should differ in brightness').toBeGreaterThan(0.15)

  const settled = samples.filter((sample) => sample.t >= SEQUENCE_MS)
  expect(settled[settled.length - 1].threadSpread, 'threads should converge on arrival').toBeLessThanOrEqual(2)
  expect(Math.max(...settled[settled.length - 1].threadOpacities), 'threads rest ghostly').toBeLessThan(0.6)
}

function assertBackgroundFadedOut(samples: AnimationSample[]) {
  const visible = samples.filter((sample) => (sample.leavingOpacity ?? 0) > 0.5)
  expect(visible.length, 'the tab being left should still be painted at first').toBeGreaterThan(0)

  const stillFading = samples.filter((sample) => sample.t > FADE_OUT_MS + 300 && (sample.leavingOpacity ?? 0) > 0.1)
  expect(stillFading.length, 'fade-out must finish well before the fade-in does').toBe(0)
}

function assertBackgroundFadedIn(samples: AnimationSample[]) {
  const early = samples.filter((sample) => sample.t > 50 && sample.t < 500 && sample.opacity !== null)
  const late = samples.filter((sample) => sample.t >= SEQUENCE_MS && sample.opacity !== null)
  expect(early.length).toBeGreaterThan(0)
  expect(late.length).toBeGreaterThan(0)
  expect(Math.min(...early.map((sample) => sample.opacity ?? 1)), 'background starts transparent').toBeLessThan(0.5)
  expect(late[late.length - 1].opacity ?? 0, 'background settles fully opaque').toBeGreaterThan(0.95)
}

async function tabLeft(page: Page, testId: string, tabId: string): Promise<number> {
  const box = await page.locator(`[data-testid="${testId}"] [data-tab-id="${tabId}"]`).boundingBox()
  if (!box) throw new Error(`Tab ${tabId} is not visible`)
  return box.x
}

test.describe('Mailbox - tab navigation animation', () => {
  // Every case waits out two full 2s animation sequences on top of the login flow.
  test.describe.configure({ timeout: 60_000 })

  test.beforeEach(async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL
    const password = process.env.E2E_USER_PASSWORD
    if (!email || !password) test.skip()

    await stubMailboxApi(page)

    await page.goto(`${BASE}/auth/login`)
    await page.getByPlaceholder(/email/i).fill(email!)
    await page.getByPlaceholder(/password/i).fill(password!)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    await page.waitForURL(/\/dashboard|\/mailbox|\/calendar/i, { timeout: 15_000 })
  })

  const combinations: Array<{ from: string; to: string; label: string }> = [
    { from: 'mailbox', to: 'settings', label: 'Settings' },
    { from: 'settings', to: 'people', label: 'People and Domains' },
    { from: 'people', to: 'invitations', label: 'Invitations' },
    { from: 'invitations', to: 'mailbox', label: 'Mailbox' },
  ]

  for (const combination of combinations) {
    test(`animates the highlight from ${combination.from} to ${combination.to}`, async ({ page }) => {
      await page.goto(`${BASE}/mailbox?tab=${combination.from}`)
      await expect(page.getByTestId('mailbox-main-tabs')).toBeVisible({ timeout: 15_000 })
      // Let the arrival animation settle so the case starts from a stable state.
      await page.waitForTimeout(SEQUENCE_MS)

      await startSampling(page, 'mailbox-main-tabs')
      await page.getByRole('tab', { name: combination.label, exact: true }).click()
      const samples = await collectSamples(page)

      // Measured after the switch: leaving the Mailbox tab removes the Learner Guide button,
      // which reflows the tab bar.
      const targetLeft = await tabLeft(page, 'mailbox-main-tabs', combination.to)
      assertTravelled(samples, targetLeft)
      assertThreadsWaved(samples)
      assertBackgroundFadedIn(samples)
      assertBackgroundFadedOut(samples)

      await expect(page.locator(`[data-testid="mailbox-main-tabs"] [data-tab-id="${combination.to}"]`)).toHaveAttribute('data-active', 'true')
    })
  }

  test('animates settings sub-tab navigation', async ({ page }) => {
    await page.goto(`${BASE}/mailbox?tab=settings&settings=accounts`)
    await expect(page.getByTestId('mailbox-settings-tabs')).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(SEQUENCE_MS)

    const targetLeft = await tabLeft(page, 'mailbox-settings-tabs', 'ai')

    await startSampling(page, 'mailbox-settings-tabs')
    await page.getByRole('tab', { name: 'AI Assistant', exact: true }).click()
    const samples = await collectSamples(page)

    assertTravelled(samples, targetLeft)
    assertThreadsWaved(samples)
    assertBackgroundFadedIn(samples)
    assertBackgroundFadedOut(samples)
  })

  test('quick link from the Mailbox tab drives the same travel effect', async ({ page }) => {
    await page.goto(`${BASE}/mailbox?tab=mailbox`)
    await expect(page.getByTestId('mailbox-main-tabs')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /Learner Guide/i }).click()

    const quickLink = page.getByRole('button', { name: /Go to Automations/i })
    await quickLink.scrollIntoViewIfNeeded()
    await page.waitForTimeout(SEQUENCE_MS)

    await startSampling(page, 'mailbox-main-tabs')
    await quickLink.click()
    const samples = await collectSamples(page)

    const targetLeft = await tabLeft(page, 'mailbox-main-tabs', 'settings')
    assertTravelled(samples, targetLeft)
    assertThreadsWaved(samples)
    assertBackgroundFadedIn(samples)

    // The sub-tab bar arrives with its own entry animation and lands on Automations.
    await expect(page.getByTestId('mailbox-settings-tabs')).toBeVisible()
    await expect(page.locator('[data-testid="mailbox-settings-tabs"] [data-tab-id="automations"]')).toHaveAttribute('data-active', 'true')
    await expect(page.getByTestId('mailbox-settings-tabs-indicator')).toBeVisible()
  })
})
