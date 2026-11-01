import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CalendarQuickToolButton } from '../calendar-quick-tool-button'

describe('CalendarQuickToolButton', () => {
  it('retains theme tint with stronger selected fill and border without a check marker', () => {
    const onClick = vi.fn()
    const { rerender } = render(<CalendarQuickToolButton active={false} icon={<span />} onClick={onClick}>Tools</CalendarQuickToolButton>)
    const button = screen.getByRole('button', { name: 'Tools' })
    expect(button).toHaveClass('bg-primary-subtle', 'border-primary-muted', 'text-foreground')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
    rerender(<CalendarQuickToolButton active icon={<span />} onClick={onClick}>Tools</CalendarQuickToolButton>)
    expect(button).toHaveClass('bg-primary-muted', 'border-primary', 'ring-primary', 'text-foreground')
    expect(button).not.toHaveClass('bg-primary', 'text-primary-foreground')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button.querySelector('.lucide-check')).toBeNull()
    expect(button.className).not.toMatch(/from-|via-|to-|text-danger|text-success/)
  })

  it('does not assign toggle semantics to a one-shot action', () => {
    render(<CalendarQuickToolButton icon={<span />}>Copy Invite Link</CalendarQuickToolButton>)
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed')
  })
})
