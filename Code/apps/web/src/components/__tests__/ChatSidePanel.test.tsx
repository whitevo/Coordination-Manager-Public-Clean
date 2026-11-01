import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSidePanel } from '../ChatSidePanel'

vi.mock('../LearnerHelpIcon', () => ({ default: () => null }))
vi.mock('../MobilePanelSwitcher', () => ({ default: () => null }))
vi.mock('../CalendarQuickButtonToggle', () => ({ default: () => null }))

describe('ChatSidePanel', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('centers content safely without shrinking the header or poll controls', () => {
    render(<ChatSidePanel isOpen onClose={vi.fn()} onPanelChange={vi.fn()} />)

    const header = screen.getByRole('button', { name: 'Close' }).parentElement?.parentElement
    const body = screen.getByRole('button', { name: 'Submit Vote' }).parentElement
    expect(header).toHaveClass('shrink-0')
    expect(body).toHaveClass('min-h-0', 'overflow-y-auto', 'justify-center-safe', '*:shrink-0')
    expect(screen.getByRole('button', { name: 'Submit Vote' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Yes.*love to chat/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit Vote' }))

    expect(sessionStorage.getItem('cm-chat-poll-vote')).toBe('yes')
    expect(body).toContainElement(screen.getByRole('heading', { name: 'Thanks for your input!' }))
    expect(body).toHaveClass('justify-center-safe')
  })

  it('still closes through the header control', () => {
    const onClose = vi.fn()
    render(<ChatSidePanel isOpen onClose={onClose} onPanelChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
