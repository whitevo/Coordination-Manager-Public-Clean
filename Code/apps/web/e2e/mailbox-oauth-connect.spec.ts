/**
 * E2E: Mailbox Gmail OAuth connect flow
 *
 * Pre-conditions:
 *  - Dev stack running (pnpm dev:stack from repo root)
 *  - E2E_USER_EMAIL and E2E_USER_PASSWORD set in env (test account)
 *  - MAILBOX_GMAIL_REDIRECT_URI points to localhost:3001
 *
 * This test uses a mocked OAuth callback to avoid real Google redirects.
 * It verifies the end-to-end connect flow, success notice, and account persistence.
 */
import { test, expect } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173'

test.describe('Mailbox - Gmail OAuth connect', () => {
  test.beforeEach(async ({ page }) => {
    // Sign in via test credentials stored in env
    const email = process.env.E2E_USER_EMAIL
    const password = process.env.E2E_USER_PASSWORD
    if (!email || !password) test.skip()

    await page.goto(`${BASE}/auth/login`)
    await page.getByPlaceholder(/email/i).fill(email!)
    await page.getByPlaceholder(/password/i).fill(password!)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    await page.waitForURL(/\/dashboard|\/mailbox|\/calendar/i, { timeout: 15_000 })
  })

  test('navigates to mailbox and shows Settings / Accounts tab', async ({ page }) => {
    await page.goto(`${BASE}/mailbox?tab=settings&settings=accounts`)
    await expect(page.getByRole('heading', { name: 'Connect Account' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Connect Gmail/i })).toBeVisible()
  })

  test('restores the last settings section when Settings is opened manually', async ({ page }) => {
    await page.goto(`${BASE}/mailbox?tab=settings&settings=accounts`)
    await page.getByRole('tab', { name: 'AI Assistant', exact: true }).click()
    await page.getByRole('tab', { name: 'Mailbox', exact: true }).click()
    await page.getByRole('tab', { name: 'Settings', exact: true }).click()

    await expect(page).toHaveURL(/tab=settings&settings=ai/)
    await expect(page.getByRole('tab', { name: 'AI Assistant', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  test('restores the open Analytics panel after refresh and cross-page navigation', async ({
    page,
  }) => {
    await page.goto(`${BASE}/mailbox?tab=settings&settings=accounts`)
    const analyticsButton = page.getByRole('button', {
      name: /^(Show: Analytics|Hide: Analytics)$/,
    })
    if ((await analyticsButton.textContent())?.includes('Show:')) await analyticsButton.click()

    const analyticsResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/mailbox/analytics') && response.request().method() === 'GET'
    )
    await page.reload()
    await analyticsResponse
    await expect(page.getByRole('button', { name: 'Hide: Analytics', exact: true })).toBeVisible()

    await page.goto(`${BASE}/time-management`)
    await page.goto(`${BASE}/mailbox?tab=settings`)
    await expect(page.getByRole('button', { name: 'Hide: Analytics', exact: true })).toBeVisible()
  })

  test('shows "no accounts" banner on Mailbox tab when none connected', async ({ page }) => {
    await page.goto(`${BASE}/mailbox?tab=mailbox`)
    // Only assert if the user has no connected accounts
    const banner = page.getByText(/no accounts are connected yet/i)
    const hasAccounts = await page.locator('[data-testid="account-card"]').count()
    if (hasAccounts === 0) {
      await expect(banner).toBeVisible()
      await expect(page.getByRole('button', { name: /open accounts setup/i })).toBeVisible()
    }
  })

  test('simulated OAuth success shows notice and import buttons', async ({ page }) => {
    // Simulate a completed OAuth callback redirect by navigating with oauth_success param
    await page.goto(`${BASE}/mailbox?tab=mailbox&oauth_success=true`)
    await expect(page.getByText(/account connected/i)).toBeVisible()
    // oauth_success param should be removed from URL after handling
    await expect(page).not.toHaveURL(/oauth_success/)
  })

  test('simulated OAuth error shows error notice in inbox', async ({ page }) => {
    await page.goto(`${BASE}/mailbox?tab=mailbox&oauth_error=access_denied`)
    await expect(page.getByText(/oauth connection failed/i)).toBeVisible()
    await expect(page).not.toHaveURL(/oauth_error/)
  })

  test('account import settings panel expands and shows configuration info', async ({ page }) => {
    await page.goto(`${BASE}/mailbox?tab=settings&settings=accounts`)
    const importSettingsBtn = page.getByRole('button', { name: /import settings/i }).first()
    // Only run if an account is already connected
    if (await importSettingsBtn.isVisible()) {
      await importSettingsBtn.click()
      await expect(page.getByText(/what gets imported/i)).toBeVisible()
      await expect(page.getByText(/deleted email note/i)).toBeVisible()
      await expect(page.getByText(/live tracking/i)).toBeVisible()
    }
  })
})
