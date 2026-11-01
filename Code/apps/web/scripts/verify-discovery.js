import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const read = relative => readFileSync(path.join(dist, relative), 'utf8')
const sitemap = read('sitemap.xml')
const guide = read('llms.txt')
const tagline = guide.split('\n').find(line => line.startsWith('> '))?.slice(2)
assert.ok(tagline, 'Agent guide must contain the tagline')
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
assert.ok(locations.length > 0, 'Sitemap must list public pages')
assert.equal(new Set(locations).size, locations.length, 'Sitemap URLs must be unique')

for (const location of locations) {
  const url = new URL(location)
  assert.equal(url.origin, 'https://coordinationmanager.com')
  const relative = url.pathname === '/' ? 'index.html' : `${url.pathname.slice(1)}/index.html`
  const html = read(relative)
  assert.ok(html.includes(`<link rel="canonical" href="${location}" />`), `Canonical mismatch: ${relative}`)
  assert.ok(html.includes('<meta name="robots" content="index, follow" />'), `Public indexing missing: ${relative}`)
  assert.ok(html.includes('<nav aria-label="Public pages and documentation">'), `Static navigation missing: ${relative}`)
  const data = html.match(/<script id="site-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]
  assert.ok(data, `Structured data missing: ${relative}`)
  assert.equal(JSON.parse(data)['@graph'][1].url, location, `Structured URL mismatch: ${relative}`)
  assert.ok(guide.includes(location), `Agent guide link missing: ${relative}`)
  for (const match of html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)) {
    assert.ok(existsSync(path.join(dist, match[1].slice(1))), `Built asset missing: ${match[1]}`)
  }
}

for (const shell of ['app-shell.html', 'docs/app-shell.html']) {
  const html = read(shell)
  assert.ok(html.includes('<meta name="robots" content="noindex, follow" />'), `Fallback must not be indexed: ${shell}`)
  assert.ok(!html.includes('rel="canonical"'), `Fallback must not inherit a canonical: ${shell}`)
}
assert.ok(read('index.html').includes(tagline), 'Homepage HTML must match the agent tagline')
assert.ok(read('docs/overview/index.html').includes(tagline), 'Docs HTML must match the agent tagline')
assert.ok(read('robots.txt').includes('Sitemap: https://coordinationmanager.com/sitemap.xml'))
const image = readFileSync(path.join(dist, 'og-image-current.png'))
assert.equal(image.subarray(1, 4).toString(), 'PNG')
assert.equal(image.readUInt32BE(16), 1200, 'Preview width must match metadata')
assert.equal(image.readUInt32BE(20), 630, 'Preview height must match metadata')
console.log(`Verified ${locations.length} public HTML pages, linked build assets, discovery resources, noindex shells, and the 1200x630 preview.`)
