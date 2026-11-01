import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const cssPath = fileURLToPath(new URL('../src/index.css', import.meta.url))
const result = await postcss([tailwind({ base: root })]).process(await readFile(cssPath, 'utf8'), {
  from: cssPath,
})
const missingSources = []
result.root.walkDecls((declaration) => {
  if (!declaration.source?.input.file) {
    missingSources.push(`${declaration.prop}: ${declaration.value}`)
  }
})
assert.deepEqual(missingSources, [], 'Every generated declaration needs a source filename for Vite')
console.log('[PASS] Docs PostCSS declarations retain source filenames')

const warnings = []
const originalWarn = console.warn
console.warn = (...args) => {
  warnings.push(args.join(' '))
  originalWarn(...args)
}
let server
try {
  server = await createServer({ root, server: { watch: null, ws: false } })
  // transformRequest takes a root-relative module ID, without the HTTP /docs/ base.
  const transformed = await server.transformRequest('/src/index.css')
  assert.ok(transformed?.code, 'Docs CSS must transform successfully')
  assert.equal(
    warnings.some((message) => message.includes('PostCSS plugin did not pass')),
    false,
    'Docs CSS must not emit the missing-from warning',
  )
  console.log('[PASS] Fresh Vite docs transform has no PostCSS missing-from warning')
} finally {
  try {
    await server?.close()
  } finally {
    console.warn = originalWarn
  }
}
