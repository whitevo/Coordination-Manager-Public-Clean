import { expect, test } from '@playwright/test'

const viewports = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 740, height: 360 },
  { width: 900, height: 900 },
  { width: 1440, height: 1000 },
]

for (const pagePath of ['/calendar/timezone-preview', '/time-management']) {
  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of viewports) {
      test(`timezone popup stays outside the header on ${pagePath} at ${viewport.width}px [${theme}]`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport)
        await page.emulateMedia({
          reducedMotion: theme === 'dark' ? 'reduce' : 'no-preference',
        })
        await page.addInitScript(() => {
          localStorage.setItem(
            'coordination-timezones',
            JSON.stringify({
              primary: 'UTC',
              additional: [],
            })
          )
        })
        await page.route('**/api/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname
          if (pathname === '/api/calendars/timezone-preview') {
            await route.fulfill({
              json: {
                title: 'Timezone popup preview',
                created_by: 'owner@example.com',
                config: { timeInterval: 60, startHour: 9, endHour: 17 },
              },
            })
          } else if (pathname === '/api/calendar-sources') {
            await route.fulfill({ json: { sources: [] } })
          } else if (pathname === '/api/user-events') {
            await route.fulfill({ json: { events: [] } })
          } else {
            await route.fulfill({
              json:
                pathname.startsWith('/api/availability/') || pathname.startsWith('/api/meetings/')
                  ? []
                  : {},
            })
          }
        })
        await page.goto(pagePath)
        await page.evaluate((mode) => {
          document.documentElement.classList.toggle('dark', mode === 'dark')
        }, theme)

        const trigger = page.locator(
          'button[aria-haspopup="dialog"][aria-label="Timezone: UTC"], button[aria-haspopup="dialog"][aria-label="Change timezone"]'
        )
        await expect(trigger).toBeVisible()
        const triggerContainer = trigger.locator('..')
        const before = await triggerContainer.boundingBox()
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: 'Timezone settings', exact: true })
        await expect(dialog).toBeVisible()
        const after = await triggerContainer.boundingBox()
        expect(after?.height).toBe(before?.height)
        expect(await triggerContainer.getByText('Primary', { exact: true }).count()).toBe(0)

        const expectFits = async () => {
          const panel = page.getByRole('dialog')
          const box = await panel.boundingBox()
          expect(box).not.toBeNull()
          expect(box!.x).toBeGreaterThanOrEqual(0)
          expect(box!.y).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
          expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
          expect(
            await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)
          ).toBe(true)
        }
        await expectFits()
        await dialog.getByRole('button', { name: /Add Timezone/ }).click()
        const searchDialog = page.getByRole('dialog', { name: 'Add Timezone', exact: true })
        await expect(searchDialog).toBeVisible()
        await expect(page.getByRole('dialog')).toHaveCount(1)
        const search = searchDialog.getByRole('textbox', { name: 'Search timezones' })
        await expect(search).toBeFocused()
        await search.fill('Tallinn')
        await expectFits()
        const result = searchDialog.getByRole('button', { name: /Tallinn/ })
        await result.focus()
        await result.press('Enter')
        await expect(dialog).toBeVisible()
        await expect(dialog.getByRole('button', { name: /Tallinn/ })).toBeVisible()
        await dialog.getByRole('button', { name: /Add Timezone/ }).click()
        await page.getByRole('button', { name: 'Back to timezone settings' }).click()
        await expect(dialog.getByRole('button', { name: /Add Timezone/ })).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(trigger).toBeFocused()
      })
    }
  }
}
