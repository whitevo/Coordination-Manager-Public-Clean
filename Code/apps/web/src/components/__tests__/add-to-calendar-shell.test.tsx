import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddToCalendarShell } from '../AddToCalendarShell'

vi.mock('../../contexts/LayoutContext', () => ({
  RightPanelPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
afterEach(cleanup)

describe('Add to calendar panel visibility', () => {
  it('hides and restores the panel without unmounting its form content or calling destructive close', () => {
    const onClose = vi.fn()
    const props = { mode: 'panel' as const, isMobileLayout: true, onClose, onModeChange: vi.fn() }
    const { rerender } = render(<AddToCalendarShell {...props}><input aria-label="Draft title" defaultValue="Original" /></AddToCalendarShell>)
    const title = screen.getByRole('textbox', { name: 'Draft title' })
    fireEvent.change(title, { target: { value: 'Unsaved change' } })
    rerender(<AddToCalendarShell {...props} hidden><input aria-label="Draft title" defaultValue="Original" /></AddToCalendarShell>)
    expect(screen.getByTestId('add-to-calendar-side-panel')).not.toBeVisible()
    expect(title).toHaveValue('Unsaved change')
    expect(onClose).not.toHaveBeenCalled()
    rerender(<AddToCalendarShell {...props}><input aria-label="Draft title" defaultValue="Original" /></AddToCalendarShell>)
    expect(screen.getByTestId('add-to-calendar-side-panel')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Draft title' })).toBe(title)
    expect(title).toHaveValue('Unsaved change')
  })

  it('does not hide the focus-window mode when panel visibility is hidden', () => {
    render(<AddToCalendarShell mode="window" isMobileLayout hidden onClose={vi.fn()} onModeChange={vi.fn()}><input aria-label="Window draft" /></AddToCalendarShell>)
    expect(screen.getByTestId('add-to-calendar-window')).toBeVisible()
  })
})
