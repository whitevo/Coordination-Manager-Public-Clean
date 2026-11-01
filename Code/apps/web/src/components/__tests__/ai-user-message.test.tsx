import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AiUserMessage } from '../ai-user-message'
import { AI_MESSAGE_MAX_LENGTH, getAiMessageError } from '@/lib/ai-message'

describe('AiUserMessage', () => {
  it('preserves literal formatting without interpreting HTML or Markdown', () => {
    const content = '  **Heading**\n\n\t- indented item\n<script>alert("test")</script>  '
    const { container } = render(<AiUserMessage content={content} />)
    expect(container.querySelector('.whitespace-pre-wrap')?.textContent).toBe(content)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('strong')).toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([
    'x'.repeat(601),
    Array.from({ length: 9 }, (_, i) => `Line ${i}`).join('\n'),
  ])('expands and collapses long messages without losing content', content => {
    const { container } = render(<AiUserMessage content={content} />)
    const button = screen.getByRole('button', { name: 'Show more' })
    const text = container.querySelector('.whitespace-pre-wrap')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', text?.id)
    expect(text?.textContent).not.toBe(content)
    fireEvent.click(button)
    expect(text?.textContent).toBe(content)
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(button)
    expect(text?.textContent).not.toBe(content)
  })

  it('leaves a message at the preview thresholds fully visible', () => {
    const { container } = render(<AiUserMessage content={'x'.repeat(600)} />)
    expect(container.textContent).toBe('x'.repeat(600))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('AI message length validation', () => {
  it('accepts the exact API limit and rejects one character above it', () => {
    expect(getAiMessageError('x'.repeat(AI_MESSAGE_MAX_LENGTH))).toBeNull()
    expect(getAiMessageError('x'.repeat(AI_MESSAGE_MAX_LENGTH + 1))).toContain('4001')
  })
})
