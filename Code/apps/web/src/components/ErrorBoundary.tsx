import React from 'react'
import { handleAssetError } from '@/lib/asset-recovery'
import { Button } from './ui'

interface State {
  hasError: boolean
}
const ERROR_RELOAD_KEY = 'errorBoundaryAutoReload'

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
    if (handleAssetError(error)) return

    // Any first-render crash on a fresh navigation (stale JS chunk from a new
    // deploy, or a transient race while auth/session state is still
    // hydrating on a cold mobile app start) is usually resolved by a single
    // real reload of the SAME url. Auto-reload once; guard with
    // sessionStorage so a genuinely broken page doesn't reload-loop forever.
    try {
      if (!sessionStorage.getItem(ERROR_RELOAD_KEY)) {
        sessionStorage.setItem(ERROR_RELOAD_KEY, '1')
        window.location.reload()
      }
    } catch {
      // ignore storage errors
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-8">
          <div className="text-center max-w-md space-y-4">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">
              An unexpected error occurred. Please reload the page to continue.
            </p>
            <Button
              intent="primary"
              onClick={() => {
                try { sessionStorage.removeItem(ERROR_RELOAD_KEY) } catch { /* ignore */ }
                // Reload the SAME url (not home) so the user lands back where
                // they were instead of having to navigate here again.
                window.location.reload()
              }}
            >
              Reload
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
