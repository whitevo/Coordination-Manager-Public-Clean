import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173'
const API_BASE = process.env.E2E_API_URL || 'http://localhost:3001'
const ITEM_SELECTOR = '[data-time-management-item="true"]'

async function createTravelerContext(page: Page): Promise<void> {
  await page.goto(`${BASE}/auth/login`)
  await page.getByRole('checkbox', { name: /remember me on this device/i }).check()
  await page.getByRole('button', { name: 'Continue as Traveler' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 20_000 })
}

async function openTimeManagement(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(`${BASE}/time-management`)
  await expect(page.getByTestId('calendar-scroll-container')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Jump to today' }).click()
  await page.waitForTimeout(400)
}

async function waitForActiveMode(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(async (apiBase) => {
    const authKey = [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
      .find((key) => /^sb-.+-auth-token$/.test(key))
    const raw = authKey ? localStorage.getItem(authKey) || sessionStorage.getItem(authKey) : null
    const accessToken = raw ? (JSON.parse(raw) as { access_token?: string }).access_token : undefined
    if (!accessToken) return false
    const response = await fetch(`${apiBase}/api/time-management/modes`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return false
    const payload = await response.json() as { activeModeId?: string; modes?: unknown[] }
    return typeof payload.activeModeId === 'string' && (payload.modes?.length ?? 0) > 0
  }, API_BASE), { timeout: 20_000 }).toBe(true)
}

function itemCards(page: Page, title: string) {
  return page.locator(ITEM_SELECTOR).filter({ hasText: title })
}

async function selectVisibleGridSlot(page: Page): Promise<void> {
  const target = await page.locator('[data-time-management-drop-zone="true"]').evaluateAll((nodes) => {
    const viewportTop = 280
    const viewportBottom = window.innerHeight
    const match = nodes
      .map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          dayIndex: node.getAttribute('data-time-management-day-index'),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
        }
      })
      .find((entry) => entry.dayIndex === '0' && entry.bottom > viewportTop && entry.y < viewportBottom)

    if (!match) return null
    const visibleTop = Math.max(viewportTop, match.y)
    const visibleBottom = Math.min(viewportBottom, match.bottom)
    return {
      x: match.x + Math.min(20, match.width / 2),
      y: (visibleTop + visibleBottom) / 2,
    }
  })

  if (!target) throw new Error('No visible Time Management day column was found')
  await page.mouse.click(target.x, target.y)
}

async function ensureEditorOpen(page: Page): Promise<void> {
  const showPanel = page.getByTitle('Show left panel')
  if (await showPanel.isVisible().catch(() => false)) {
    await showPanel.click()
  }

  const titleInput = page.getByPlaceholder('Type Title for Time Item')
  if (!(await titleInput.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Create Time Item' }).click()
  }
  await expect(titleInput).toBeVisible()
}

async function createItem(page: Page, title: string): Promise<void> {
  await selectVisibleGridSlot(page)
  await ensureEditorOpen(page)
  await page.getByPlaceholder('Type Title for Time Item').fill(title)
  const createResponse = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/user-events'
  ))
  await page.getByTestId('left-sidebar-save-button').click()
  const response = await createResponse
  expect(response.ok()).toBe(true)
  const body = await response.json() as { event?: { title?: string } }
  expect(body.event?.title).toBe(title)
}

async function moveItemThirtyMinutesLater(page: Page, title: string): Promise<string> {
  const card = itemCards(page, title).first()
  await card.scrollIntoViewIfNeeded()
  const before = (await card.textContent()) || ''
  const box = await card.boundingBox()
  if (!box) throw new Error('The item card is not visible for dragging')
  const updateResponse = page.waitForResponse((response) => (
    response.request().method() === 'PUT' && /^\/api\/user-events\/[^/]+$/.test(new URL(response.url()).pathname)
  ))
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX, startY + 60, { steps: 8 })
  await page.mouse.up()
  expect((await updateResponse).ok()).toBe(true)

  await expect.poll(async () => (await itemCards(page, title).first().textContent()) || '').not.toBe(before)
  return (await itemCards(page, title).first().textContent()) || ''
}

async function deleteItem(page: Page, title: string): Promise<void> {
  const card = itemCards(page, title).first()
  await card.scrollIntoViewIfNeeded()
  await card.click({ button: 'right', force: true })
  await page.locator('#calendar-item-context-menu').getByRole('menuitem', { name: 'Delete Item' }).click()
  const deleteResponse = page.waitForResponse((response) => (
    response.request().method() === 'DELETE' && /^\/api\/user-events\/[^/]+$/.test(new URL(response.url()).pathname)
  ))
  await page.locator('#calendar-item-context-menu').getByRole('button', { name: 'Confirm' }).click()
  expect((await deleteResponse).ok()).toBe(true)
  await expect(itemCards(page, title)).toHaveCount(0, { timeout: 15_000 })
}

