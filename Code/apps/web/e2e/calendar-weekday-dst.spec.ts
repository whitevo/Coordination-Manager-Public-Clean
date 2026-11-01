import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark'] as const) {
  test(`Any Week timezone transitions survive mode switching and reload [${theme}]`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'))
    await page.addInitScript(() => {
      localStorage.setItem('coordination-timezones', JSON.stringify({
        primary: 'UTC',
        additional: ['Europe/Tallinn', 'America/New_York'],
      }))
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/**', async route => {
      expect(route.request().method()).toBe('GET')
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/api/calendars/dst-preview') {
        await route.fulfill({ json: {
          title: 'Timezone transition preview',
          created_by: 'owner@example.com',
          is_owner: true,
          has_edit_permission: true,
          config: {
            hideDateNumbers: true,
            customStartDate: '2026-06-08',
            customEndDate: '2026-06-14',
            timeInterval: 60,
            startHour: 9,
            endHour: 17,
          },
        } })
      } else {
        await route.fulfill({ json: pathname.startsWith('/api/availability/')
          || pathname.startsWith('/api/meetings/') ? [] : {} })
      }
    })
    await page.goto('/calendar/dst-preview')

    const expectTransitions = async () => {
      await expect(page.getByText('25 Oct 2026', { exact: true })).toBeVisible()
      await expect(page.getByText('1 Nov 2026', { exact: true })).toBeVisible()
      await expect(page.getByText('This week', { exact: true })).toBeVisible()
      await expect(page.getByText('Next week', { exact: true })).toBeVisible()
      await expect(page.getByText('+3 to +2', { exact: true })).toBeVisible()
      await expect(page.getByText('-4 to -5', { exact: true })).toBeVisible()
    }
    await expectTransitions()

    await page.getByRole('button', { name: 'Edit Calendar', exact: true }).click()
    await page.getByRole('button', { name: 'Dates', exact: true }).click()
    await page.getByRole('button', { name: 'Any Week', exact: true }).click()
    await expectTransitions()
    await page.reload()
    await expectTransitions()

    // Signed-out sessions reset appearance; isolate the header's light/dark token rendering.
    await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), theme)
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/)
    const header = page.getByText('25 Oct 2026', { exact: true }).locator('../..')
    await testInfo.attach(`weekday-dst-${theme}.png`, {
      body: await header.screenshot(),
      contentType: 'image/png',
    })
    await testInfo.attach(`weekday-dst-${theme}.aria.yml`, {
      body: await header.ariaSnapshot(),
      contentType: 'text/yaml',
    })
  })
}
