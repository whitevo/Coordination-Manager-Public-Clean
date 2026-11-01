import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dismissPanelsForMobileNavigation,
  MOBILE_NAVIGATION_PANEL_DISMISS_EVENT,
  useMobileNavigationPanelDismiss,
} from '../use-mobile-navigation-panel-dismiss'

function NavigationHarness() {
  const [globalPanel, setGlobalPanel] = useState<string | null>('ai')
  const [pagePanelOpen, setPagePanelOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [draft, setDraft] = useState('Unsaved draft')
  useMobileNavigationPanelDismiss(() => setPagePanelOpen(false))
  return (
    <>
      <nav onClickCapture={(event) => {
        if (dismissPanelsForMobileNavigation(event.target)) setGlobalPanel(null)
      }}>
        <button onClick={() => setMenuOpen(true)}>Open navigation menu</button>
        <a href="/time-management" onClick={(event) => event.preventDefault()}>Current page</a>
        <a href="/mailbox" onClick={(event) => event.preventDefault()}>Mailbox</a>
        <button onClick={() => setGlobalPanel(globalPanel === 'feedback' ? null : 'feedback')}>Feedback</button>
        <button onClick={() => setGlobalPanel(globalPanel === 'ai' ? null : 'ai')}>AI Assistant</button>
        <span>Navigation label</span>
      </nav>
      <output data-testid="global-panel">{globalPanel ?? 'closed'}</output>
      <output data-testid="page-panel">{pagePanelOpen ? 'open' : 'closed'}</output>
      <output data-testid="menu">{menuOpen ? 'open' : 'closed'}</output>
      <input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button>Calendar next week</button>
    </>
  )
}

describe('mobile header navigation panel dismissal', () => {
  const originalWidth = window.innerWidth
  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  function setWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  }

  it.each(['Open navigation menu', 'Current page', 'Mailbox'])('closes page and global panels when %s is activated without clearing the draft', (name) => {
    setWidth(390)
    render(<NavigationHarness />)
    fireEvent.click(screen.getByText(name))
    expect(screen.getByTestId('global-panel')).toHaveTextContent('closed')
    expect(screen.getByTestId('page-panel')).toHaveTextContent('closed')
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved draft')
    if (name === 'Open navigation menu') expect(screen.getByTestId('menu')).toHaveTextContent('open')
  })

  it('closes old panels before opening the requested Assistance panel and keeps its toggle working', () => {
    setWidth(390)
    render(<NavigationHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Feedback' }))
    expect(screen.getByTestId('global-panel')).toHaveTextContent('feedback')
    expect(screen.getByTestId('page-panel')).toHaveTextContent('closed')
    fireEvent.click(screen.getByRole('button', { name: 'Feedback' }))
    expect(screen.getByTestId('global-panel')).toHaveTextContent('closed')
    fireEvent.click(screen.getByRole('button', { name: 'AI Assistant' }))
    expect(screen.getByTestId('global-panel')).toHaveTextContent('ai')
  })

  it.each([768, 1440])('leaves panels unchanged for desktop header navigation at width %s', (width) => {
    setWidth(width)
    render(<NavigationHarness />)
    fireEvent.click(screen.getByText('Current page'))
    expect(screen.getByTestId('global-panel')).toHaveTextContent('ai')
    expect(screen.getByTestId('page-panel')).toHaveTextContent('open')
  })

  it('ignores labels and controls outside header navigation', () => {
    setWidth(390)
    render(<NavigationHarness />)
    fireEvent.click(screen.getByText('Navigation label'))
    fireEvent.click(screen.getByRole('button', { name: 'Calendar next week' }))
    expect(screen.getByTestId('global-panel')).toHaveTextContent('ai')
    expect(screen.getByTestId('page-panel')).toHaveTextContent('open')
    expect(dismissPanelsForMobileNavigation(null)).toBe(false)
  })

  it('uses current listener state and cleans up on unmount', () => {
    setWidth(390)
    const first = vi.fn()
    const latest = vi.fn()
    const { rerender, unmount } = renderHook(({ onDismiss }) => useMobileNavigationPanelDismiss(onDismiss), {
      initialProps: { onDismiss: first },
    })
    rerender({ onDismiss: latest })
    act(() => window.dispatchEvent(new Event(MOBILE_NAVIGATION_PANEL_DISMISS_EVENT)))
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledOnce()
    unmount()
    act(() => window.dispatchEvent(new Event(MOBILE_NAVIGATION_PANEL_DISMISS_EVENT)))
    expect(latest).toHaveBeenCalledOnce()
  })
})
