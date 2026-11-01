import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AiChatPage from '../AiChatPage'
import { apiClient } from '../../lib/api-client'

vi.mock('../../lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { roles: [], themePreferences: null } }),
}))
vi.mock('../../components/SentimentGrid', () => ({ default: () => null }))
vi.mock('../../components/LearnerHelpIcon', () => ({ default: () => null }))

describe('AiChatPage message handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.mocked(apiClient.get).mockResolvedValue({ data: { available: true, remaining: 10, limit: 10 } })
    vi.mocked(apiClient.post).mockResolvedValue({ data: { message: 'Hello', remaining: 9, limit: 10 } })
  })

  it('sends literal text and expands the complete submitted message', async () => {
    const content = `  **Heading**\n\n${'  item\n'.repeat(12)}`
    render(<AiChatPage />)
    const input = await screen.findByRole('textbox', { name: 'Message to AI' })
    fireEvent.change(input, { target: { value: content } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/ai-chat', expect.objectContaining({ message: content })))
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByText(/\*\*Heading\*\*/).textContent).toBe(content)
    expect(await screen.findByText('AI prompts left today: 9 of 10')).toBeInTheDocument()
  })

  it('retains oversized drafts and explains the limit without submitting', async () => {
    render(<AiChatPage />)
    const input = await screen.findByRole('textbox', { name: 'Message to AI' })
    const content = 'x'.repeat(4001)
    fireEvent.change(input, { target: { value: content } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(input).toHaveValue(content)
    expect(screen.getByText(/Your message is too long/)).toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('keeps the server allowance on provider failure', async () => {
    vi.mocked(apiClient.post).mockRejectedValue({ response: { data: {
      message: 'The selected model is temporarily unavailable.', remaining: 10, limit: 10,
    } } })
    render(<AiChatPage />)
    const input = await screen.findByRole('textbox', { name: 'Message to AI' })
    fireEvent.change(input, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('The selected model is temporarily unavailable.')).toBeInTheDocument()
    expect(screen.getByText('AI prompts left today: 10 of 10')).toBeInTheDocument()
  })
})
