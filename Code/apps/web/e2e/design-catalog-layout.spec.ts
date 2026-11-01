import { test, expect, type Locator } from '@playwright/test'

test.use({ baseURL: process.env.E2E_DOCS_BASE_URL || 'http://localhost:5174' })

async function columnCount(grid: Locator) {
  return grid.evaluate(element =>
    getComputedStyle(element).gridTemplateColumns.split(' ').filter(track => parseFloat(track) > 0).length
  )
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/docs/design/catalog')
  await expect(page.getByRole('heading', { name: 'Component Catalog', exact: true })).toBeVisible()
})

for (const width of [1920, 2560]) {
  test(`fills available width and balances variant/theme columns at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1080 })
    await page.getByRole('button', { name: 'Select all', exact: true }).click()

    const single = page.locator('main section').filter({
      has: page.getByRole('heading', { name: 'Resource Reconciliation', exact: true }),
    })
    const singleVariants = single.locator(':scope > .grid')
    const singleCard = singleVariants.locator(':scope > div')
    await expect(singleCard).toHaveCount(1)
    const selectedThemes = await page.locator('fieldset input[type="checkbox"]').count()
    await expect(singleCard.locator('.cm-preview')).toHaveCount(selectedThemes)

    const sectionBox = await singleVariants.boundingBox()
    const cardBox = await singleCard.boundingBox()
    expect(sectionBox).not.toBeNull()
    expect(cardBox).not.toBeNull()
    expect(Math.abs(cardBox!.width - sectionBox!.width)).toBeLessThan(1)
    expect(sectionBox!.width).toBeGreaterThan(width - 360)

    const singleThemeColumns = await columnCount(singleCard.locator('.grid'))
    expect(singleThemeColumns).toBeGreaterThan(2)

    const multiple = page.locator('main section').filter({
      has: page.getByRole('heading', { name: 'Status Badge', exact: true }),
    })
    const variants = multiple.locator(':scope > .grid')
    expect(await columnCount(variants)).toBeGreaterThanOrEqual(width === 2560 ? 4 : 3)
    expect(await columnCount(variants.locator(':scope > div').first().locator('.grid')))
      .toBeLessThan(singleThemeColumns)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.cm-preview').evaluateAll(previews =>
      previews.every(preview => preview.scrollWidth <= preview.clientWidth + 1)
    )).toBe(true)
  })
}

test('reclaims width after filtering and keeps the theme explanation outside cards', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const primary = page.locator('main section').filter({
    has: page.getByRole('heading', { name: 'Primary Button', exact: true }),
  })
  const variants = primary.locator(':scope > .grid')
  await expect(variants.locator(':scope > div')).toHaveCount(2)
  const originalWidth = (await variants.locator(':scope > div').first().boundingBox())!.width

  await page.getByPlaceholder('Search components, recipes, pages, tags...').fill('Token primary')
  await expect(variants.locator(':scope > div')).toHaveCount(1)
  expect((await variants.locator(':scope > div').boundingBox())!.width).toBeGreaterThan(originalWidth * 1.9)
  await expect(page.getByText('Variants are implementations', { exact: false })).toHaveCount(1)
  await expect(page.getByText('Theme previews change primary', { exact: false })).toHaveCount(1)
  await expect(page.getByText('Primary and structural colors vary by theme.', { exact: false })).toHaveCount(0)

  await page.getByRole('button', { name: 'Clear search', exact: true }).click()
  await expect(variants.locator(':scope > div')).toHaveCount(2)
})

test('stacks on phones without overflow and preserves theme selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const variants = page.locator('main section').first().locator(':scope > .grid')
  expect(await columnCount(variants)).toBe(1)
  expect(await columnCount(variants.locator('.grid').first())).toBe(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.getByRole('button', { name: 'Deselect all', exact: true }).click()
  await expect(page.locator('.cm-preview')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Light', exact: true }).check()
  await expect(page.locator('main section').first().locator('.cm-preview')).toHaveCount(1)
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(page.locator('main section').first().locator('.cm-preview'))
    .toHaveCount(await page.locator('fieldset input[type="checkbox"]').count())
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.locator('.cm-preview').evaluateAll(previews =>
    previews.every(preview => preview.scrollWidth <= preview.clientWidth + 1)
  )).toBe(true)
})

test('keeps other docs pages constrained and respects the open AI panel', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const content = page.locator('main > div')
  const fullWidth = (await content.boundingBox())!.width
  await page.getByRole('button', { name: 'AI Search', exact: true }).first().click()
  await expect.poll(async () => (await content.boundingBox())!.width).toBeLessThan(fullWidth - 300)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  await page.goto('/docs/design/catalog/')
  await expect(page.getByRole('heading', { name: 'Component Catalog', exact: true })).toBeVisible()
  expect((await content.boundingBox())!.width).toBeCloseTo(fullWidth, 0)

  await page.goto('/docs/overview')
  await expect(page.getByRole('heading', { name: 'Component Catalog', exact: true })).toHaveCount(0)
  expect((await content.boundingBox())!.width).toBeLessThanOrEqual(896)
})
