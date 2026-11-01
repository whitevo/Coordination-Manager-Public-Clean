import { expect, test } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173'

test.describe('Quick Menu navigation', () => {
  test('persists a pinned Distribute Templates shortcut and routes to its tab', async ({ page }) => {
    const email = process.env.E2E_USER_EMAIL
    const password = process.env.E2E_USER_PASSWORD
    if (!email || !password) test.skip()

    await page.goto(`${BASE}/auth/login`)
    await page.getByPlaceholder(/email/i).fill(email)
    await page.getByPlaceholder(/password/i).fill(password)
    await page.getByRole('button', { name: /sign in|log in/i }).click()
    await page.waitForURL(/\/dashboard|\/mailbox|\/calendar/i, { timeout: 15_000 })

    await page.goto(`${BASE}/calendars`)
    const toolsButton = page.getByRole('button', { name: 'Tools' })
    await toolsButton.hover()
    await page.getByText('Distribute Messages', { exact: true }).hover()

    const pinButton = page.getByRole('button', { name: 'Add Distribute Templates quick button' })
    await expect(pinButton).toBeVisible()
    await pinButton.click()

    const quickLink = page.getByRole('link', { name: 'Distribute Templates' })
    await expect(quickLink).toHaveAttribute('href', '/distribute?tab=templates')

    await page.reload()
    await expect(page.getByRole('link', { name: 'Distribute Templates' })).toHaveAttribute('href', '/distribute?tab=templates')

    await page.getByRole('link', { name: 'Distribute Templates' }).click()
    await page.waitForURL(/\/distribute\?tab=templates/)
    await expect(page.getByRole('button', { name: 'Templates' })).toBeVisible()
  })
})