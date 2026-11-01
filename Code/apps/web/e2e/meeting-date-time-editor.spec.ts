import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark'] as const) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`meeting date/time selection and interaction traces [${theme}, ${reducedMotion}]`, async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-10-28T08:00:00Z'))
      await page.emulateMedia({ reducedMotion })
      await page.route('**/api/**', async route => {
        const pathname = new URL(route.request().url()).pathname
        await route.fulfill({
          json: pathname === '/api/calendars/editor-test'
            ? {
              id: 'editor-test',
              hash: 'editor-test',
              title: 'Meeting editor test',
              created_by: 'owner@example.com',
              is_owner: true,
              has_edit_permission: true,
              config: {
                hideDateNumbers: false,
                customStartDate: '2026-10-26',
                customEndDate: '2026-11-01',
                timeInterval: 30,
                startHour: 9,
                endHour: 17,
              },
            }
            : pathname.startsWith('/api/availability/') || pathname.startsWith('/api/meetings/')
              ? []
              : {},
        })
      })
      await page.goto('/calendar/editor-test')
      const cell = page.locator('[data-cell-id="2026-10-28_10:00"]')
      await expect(cell).toBeVisible()
      await page.locator('main').getByRole('button', { name: 'Tools', exact: true }).click()
      await page.getByRole('button', { name: 'Create Meeting', exact: true }).click()
      await cell.click()
      await page.getByRole('button', { name: 'Edit date and time manually' }).click()
      await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), theme)

      const time = page.getByLabel('Time (UTC)', { exact: true })
      const trigger = page.getByRole('button', { name: 'Open time picker' })
      const apply = page.getByRole('button', { name: 'Apply', exact: true })
      await expect(apply).toBeDisabled()

      for (const [selection, value] of [
        ['Select hour 11', '11:00'],
        ['Select minute 30', '11:30'],
        ['Select minute 30', '11:30'],
      ]) {
        await trigger.click()
        await page.getByRole('button', { name: selection, exact: true }).click()
        await expect(page.getByRole('group', { name: 'Choose time (UTC)' })).toHaveCount(0)
        await expect(time).toHaveValue(value)
        await expect(trigger).toBeFocused()
        await expect(apply).toBeVisible()
        await expect(apply).toBeEnabled()
      }
      await time.fill('10:00')
      await expect(apply).toBeDisabled()
      await time.fill('12:30')
      await expect(time).toBeFocused()
      await expect(apply).toBeEnabled()

      for (const control of [
        page.getByLabel('Date', { exact: true }),
        time,
        page.getByRole('button', { name: 'Open date picker' }),
        trigger,
      ]) {
        await apply.focus()
        await control.hover()
        const pair = control.locator('../..')
        const traces = pair.locator('.switch-card-trace')
        await expect(traces).toHaveCount(2)
        for (const trace of await traces.all()) {
          await expect.poll(() => trace.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('1')
          await expect.poll(() => trace.evaluate(element => getComputedStyle(element, '::before').animationName))
            .toBe(reducedMotion === 'reduce' ? 'none' : 'switch-card-trace-spin')
        }
        const otherPair = page.locator('.meeting-editor-pair').filter({ hasNot: control })
        for (const trace of await otherPair.locator('.switch-card-trace').all()) {
          await expect.poll(() => trace.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('0')
        }
        await control.focus()
        await apply.hover()
        for (const trace of await traces.all()) {
          await expect.poll(() => trace.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('1')
        }
      }

      await apply.click()
      await expect(time).toHaveCount(0)
      await page.getByRole('button', { name: 'Edit date and time manually' }).click()
      await expect(time).toHaveValue('12:30')
      await expect(apply).toBeDisabled()
    })
  }
}
