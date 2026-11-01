import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

function builtCss(app: 'web' | 'docs') {
  const assets = path.resolve(process.cwd(), '..', app, 'dist', 'assets')
  const files = readdirSync(assets).filter(file => file.endsWith('.css'))
  if (files.length === 0) throw new Error(`Build ${app} before running the CSS compatibility tests`)
  return files.map(file => readFileSync(path.join(assets, file), 'utf8')).join('\n')
}

for (const app of ['web', 'docs'] as const) {
  test(`${app} compiled CSS preserves light, dark, and local theme tokens`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setContent(`
      <section id="surface" class="${app === 'docs' ? 'cm-preview' : ''}">
        <button id="action" class="bg-primary text-primary-foreground rounded-lg border border-border">Action</button>
        <div id="small" class="rounded-sm">Small radius</div>
        <div id="responsive" class="flex flex-col lg:flex-row">Responsive</div>
        <div id="highlight" class="design-catalog-highlight">Highlight</div>
      </section>
    `)
    await page.addStyleTag({ content: builtCss(app) })
    const action = page.locator('#action')
    await expect(action).toHaveCSS('background-color', 'rgb(15, 23, 41)')
    await expect(action).toHaveCSS('color', 'rgb(250, 250, 250)')
    await expect(action).toHaveCSS('border-radius', app === 'web' ? '9px' : '8px')
    await expect(page.locator('#small')).toHaveCSS('border-radius', app === 'web' ? '5px' : '4px')
    await page.evaluate((target) => {
      if (target === 'docs') document.querySelector('#surface')?.classList.add('cm-dark')
      else document.documentElement.classList.add('dark')
    }, app)
    await expect(action).toHaveCSS('background-color', 'rgb(250, 250, 250)')
    await expect(action).toHaveCSS('color', 'rgb(15, 23, 41)')
    await page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>('#surface')
      if (!surface) throw new Error('Theme fixture is missing')
      surface.style.setProperty('--primary', '142 71% 45%')
    })
    await expect(action).toHaveCSS('background-color', 'rgb(33, 196, 93)')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('#responsive')).toHaveCSS('flex-direction', 'column')
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('#responsive')).toHaveCSS('flex-direction', 'row')
    if (app === 'web') {
      await expect(page.locator('#highlight')).toHaveCSS('animation-name', 'none')
    }
  })
}

test('web container stays fluid below its cap without invalid percentage media queries', async ({ page }) => {
  await page.setContent('<div class="container">Container</div>')
  await page.addStyleTag({ content: builtCss('web') })
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(page.locator('.container')).toHaveCSS('max-width', 'none')
  await page.setViewportSize({ width: 2000, height: 900 })
  await expect(page.locator('.container')).toHaveCSS('max-width', '1800px')
})
