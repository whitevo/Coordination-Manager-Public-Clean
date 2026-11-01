import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { Lightbox } from '../Lightbox'
import { Dialog } from '../Dialog'
import { OVERLAY_BASE_Z, resetOverlayStack } from '../../../lib/overlay-layers'

const IMAGE = 'data:image/png;base64,iVBORw0KGgo='

function Harness({ onClose }: { onClose?: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  return (
    <>
      <button type="button" onClick={() => setSrc(IMAGE)}>
        Open image
      </button>
      <Lightbox
        open={src !== null}
        src={src}
        alt="Screenshot"
        onClose={() => {
          onClose?.()
          setSrc(null)
        }}
      />
    </>
  )
}

afterEach(() => {
  resetOverlayStack()
  document.getElementById('root')?.remove()
  document.body.style.overflow = ''
})

describe('Lightbox', () => {
  it('renders nothing while closed or without a source', () => {
    const { rerender } = render(<Lightbox open={false} src={IMAGE} alt="Shot" onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<Lightbox open src={null} alt="Shot" onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('portals to document.body on the focusModal layer with an accessible name', async () => {
    const { container } = render(<Lightbox open src={IMAGE} alt="Shot" title="Attachment preview" onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog', { name: 'Attachment preview' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(container).not.toContainElement(dialog)
    const scrim = screen.getByTestId('lightbox-scrim')
    expect(scrim.parentElement).toBe(document.body)
    expect(Number(scrim.style.zIndex)).toBeGreaterThanOrEqual(OVERLAY_BASE_Z.focusModal)
    expect(scrim.className).not.toMatch(/\bz-\d+/)
    expect(screen.getByRole('img', { name: 'Shot' })).toHaveAttribute('src', IMAGE)
  })

  it('focuses the close button, traps Tab, and returns focus to the trigger on close', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open image' })
    trigger.focus()
    fireEvent.click(trigger)
    const close = await screen.findByRole('button', { name: 'Close preview' })
    await waitFor(() => expect(close).toHaveFocus())
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.click(close)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('closes on Escape, on the close button and on the area around the image, not on the image', async () => {
    const onClose = vi.fn()
    render(<Lightbox open src={IMAGE} alt="Shot" onClose={onClose} />)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('img', { name: 'Shot' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('locks body scroll and makes the app root inert while open', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.appendChild(appRoot)
    const { rerender } = render(<Lightbox open src={IMAGE} alt="Shot" onClose={vi.fn()} />)
    await screen.findByRole('dialog')
    expect(document.body.style.overflow).toBe('hidden')
    expect(appRoot.inert).toBe(true)
    expect(appRoot).toHaveAttribute('aria-hidden', 'true')
    rerender(<Lightbox open={false} src={IMAGE} alt="Shot" onClose={vi.fn()} />)
    expect(document.body.style.overflow).toBe('')
    expect(appRoot.inert).toBe(false)
    expect(appRoot).not.toHaveAttribute('aria-hidden')
  })

  it('stacks above an open Dialog and Escape closes only the lightbox', async () => {
    const closeDialog = vi.fn()
    const closeLightbox = vi.fn()
    render(
      <>
        <Dialog open onClose={closeDialog} title="Feedback" />
        <Lightbox open src={IMAGE} alt="Shot" onClose={closeLightbox} />
      </>
    )
    const lightbox = await screen.findByRole('dialog', { name: 'Image preview' })
    const dialog = screen.getByRole('dialog', { name: 'Feedback' })
    const lightboxZ = Number(screen.getByTestId('lightbox-scrim').style.zIndex)
    const dialogZ = Number((dialog.parentElement as HTMLElement).style.zIndex)
    expect(lightboxZ).toBeGreaterThan(dialogZ)
    fireEvent.keyDown(lightbox, { key: 'Escape' })
    expect(closeLightbox).toHaveBeenCalledTimes(1)
    expect(closeDialog).not.toHaveBeenCalled()
  })
})
