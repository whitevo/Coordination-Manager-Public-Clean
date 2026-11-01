import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from '../ErrorBoundary'
import AppWithRecovery from '../app-with-recovery'

vi.mock('@/App', () => ({ default: () => <div>Application content</div> }))

function BrokenPage(): never {
  throw new Error('Failed to fetch dynamically imported module: /assets/page-old.js')
}

describe('React asset recovery integration', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    delete window.__assetRecovery
    vi.restoreAllMocks()
  })

  it('marks the app ready after mounting, disabling automatic asset reloads', () => {
    const markReady = vi.fn()
    window.__assetRecovery = { markReady, handleError: vi.fn() }
    render(<AppWithRecovery />)
    expect(screen.getByText('Application content')).not.toBeNull()
    expect(markReady).toHaveBeenCalledOnce()
  })

  it('does not invoke the generic crash auto-reload for an asset failure', () => {
    const handleError = vi.fn().mockReturnValue(true)
    window.__assetRecovery = { markReady: vi.fn(), handleError }
    render(<ErrorBoundary><BrokenPage /></ErrorBoundary>)
    expect(handleError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Failed to fetch dynamically imported module: /assets/page-old.js',
    }))
    expect(sessionStorage.getItem('errorBoundaryAutoReload')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reload' })).not.toBeNull()
  })

  it('keeps the existing crash fallback usable if the early script is unavailable', () => {
    sessionStorage.setItem('errorBoundaryAutoReload', '1')
    render(<ErrorBoundary><BrokenPage /></ErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).not.toBeNull()
  })
})
