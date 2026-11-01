import { test, expect, type Page } from '@playwright/test'
import { COLOR_VAR_MAP, DEFAULT_DARK, DEFAULT_LIGHT, PRESET_THEMES } from '../src/lib/theme-types'
import { signInMailboxTest } from './mailbox-test-auth'

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173'
const ACCOUNT = {
  id: 'acct-anthropic',
  provider: 'gmail',
  address: 'me@example.com',
  display_name: 'Test mailbox',
  identity_group: 'personal',
  status: 'connected',
  connected_at: new Date().toISOString(),
  last_synced_at: new Date().toISOString(),
  sync_error: null,
}

const ANTHROPIC_MESSAGES = [
  {
    id: 'anthropic-1',
    account_id: ACCOUNT.id,
    account: ACCOUNT,
    thread_id: 'provider-thread-1',
    subject: 'You\'re invited to join Ristik on Claude',
    from_name: 'Anthropic',
    from_email: 'no-reply@anthropic.com',
    to_emails: 'me@example.com',
    cc_emails: null,
    bcc_emails: null,
    received_at: '2026-09-14T20:33:00.000Z',
    preview: 'First Anthropic invitation',
    body_text: 'First Anthropic invitation',
    is_read: false,
    is_archived: false,
    is_provider_trashed: false,
    is_provider_junk: false,
    is_provider_sent: false,
    has_attachments: false,
    user_tag_ids: [],
  },
  {
    id: 'anthropic-2',
    account_id: ACCOUNT.id,
    account: ACCOUNT,
    thread_id: 'provider-thread-2',
    subject: 'Re: You\'re invited to join Ristik on Claude',
    from_name: 'Anthropic',
    from_email: 'no-reply@anthropic.com',
    to_emails: 'me@example.com',
    cc_emails: null,
    bcc_emails: null,
    received_at: '2026-09-10T20:20:00.000Z',
    preview: 'Second Anthropic invitation',
    body_text: 'Second Anthropic invitation',
    is_read: true,
    is_archived: false,
    is_provider_trashed: false,
    is_provider_junk: false,
    is_provider_sent: false,
    has_attachments: false,
    user_tag_ids: [],
  },
]

const THREADING_LABELS = [
  'Same normalized subject and sender email within days',
  'Same normalized subject, no reply, within days',
  'Same normalized subject within days',
  'Same sender email, no reply, within days',
  'Same sender email within days (any subject)',
]

async function mockThreadViewApi(page: Page) {
  await page.route(/\/health(\?|$)/, (route) => route.fulfill({ json: { status: 'ok' } }))
  const trashedIds = new Set<string>()
  let options = {
    sameNameAndEmail: false,
    sameNameWithoutReply: false,
    sameNameWithinSevenDays: false,
    sameEmailWithoutReply: false,
    sameEmailWithinSevenDays: false,
  }

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    if (path.endsWith('/accounts') && method === 'GET') {
      return route.fulfill({ json: { accounts: [ACCOUNT] } })
    }
    if (path.endsWith('/preferences/threading') && method === 'GET') {
      return route.fulfill({ json: { options } })
    }
    if (path.endsWith('/preferences/threading') && method === 'PUT') {
      options = route.request().postDataJSON().options
      return route.fulfill({ json: { options, regroupedMessages: 2 } })
    }
    if (path.endsWith('/messages') && method === 'GET') {
      const messages = ANTHROPIC_MESSAGES.filter((message) => !trashedIds.has(message.id))
      return route.fulfill({ json: { messages, total: messages.length } })
    }
    const trashMatch = path.match(/\/messages\/([^/]+)\/trash$/)
    if (trashMatch && method === 'POST') {
      trashedIds.add(trashMatch[1])
      return route.fulfill({ json: { success: true } })
    }
    if (path.endsWith('/messages/anthropic-1/thread') && method === 'GET') {
      const isThreaded = options.sameNameAndEmail || options.sameNameWithoutReply || options.sameNameWithinSevenDays
        || options.sameEmailWithoutReply || options.sameEmailWithinSevenDays
      return route.fulfill({
        json: {
          thread: { id: isThreaded ? 'app-thread-anthropic' : 'provider-thread-1' },
          messages: isThreaded ? ANTHROPIC_MESSAGES : [ANTHROPIC_MESSAGES[0]],
        },
      })
    }
    if (path.endsWith('/preferences/tags')) return route.fulfill({ json: { tags: [] } })
    if (path.endsWith('/people')) return route.fulfill({ json: { people: [] } })
    if (path.endsWith('/invitations/extract')) return route.fulfill({ json: { success: true } })
    if (path.endsWith('/invitations')) return route.fulfill({ json: { invitations: [] } })
    if (path.endsWith('/rules')) return route.fulfill({ json: { rules: [] } })
    if (path.endsWith('/drafts')) return route.fulfill({ json: { drafts: [] } })
    return route.fulfill({ json: {} })
  })
}