async function expectItemPresent(page: Page, title: string, responseLog: string[] = []): Promise<void> {
  try {
    await expect.poll(async () => itemCards(page, title).count(), { timeout: 15_000 }).toBeGreaterThan(0)
  } catch (error) {
    const diagnostics = await page.evaluate(async ({ apiBase, expectedTitle }) => {
      const authKey = [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
        .find((key) => /^sb-.+-auth-token$/.test(key))
      const raw = authKey ? localStorage.getItem(authKey) || sessionStorage.getItem(authKey) : null
      const accessToken = raw ? (JSON.parse(raw) as { access_token?: string }).access_token : undefined
      if (!accessToken) return { authKey, hasAccessToken: false }

      const headers = { Authorization: `Bearer ${accessToken}` }
      const [revisionResponse, eventsResponse, modesResponse] = await Promise.all([
        fetch(`${apiBase}/api/user-events/revision`, { headers }),
        fetch(`${apiBase}/api/user-events`, { headers }),
        fetch(`${apiBase}/api/time-management/modes`, { headers }),
      ])
      const revisionBody = await revisionResponse.text()
      const eventsBody = await eventsResponse.json() as {
        events?: Array<{ title: string; start_time: string; end_time: string }>
      }
      const modesBody = await modesResponse.json() as {
        activeModeId?: string
        modes?: Array<{ id: string; name: string }>
      }
      const serverEvent = (eventsBody.events || []).find((event) => event.title === expectedTitle)
      return {
        authKey,
        hasAccessToken: true,
        revisionStatus: revisionResponse.status,
        revisionBody,
        eventsStatus: eventsResponse.status,
        serverHasItem: Boolean(serverEvent),
        serverEvent,
        serverEventCount: eventsBody.events?.length ?? 0,
        activeModeId: modesBody.activeModeId,
        modes: modesBody.modes,
        visibility: document.visibilityState,
        weekLabels: Array.from(document.querySelectorAll('*'))
          .filter((element) => element.children.length === 0)
          .map((element) => element.textContent?.trim() || '')
          .filter((text) => /^[A-Z][a-z]{2} \d{1,2} - \d{1,2}, \d{4}$/.test(text)),
        eventCache: Object.keys(sessionStorage)
          .filter((key) => key.startsWith('session-data-cache:time-management:events:'))
          .map((key) => ({ key, containsItem: sessionStorage.getItem(key)?.includes(expectedTitle) ?? false })),
        timeManagementPreferences: localStorage.getItem('time-management-v1'),
        calendarText: document.querySelector('[data-testid="calendar-scroll-container"]')?.textContent?.slice(0, 500),
        eventRequests: performance.getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.includes('/api/user-events')),
      }
    }, { apiBase: API_BASE, expectedTitle: title })
    throw new Error(`Item did not propagate: ${JSON.stringify({ ...diagnostics, fullEventResponseLog: responseLog })}`, { cause: error })
  }
}

async function expectItemAbsent(page: Page, title: string): Promise<void> {
  await expect(itemCards(page, title)).toHaveCount(0, { timeout: 15_000 })
}

async function expectItemText(page: Page, title: string, expectedText: string, responseLog: string[]): Promise<void> {
  try {
    await expect.poll(async () => (await itemCards(page, title).first().textContent()) || '', {
      timeout: 15_000,
    }).toBe(expectedText)
  } catch (error) {
    const diagnostics = await page.evaluate(async ({ apiBase, expectedTitle }) => {
      const authKey = [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
        .find((key) => /^sb-.+-auth-token$/.test(key))
      const raw = authKey ? localStorage.getItem(authKey) || sessionStorage.getItem(authKey) : null
      const accessToken = raw ? (JSON.parse(raw) as { access_token?: string }).access_token : undefined
      if (!accessToken) return { hasAccessToken: false }

      const headers = { Authorization: `Bearer ${accessToken}` }
      const [response, modesResponse] = await Promise.all([
        fetch(`${apiBase}/api/user-events`, { headers }),
        fetch(`${apiBase}/api/time-management/modes`, { headers }),
      ])
      const payload = await response.json() as {
        revision?: string
        events?: Array<{ title: string; start_time: string; end_time: string; source_id: string | null }>
      }
      const modesPayload = await modesResponse.json() as {
        activeModeId?: string
        modes?: Array<{ id: string; name: string }>
      }
      return {
        status: response.status,
        revision: payload.revision,
        serverEvent: (payload.events || []).find((event) => event.title === expectedTitle),
        activeModeId: modesPayload.activeModeId,
        modes: modesPayload.modes,
        cardTexts: Array.from(document.querySelectorAll('[data-time-management-item="true"]'))
          .filter((node) => node.textContent?.includes(expectedTitle))
          .map((node) => node.textContent),
        eventRequests: performance.getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.includes('/api/user-events')),
      }
    }, { apiBase: API_BASE, expectedTitle: title })
    throw new Error(`Move did not propagate: ${JSON.stringify({ ...diagnostics, fullEventResponseLog: responseLog })}`, { cause: error })
  }
}

