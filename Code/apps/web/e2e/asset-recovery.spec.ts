import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const recoveryScript = readFileSync(resolve('public/asset-recovery.js'), 'utf8')
const route = '/time-management?view=week#notes'

test('missing startup JS and CSS recover once and show an unstyled usable fallback', async ({ page }) => {
  let navigations = 0
  await page.route('**/*', async intercepted => {
    const request = intercepted.request()
    if (new URL(request.url()).pathname === '/asset-recovery.js') {
      await intercepted.fulfill({ contentType: 'text/javascript', body: recoveryScript })
    } else if (request.isNavigationRequest()) {
      navigations++
      await intercepted.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><script src="/asset-recovery.js"></script><script type="module" src="/assets/missing-entry.js"></script><link rel="stylesheet" href="/assets/missing.css"></head><body><div id="root"></div></body></html>',
      })
    } else {
      await intercepted.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
    }
  })
  await page.goto(route, { waitUntil: 'commit' })
  await expect(page.getByRole('button', { name: 'Reload this page' })).toBeVisible()
  expect(navigations).toBe(2)
  expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(route)
})

test('late stylesheet failure offers manual recovery without discarding a draft', async ({ page }) => {
  let navigations = 0
  await page.route('**/*', async intercepted => {
    const request = intercepted.request()
    if (new URL(request.url()).pathname === '/asset-recovery.js') {
      await intercepted.fulfill({ contentType: 'text/javascript', body: recoveryScript })
    } else if (request.isNavigationRequest()) {
      navigations++
      await intercepted.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><head><script src="/asset-recovery.js"></script></head><body><textarea aria-label="Draft">Unsaved draft</textarea></body></html>',
      })
    } else {
      await intercepted.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
    }
  })
  await page.goto(route)
  await page.evaluate(() => {
    window.__assetRecovery?.markReady()
    const stylesheet = document.createElement('link')
    stylesheet.rel = 'stylesheet'
    stylesheet.href = '/assets/missing.css'
    document.head.appendChild(stylesheet)
  })
  await expect(page.getByRole('button', { name: 'Reload this page' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved draft')
  expect(navigations).toBe(1)
  await page.getByRole('button', { name: 'Reload this page' }).click()
  await expect.poll(() => navigations).toBe(2)
})
