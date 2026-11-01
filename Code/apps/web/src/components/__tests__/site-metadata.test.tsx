import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import SiteMetadata from '../site-metadata'
import { SITE_ORIGIN, SITE_TAGLINE } from '../../../../../shared/site-discovery'

function Navigation() {
  const navigate = useNavigate()
  return <>
    <button onClick={() => navigate('/mailbox')}>Mailbox</button>
    <button onClick={() => navigate('/calendars')}>Calendars</button>
  </>
}

afterEach(() => {
  cleanup()
  document.head.querySelectorAll('meta, link[rel="canonical"], #site-structured-data').forEach(element => element.remove())
})

describe('SPA site metadata', () => {
  it('updates route metadata and removes public canonical and schema on private pages', async () => {
    render(<MemoryRouter><SiteMetadata /><Navigation /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toContain(SITE_TAGLINE))
    fireEvent.click(screen.getByText('Mailbox'))
    await waitFor(() => expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow'))
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
    expect(document.getElementById('site-structured-data')).toBeNull()
    expect(document.querySelector('meta[property="og:url"]')).toBeNull()
    fireEvent.click(screen.getByText('Calendars'))
    await waitFor(() => expect(document.title).toBe('Coordination Calendars | Coordination Manager'))
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE_ORIGIN}/calendars`)
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('index, follow')
    expect(JSON.parse(document.getElementById('site-structured-data')?.textContent ?? '')['@graph'][1].url).toBe(`${SITE_ORIGIN}/calendars`)
  })

  it('uses the docs base path for documentation canonicals', async () => {
    render(<MemoryRouter initialEntries={['/api/mailbox']}><SiteMetadata docs /></MemoryRouter>)
    await waitFor(() => expect(document.title).toBe('Mailbox API | Coordination Manager'))
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(`${SITE_ORIGIN}/docs/api/mailbox`)
  })

  it('does not index unknown routes', async () => {
    render(<MemoryRouter initialEntries={['/does-not-exist']}><SiteMetadata /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow'))
    expect(document.querySelector('link[rel="canonical"]')).toBeNull()
  })
})
