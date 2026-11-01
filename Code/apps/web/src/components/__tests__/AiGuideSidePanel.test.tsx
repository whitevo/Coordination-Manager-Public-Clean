import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AiGuideSidePanel } from '../AiGuideSidePanel'
import { apiClient } from '../../lib/api-client'

const aiAssistantMock = vi.hoisted(() => ({ pageContext: null as unknown }))

vi.mock('../../lib/api-client', () => ({
  apiClient: { get: vi.fn().mockResolvedValue({ data: { available: true } }), post: vi.fn() },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { themePreferences: null, roles: [] },
  }),
}))

vi.mock('../../contexts/AiAssistantContext', () => ({
  useAiAssistant: () => ({ pageContext: aiAssistantMock.pageContext, assistantHost: null }),
}))

vi.mock('../LearnerHelpIcon', () => ({ default: () => null }))
vi.mock('../SentimentGrid', () => ({ default: () => null }))
vi.mock('../MobilePanelSwitcher', () => ({ default: () => null }))
vi.mock('../CalendarQuickButtonToggle', () => ({ default: () => null }))

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}{useLocation().search}</output>
}

describe('AiGuideSidePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({ data: { available: true, remaining: 10, limit: 10 } })
    aiAssistantMock.pageContext = null
    sessionStorage.clear()
    sessionStorage.setItem('cm-ai-guide-messages', JSON.stringify([{
      role: 'assistant',
      content: 'Read [the guide](https://example.com/guide) and https://example.com/status.',
      timestamp: new Date().toISOString(),
    }]))
  })

  it('preserves and expands long multiline user messages', () => {
    const content = `  Heading\n\n${'  indented text\n'.repeat(12)}`
    sessionStorage.setItem('cm-ai-guide-messages', JSON.stringify([{
      role: 'user', content, timestamp: new Date().toISOString(),
    }]))
    const { container } = render(
      <MemoryRouter><AiGuideSidePanel isOpen onClose={vi.fn()} onPanelChange={vi.fn()} /></MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(container.querySelector('.whitespace-pre-wrap')?.textContent).toBe(content)
  })

  it('keeps an oversized draft and does not submit or spend a prompt', async () => {
    sessionStorage.clear()
    const onSubmit = vi.fn()
    aiAssistantMock.pageContext = { pageName: 'Assistant', placeholder: 'Ask', suggestions: [], onSubmit }
    render(
      <MemoryRouter><AiGuideSidePanel isOpen onClose={vi.fn()} onPanelChange={vi.fn()} /></MemoryRouter>,
    )
    const input = screen.getByRole('textbox', { name: 'Message to AI' })
    const content = 'x'.repeat(4001)
    fireEvent.change(input, { target: { value: content } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue(content)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Your message is too long/)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('AI prompts left today: 10 of 10')).toBeInTheDocument())
  })

  it('shows a provider failure without reducing the displayed allowance', async () => {
    sessionStorage.clear()
    vi.mocked(apiClient.post).mockRejectedValue({
      response: { status: 429, data: {
        message: 'The selected model is unavailable because its provider is limiting requests.',
        remaining: 10, limit: 10,
      } },
    })
    render(
      <MemoryRouter><AiGuideSidePanel isOpen onClose={vi.fn()} onPanelChange={vi.fn()} /></MemoryRouter>,
    )
    const input = screen.getByRole('textbox', { name: 'Message to AI' })
    await waitFor(() => expect(screen.getByText('AI prompts left today: 10 of 10')).toBeInTheDocument())
    fireEvent.change(input, { target: { value: 'First message\n\n  keep this indent' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText(/model is unavailable because its provider/)).toBeInTheDocument()
    expect(screen.getByText('AI prompts left today: 10 of 10')).toBeInTheDocument()
    expect(vi.mocked(apiClient.post).mock.calls[0][1]).toMatchObject({ message: 'First message\n\n  keep this indent' })
  })

  it('renders Markdown and bare URLs as safe external links', () => {
    render(
      <MemoryRouter>
        <AiGuideSidePanel isOpen onClose={vi.fn()} onPanelChange={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'the guide' })).toHaveAttribute('href', 'https://example.com/guide')
    expect(screen.getByRole('link', { name: 'https://example.com/status' })).toHaveAttribute('href', 'https://example.com/status')
    expect(screen.getByRole('link', { name: 'the guide' })).toHaveAttribute('target', '_blank')
  })

  it('opens the AI feedback list from the header shortcut', () => {
    const onClose = vi.fn()
    render(
      <MemoryRouter initialEntries={['/time-management']}>
        <AiGuideSidePanel isOpen onClose={onClose} onPanelChange={vi.fn()} />
        <CurrentPath />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'View AI feedback' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByTestId('current-path')).toHaveTextContent('/feedback?tab=ai')
  })

  it('retries once with evaluation feedback when the page reports the change did not land', async () => {
    sessionStorage.clear()
    const onSubmit = vi.fn()
      .mockResolvedValueOnce({
        message: 'Created category Deep Work.',
        evaluation: { ok: false, issues: ['create_category "Deep Work" was rejected by the server: duplicate.'], applied: [] },
        retryToken: 'token-1',
      })
      .mockResolvedValueOnce({
        message: 'Created category Deep Work 2.',
        action: 'configure_time_management',
        evaluation: { ok: true, issues: [], applied: ['Created category "Deep Work 2"'] },
      })
    aiAssistantMock.pageContext = { pageName: 'Time Management Assistant', suggestions: [], placeholder: 'Ask', onSubmit }

    render(
      <MemoryRouter initialEntries={['/time-management']}>
        <AiGuideSidePanel isOpen onClose={vi.fn()} onPanelChange={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByPlaceholderText('Ask'), { target: { value: 'Create category Deep Work' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Ask'), { key: 'Enter' })

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    const retryArg = onSubmit.mock.calls[1][2] as { evaluationFeedback: string; retryToken: string }
    expect(retryArg.retryToken).toBe('token-1')
    expect(retryArg.evaluationFeedback).toContain('duplicate')
    expect(await screen.findByText(/Created category Deep Work 2\./)).toBeInTheDocument()
    expect(screen.getByText(/retried automatically/)).toBeInTheDocument()
  })

  it('shows actionable unresolved issues when the retry still fails', async () => {
    sessionStorage.clear()
    const failed = {
      message: 'Activated Focus.',
      evaluation: { ok: false, issues: ['activate_mode: no mode matches "Focus".'], applied: [] },
      retryToken: 'token-2',
    }
    const onSubmit = vi.fn()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce({ ...failed, retryToken: undefined })
    aiAssistantMock.pageContext = { pageName: 'Time Management Assistant', suggestions: [], placeholder: 'Ask', onSubmit }

    render(
      <MemoryRouter initialEntries={['/time-management']}>
        <AiGuideSidePanel isOpen onClose={vi.fn()} onPanelChange={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByPlaceholderText('Ask'), { target: { value: 'Activate Focus mode' } })
    fireEvent.keyDown(screen.getByPlaceholderText('Ask'), { key: 'Enter' })

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Not completed -- the self-check found/)).toBeInTheDocument()
  })
})