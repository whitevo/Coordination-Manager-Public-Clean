import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CalendarCheck, Inbox, Settings2, UserRound } from 'lucide-react'
import { MailboxMobileNavigation } from '../mailbox-mobile-navigation'

afterEach(cleanup)

const tabs = [
  { id: 'mailbox', label: 'Mailbox', icon: Inbox },
  { id: 'people', label: 'People and Domains', mobileLabel: 'People', icon: UserRound },
  { id: 'invitations', label: 'Invitations', mobileLabel: 'Invites', icon: CalendarCheck },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

describe('MailboxMobileNavigation', () => {
  it('keeps all four sections and the guide in one five-column row with accessible names', () => {
    render(
      <MailboxMobileNavigation
        tabs={tabs}
        activeId="mailbox"
        onSelect={vi.fn()}
        guide={{ isOpen: false, onToggle: vi.fn(), buttonRef: null }}
      />
    )

    const navigation = screen.getByRole('navigation', { name: 'Mailbox sections' })
    expect(navigation.className).toContain('grid-cols-5')
    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'People and Domains' }).textContent).toBe('People')
    expect(screen.getByRole('button', { name: 'Invitations' }).textContent).toBe('Invites')
    expect(screen.getByRole('button', { name: 'Mailbox' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('allows selecting Mailbox even when it is already active, and selecting other sections', () => {
    const onSelect = vi.fn()
    render(<MailboxMobileNavigation tabs={tabs} activeId="mailbox" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mailbox' }))
    fireEvent.click(screen.getByRole('button', { name: 'People and Domains' }))
    expect(onSelect.mock.calls).toEqual([['mailbox'], ['people']])
  })

  it('exposes guide expansion and invokes its toggle separately from navigation', () => {
    const onSelect = vi.fn()
    const onToggle = vi.fn()
    const { rerender } = render(
      <MailboxMobileNavigation
        tabs={tabs}
        activeId="mailbox"
        onSelect={onSelect}
        guide={{ isOpen: false, onToggle, buttonRef: null }}
      />
    )
    const guide = screen.getByRole('button', { name: 'Learner Guide' })
    expect(guide.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(guide)
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()

    rerender(
      <MailboxMobileNavigation
        tabs={tabs}
        activeId="mailbox"
        onSelect={onSelect}
        guide={{ isOpen: true, onToggle, buttonRef: null }}
      />
    )
    expect(guide.getAttribute('aria-expanded')).toBe('true')
    expect(guide.getAttribute('aria-controls')).toBe('mailbox-learner-guide')
  })

  it('uses one four-column row on sections where the guide is unavailable', () => {
    render(<MailboxMobileNavigation tabs={tabs} activeId="settings" onSelect={vi.fn()} />)
    expect(screen.getByRole('navigation').className).toContain('grid-cols-4')
    expect(screen.queryByRole('button', { name: 'Learner Guide' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })
})
