import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const guidePath = fileURLToPath(new URL('../dist/llms.txt', import.meta.url))
const outputPath = fileURLToPath(new URL('../public/og-image-current.png', import.meta.url))
const tagline = readFileSync(guidePath, 'utf8').split('\n').find(line => line.startsWith('> '))?.slice(2)
if (!tagline) throw new Error('Build the web app first: dist/llms.txt must contain the current tagline.')
const channelIndex = process.argv.indexOf('--channel')
const channel = channelIndex >= 0 ? process.argv[channelIndex + 1] : undefined
if (channelIndex >= 0 && !channel) throw new Error('--channel requires a browser channel name.')
const browser = await chromium.launch(channel ? { channel } : {})
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: 1200px; height: 630px; color: #f1f5f9; font-family: Arial, sans-serif;
      background: radial-gradient(ellipse at 85% 15%, #164e63, transparent 60%), linear-gradient(135deg, #0f172a, #172554); }
    main { padding: 72px; height: 100%; border: 2px solid #334155; }
    .eyebrow { color: #67e8f9; font-size: 22px; letter-spacing: 4px; margin: 0 0 30px; }
    h1 { font-size: 72px; letter-spacing: -2px; margin: 0 0 32px; }
    h1 span { color: #a3e635; }
    .tagline { font-size: 36px; line-height: 1.4; max-width: 1000px; margin: 0; }
    footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid #475569; color: #a5f3fc; font-size: 25px; }
  </style></head><body><main>
    <p class="eyebrow">TIME / CONVERSATIONS / COMMUNITY</p>
    <h1>Coordination <span>Manager</span></h1>
    <p class="tagline"></p>
    <footer>coordinationmanager.com</footer>
  </main></body></html>`)
  await page.locator('.tagline').evaluate((element, text) => { element.textContent = text }, tagline)
  const footer = await page.locator('footer').boundingBox()
  if (!footer || footer.y + footer.height > 600) throw new Error('Social preview content exceeds the safe image area.')
  await page.screenshot({ path: outputPath })
  console.log(`Generated ${outputPath} (1200x630) from the built agent guide.`)
} finally {
  await browser.close()
}
