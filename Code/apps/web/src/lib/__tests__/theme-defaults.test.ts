import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COLOR_VAR_MAP,
  DEFAULT_DARK,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT,
  PRESET_THEMES,
  createDefaultThemePreferences,
  type ThemeColors,
} from '../theme-types'

// Git stores these files with LF; CSP hashes are computed on the LF form Vercel builds from.
const read = (path: string) => readFileSync(resolve(path), 'utf8').replace(/\r\n/g, '\n')
const indexCss = read('src/index.css')
const indexHtml = read('index.html')
const vercelJson = read('vercel.json')

function cssBlockVars(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(indexCss)
  if (!match) throw new Error(`No ${selector} block in index.css`)
  const vars: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const decl = /^\s*(--[\w-]+)\s*:\s*([^;]+);/.exec(line)
    if (decl) vars[decl[1]] = decl[2].trim()
  }
  return vars
}

function expectMatchesCss(colors: ThemeColors, selector: string) {
  const css = cssBlockVars(selector)
  for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
    expect({ key, value: colors[key as keyof ThemeColors] }).toEqual({ key, value: css[cssVar] })
  }
}

describe('default theme palettes', () => {
  it('DEFAULT_LIGHT matches the :root tokens in index.css', () => {
    expectMatchesCss(DEFAULT_LIGHT, ':root')
  })

  it('DEFAULT_DARK matches the .dark tokens in index.css', () => {
    expectMatchesCss(DEFAULT_DARK, '.dark')
  })
})

describe('new-user default theme (Dark Forest)', () => {
  const forest = PRESET_THEMES.find(theme => theme.id === DEFAULT_DARK_THEME_ID)

  it('is the Forest preset in dark mode', () => {
    expect(forest?.name).toBe('Forest')
    expect(createDefaultThemePreferences()).toEqual({
      mode: 'dark',
      darkThemeId: 'preset-forest',
      lightThemeId: null,
      customThemes: [],
    })
  })

  it('index.html paints the same Forest values before React mounts', () => {
    expect(forest).toBeDefined()
    for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
      const value = forest?.colors[key as keyof ThemeColors]
      expect(indexHtml).toContain(`'${cssVar}': '${value}'`)
    }
    expect(indexHtml).toContain(`'${DEFAULT_DARK_THEME_ID}'`)
  })

  it('vercel.json CSP allows the current inline bootstrap script by hash', () => {
    const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
    expect(scripts).toHaveLength(1)
    const hash = createHash('sha256').update(scripts[0]).digest('base64')
    expect(vercelJson).toContain(`'sha256-${hash}'`)
  })
})
