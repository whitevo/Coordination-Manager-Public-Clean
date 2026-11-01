import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'

const auth = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  isAuthenticated: true,
  isLoading: false,
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../lib/setup-api', () => ({ isSetupAccessible: () => false }))
vi.mock('../components/HomeRoute', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../components/Layout', async () => {
  const { useState } = await import('react')
  const { Link, Outlet } = await import('react-router-dom')
  return {
    default: function Layout() {
      const [activePanel, setActivePanel] = useState('feedback')
      const [drafts, setDrafts] = useState({ feedback: '', ai: '', chat: '' })
      return (
        <>
          <Link to="/time-management">Time management</Link>
          <Link to="/settings">Settings</Link>
          <Link to="/mailbox">Mailbox</Link>
          <output aria-label="Active panel">{activePanel}</output>
          {(['feedback', 'ai', 'chat'] as const).map(panel => (
            <div key={panel}>
              <button onClick={() => setActivePanel(panel)}>{panel} panel</button>
              <textarea
                aria-label={`${panel} draft`}
                value={drafts[panel]}
                onChange={event => setDrafts(previous => ({ ...previous, [panel]: event.target.value }))}
              />
            </div>
          ))}
          <Outlet />
        </>
      )
    },
  }
})
vi.mock('../pages/TimeManagementPage.tsx', () => ({ default: () => <h1>Time management page</h1> }))
vi.mock('../pages/SettingsPage', () => ({ default: () => <h1>Settings page</h1> }))
vi.mock('../pages/MailboxPage', () => ({ default: () => <h1>Mailbox page</h1> }))
vi.mock('../pages/auth/LoginPage', () => ({ default: () => <h1>Login page</h1> }))

beforeEach(() => {
  auth.user = { id: 'user-1' }
  auth.isAuthenticated = true
  auth.isLoading = false
})

afterEach(cleanup)

function renderApp(path = '/time-management') {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

describe('Side panel lifetime across app routes', () => {
  it('preserves all panel drafts and the open panel across public and protected pages', async () => {
    renderApp()
    await screen.findByRole('heading', { name: 'Time management page' })
    for (const panel of ['feedback', 'ai', 'chat']) {
      fireEvent.change(screen.getByRole('textbox', { name: `${panel} draft` }), {
        target: { value: `Unsent ${panel} message` },
      })
    }
    fireEvent.click(screen.getByRole('button', { name: 'chat panel' }))

    for (const page of ['Settings', 'Mailbox', 'Time management']) {
      fireEvent.click(screen.getByRole('link', { name: page }))
      await screen.findByRole('heading', { name: `${page} page` })
      for (const panel of ['feedback', 'ai', 'chat']) {
        expect(screen.getByRole('textbox', { name: `${panel} draft` })).toHaveValue(`Unsent ${panel} message`)
      }
      expect(screen.getByLabelText('Active panel')).toHaveTextContent('chat')
    }
  })

  it('still redirects unauthenticated users away from protected pages', async () => {
    auth.user = null
    auth.isAuthenticated = false
    renderApp('/settings')
    expect(await screen.findByRole('heading', { name: 'Login page' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Settings page' })).not.toBeInTheDocument()
  })

  it('keeps protected pages hidden while authentication is loading', async () => {
    auth.isLoading = true
    renderApp('/settings')
    expect(await screen.findByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Settings page' })).not.toBeInTheDocument()
  })

  it('resets panel drafts when the account changes', async () => {
    const view = renderApp()
    await screen.findByRole('heading', { name: 'Time management page' })
    fireEvent.change(screen.getByRole('textbox', { name: 'feedback draft' }), {
      target: { value: 'Private feedback' },
    })
    auth.user = { id: 'user-2' }
    view.rerender(<MemoryRouter initialEntries={['/time-management']}><App /></MemoryRouter>)
    expect(screen.getByRole('textbox', { name: 'feedback draft' })).toHaveValue('')
  })
})