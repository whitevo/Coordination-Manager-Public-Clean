/**
 * E2E: Time Management -- "Close Left Panel on Save" setting
 *
 * Pre-conditions:
 *  - Dev stack running (pnpm dev:stack from repo root)
 *  - E2E_USER_EMAIL and E2E_USER_PASSWORD set in env (test account)
 *
 * All Time Management API calls are intercepted so the page renders
 * deterministically regardless of the test account's real data.
 *
 * Covers:
 *  1. Defaults: master toggle active, only "Calendar Grid" closes the left
 *     panel on save; "Left Sidebar" and "Full View" are inactive.
 *  2. Saving from the Calendar Grid closes the left panel by default.
 *  3. Saving from the Left Sidebar does NOT close the panel by default, but
 *     does once the "Left Sidebar" surface toggle is enabled.
 *  4. Saving from Full View does NOT close the panel by default, but does
 *     once the "Full View" surface toggle is enabled.
 *  5. Turning the master "Close Left Panel on Save" toggle off disables all
 *     per-surface buttons and no surface closes the panel on save.
 *  6. Applying an autosave-enabled Quick Object against an existing selection
 *     closes the left panel (Calendar Grid behavior), matching the default.
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173'
const STORAGE_KEY = 'time-management-v1'

const AUTOSAVE_QUICK_TEMPLATE = {
  id: 'qt-e2e-standup',
  quickName: 'Standup',
  title: 'Standup',
  notes: '',
  categoryIds: [],
  autoSaveEnabled: true,
  sourceItemId: '',
  createdAt: new Date().toISOString(),
}

function basePreferences(overrides: Record<string, unknown> = {}) {
  return {
    syncCalendars: [],
    slotMinutes: 30,
    timeBackgrounds: [],
    collapsedBackgroundIds: [],
    quickTemplates: [],
    showQuickTemplatesInMain: false,
    quickTemplatesMainExpanded: false,
    isLeftPanelOpen: false,
    leftPanelWidthPx: 320,
    expandedSections: [],
    showActiveSourcesWhenCollapsed: false,
    ...overrides,
  }
}

async function seedPreferences(page: Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([key, prefs]) => {
      window.localStorage.setItem(key as string, JSON.stringify(prefs))
    },
    [STORAGE_KEY, basePreferences(overrides)] as const
  )
}

let nextEventId = 1

async function mockApi(page: Page) {
  // Registered first so more specific routes added below take priority.
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }))

  await page.route('**/api/time-management/modes**', (route) =>
    route.fulfill({ json: { modes: [], activeModeId: undefined } })
  )
  await page.route('**/api/time-management/categories**', (route) =>
    route.fulfill({ json: { categories: [] } })
  )
  await page.route('**/api/time-management/prefs**', (route) =>
    route.fulfill({ json: { prefs: {} } })
  )
  await page.route('**/api/calendar-sources**', (route) =>
    route.fulfill({ json: { sources: [] } })
  )
  await page.route('**/api/user-events**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      return route.fulfill({ json: { events: [] } })
    }
    if (request.method() === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>
      const id = `evt-e2e-${nextEventId++}`
      return route.fulfill({ json: { event: { id, ...payload } } })
    }
    if (request.method() === 'PUT') {
      const payload = request.postDataJSON() as Record<string, unknown>
      return route.fulfill({ json: { event: { id: 'evt-e2e-updated', ...payload } } })
    }
    return route.fulfill({ json: {} })
  })
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

async function openTimeManagement(page: Page) {
  await page.goto(`${BASE}/time-management`)
  await expect(page.getByTestId('calendar-scroll-container')).toBeVisible({ timeout: 15_000 })
}

async function leftPanelIsOpen(page: Page): Promise<boolean> {
  const value = await page.getByTestId('time-management-left-panel').getAttribute('data-open')
  return value === 'true'
}

/** Clicks the first weekday column to create a minimal (one-slot) selection. */
async function selectTimeOnGrid(page: Page) {
  const column = page.getByTestId('calendar-day-column-0')
  await column.click({ position: { x: 10, y: 40 } })
}

async function openModeSettings(page: Page) {
  const panel = page.getByTestId('time-management-left-panel')
  const modesHeader = panel.getByText('Calendar Modes')
  if (!(await panel.getByTestId('close-left-panel-on-save-settings').isVisible().catch(() => false))) {
    await modesHeader.click()
  }
  const settingsToggle = panel.getByRole('button', { name: 'Settings' })
  if (!(await panel.getByTestId('close-left-panel-on-save-settings').isVisible().catch(() => false))) {
    await settingsToggle.click()
  }
  await expect(panel.getByTestId('close-left-panel-on-save-settings')).toBeVisible()
}

