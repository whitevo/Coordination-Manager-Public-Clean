import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLookup = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('dns/promises', () => ({
  lookup: mockLookup,
}))

vi.stubGlobal('fetch', mockFetch)

import { fetchPublicCalendarUrl } from '../public-calendar-fetch.js'

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } })
}

describe('fetchPublicCalendarUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLookup.mockImplementation(async (host: string) => {
      if (host === 'internal.example.com') return [{ address: '10.0.0.5', family: 4 }]
      return [{ address: '93.184.216.34', family: 4 }]
    })
  })

  it('returns a normal response without redirects, using redirect: manual', async () => {
    mockFetch.mockResolvedValueOnce(new Response('BEGIN:VCALENDAR', { status: 200 }))

    const res = await fetchPublicCalendarUrl('https://example.com/feed.ics')

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('follows a redirect to another public https host', async () => {
    mockFetch
      .mockResolvedValueOnce(redirect('https://cdn.example.org/feed.ics'))
      .mockResolvedValueOnce(new Response('BEGIN:VCALENDAR', { status: 200 }))

    const res = await fetchPublicCalendarUrl('https://example.com/feed.ics')

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1][0]).toBe('https://cdn.example.org/feed.ics')
  })

  it('resolves relative redirect locations', async () => {
    mockFetch
      .mockResolvedValueOnce(redirect('/other.ics', 301))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    await fetchPublicCalendarUrl('https://example.com/feed.ics')

    expect(mockFetch.mock.calls[1][0]).toBe('https://example.com/other.ics')
  })

  it('rejects a redirect to a private IP literal', async () => {
    mockFetch.mockResolvedValueOnce(redirect('https://169.254.169.254/latest/meta-data/'))

    await expect(fetchPublicCalendarUrl('https://example.com/feed.ics')).rejects.toThrow(/private or internal/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a redirect to a hostname that resolves to a private address', async () => {
    mockFetch.mockResolvedValueOnce(redirect('https://internal.example.com/feed.ics'))

    await expect(fetchPublicCalendarUrl('https://example.com/feed.ics')).rejects.toThrow(/private or internal/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects a redirect to localhost and to plain http', async () => {
    mockFetch.mockResolvedValueOnce(redirect('https://localhost/admin'))
    await expect(fetchPublicCalendarUrl('https://example.com/feed.ics')).rejects.toThrow(/private or internal/)

    mockFetch.mockResolvedValueOnce(redirect('http://example.com/feed.ics'))
    await expect(fetchPublicCalendarUrl('https://example.com/feed.ics')).rejects.toThrow(/HTTPS/)
  })

  it('rejects an initial URL that points at a private address without fetching', async () => {
    await expect(fetchPublicCalendarUrl('https://internal.example.com/feed.ics')).rejects.toThrow(/private or internal/)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects after more than 3 redirects', async () => {
    mockFetch.mockImplementation(async () => redirect('https://example.com/next.ics'))

    await expect(fetchPublicCalendarUrl('https://example.com/feed.ics')).rejects.toThrow(/too many times/)
    expect(mockFetch).toHaveBeenCalledTimes(4)
  })

  it('rejects a redirect without a Location header', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 302 }))

    await expect(fetchPublicCalendarUrl('https://example.com/feed.ics')).rejects.toThrow(/without a destination/)
  })
})
