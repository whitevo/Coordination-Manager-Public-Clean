/**
 * E2E: Design system baselines (ARIA snapshots + screenshots)
 *
 * Purpose:
 *   Records the approved design state of key public pages so UI/UX change
 *   proposals can be validated against the design contract
 *   (.claude/skills/design-system/references/workflow.md).
 *
 * Pre-conditions:
 *   - Dev stack running (pnpm dev:stack from repo root) or E2E_BASE_URL set
 *   - No auth required: only public routes are covered here
 *
 * What it captures per page x theme (light + dark):
 *   1. ARIA snapshot of <body> -- catches semantic/structure drift
 *      (roles, names, states) that screenshots miss.
 *   2. Full-page screenshot -- catches token, spacing, and radius drift.
 *
 * Conventions:
 *   - Snapshot names use stable logical IDs (home, calendars, ...), never
 *     visible copy, so renames of labels do not rename baselines.
 *   - Theme is forced via localStorage before app boot; ThemeContext reads
 *     'theme-preferences' on load ('theme-mode' is the legacy key).
 *   - Reduced motion is emulated for deterministic captures.
 *   - Infinite pulse animations (unmarked slots, attachments) can cause
 *     small pixel diffs; maxDiffPixelRatio below absorbs them. Tighten the
 *     locator to a region if a page proves flaky.
 *
 * Recording baselines (intentional design change only):
 *   npx playwright test e2e/design-snapshot.spec.ts -u
 */
import { test, expect, type Page } from '@playwright/test'

const PAGES = [
  { id: 'home', path: '/' },
  { id: 'calendars', path: '/calendars' },
  { id: 'support', path: '/support' },
  { id: 'privacy', path: '/privacy' },
] as const

const THEMES = ['light', 'dark'] as const

async function forceTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.addInitScript((mode) => {
    localStorage.setItem(
      'theme-preferences',
      JSON.stringify({ mode, darkThemeId: null, lightThemeId: null, customThemes: [] })
    )
    localStorage.setItem('theme-mode', mode)
  }, theme)
}

async function stubApi(page: Page) {
  // Deterministic empty payloads; extend per page as needed (see
  // mailbox-tab-animation.spec.ts for the stubbing pattern).
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }))
}

for (const target of PAGES) {
  for (const theme of THEMES) {
    test(`${target.id} [${theme}] matches design baselines`, async ({ page }) => {
      await forceTheme(page, theme)
      await stubApi(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })

      await page.goto(target.path)
      await page.waitForLoadState('networkidle')

      // Semantic structure baseline
      await expect(page.locator('body')).toMatchAriaSnapshot({
        name: `${target.id}-${theme}.aria.yml`,
      })

      // Pixel baseline
      await expect(page).toHaveScreenshot(`${target.id}-${theme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      })
    })
  }
}