async function cleanupItems(page: Page, titles: string[]): Promise<void> {
  await page.evaluate(async ({ apiBase, cleanupTitles }) => {
    const authKey = [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
      .find((key) => /^sb-.+-auth-token$/.test(key))
    const raw = authKey ? localStorage.getItem(authKey) || sessionStorage.getItem(authKey) : null
    const accessToken = raw ? (JSON.parse(raw) as { access_token?: string }).access_token : undefined
    if (!accessToken) return

    const response = await fetch(`${apiBase}/api/user-events`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) return
    const payload = await response.json() as { events?: Array<{ id: string; title: string }> }
    const matches = (payload.events || []).filter((event) => cleanupTitles.includes(event.title))
    await Promise.all(matches.map((event) => fetch(`${apiBase}/api/user-events/${event.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })))
  }, { apiBase: API_BASE, cleanupTitles: titles }).catch(() => undefined)
}

test.describe('Time Management multi-session synchronization', () => {
  test('propagates create, move, and delete in both directions', async ({ browser }) => {
    test.setTimeout(180_000)

    const contextA = await browser.newContext()
    let contextB: BrowserContext | null = null
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const titleFromA = `E2E multi-session A ${unique}`
    const titleFromB = `E2E multi-session B ${unique}`

    try {
      const pageA = await contextA.newPage()
      const pageAEventResponses: string[] = []
      pageA.on('response', async (response) => {
        const url = new URL(response.url())
        if (response.request().method() !== 'GET' || url.pathname !== '/api/user-events') return
        try {
          const payload = await response.json() as {
            revision?: string
            events?: Array<{ title: string; start_time: string; end_time: string }>
          }
          pageAEventResponses.push(JSON.stringify({
            revision: payload.revision,
            events: (payload.events || []).map((event) => ({
              title: event.title,
              start: event.start_time,
              end: event.end_time,
            })),
          }))
        } catch {
          pageAEventResponses.push(`unreadable:${response.status()}`)
        }
      })
      await createTravelerContext(pageA)
      await openTimeManagement(pageA)
      await waitForActiveMode(pageA)
      const storageState = await contextA.storageState()

      contextB = await browser.newContext({ storageState })
      const pageB = await contextB.newPage()
      const pageBEventResponses: string[] = []
      pageB.on('response', async (response) => {
        const url = new URL(response.url())
        if (response.request().method() !== 'GET' || url.pathname !== '/api/user-events') return
        try {
          const payload = await response.json() as {
            revision?: string
            events?: Array<{ title: string; start_time: string; end_time: string }>
          }
          pageBEventResponses.push(JSON.stringify({
            revision: payload.revision,
            events: (payload.events || []).map((event) => ({
              title: event.title,
              start: event.start_time,
              end: event.end_time,
            })),
          }))
        } catch {
          pageBEventResponses.push(`unreadable:${response.status()}`)
        }
      })

      await test.step('open second Time Management session', async () => {
        await openTimeManagement(pageB)
      })

      await test.step('create in A and observe in B', async () => {
        await createItem(pageA, titleFromA)
        await expectItemPresent(pageB, titleFromA, pageBEventResponses)
      })

      await test.step('move in B and observe in A', async () => {
        const movedText = await moveItemThirtyMinutesLater(pageB, titleFromA)
        await expectItemText(pageA, titleFromA, movedText, pageAEventResponses)
      })

      await test.step('delete in B and observe in A', async () => {
        await deleteItem(pageB, titleFromA)
        await expectItemAbsent(pageA, titleFromA)
      })

      await test.step('create in B and observe in A', async () => {
        await createItem(pageB, titleFromB)
        await expectItemPresent(pageA, titleFromB, pageAEventResponses)
      })

      await test.step('delete in A and observe in B', async () => {
        await deleteItem(pageA, titleFromB)
        await expectItemAbsent(pageB, titleFromB)
      })
    } finally {
      const cleanupPage = contextB?.pages()[0] || contextA.pages()[0]
      if (cleanupPage) await cleanupItems(cleanupPage, [titleFromA, titleFromB])
      await contextB?.close().catch(() => undefined)
      await contextA.close().catch(() => undefined)
    }
  })
})
