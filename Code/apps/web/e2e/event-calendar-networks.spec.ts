import { expect, test } from '@playwright/test'

const sourceA = `source_${'a'.repeat(64)}`
const sourceB = `source_${'b'.repeat(64)}`
const sourceSameName = `source_${'c'.repeat(64)}`

for (const mode of ['desktop-light', 'phone-dark'] as const) {
  test(`joined source links and corrected meeting-title mapping use the destination filter [${mode}]`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-12T12:00:00Z'))
    if (mode === 'phone-dark') await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(() => {
      localStorage.setItem('coordination-timezones', JSON.stringify({ primary: 'UTC', additional: [] }))
    })
    await page.route('**/api/**', async route => {
      expect(route.request().method()).toBe('GET')
      const pathname = new URL(route.request().url()).pathname
      const base = { start_time: '2026-06-11T14:00:00Z', end_time: '2026-06-11T15:00:00Z', is_public: true }
      const responses: Record<string, unknown> = {
        '/api/user-events/public': { events: [
          { ...base, id: 'metta-1', title: 'MeTTa Coders', calendar_title: 'SingularityNET', network_source_key: sourceSameName },
          { ...base, id: 'metta-duplicate', title: 'MeTTa Coders', calendar_title: 'Original A', network_source_key: sourceA },
          { ...base, id: 'origin-1', title: 'Original source meeting', calendar_title: 'Original A', network_source_key: sourceA,
            start_time: '2026-06-11T16:00:00Z', end_time: '2026-06-11T17:00:00Z' },
          { ...base, id: 'source-only', title: 'Same-name source meeting', calendar_title: 'SingularityNET', network_source_key: sourceSameName,
            start_time: '2026-06-11T17:00:00Z', end_time: '2026-06-11T18:00:00Z' },
        ] },
        '/api/network-relations/networks': { networks: [
          { id: 'a', name: 'Old Network A', original_name: 'Original A', source_key: sourceA, merged_into: 'b', color: '#3B82F6', description: null },
          { id: 'b', name: 'SingularityNET', original_name: 'SingularityNET', color: '#10B981', description: null },
        ] },
        '/api/network-relations/mappings': { mappings: [{ id: 'metta-mapping', network_id: 'b', source_string: 'MeTTa Coders', source_type: 'meeting_title' }] },
        '/api/network-relations/rules': { rules: [] },
        '/api/network-relations/assignments': { assignments: [], sources: [{ key: sourceA, name: 'Original A' }, { key: sourceSameName, name: 'SingularityNET' }] },
      }
      await route.fulfill({ json: responses[pathname] || {} })
    })
    await page.goto(`/events-calendar?network=${sourceA}&keep=value`)
    const destination = page.getByRole('button', { name: 'SingularityNET', exact: true })
    await expect(destination).toHaveAttribute('aria-pressed', 'true')
    await expect(destination).not.toContainText('Original A')
    await expect(destination).toHaveText('SingularityNET3')
    await expect(destination.locator('.lucide-arrow-left')).toHaveCount(0)
    await expect(page.getByText('Member calendars', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Old Network A', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Original A', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /MeTTa Coders/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Original source meeting/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Same-name source meeting/ })).toHaveCount(1)
    expect(new URL(page.url()).searchParams.getAll('network')).toEqual(['b'])
    expect(new URL(page.url()).searchParams.get('keep')).toBe('value')
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), mode === 'phone-dark')
    await expect(destination.locator('span.truncate')).toHaveText('SingularityNET')
    await page.reload()
    await expect(destination).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /MeTTa Coders/ })).toHaveCount(1)
    await page.goto(`/events-calendar?network=${sourceSameName}`)
    await expect(destination).toHaveAttribute('aria-pressed', 'true')
    await page.waitForURL(url => url.searchParams.get('network') === 'b')
    expect(new URL(page.url()).searchParams.getAll('network')).toEqual(['b'])
    await expect(page.getByRole('button', { name: /Same-name source meeting/ })).toHaveCount(1)
  })

  test(`shared network filters retain overlapping memberships and source provenance [${mode}]`, async ({ page }, testInfo) => {
    await page.clock.setFixedTime(new Date('2026-06-12T12:00:00Z'))
    if (mode === 'phone-dark') await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.addInitScript(() => {
      localStorage.setItem('coordination-timezones', JSON.stringify({ primary: 'UTC', additional: [] }))
      localStorage.setItem('coordinateEventsNetworkFilterModes', JSON.stringify({ 'Network B': 'hidden' }))
    })
    await page.route('**/api/**', async route => {
      expect(route.request().method()).toBe('GET')
      const pathname = new URL(route.request().url()).pathname
      const shared = { title: 'Shared meeting', start_time: '2026-06-11T14:00:00Z', end_time: '2026-06-11T15:00:00Z', source_type: 'google_oauth', is_public: true }
      const responses: Record<string, unknown> = {
        '/api/user-events/public': { events: [
          { ...shared, id: 'source-a', network_source_key: sourceA, calendar_title: 'Original A' },
          { ...shared, id: 'source-b', network_source_key: sourceB, calendar_title: 'Original B' },
          { ...shared, id: 'only-a', title: 'Only A meeting', network_source_key: sourceA, calendar_title: 'Original A',
            start_time: '2026-06-11T16:00:00Z', end_time: '2026-06-11T17:00:00Z' },
        ] },
        '/api/network-relations/networks': { networks: [
          { id: 'a', name: 'Renamed A', original_name: 'Original A', source_key: sourceA, color: '#3B82F6', description: null },
          { id: 'b', name: 'Network B', original_name: 'Original B', source_key: sourceB, color: '#10B981', description: null },
          { id: 'combined', name: 'Combined', member_keys: [sourceA, sourceB], color: '#8B5CF6', description: null },
        ] },
        '/api/network-relations/mappings': { mappings: [] },
        '/api/network-relations/rules': { rules: [] },
        '/api/network-relations/assignments': { assignments: [], sources: [
          { key: sourceA, name: 'Original A' }, { key: sourceB, name: 'Original B' },
        ] },
      }
      await route.fulfill({ json: responses[pathname] || {} })
    })
    await page.goto(`/events-calendar?network=${sourceB}`)
    await expect(page.getByRole('button', { name: 'Network B', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /Shared meeting/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Only A meeting/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Original A', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Renamed A', exact: true }).click()
    expect(new URL(page.url()).searchParams.getAll('network')).toEqual([sourceA])
    await page.reload()
    await expect(page.getByRole('button', { name: 'Renamed A', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /Only A meeting/ })).toHaveCount(1)
    await page.getByRole('button', { name: 'Combined', exact: true }).click()
    expect(new URL(page.url()).searchParams.getAll('network')).toEqual(['combined'])
    await expect(page.getByRole('button', { name: /Shared meeting/ })).toHaveCount(1)
    await page.getByRole('button', { name: /Shared meeting/ }).click()
    await page.getByRole('button', { name: 'Show sources', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Shared meeting' })
    await expect(dialog.getByText('Original A', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Original B', { exact: true })).toBeVisible()
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), mode === 'phone-dark')
    await testInfo.attach(`network-provenance-${mode}.png`, { body: await dialog.screenshot(), contentType: 'image/png' })
    await page.getByRole('button', { name: 'Close event details' }).click()
    await page.getByRole('button', { name: 'Clear network filter', exact: true }).click()
    expect(new URL(page.url()).searchParams.has('network')).toBe(false)
  })
}
