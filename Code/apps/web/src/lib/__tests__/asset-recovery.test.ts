import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync(resolve('public/asset-recovery.js'), 'utf8')

function setup(options: { ready?: boolean; offline?: boolean; storageBlocked?: boolean; entry?: string } = {}) {
  document.body.innerHTML = '<div id="root"><textarea>Unsaved draft</textarea></div>'
  document.head.innerHTML = ''
  const entry = document.createElement('script')
  entry.type = 'module'
  entry.src = options.entry ?? '/assets/index-old.js'
  document.head.appendChild(entry)
  const reload = vi.fn()
  const events = new EventTarget()
  const storage = options.storageBlocked
    ? { getItem: () => { throw new Error('Storage blocked') }, setItem: vi.fn() }
    : sessionStorage
  const browser = {
    addEventListener: events.addEventListener.bind(events),
    location: {
      href: 'https://coordinationmanager.com/time-management?view=week#notes',
      origin: 'https://coordinationmanager.com',
      pathname: '/time-management',
      reload,
    },
    navigator: { onLine: !options.offline },
    sessionStorage: storage,
    __assetRecovery: undefined as Window['__assetRecovery'],
  }
  new Function('window', 'document', 'console', 'URL', source)(browser, document, console, URL)
  if (options.ready) browser.__assetRecovery?.markReady()
  return { browser, reload, events }
}

function preload(events: EventTarget, message = 'Failed to fetch dynamically imported module: /assets/page-old.js') {
  const event = new Event('vite:preloadError', { cancelable: true })
  Object.assign(event, { payload: new Error(message) })
  events.dispatchEvent(event)
  return event
}

describe('early application asset recovery', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('retries startup once, without changing the current route', () => {
    const { browser, reload, events } = setup()
    expect(preload(events).defaultPrevented).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
    expect(browser.location.href).toBe('https://coordinationmanager.com/time-management?view=week#notes')
    preload(events)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('shows a usable manual fallback after a failed retry instead of looping', () => {
    const first = setup()
    preload(first.events)
    const second = setup()
    preload(second.events)
    expect(second.reload).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Save or copy')
    document.querySelector<HTMLButtonElement>('#asset-recovery-notice button')?.click()
    expect(second.reload).toHaveBeenCalledOnce()
  })

  it('gives a different build its own bounded startup attempt', () => {
    preload(setup().events)
    const next = setup({ entry: '/assets/index-new.js' })
    preload(next.events)
    expect(next.reload).toHaveBeenCalledOnce()
  })

  it('preserves mounted content and drafts on late CSS preload failure', () => {
    const { reload, events } = setup({ ready: true })
    preload(events, 'Unable to preload CSS for /assets/index-old.css')
    preload(events)
    expect(reload).not.toHaveBeenCalled()
    expect(document.querySelector('textarea')?.value).toBe('Unsaved draft')
    expect(document.querySelectorAll('#asset-recovery-notice')).toHaveLength(1)
  })

  it.each([{ offline: true }, { storageBlocked: true }])('does not auto-reload without a safe retry: %j', options => {
    const { reload, events } = setup(options)
    preload(events)
    expect(reload).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })

  it.each([
    { tag: 'script', attribute: 'src', path: '/assets/index-old.js' },
    { tag: 'link', attribute: 'href', path: '/assets/index-old.css' },
  ])('handles missing startup resources before React runs: $path', ({ tag, attribute, path }) => {
    const { reload, events } = setup()
    const resource = document.createElement(tag)
    resource.setAttribute(attribute, 'https://coordinationmanager.com' + path)
    resource.setAttribute('rel', 'stylesheet')
    const event = new Event('error')
    // Resource error events have the failing element as their target.
    Object.defineProperty(event, 'target', { value: resource })
    events.dispatchEvent(event)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('leaves unrelated exceptions, API errors and external resource failures alone', () => {
    const { reload, events, browser } = setup()
    expect(preload(events, 'Cannot read properties of undefined').defaultPrevented).toBe(false)
    expect(browser.__assetRecovery?.handleError(new Error('Request failed with status code 401'))).toBe(false)
    for (const path of ['/api/health', 'https://example.com/assets/external.js']) {
      const script = document.createElement('script')
      script.src = path
      const event = new Event('error')
      Object.defineProperty(event, 'target', { value: script })
      events.dispatchEvent(event)
    }
    expect(reload).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('recognizes Safari and Firefox module failures', () => {
    const { browser, reload } = setup({ ready: true })
    expect(browser.__assetRecovery?.handleError(new Error('Importing a module script failed.'))).toBe(true)
    expect(browser.__assetRecovery?.handleError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('handles module rejections outside React without suppressing their diagnostics', () => {
    const { reload, events } = setup({ ready: true })
    const event = new Event('unhandledrejection', { cancelable: true })
    Object.assign(event, { reason: new Error('Importing a module script failed.') })
    events.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })
})
