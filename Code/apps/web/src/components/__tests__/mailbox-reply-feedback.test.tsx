import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MailboxReplyFeedback from '../mailbox-reply-feedback'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: { post } }))

beforeEach(() => { post.mockReset().mockResolvedValue({ data: {} }) })
afterEach(cleanup)

const suggestion = { instruction: 'Thank them', subject: 'Re: Meeting', body: 'Thank you for meeting with me.' }

describe('Mailbox reply suggestion feedback', () => {
  it('submits the original suggestion with a rating and optional comment only on explicit submission', async () => {
    render(<MailboxReplyFeedback {...suggestion} />)
    expect(post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Give feedback on AI reply' }))
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Sentiment grid' }), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Sentiment grid' }), { key: 'ArrowRight' })
    fireEvent.change(screen.getByRole('textbox', { name: 'AI reply feedback comment' }), { target: { value: 'Too formal' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' })) })
    expect(post).toHaveBeenCalledExactlyOnceWith('/api/ai-feedback', {
      user_prompt: 'Mailbox AI: Suggest reply\nThank them',
      ai_answer: 'Subject: Re: Meeting\n\nThank you for meeting with me.',
      sentiment_valence: 0.5, sentiment_trust: 0.5, feedback_text: 'Too formal',
    })
    expect(screen.getByRole('status')).toHaveTextContent('Thank you')
    expect(screen.queryByRole('button', { name: 'Submit feedback' })).not.toBeInTheDocument()
  })

  it('retains comments on failure and supports retry', async () => {
    post.mockRejectedValueOnce(new Error('Unavailable'))
    render(<MailboxReplyFeedback {...suggestion} />)
    fireEvent.click(screen.getByRole('button', { name: 'Give feedback on AI reply' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Please improve' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not submit')
    expect(screen.getByRole('textbox')).toHaveValue('Please improve')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' })) })
    expect(post).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('blocks duplicate submissions while pending', async () => {
    let finish!: () => void
    post.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    render(<MailboxReplyFeedback {...suggestion} />)
    fireEvent.click(screen.getByRole('button', { name: 'Give feedback on AI reply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }))
    expect(screen.getByRole('button', { name: 'Submitting feedback...' })).toBeDisabled()
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(post).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