async function signInAndOpenMailbox(page: Page) {
  if (!(await signInMailboxTest(page))) test.skip()
  await page.goto(`${BASE}/mailbox?tab=mailbox`)
  await expect(page.getByTestId('mailbox-message-row').filter({ hasText: 'Anthropic' }).first()).toBeVisible({ timeout: 15_000 })
}

test.describe('Mailbox Thread View settings', () => {
  test.beforeEach(async ({ page }) => {
    await mockThreadViewApi(page)
    await signInAndOpenMailbox(page)
  })

  for (const width of [390, 1280]) {
    test(`AI reply feedback retains original suggestion and submits ratings at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.route('**/api/mailbox/messages/anthropic-1/draft-suggestion', route => route.fulfill({
        json: { subject: 'AI generated subject', body_text: 'Original AI reply body' },
      }))
      let feedback: Record<string, unknown> | null = null
      await page.route('**/api/ai-feedback', async route => {
        feedback = route.request().postDataJSON()
        await route.fulfill({ status: 201, json: { feedback: { id: 'test-feedback' } } })
      })
      await page.getByTestId('mailbox-message-row').first().click()
      await page.getByRole('button', { name: 'Reply', exact: true }).click()
      await page.getByRole('textbox', { name: 'AI reply instruction' }).fill('Please thank them')
      await page.getByRole('button', { name: 'AI: Suggest reply' }).click()
      await expect(page.getByRole('textbox', { name: 'Message body' })).toHaveValue('Original AI reply body')
      await page.getByRole('textbox', { name: 'Message body' }).fill('My later private edits')
      await page.getByRole('button', { name: 'Hide details' }).click()
      await page.getByRole('button', { name: 'Give feedback on AI reply' }).click()
      await page.getByRole('textbox', { name: 'AI reply feedback comment' }).fill('Clear and useful')
      await page.getByRole('button', { name: 'Submit feedback' }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Thank you for your feedback!' })).toBeVisible()
      expect(feedback).toMatchObject({
        user_prompt: 'Mailbox AI: Suggest reply\nPlease thank them',
        ai_answer: 'Subject: AI generated subject\n\nOriginal AI reply body',
        feedback_text: 'Clear and useful',
      })
      await expect(page.getByRole('textbox', { name: 'Message body' })).toHaveValue('My later private edits')
    })
  }

  for (const viewport of [
    { width: 360, height: 800 }, { width: 390, height: 844 },
    { width: 430, height: 932 }, { width: 844, height: 390 },
    { width: 768, height: 1024 }, { width: 1280, height: 900 },
  ]) {
    test(`compact draft leaves emails readable and selectable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.getByTestId('mailbox-message-row').first().click()
      await page.getByRole('button', { name: 'Reply', exact: true }).click()
      const panel = page.getByTestId('mailbox-draft-panel')
      const body = page.getByRole('textbox', { name: 'Message body' })
      await expect(page.getByLabel('Subject', { exact: true })).toBeVisible()
      await body.fill('Keep this reply while reading')
      await page.getByLabel('Subject', { exact: true }).fill('Keep subject too')
      await panel.getByRole('button', { name: 'Hide details' }).click()
      const reader = page.getByTestId('mailbox-thread-scroll')
      const editingHeight = await reader.evaluate(element => element.clientHeight)
      await panel.getByRole('button', { name: 'Read emails', exact: true }).click()
      await expect.poll(() => reader.evaluate(element => element.clientHeight)).toBeGreaterThan(editingHeight)
      await expect(body).toBeHidden()
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeHidden()
      await reader.getByText('First Anthropic invitation', { exact: true }).dblclick()
      expect(await page.evaluate(() => window.getSelection()?.toString())).not.toBe('')
      await panel.getByRole('button', { name: 'Details', exact: true }).click()
      await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Keep subject too')
      await expect(body).toBeHidden()
      await expect(panel.getByRole('button', { name: 'Back to draft' })).toBeVisible()
      await panel.getByRole('button', { name: 'Hide details' }).click()
      await panel.getByRole('button', { name: 'Back to draft' }).click()
      await expect(body).toBeVisible()
      await expect(body).toHaveValue('Keep this reply while reading')
      await panel.getByRole('button', { name: 'Details', exact: true }).click()
      await expect(page.getByLabel('Subject', { exact: true })).toHaveValue('Keep subject too')
      expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    })
  }

  for (const width of [390, 1280]) {
    test(`long email scrolls independently while draft is minimized at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.route('**/api/mailbox/messages/anthropic-1/thread', route => route.fulfill({ json: {
        thread: { id: 'provider-thread-1', account_id: ACCOUNT.id },
        messages: [{ ...ANTHROPIC_MESSAGES[0], body_text: Array.from({ length: 100 }, (_, i) => `Email line ${i + 1}`).join('\n') }],
      } }))
      await page.getByTestId('mailbox-message-row').first().click()
      await page.getByRole('button', { name: 'Reply', exact: true }).click()
      await page.getByRole('textbox', { name: 'Message body' }).fill('Long email reply')
      await page.getByRole('button', { name: 'Read emails', exact: true }).click()
      const reader = page.getByTestId('mailbox-thread-scroll')
      await reader.hover()
      await page.mouse.wheel(0, 600)
      await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(100)
      const scrollTop = await reader.evaluate(element => element.scrollTop)
      await page.getByRole('button', { name: 'Back to draft' }).click()
      await expect(page.getByRole('textbox', { name: 'Message body' })).toHaveValue('Long email reply')
      expect(await reader.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(scrollTop)
      await page.getByRole('button', { name: 'Save as Draft', exact: true }).scrollIntoViewIfNeeded()
      await expect(page.getByRole('button', { name: 'Save as Draft', exact: true })).toBeInViewport()
    })
  }

  test('one stable hover toggle switches allocations without clicks or oscillation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByTestId('mailbox-message-row').first().click()
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    const read = page.getByTestId('mailbox-draft-reading-toggle')
    const initialBox = await read.boundingBox()
    await read.hover()
    await expect(page.locator('#mailbox-draft-content')).toHaveCSS('opacity', '0.1')
    await expect(page.getByRole('button', { name: 'Back to draft' })).toBeVisible()
    await page.mouse.move(0, 0)
    await expect(page.getByRole('textbox', { name: 'Message body' })).toBeHidden()
    await read.hover()
    await expect(page.getByRole('textbox', { name: 'Message body' })).toBeVisible()
    await expect(read).toHaveAttribute('aria-pressed', 'false')
    await page.waitForTimeout(300)
    await expect(page.getByRole('textbox', { name: 'Message body' })).toBeVisible()
    expect(await read.boundingBox()).toEqual(initialBox)
    await page.mouse.move(0, 0)
    await read.hover()
    await expect(page.locator('#mailbox-draft-content')).toHaveCSS('opacity', '0.1')
    await page.mouse.move(0, 0)
    await read.hover()
    await expect(page.getByRole('textbox', { name: 'Message body' })).toBeVisible()
  })

  test('keyboard users can read emails and return without focusing minimized draft fields', async ({ page }) => {
    await page.getByTestId('mailbox-message-row').first().click()
    await page.getByRole('button', { name: 'Reply', exact: true }).click()
    const read = page.getByTestId('mailbox-draft-reading-toggle')
    await read.focus()
    await page.keyboard.press('Enter')
    await expect(read).toHaveAttribute('aria-pressed', 'true')
    await expect(read).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(read).toBeFocused()
    await expect(read).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('textbox', { name: 'Message body' })).toBeVisible()
  })

  test('saved Draft badge is readable in every preset and light/dark mode', async ({ page }) => {
    await page.route('**/api/mailbox/drafts', route => route.fulfill({ json: { drafts: [{
      id: 'saved-draft', account_id: ACCOUNT.id, thread_id: 'provider-thread-1',
      mode: 'reply', from_address: ACCOUNT.address, to_emails: 'recipient@example.com',
      cc_emails: '', bcc_emails: '', subject: 'Saved draft fixture', body_text: 'Saved draft body',
      status: 'draft', updated_at: new Date().toISOString(), attachments: [],
    }] } }))
    await page.reload()
    const badge = page.getByTestId('mailbox-draft-badge').first()
    await expect(badge).toHaveText('Draft')
    for (const dark of [false, true]) {
      for (const theme of [{ name: 'Default', colors: dark ? DEFAULT_DARK : DEFAULT_LIGHT }, ...PRESET_THEMES]) {
        await page.evaluate(({ dark, colors, variables }) => {
          document.documentElement.classList.toggle('dark', dark)
          for (const [key, variable] of Object.entries(variables)) {
            document.documentElement.style.setProperty(variable, colors[key as keyof typeof colors])
          }
        }, { dark, colors: theme.colors, variables: COLOR_VAR_MAP })
        await expect.poll(() => badge.evaluate(element => {
          const luminance = (color: string) => (color.match(/[\d.]+/g) || []).slice(0, 3)
            .map(Number).map(value => value / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
          const style = getComputedStyle(element)
          const bg = luminance(style.backgroundColor)
          const fg = luminance(style.color)
          return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)
        }), { message: `${theme.name} ${dark ? 'dark' : 'light'} Draft contrast` }).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  for (const label of THREADING_LABELS) {
    test(`${label} controls Anthropic thread opening`, async ({ page }) => {
      let saves = 0
      page.on('request', request => {
        if (request.url().endsWith('/api/mailbox/preferences/threading') && request.method() === 'PUT') saves++
      })
      await page.goto(`${BASE}/mailbox?tab=settings&settings=accounts`)
      await page.waitForLoadState('networkidle')
      expect(saves).toBe(0)
      await page.getByRole('button', { name: 'Mailbox Settings', exact: true }).click()
      const checkbox = page.locator('label').filter({ hasText: label }).locator('input[type="checkbox"]')
      const saveResponse = page.waitForResponse((response) =>
        response.url().endsWith('/api/mailbox/preferences/threading') && response.request().method() === 'PUT'
      )
      await checkbox.check()
      await saveResponse

      await page.goto(`${BASE}/mailbox?tab=mailbox`)
      const row = page.getByTestId('mailbox-message-row').filter({ hasText: 'Anthropic' }).first()
      const threadResponse = page.waitForResponse((response) =>
        response.url().endsWith('/api/mailbox/messages/anthropic-1/thread')
      )
      await row.click()
      const payload = await (await threadResponse).json()
      expect(payload.messages).toHaveLength(2)
      await expect(page.getByText('Thread Viewer', { exact: true })).toBeVisible()
    })
  }
})

test.describe('Mailbox mobile navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await mockThreadViewApi(page)
    await signInAndOpenMailbox(page)
  })

  test('a normal inbox refresh has bounded requests and never reparses invitations', async ({ page }) => {
    await page.waitForLoadState('networkidle')
    const paths: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/mailbox/')) paths.push(path)
    })
    await page.reload()
    await expect(page.getByTestId('mailbox-message-row').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(paths.filter(path => path === '/api/mailbox/invitations/extract')).toHaveLength(0)
    for (const path of ['accounts', 'messages']) {
      const count = paths.filter(value => value === `/api/mailbox/${path}`).length
      expect(count, path).toBeGreaterThanOrEqual(1)
      expect(count, path).toBeLessThanOrEqual(2)
    }
    for (const path of ['people', 'rules', 'drafts', 'invitations']) {
      expect(paths.filter(value => value === `/api/mailbox/${path}`), path).toHaveLength(1)
    }
    console.info(`Mailbox refresh: ${paths.length} mailbox requests, ${paths.filter(path => path.endsWith('/sync')).length} provider checks, 0 invitation reparses`)
    expect(paths.length).toBeLessThanOrEqual(25)
  })

  test('request-limit warning has readable text and icon contrast in every preset and mode', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('rateLimitWarnAt', new Date().toISOString())
      window.dispatchEvent(new CustomEvent('rate-limit-warn', { detail: { warn: true } }))
    })
    const banner = page.getByTestId('request-limit-warning')
    await expect(banner).toBeVisible()
    for (const dark of [false, true]) {
      for (const theme of [
        { name: 'Default', colors: dark ? DEFAULT_DARK : DEFAULT_LIGHT },
        ...PRESET_THEMES,
      ]) {
        await page.evaluate(({ dark, colors, variables }) => {
          const root = document.documentElement
          root.classList.toggle('dark', dark)
          for (const [key, variable] of Object.entries(variables)) {
            root.style.setProperty(variable, colors[key as keyof typeof colors])
          }
        }, { dark, colors: theme.colors, variables: COLOR_VAR_MAP })
        await expect.poll(async () => banner.evaluate((element) => {
          const luminance = (color: string) => (color.match(/[\d.]+/g) || []).slice(0, 3)
            .map(Number).map(value => value / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
          const background = luminance(getComputedStyle(element).backgroundColor)
          const contrast = (node: Element) => {
            const foreground = luminance(getComputedStyle(node).color)
            return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
          }
          return Math.min(
            contrast(element.querySelector('span')!) / 4.5,
            contrast(element.querySelector('svg')!) / 3,
            contrast(element.querySelector('button')!) / 4.5,
          )
        }), { message: `${theme.name}, ${dark ? 'dark' : 'light'}` }).toBeGreaterThanOrEqual(1)
      }
    }
  })

  test.describe('Mailbox learner guide theme surfaces', () => {
    for (const theme of [
      { name: 'default light', dark: false, colors: DEFAULT_LIGHT },
      { name: 'default dark', dark: true, colors: DEFAULT_DARK },
      { name: 'Forest', dark: true, colors: PRESET_THEMES.find((preset) => preset.id === 'preset-forest')!.colors },
    ]) {
      test(`keeps guide text readable on ${theme.name} surfaces`, async ({ page }) => {
        await page.locator('button[aria-controls="mailbox-learner-guide"]:visible').click()
        const guide = page.locator('#mailbox-learner-guide')
        await expect(guide).toBeVisible()
        await guide.getByRole('button', { name: 'Open Tags', exact: true }).click()
        for (const name of ['Accounts', 'Automations', 'AI Assistant']) {
          await guide.getByRole('button', { name: new RegExp(`^${name} --`) }).click()
        }
        await expect(guide.getByRole('button', { name: 'Close Tags', exact: true })).toBeVisible()

        await page.evaluate(({ dark, colors, variables }) => {
          const root = document.documentElement
          root.classList.toggle('dark', dark)
          for (const [key, variable] of Object.entries(variables)) {
            root.style.removeProperty(variable)
            const value = colors[key as keyof typeof colors]
            if (value) root.style.setProperty(variable, value)
          }
        }, { dark: theme.dark, colors: theme.colors, variables: COLOR_VAR_MAP })
        await expect.poll(() => guide.evaluate((element) =>
          getComputedStyle(element).backgroundColor === getComputedStyle(document.body).backgroundColor
        )).toBe(true)
        await expect.poll(() => page.locator('body').evaluate((body) =>
          body.getAnimations({ subtree: true })
            .filter((animation) => animation instanceof CSSTransition && animation.playState === 'running').length
        )).toBe(0)

        const contrast = await guide.evaluate((element) => {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas is required to normalize CSS colors')
          const rgb = (color: string) => {
            context.clearRect(0, 0, 1, 1)
            context.fillStyle = color
            context.fillRect(0, 0, 1, 1)
            const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
            return [red, green, blue, alpha / 255]
          }
          const luminance = (color: number[]) => color.slice(0, 3)
            .map((value) => value / 255)
            .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
          const background = (node: Element): number[] => {
            const color = rgb(getComputedStyle(node).backgroundColor)
            if (color.length < 4 || color[3] === 1) return color
            const parent = node.parentElement ? background(node.parentElement) : [255, 255, 255]
            return color.slice(0, 3).map((value, index) => value * color[3] + parent[index] * (1 - color[3]))
          }
          const text = Array.from(element.querySelectorAll('p,li,span,button'))
            .filter((node) => node.getClientRects().length && Array.from(node.childNodes)
              .some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim()))
            // Status badges retain their shared semantic palette, independently of the guide surfaces.
            .filter((node) => !['text-info', 'text-warning', 'text-danger', 'text-feature-ai']
              .some((color) => node.classList.contains(color)))
          const ratios = text.map((node) => {
            const foreground = luminance(rgb(getComputedStyle(node).color))
            const surface = luminance(background(node))
            return (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05)
          })
          return {
            count: ratios.length,
            minimum: Math.min(...ratios),
            lowContrastText: text.filter((_, index) => ratios[index] < 4.5)
              .map((node) => ({
                text: node.textContent,
                className: node.className,
                foreground: getComputedStyle(node).color,
                background: background(node),
              })),
            legacyColors: Array.from(element.querySelectorAll('[class]')).flatMap((node) =>
              Array.from(node.classList).filter((name) => /^(?:dark:)?(?:bg-white|bg-card|text-slate-|text-white|border-blue-)/.test(name))),
          }
        })
        expect(contrast.count).toBeGreaterThan(100)
        expect(contrast.legacyColors).toEqual([])
        expect(contrast.lowContrastText).toEqual([])
        expect(contrast.minimum).toBeGreaterThanOrEqual(4.5)
      })
    }
  })

  for (const width of [320, 375, 390]) {
    test(`stacks guide panels and contains the setup shortcut at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await page.locator('button[aria-controls="mailbox-learner-guide"]:visible').click()
      const guide = page.locator('#mailbox-learner-guide')
      const panels = page.getByTestId('mailbox-guide-panels')
      await expect(panels).toHaveCSS('flex-direction', 'column')
      const sections = panels.locator(':scope > section')
      const inbox = await sections.nth(0).boundingBox()
      const thread = await sections.nth(1).boundingBox()
      expect(inbox).not.toBeNull()
      expect(thread).not.toBeNull()
      expect(thread!.y).toBeGreaterThan(inbox!.y + inbox!.height)
      expect(thread!.width).toBeCloseTo(inbox!.width, 0)
      const tags = panels.locator('section').filter({ hasText: 'Tags panel (slide-out)' })
      await expect(tags).toBeHidden()
      await guide.getByRole('button', { name: 'Open Tags', exact: true }).click()
      await expect(tags).toBeVisible()
      expect((await tags.boundingBox())!.width).toBeCloseTo(inbox!.width, 0)
      expect(await panels.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
      await guide.getByRole('button', { name: 'Close Tags', exact: true }).click()
      await expect(tags).toBeHidden()
      await page.getByTestId('mailbox-guide-start').getByRole('button', {
        name: 'Go to Settings -> Accounts', exact: true,
      }).click()
      await expect(page).toHaveURL(/tab=settings&settings=accounts/)
    })

    test(`keeps sections and guide in one touch-friendly row at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      const navigation = page.getByTestId('mailbox-mobile-navigation')
      await expect(navigation).toBeVisible()
      const boxes = await navigation.getByRole('button').evaluateAll((buttons) =>
        buttons.map((button) => {
          const rect = button.getBoundingClientRect()
          return { top: rect.top, width: rect.width, height: rect.height, overflow: button.scrollWidth > button.clientWidth }
        })
      )
      expect(boxes).toHaveLength(5)
      expect(new Set(boxes.map((box) => box.top)).size).toBe(1)
      expect(boxes.every((box) => box.width >= 44 && box.height >= 44 && !box.overflow)).toBe(true)
      expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true)
      await navigation.getByRole('button', { name: 'Learner Guide' }).click()
      await expect(page.locator('#mailbox-learner-guide')).toBeVisible()
      await expect(navigation.getByRole('button', { name: 'Learner Guide' })).toHaveAttribute('aria-expanded', 'true')
    })
  }

  for (const width of [360, 390, 430, 768, 844]) {
    test(`keeps primary reader actions beside the title at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 900 })
      await page.getByTestId('mailbox-message-row').first().click()
      const actions = page.getByTestId('mailbox-thread-actions')
      await expect(actions).toBeVisible()
      const back = actions.getByRole('button', { name: 'Back to Inbox', exact: true })
      await expect(back).toHaveText('')
      const primary = page.getByTestId('mailbox-thread-primary-actions')
      const controls = await primary.locator('h2, :scope > button, :scope > details > summary')
        .evaluateAll((nodes) => nodes.map((node) => {
          const rect = node.getBoundingClientRect()
          return { center: rect.top + rect.height / 2, width: rect.width, height: rect.height }
        }))
      expect(controls).toHaveLength(4)
      expect(Math.max(...controls.map((box) => box.center)) - Math.min(...controls.map((box) => box.center)))
        .toBeLessThanOrEqual(1)
      expect(controls.slice(1).every((box) => box.width >= 36 && box.height >= 36)).toBe(true)
      const picker = actions.locator('summary')
      await expect(picker).toHaveAccessibleName('Email format: Raw')
      await expect(picker.locator('.lucide-help-circle')).toBeVisible()
      await expect(picker).toHaveClass(/text-warning/)
      await picker.focus()
      await picker.press('Enter')
      const formats = actions.getByRole('group', { name: 'Email format' })
      await expect(formats).toBeVisible()
      const bounds = (await formats.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      await formats.getByRole('button', { name: 'System', exact: true }).click()
      await expect(formats).toBeHidden()
      await expect(picker).toHaveAccessibleName('Email format: System')
      await expect(picker).toBeFocused()
      expect(await page.evaluate(() => document.body.scrollWidth <= window.innerWidth)).toBe(true)
      await back.click()
      await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
    })
  }

  test('anchors manual and automatic selection to the previous message header', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const conversation = [
      { ...ANTHROPIC_MESSAGES[1], id: 'context-first' },
      { ...ANTHROPIC_MESSAGES[1], id: 'context-previous' },
      { ...ANTHROPIC_MESSAGES[1], body_text: Array.from({ length: 80 }, (_, index) => `Email detail line ${index}`).join('\n') },
    ]
    await page.route('**/api/mailbox/messages/anthropic-2/thread', (route) =>
      route.fulfill({ json: { thread: { id: 'provider-thread-2', account_id: ACCOUNT.id }, messages: conversation } })
    )
    const row = page.locator('[data-testid="mailbox-message-slot"][data-message-id="anthropic-2"] [data-testid="mailbox-message-row"]')
    await row.click()
    const reader = page.getByTestId('mailbox-thread-scroll')
    const selected = reader.getByTestId('mailbox-thread-message').filter({
      has: page.locator('[data-testid="mailbox-thread-message-header"][data-message-id="anthropic-2"]'),
    })
    await expect(selected.getByText('Selected message', { exact: true })).toBeVisible()
    const previous = reader.locator('[data-testid="mailbox-thread-message-header"][data-message-id="context-previous"]')
    await expect(previous).toHaveAttribute('aria-expanded', 'false')
    const checkAnchor = async () => {
      await expect.poll(async () => {
        const headerBox = (await previous.boundingBox())!
        const readerBox = (await reader.boundingBox())!
        return Math.abs(headerBox.y - readerBox.y)
      }).toBeLessThanOrEqual(2)
    }
    await checkAnchor()
    await page.locator('[data-testid="mailbox-message-slot"][data-message-id="anthropic-1"] [data-testid="mailbox-message-row"]').click()
    await expect(page.getByRole('button', { name: 'Move 1 emails to provider trash' })).toBeEnabled()
    await page.getByRole('button', { name: 'Move 1 emails to provider trash' }).click()
    await page.getByRole('button', { name: 'Move to trash', exact: true }).last().click()
    await expect(selected.getByText('Selected message', { exact: true })).toBeVisible()
    await checkAnchor()
  })

  for (const width of [390, 1280]) {
    test(`opens a sent reply before sync and removes its notice after four seconds at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      const source = { ...ANTHROPIC_MESSAGES[0], from_email: 'recipient@example.com' }
      let synced = false
      let releaseSync!: () => void
      const waitForSync = new Promise<void>((resolve) => { releaseSync = resolve })
      const sentAt = new Date().toISOString()
      const imported = {
        ...source, id: 'confirmed-sent-reply', provider_message_id: 'provider-reply',
        from_email: ACCOUNT.address, to_emails: 'recipient@example.com',
        subject: `Re: ${source.subject}`, body_text: 'Browser test sent reply',
        received_at: sentAt, is_read: true, is_provider_sent: true,
      }
      await page.route('**/api/mailbox/messages/anthropic-1/thread', (route) => route.fulfill({
        json: { thread: { id: 'provider-thread-1', account_id: ACCOUNT.id }, messages: synced ? [source, imported] : [source] },
      }))
      await page.route('**/api/mailbox/drafts', async (route) => {
        expect(route.request().postDataJSON()).toMatchObject({
          to_emails: ['recipient@example.com'], cc_emails: [], bcc_emails: [],
        })
        await route.fulfill({ json: { draft: { ...route.request().postDataJSON(), id: 'reply-draft' } } })
      })
      await page.route('**/api/mailbox/drafts/reply-draft/send', (route) => route.fulfill({
        json: { draft: { sent_at: sentAt }, provider_message_id: 'provider-reply' },
      }))
      await page.route('**/api/mailbox/accounts/acct-anthropic/sync', async (route) => {
        await waitForSync
        synced = true
        await route.fulfill({ json: { success: true } })
      })
      await page.getByTestId('mailbox-message-row').first().click()
      await page.getByRole('button', { name: 'Reply', exact: true }).click()
      await page.getByPlaceholder('Write your message').fill('Browser test sent reply')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      const notice = page.getByText('Message sent to recipient@example.com', { exact: true })
      await expect(notice).toBeVisible()
      const local = page.locator('[data-testid="mailbox-thread-message"][data-message-id="sent-draft:reply-draft"]')
      await expect(local.getByText('Selected message', { exact: true })).toBeVisible()
      await expect(local.getByText('Browser test sent reply', { exact: true })).toBeVisible()
      await expect(page.getByText('Open thread', { exact: true })).toHaveCount(0)
      await expect(notice).toHaveCount(0, { timeout: 5000 })
      releaseSync()
      const canonical = page.locator('[data-testid="mailbox-thread-message"][data-message-id="confirmed-sent-reply"]')
      await expect(canonical.getByText('Selected message', { exact: true })).toBeVisible()
      await expect(local).toHaveCount(0)
      await expect(page.getByText('Browser test sent reply', { exact: true })).toHaveCount(1)
    })
  }

  test('Mailbox closes the reader without resetting search or reopening it after section navigation', async ({ page }) => {
    const navigation = page.getByTestId('mailbox-mobile-navigation')
    const search = page.getByPlaceholder('Search subject, sender, recipients, and content')
    await search.fill('Anthropic')
    const scroller = page.getByTestId('mailbox-inbox-scroll')
    const scrollTop = await scroller.evaluate((node) => {
      node.scrollTop = 80
      node.dispatchEvent(new Event('scroll', { bubbles: true }))
      return node.scrollTop
    })
    await page.getByTestId('mailbox-message-row').filter({ hasText: 'Anthropic' }).first().click()
    await expect(page.getByRole('heading', { name: 'Thread Viewer', exact: true })).toBeVisible()
    await navigation.getByRole('button', { name: 'Mailbox', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Thread Viewer', exact: true })).toHaveCount(0)
    await expect(search).toHaveValue('Anthropic')
    expect(await scroller.evaluate((node) => node.scrollTop)).toBe(scrollTop)
    await navigation.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(navigation.getByRole('button', { name: 'Learner Guide' })).toHaveCount(0)
    await navigation.getByRole('button', { name: 'Mailbox', exact: true }).click()
    await expect(search).toHaveValue('Anthropic')
    await expect(page.getByRole('heading', { name: 'Thread Viewer', exact: true })).toHaveCount(0)
  })

  test('a pending email load cannot reopen the reader after selecting Mailbox', async ({ page }) => {
    let releaseResponse!: () => void
    const pendingResponse = new Promise<void>((resolve) => { releaseResponse = resolve })
    await page.route('**/api/mailbox/messages/anthropic-1/thread', async (route) => {
      await pendingResponse
      await route.fulfill({ json: { thread: { id: 'provider-thread-1' }, messages: [ANTHROPIC_MESSAGES[0]] } })
    })
    const request = page.waitForRequest('**/api/mailbox/messages/anthropic-1/thread')
    await page.getByTestId('mailbox-message-row').filter({ hasText: 'Anthropic' }).first().click()
    await request
    await page.getByTestId('mailbox-mobile-navigation').getByRole('button', { name: 'Mailbox', exact: true }).click()
    const response = page.waitForResponse('**/api/mailbox/messages/anthropic-1/thread')
    releaseResponse()
    await response
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Thread Viewer', exact: true })).toHaveCount(0)
  })

  test('desktop keeps its animated navigation instead of the mobile row', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.getByTestId('mailbox-main-tabs')).toBeVisible()
    await expect(page.getByTestId('mailbox-mobile-navigation')).toHaveCount(0)
    await page.locator('button[aria-controls="mailbox-learner-guide"]:visible').click()
    await expect(page.getByTestId('mailbox-guide-panels')).toHaveCSS('flex-direction', 'row')
  })
})
