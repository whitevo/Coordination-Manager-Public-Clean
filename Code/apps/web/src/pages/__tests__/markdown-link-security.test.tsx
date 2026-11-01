import { describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MarkdownComposer } from '../time-management-markdown-composer'
import { isSafeNoteLinkTarget } from '../../lib/note-link-utils'

describe('Markdown note link security', () => {
  it.each([
    '/\\attacker.example', '//attacker.example', '/%5cattacker.example',
    '/%5C/attacker.example', '/\t/attacker.example', '/\n/attacker.example',
    'javascript:alert(1)', 'data:text/html,unsafe', 'https://', 'https://example.com\\evil',
  ])('rejects unsafe target %s', (target) => {
    expect(isSafeNoteLinkTarget(target)).toBe(false)
  })

  it.each([
    '/time-management', '/mailbox?tab=settings#accounts',
    '/notes/../time-management', '/notes/hello%20world',
    'https://example.com/notes', 'http://example.com',
  ])('preserves supported target %s', (target) => {
    expect(isSafeNoteLinkTarget(target)).toBe(true)
  })

  it('does not render origin-escaping links from stored Markdown', async () => {
    const { container } = render(<MarkdownComposer
      value={'[unsafe](/%5cattacker.example)\n\n[safe](/time-management)\n\n[external](https://example.com)'}
      onChange={() => undefined}
      placeholder="Notes"
    />)
    await waitFor(() => {
      expect(container.querySelector('a[href="/time-management"]')).not.toBeNull()
      expect(container.querySelector('a[href="https://example.com"]')).not.toBeNull()
    })
    expect(container.querySelector('a[href*="attacker.example"]')).toBeNull()
    expect(container.querySelector('a[href="https://example.com"]')?.getAttribute('rel')).toContain('noopener')
  })
})