test.describe('Time Management - Close Left Panel on Save', () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD) test.skip()
    await page.setViewportSize({ width: 1600, height: 900 })
    await mockApi(page)
  })

  test('defaults: master toggle active, only Calendar Grid closes the panel on save', async ({ page }) => {
    await seedPreferences(page)
    await login(page)
    await openTimeManagement(page)
    await selectTimeOnGrid(page)
    await openModeSettings(page)

    await expect(page.getByTestId('close-left-panel-on-save-toggle')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('close-left-panel-on-save-surface-calendarGrid')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('close-left-panel-on-save-surface-leftSidebar')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('close-left-panel-on-save-surface-fullView')).toHaveAttribute('aria-pressed', 'false')
  })

  test('saving from the Calendar Grid closes the left panel by default', async ({ page }) => {
    await seedPreferences(page)
    await login(page)
    await openTimeManagement(page)

    await selectTimeOnGrid(page)
    expect(await leftPanelIsOpen(page)).toBe(true)

    await page.getByPlaceholder('Type Title for Time Item').fill('Grid save item')
    await page.getByTestId('calendar-grid-save-button').click()

    await expect
      .poll(async () => leftPanelIsOpen(page))
      .toBe(false)
  })

  test('saving from the Left Sidebar does not close the panel by default, but does once enabled', async ({ page }) => {
    await seedPreferences(page)
    await login(page)
    await openTimeManagement(page)

    // First save with the default (leftSidebar surface inactive): panel stays open.
    await selectTimeOnGrid(page)
    await page.getByPlaceholder('Type Title for Time Item').fill('Sidebar save item 1')
    await page.getByTestId('left-sidebar-save-button').click()
    await page.waitForTimeout(300)
    expect(await leftPanelIsOpen(page)).toBe(true)

    // Enable the Left Sidebar surface toggle.
    await openModeSettings(page)
    await page.getByTestId('close-left-panel-on-save-surface-leftSidebar').click()
    await expect(page.getByTestId('close-left-panel-on-save-surface-leftSidebar')).toHaveAttribute('aria-pressed', 'true')

    // Second save now closes the panel.
    await selectTimeOnGrid(page)
    await page.getByPlaceholder('Type Title for Time Item').fill('Sidebar save item 2')
    await page.getByTestId('left-sidebar-save-button').click()

    await expect
      .poll(async () => leftPanelIsOpen(page))
      .toBe(false)
  })

  test('saving from Full View does not close the panel by default, but does once enabled', async ({ page }) => {
    await seedPreferences(page)
    await login(page)
    await openTimeManagement(page)

    await selectTimeOnGrid(page)
    await page.getByPlaceholder('Type Title for Time Item').fill('Full view item 1')
    await page.getByTestId('calendar-grid-open-full-view').click()
    await page.getByTestId('full-editor-save-button').click()
    await page.waitForTimeout(300)
    expect(await leftPanelIsOpen(page)).toBe(true)

    await openModeSettings(page)
    await page.getByTestId('close-left-panel-on-save-surface-fullView').click()
    await expect(page.getByTestId('close-left-panel-on-save-surface-fullView')).toHaveAttribute('aria-pressed', 'true')

    await selectTimeOnGrid(page)
    await page.getByPlaceholder('Type Title for Time Item').fill('Full view item 2')
    await page.getByTestId('calendar-grid-open-full-view').click()
    await page.getByTestId('full-editor-save-button').click()

    await expect
      .poll(async () => leftPanelIsOpen(page))
      .toBe(false)
  })

  test('disabling the master toggle disables all surface buttons and none close the panel', async ({ page }) => {
    await seedPreferences(page)
    await login(page)
    await openTimeManagement(page)

    await selectTimeOnGrid(page)
    await openModeSettings(page)
    await page.getByTestId('close-left-panel-on-save-toggle').click()
    await expect(page.getByTestId('close-left-panel-on-save-toggle')).toHaveAttribute('aria-pressed', 'false')

    for (const surface of ['calendarGrid', 'leftSidebar', 'fullView']) {
      await expect(page.getByTestId(`close-left-panel-on-save-surface-${surface}`)).toBeDisabled()
    }

    await page.getByPlaceholder('Type Title for Time Item').fill('No close item')
    await page.getByTestId('calendar-grid-save-button').click()
    await page.waitForTimeout(300)
    expect(await leftPanelIsOpen(page)).toBe(true)
  })

  test('applying an autosave Quick Object against an existing selection closes the left panel', async ({ page }) => {
    await seedPreferences(page, {
      quickTemplates: [AUTOSAVE_QUICK_TEMPLATE],
      showQuickTemplatesInMain: true,
      quickTemplatesMainExpanded: true,
    })
    await login(page)
    await openTimeManagement(page)

    await selectTimeOnGrid(page)
    expect(await leftPanelIsOpen(page)).toBe(true)

    await page.getByTestId(`quick-template-apply-${AUTOSAVE_QUICK_TEMPLATE.id}`).click()

    await expect
      .poll(async () => leftPanelIsOpen(page))
      .toBe(false)
  })
})
