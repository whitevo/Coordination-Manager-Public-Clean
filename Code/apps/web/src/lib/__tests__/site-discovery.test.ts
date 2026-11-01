import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PUBLIC_PAGES, SITE_ORIGIN, SITE_TAGLINE, discoveryBody, discoveryHead,
  escapeHtml, findDiscoveryPage, llmsTxt, robotsTxt, sitemapXml, structuredData,
} from '../../../../../shared/site-discovery'
import { discoveryPreviewPath, renderDiscoveryHtml } from '../../../scripts/discovery-plugin'

describe('public site discovery', () => {
  it.each(['bundle', 'native'])('loads both Vite configs with the %s loader without compatibility warnings', (loader) => {
    const script = `
      import assert from 'node:assert/strict'
      import { resolve } from 'node:path'
      import { loadConfigFromFile } from 'vite'

      for (const app of ['web', 'docs']) {
        const root = resolve('..', app)
        const result = await loadConfigFromFile(
          { command: 'build', mode: 'production' },
          resolve(root, 'vite.config.ts'), root, undefined, undefined, ${JSON.stringify(loader)}
        )
        assert.ok(result)
        assert.equal(result.config.resolve.alias['@'], resolve(root, 'src'))
        assert.ok(result.config.plugins.some(plugin => plugin.name === 'public-site-discovery'))
        if (app === 'docs') {
          assert.equal(result.config.base, '/docs/')
          assert.deepEqual(result.config.server.fs.allow, [resolve(root, '../../..')])
        }
      }
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      timeout: 20_000,
    })
    expect(result.error).toBeUndefined()
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  }, 30_000)

  it('uses current copy consistently in metadata, static text, and agent guidance', () => {
    const page = PUBLIC_PAGES[0]
    expect(page.description.length).toBeLessThanOrEqual(160)
    const head = new DOMParser().parseFromString(discoveryHead(page), 'text/html')
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
      expect(head.querySelector(selector)?.getAttribute('content')).toContain(SITE_TAGLINE)
    }
    expect(discoveryBody(page)).toContain(SITE_TAGLINE)
    expect(llmsTxt()).toContain(SITE_TAGLINE)
    expect(llmsTxt()).toContain('Human approval')
    expect(head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(`${SITE_ORIGIN}/og-image-current.png`)
    expect(head.querySelector('meta[property="og:image:alt"]')?.getAttribute('content')).toBe(SITE_TAGLINE)
  })

  it('generates parseable sitemap and structured data for approved public routes only', () => {
    const sitemap = new DOMParser().parseFromString(sitemapXml(), 'application/xml')
    expect(sitemap.querySelector('parsererror')).toBeNull()
    const urls = [...sitemap.querySelectorAll('loc')].map(element => element.textContent)
    expect(urls).toEqual(PUBLIC_PAGES.map(page => `${SITE_ORIGIN}${page.path}`))
    expect(new Set(urls).size).toBe(urls.length)
    for (const page of PUBLIC_PAGES) {
      const schema = JSON.parse(structuredData(page))
      expect(schema['@context']).toBe('https://schema.org')
      expect(schema['@graph'][1].url).toBe(`${SITE_ORIGIN}${page.path}`)
      expect(discoveryBody(page)).not.toContain('href="/mailbox"')
    }
    for (const path of ['/calendar/privatehash', '/meeting/private-id', '/mailbox', '/auth/callback', '/join/invite/secret', '/admin/users', '/missing']) {
      expect(findDiscoveryPage(path)).toBeUndefined()
      expect(urls).not.toContain(`${SITE_ORIGIN}${path}`)
    }
    expect(findDiscoveryPage('/calendars/')).toEqual(findDiscoveryPage('/calendars'))
  })

  it('does not accidentally block the public calendars listing', () => {
    const directives = robotsTxt().split('\n').filter(line => line.startsWith('Disallow: '))
      .map(line => line.slice('Disallow: '.length))
    for (const page of PUBLIC_PAGES) {
      expect(directives.some(rule => rule.endsWith('$')
        ? page.path === rule.slice(0, -1)
        : page.path.startsWith(rule))).toBe(false)
    }
    expect(robotsTxt()).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`)
  })

  it('escapes HTML and replaces content without duplicating metadata or removing app assets', () => {
    expect(escapeHtml('<"a"&>')).toBe('&lt;&quot;a&quot;&amp;&gt;')
    const template = readFileSync(resolve('index.html'), 'utf8')
    const home = renderDiscoveryHtml(template, PUBLIC_PAGES[0])
    const calendars = renderDiscoveryHtml(home, PUBLIC_PAGES[1])
    const document = new DOMParser().parseFromString(calendars, 'text/html')
    expect(document.querySelectorAll('title')).toHaveLength(1)
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE_ORIGIN}/calendars`)
    expect(document.querySelector('#root h1')?.textContent).toBe('Coordination Calendars')
    expect(document.querySelector('script[src="/src/main.tsx"]')).not.toBeNull()
    expect(document.querySelector('script[src="/asset-recovery.js"]')).not.toBeNull()
    expect(() => renderDiscoveryHtml('<html></html>', PUBLIC_PAGES[0])).toThrow('markers are missing')
    const privateShell = new DOMParser().parseFromString(renderDiscoveryHtml(home), 'text/html')
    expect(privateShell.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow')
    expect(privateShell.querySelector('link[rel="canonical"]')).toBeNull()
    expect(privateShell.querySelector('#site-structured-data')).toBeNull()
  })

  it('routes discovery assets and each public HTML file before SPA fallbacks', () => {
    const config = JSON.parse(readFileSync(resolve('vercel.json'), 'utf8')) as {
      rewrites: Array<{ source: string; destination: string }>
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
    }
    const docsFallback = config.rewrites.findIndex(rule => rule.source === '/docs/:path*')
    for (const page of PUBLIC_PAGES.filter(page => page.path !== '/')) {
      const index = config.rewrites.findIndex(rule => rule.source === page.path)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(docsFallback)
      expect(config.rewrites[index].destination).toBe(`${page.path}/index.html`)
    }
    for (const resource of ['/llms.txt', '/robots.txt', '/sitemap.xml']) {
      expect(config.rewrites.findIndex(rule => rule.source === resource)).toBeLessThan(docsFallback)
    }
    const privateHeader = config.headers.find(rule => rule.headers.some(header => header.key === 'X-Robots-Tag'))
    expect(privateHeader).toBeDefined()
    const pattern = new RegExp(`^${privateHeader?.source}$`)
    expect(pattern.test('/mailbox')).toBe(true)
    expect(pattern.test('/calendar/privatehash')).toBe(true)
    expect(pattern.test('/calendars')).toBe(false)
    expect(config.rewrites[config.rewrites.length - 1]?.destination).toBe('/app-shell.html')
  })

  it('serves public route HTML and noindex fallbacks in local production previews', () => {
    expect(discoveryPreviewPath('web', '/')).toBe('/index.html')
    expect(discoveryPreviewPath('web', '/calendars/?view=list')).toBe('/calendars/index.html?view=list')
    expect(discoveryPreviewPath('web', '/docs')).toBe('/docs/overview/index.html')
    expect(discoveryPreviewPath('web', '/docs/api/mailbox')).toBe('/docs/api/mailbox/index.html')
    expect(discoveryPreviewPath('docs', '/docs/overview')).toBe('/docs/overview/index.html')
    expect(discoveryPreviewPath('web', '/mailbox')).toBe('/app-shell.html')
    expect(discoveryPreviewPath('web', '/docs/missing')).toBe('/docs/app-shell.html')
    for (const asset of ['/llms.txt', '/robots.txt', '/sitemap.xml', '/asset-recovery.js', '/assets/app.js', '/docs/assets/app.js']) {
      expect(discoveryPreviewPath('web', asset)).toBe(asset)
    }
  })
})
