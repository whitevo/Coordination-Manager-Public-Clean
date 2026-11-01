import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_AI_API_KEY = process.env.AI_API_KEY

describe('generateDraftReply', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.AI_API_KEY
  })

  afterEach(() => {
    if (ORIGINAL_AI_API_KEY) process.env.AI_API_KEY = ORIGINAL_AI_API_KEY
    else delete process.env.AI_API_KEY
  })

  it('returns an unavailable result with a fallback subject when no AI provider is configured', async () => {
    const { generateDraftReply } = await import('../mailbox-draft.js')

    const result = await generateDraftReply({
      subject: 'Project timeline',
      fromEmail: 'a@example.com',
      fromName: 'A',
      toEmails: 'b@example.com',
      body: 'Can we meet Monday?',
      context: '',
      intent: 'Confirm Monday works',
    })

    expect(result.available).toBe(false)
    expect(result.subject).toBe('Re: Project timeline')
    expect(result.bodyText).toBe('')
    expect(result.reasoning).toContain('no AI provider configured')
  })

  it('returns an unavailable result when no intent is given, even with a provider configured', async () => {
    process.env.AI_API_KEY = 'test-key'
    const { generateDraftReply } = await import('../mailbox-draft.js')

    const result = await generateDraftReply({
      subject: 'Hi',
      fromEmail: null,
      fromName: null,
      toEmails: null,
      body: 'hello',
      context: '',
      intent: '',
    })

    expect(result.available).toBe(false)
    expect(result.reasoning).toContain('no intent was given')
  })

  it('parses a well-formed model reply and clamps the body length', async () => {
    process.env.AI_API_KEY = 'test-key'
    const { generateDraftReply } = await import('../mailbox-draft.js')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              subject: 'Re: Project timeline',
              body: 'Monday works for me. Let\'s confirm 2pm.',
              notes: 'Confirmed availability and proposed a time.',
            }),
          },
        }],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await generateDraftReply({
      subject: 'Project timeline',
      fromEmail: 'a@example.com',
      fromName: 'A',
      toEmails: 'b@example.com',
      body: 'Can we meet Monday?',
      context: 'Client wants to finalize scheduling.',
      intent: 'Confirm Monday works and propose 2pm.',
    })

    expect(result.available).toBe(true)
    expect(result.subject).toBe('Re: Project timeline')
    expect(result.bodyText).toContain('Monday works for me')
    expect(result.reasoning).toContain('Confirmed availability')

    vi.unstubAllGlobals()
  })
})
