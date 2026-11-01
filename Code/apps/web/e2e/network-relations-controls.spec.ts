import { expect, test } from '@playwright/test'
import { signInMailboxTest } from './mailbox-test-auth'

const sourceKey = `source_${'a'.repeat(64)}`
for (const mode of ['desktop-light', 'phone-dark'] as const) {
  test(`untouched source panels save mappings and rules without renaming [${mode}]`, async ({ page }) => {
    if (mode === 'phone-dark') await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    test.skip(!await signInMailboxTest(page), 'Requires local Supabase URL for the mocked session')
    let configured = false
    const mappings: Array<{ id: string; network_id: string; source_type: string; source_string: string }> = []
    const rules: Array<{ id: string; network_id: string; pattern: string; match_type: string; match_field: string; priority: number; is_active: boolean }> = []
    const writes: string[] = []
    const alias = { id: 'source-alias', name: 'Untouched source', original_name: 'Untouched source',
      source_key: sourceKey, color: '#3B82F6', description: null, member_keys: [], can_edit: true, can_rename: true }
    await page.route('**/api/**', async route => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/network-relations/') && request.method() !== 'GET') {
        expect(request.method()).toBe('POST')
        writes.push(path)
        if (path.endsWith('/networks')) {
          expect(request.postDataJSON()).toEqual({ name: 'Untouched source', source_key: sourceKey })
          configured = true
          await route.fulfill({ json: { network: alias } })
        } else if (path.endsWith('/mappings')) {
          const body = request.postDataJSON() as Omit<(typeof mappings)[number], 'id'>
          expect(body).toEqual({ network_id: alias.id, source_type: 'meeting_title', source_string: 'Extra meeting' })
          mappings.push({ id: 'new-mapping', ...body })
          await route.fulfill({ json: {} })
        } else if (path.endsWith('/rules')) {
          const body = request.postDataJSON() as Omit<(typeof rules)[number], 'id' | 'is_active'>
          expect(body).toEqual({ network_id: alias.id, pattern: 'Extra pattern', match_type: 'contains', match_field: 'calendar_title', priority: 0 })
          rules.push({ id: 'new-rule', is_active: true, ...body })
          await route.fulfill({ json: {} })
        } else {
          throw new Error(`Unexpected network write: ${path}`)
        }
        return
      }
      const responses: Record<string, unknown> = {
        '/api/auth/me': { user: { id: 'e2e-user', email: 'e2e@example.com', accountType: 'google', roles: ['admin'] } },
        '/api/network-relations/manage': { networks: configured ? [alias] : [], sources: [
          { key: sourceKey, name: 'Untouched source', can_rename: true },
        ], mappings, rules, assignments: [], targets: [] },
        '/api/user-events/public': { events: [] },
      }
      await route.fulfill({ json: responses[path] || {} })
    })
    await page.goto('/admin/network-relations')
    await page.getByRole('heading', { name: 'Network Relations', exact: true }).waitFor()
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), mode === 'phone-dark')
    const sources = page.getByRole('region', { name: 'Source networks' })
    await sources.getByText('Untouched source', { exact: true }).click()
    await expect(sources.getByText('Direct Mappings', { exact: true })).toBeVisible()
    await expect(sources.getByText('Auto-Match Rules', { exact: true })).toBeVisible()
    await expect(sources.getByRole('button', { name: /Delete source network/ })).toHaveCount(0)
    expect(writes).toEqual([])
    await sources.getByRole('button', { name: 'Add mapping', exact: true }).click()
    await sources.getByRole('textbox', { name: 'Exact mapping text' }).fill('Extra meeting')
    await sources.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(sources.getByText('Extra meeting', { exact: true })).toBeVisible()
    await sources.getByRole('button', { name: 'Add rule', exact: true }).click()
    await sources.getByRole('textbox', { name: 'Rule pattern' }).fill('Extra pattern')
    await sources.getByRole('button', { name: 'Add Rule', exact: true }).click()
    await expect(sources.getByText('Extra pattern', { exact: true })).toBeVisible()
    expect(writes).toEqual(['/api/network-relations/networks', '/api/network-relations/mappings', '/api/network-relations/rules'])
    await expect(page.getByText('Untouched source', { exact: true })).toHaveCount(1)
    await page.reload()
    await sources.getByText('Untouched source', { exact: true }).click()
    await expect(sources.getByText('Extra meeting', { exact: true })).toBeVisible()
    await expect(sources.getByText('Extra pattern', { exact: true })).toBeVisible()
  })

  test(`source renaming, safe scrim gestures and separate combination controls [${mode}]`, async ({ page }) => {
    if (mode === 'phone-dark') await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    test.skip(!await signInMailboxTest(page), 'Requires local Supabase URL for the mocked session')
    let sourceName = 'Renamed source'
    let customName = 'Custom tag'
    let memberKeys: string[] = []
    const writes: Array<{ path: string; body: object }> = []
    await page.route('**/api/**', async route => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path === '/api/quick-tools' && request.method() === 'PUT') {
        await route.fulfill({ json: { success: true } })
        return
      }
      if (request.method() !== 'GET') {
        expect(request.method()).toBe('PUT')
        expect(path).toMatch(/\/api\/network-relations\/networks\/(source-alias|custom)$/)
        const body = request.postDataJSON() as { name: string; member_keys?: string[] }
        writes.push({ path, body })
        if (path.endsWith('/source-alias')) {
          expect(Object.keys(body)).toEqual(['name'])
          sourceName = body.name
        } else if (body.member_keys) {
          expect(body.name).toBe(customName)
          memberKeys = body.member_keys
        } else {
          expect(Object.keys(body)).toEqual(['name'])
          customName = body.name
        }
        await route.fulfill({ json: { network: {}, joined: false } })
        return
      }
      const responses: Record<string, unknown> = {
        '/api/auth/me': { user: { id: 'e2e-user', email: 'e2e@example.com', accountType: 'google', roles: ['admin'] } },
        '/api/network-relations/manage': {
          networks: [
            { id: 'source-alias', name: sourceName, original_name: 'Original source', source_key: sourceKey, color: '#3B82F6', member_keys: [], can_edit: true, can_rename: true },
            { id: 'custom', name: customName, original_name: 'Custom tag', color: '#3B82F6', member_keys: memberKeys, can_edit: true, can_rename: true },
          ],
          sources: [{ key: sourceKey, name: 'Original source', can_rename: true }],
          mappings: [{ id: 'source-mapping', network_id: 'source-alias', source_type: 'meeting_title', source_string: 'Source meeting' }],
          rules: [{ id: 'source-rule', network_id: 'source-alias', pattern: 'Source pattern', match_type: 'contains', match_field: 'meeting_title', priority: 0, is_active: true }],
          assignments: [], targets: [],
        },
        '/api/user-events/public': { events: [] },
      }
      await route.fulfill({ json: responses[path] || {} })
    })
    await page.goto('/admin/network-relations')
    await page.getByRole('heading', { name: 'Network Relations', exact: true }).waitFor()
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), mode === 'phone-dark')
    const sources = page.getByRole('region', { name: 'Source networks' })
    await expect(sources.getByText('Renamed source', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit Renamed source', exact: true })).toHaveCount(0)
    await sources.getByText('Renamed source', { exact: true }).click()
    await expect(sources.getByText('Source meeting', { exact: true })).toBeVisible()
    await expect(sources.getByText('Source pattern', { exact: true })).toBeVisible()
    await expect(sources.getByRole('button', { name: 'Edit mapping Source meeting', exact: true })).toBeVisible()
    await sources.getByText('Renamed source', { exact: true }).click()
    await sources.getByRole('button', { name: 'Rename', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Rename source network' })
    const input = dialog.getByRole('textbox', { name: 'Display name' })
    const bounds = await input.boundingBox()
    if (!bounds) throw new Error('Rename input has no bounds')
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(5, 5, { steps: 6 })
    await page.mouse.up()
    await expect(dialog).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(dialog).toHaveCount(0)
    await sources.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(input).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(sources.getByRole('button', { name: 'Rename', exact: true })).toBeVisible()
    await sources.getByRole('button', { name: 'Rename', exact: true }).click()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await sources.getByRole('button', { name: 'Rename', exact: true }).click()
    await input.fill('Updated source')
    await dialog.getByRole('button', { name: 'Save name', exact: true }).click()
    await expect(sources.getByText('Updated source', { exact: true })).toBeVisible()
    await expect(sources.getByText('Original source', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Source networks', exact: true }).click()
    await expect(sources).toHaveCount(0)
    await page.getByRole('button', { name: 'Source networks', exact: true }).click()
    await expect(sources).toBeVisible()
    await page.getByText('Custom tag', { exact: true }).click()
    await expect(page.getByText('Assigned meetings', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Add network', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Updated source', exact: true }).check()
    await page.getByRole('button', { name: 'Save combined networks', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Save combined networks', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Add network', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Updated source', exact: true }).uncheck()
    await page.getByRole('button', { name: 'Cancel combination', exact: true }).click()
    expect(memberKeys).toEqual([sourceKey])
    await page.getByRole('button', { name: 'Edit Custom tag', exact: true }).click()
    await page.getByRole('textbox', { name: 'Name for Custom tag', exact: true }).fill('Custom renamed')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Custom renamed', { exact: true })).toBeVisible()
    expect(writes).toEqual([
      { path: '/api/network-relations/networks/source-alias', body: { name: 'Updated source' } },
      { path: '/api/network-relations/networks/custom', body: { name: 'Custom tag', member_keys: [sourceKey] } },
      { path: '/api/network-relations/networks/custom', body: { name: 'Custom renamed' } },
    ])
  })
}
