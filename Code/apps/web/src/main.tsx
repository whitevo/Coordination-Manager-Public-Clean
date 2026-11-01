import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { LearnerModeProvider } from './contexts/LearnerModeContext'
import { SetupProvider } from './contexts/SetupContext'
import { ToastProvider } from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import AppWithRecovery from './components/app-with-recovery'
import './index.css'

// Mobile browsers (iOS Safari, Chrome for Android) often restore a closed
// tab from the back/forward cache instead of doing a real reload. The
// resumed page keeps whatever in-memory JS state it had when it was frozen
// (e.g. expired auth tokens, stale hooks), which can throw during render and
// trip the ErrorBoundary. Force a real reload so the app always starts from
// a clean state. "Request desktop site" avoids this because switching UA
// forces a genuine full-page navigation instead of a bfcache restore.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    window.location.reload()
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <SetupProvider>
        <AuthProvider>
          <ThemeProvider>
            <LearnerModeProvider>
              <ToastProvider>
                <AppWithRecovery />
              </ToastProvider>
            </LearnerModeProvider>
          </ThemeProvider>
        </AuthProvider>
      </SetupProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
