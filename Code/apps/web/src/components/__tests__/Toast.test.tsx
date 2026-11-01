import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from '../Toast'
import { Dialog } from '../ui/Dialog'
import { OVERLAY_LAYER_CLASS, resetOverlayStack } from '../../lib/overlay-layers'

function CopyNotice() {
  const { showToast } = useToast()
  return (
    <>
      <button onClick={() => showToast('Invite link copied.', 'success', 'neutral')}>Copy</button>
      <button onClick={() => showToast('Saved.', 'success')}>Save</button>
    </>
  )
}

afterEach(() => vi.useRealTimers())

describe('Toast appearance', () => {
  it('uses an explicit readable card surface for invite-copy while preserving other success notifications', () => {
    vi.useFakeTimers()
    render(<ToastProvider><CopyNotice /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    const notice = screen.getByRole('status')
    expect(notice).toHaveClass('bg-card', 'text-card-foreground', 'border-border')
    expect(notice).not.toHaveClass('bg-success')
    expect(notice.querySelector('.text-success')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Saved.').closest('[role="status"]')).toHaveClass('bg-success', 'text-success-foreground')
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryAllByRole('status')).toHaveLength(0)
  })

  it('allows dismissing the neutral acknowledgment', () => {
    render(<ToastProvider><CopyNotice /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

function SaveFromDialog() {
  const { showToast } = useToast()
  return (
    <Dialog open onClose={() => {}} title="Edit rule">
      <button onClick={() => showToast('Rule failed to save.', 'error')}>Save rule</button>
    </Dialog>
  )
}

describe('Toast layering', () => {
  let appRoot: HTMLDivElement

  beforeEach(() => {
    resetOverlayStack()
    appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.appendChild(appRoot)
  })

  afterEach(() => {
    appRoot.remove()
  })

  it('renders outside the app root on the toast tier, so an open dialog cannot make it inert', () => {
    render(<ToastProvider><SaveFromDialog /></ToastProvider>, { container: appRoot })
    expect(appRoot.inert).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }))

    const region = screen.getByTestId('toast-region')
    expect(appRoot.contains(region)).toBe(false)
    expect(region.closest('[aria-hidden="true"]')).toBeNull()
    expect(region).toHaveClass(OVERLAY_LAYER_CLASS.toast)
    expect(screen.getByRole('alert')).toHaveTextContent('Rule failed to save.')

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
