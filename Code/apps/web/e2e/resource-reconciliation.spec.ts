import { expect, test } from '@playwright/test'

const CATALOG_URL = `${process.env.E2E_DOCS_BASE_URL ?? 'http://localhost:5174/docs'}/design/catalog`

test('batch exits do not resurrect after stale refresh or completion', async ({ page }) => {
  await page.goto(CATALOG_URL)
  const fixture = page.getByTestId('resource-contract-demo').first()
  await expect(fixture).toBeVisible()
  await fixture.getByRole('button', { name: 'Trash selected emails', exact: true }).click()
  await expect(fixture.getByTestId('resource-contract-count')).toHaveText('2')
  await fixture.getByRole('button', { name: 'Replay stale refresh', exact: true }).click()
  await expect(fixture.getByTestId('resource-contract-invoice')).toHaveCount(0)
  await expect(fixture.getByTestId('resource-contract-newsletter')).toHaveCount(0)
  await fixture.getByRole('button', { name: 'Complete pending save', exact: true }).click()
  await fixture.getByRole('button', { name: 'Replay stale refresh', exact: true }).click()
  await expect(fixture.getByTestId('resource-contract-count')).toHaveText('2')
  await expect(fixture.getByTestId('resource-contract-invoice')).toHaveCount(0)
  await expect(fixture.getByTestId('resource-contract-newsletter')).toHaveCount(0)
  await expect(fixture.locator('[role="status"]')).toHaveText('Saved')
})

test('phone reduced motion removes ghosts and partial failure restores only one row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(CATALOG_URL)
  const fixture = page.getByTestId('resource-contract-demo').first()
  await fixture.getByRole('button', { name: 'Trash selected emails', exact: true }).click()
  await expect(fixture.getByTestId('resource-contract-count')).toHaveText('2')
  await expect(fixture.getByTestId('resource-contract-invoice')).toHaveCount(0)
  await expect(fixture.getByTestId('resource-contract-newsletter')).toHaveCount(0)
  await fixture.getByRole('button', { name: 'Reject newsletter action', exact: true }).click()
  await expect(fixture.getByTestId('resource-contract-count')).toHaveText('3')
  await expect(fixture.getByTestId('resource-contract-invoice')).toHaveCount(0)
  await expect(fixture.getByTestId('resource-contract-newsletter')).toHaveCount(1)
})