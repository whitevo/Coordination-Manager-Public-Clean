import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import MeetingSidePanel from '../MeetingSidePanel'

vi.mock('../../lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}))

vi.mock('../../lib/use-timezones', () => ({
  useTimezones: () => ({ primary: 'UTC' }),
}))

vi.mock('../../lib/timezone-data', () => ({
  formatUtcTimeWithPeriodInTimezone: (value: string) => value,
}))

vi.mock('../LearnerHelpIcon', () => ({
  default: () => null,
}))

describe('MeetingSidePanel reuse controls', () => {
  it('restores and updates cached details textarea height in session storage', () => {
    sessionStorage.setItem('cm-meeting-details-height', '260')

    render(
      <MeetingSidePanel
        isOpen
        cellId="2026-06-10_10:00"
        title=""
        duration={60}
        recurrenceRule={{ type: 'none' }}
        meetingLink=""
        description=""
        timeInterval={30}
        isEditing={false}
        existingTitles={[]}
        existingLinks={[]}
        existingDescriptions={[]}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const detailsTextarea = screen.getByLabelText('Details') as HTMLTextAreaElement
    expect(detailsTextarea.style.height).toBe('260px')

    Object.defineProperty(detailsTextarea, 'clientHeight', {
      configurable: true,
      value: 246,
    })

    fireEvent.mouseUp(detailsTextarea)

    expect(sessionStorage.getItem('cm-meeting-details-height')).toBe('246')
    expect(detailsTextarea.style.height).toBe('246px')
  })

  it('shows title reuse and clears reusable links', () => {
    const onClearReusableLinks = vi.fn()

    render(
      <MeetingSidePanel
        isOpen
        cellId="2026-06-10_10:00"
        title=""
        duration={60}
        recurrenceRule={{ type: 'none' }}
        meetingLink=""
        description=""
        timeInterval={30}
        isEditing={false}
        existingTitles={['Weekly Sync']}
        existingLinks={['https://meet.example.com/team']}
        existingDescriptions={[]}
        onClearReusableLinks={onClearReusableLinks}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const reuseButtons = screen.getAllByRole('button', { name: 'Reuse' })
    expect(reuseButtons).toHaveLength(2)

    fireEvent.click(reuseButtons[0])
    fireEvent.click(screen.getByRole('button', { name: 'Weekly Sync' }))
    expect(screen.getByLabelText('Custom Meeting Name')).toHaveValue('Weekly Sync')

    fireEvent.click(reuseButtons[1])
    fireEvent.click(screen.getByRole('button', { name: /Clear all links from meetings/i }))
    expect(onClearReusableLinks).toHaveBeenCalledTimes(1)
  })
})

describe('MeetingSidePanel recurrence end conditions', () => {
  type SaveHandler = (data: { recurrenceRule: unknown }) => void
  const renderPanel = (onSave: SaveHandler) => render(
    <MeetingSidePanel
      isOpen
      cellId="2026-06-10_10:00"
      title=""
      duration={60}
      recurrenceRule={{ type: 'weekly', endType: 'never' }}
      meetingLink=""
      description=""
      timeInterval={30}
      isEditing={false}
      existingTitles={[]}
      existingLinks={[]}
      existingDescriptions={[]}
      onSave={onSave}
      onCancel={vi.fn()}
    />
  )

  it('switches to an end date when the date is typed without clicking the option', () => {
    const onSave = vi.fn<SaveHandler>()
    renderPanel(onSave)
    fireEvent.change(screen.getByLabelText('Recurrence end date'), { target: { value: '2026-07-31' } })
    fireEvent.click(screen.getByText('Confirm Meeting'))
    expect(onSave.mock.calls[0][0].recurrenceRule).toMatchObject({ endType: 'on', endDate: '2026-07-31' })
  })

  it('saves the displayed default count when After is chosen', () => {
    const onSave = vi.fn<SaveHandler>()
    renderPanel(onSave)
    const afterRadio = screen.getAllByRole('radio').find((radio) => radio.closest('label')?.textContent?.includes('After'))
    fireEvent.click(afterRadio!)
    fireEvent.click(screen.getByText('Confirm Meeting'))
    expect(onSave.mock.calls[0][0].recurrenceRule).toMatchObject({ endType: 'after', endCount: 13 })
  })
})

describe('MeetingSidePanel date and time editor', () => {
    function renderEditor(timeInterval = 30, cellId = '2026-06-10_10:00') {
      const onCellIdChange = vi.fn()
      const result = render(
        <MeetingSidePanel
          isOpen
          cellId={cellId}
          title=""
          duration={60}
          recurrenceRule={{ type: 'none' }}
          meetingLink=""
          description=""
          timeInterval={timeInterval}
          isEditing={false}
          existingTitles={[]}
          existingLinks={[]}
          existingDescriptions={[]}
          onSave={vi.fn()}
          onCancel={vi.fn()}
          onCellIdChange={onCellIdChange}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: 'Edit date and time manually' }))
      return { ...result, onCellIdChange }
    }

    it('highlights Apply only for changes and disables it again when edits are reverted', () => {
      renderEditor()
      const apply = screen.getByRole('button', { name: 'Apply' })
      expect(apply).toBeDisabled()
      expect(apply).not.toHaveClass('bg-primary')
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-06-11' } })
      expect(apply).toBeEnabled()
      expect(apply).toHaveClass('bg-primary')
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-06-10' } })
      expect(apply).toBeDisabled()
      expect(apply).not.toHaveClass('bg-primary')
    })

    it.each([
      ['Select hour 11', '11:00'],
      ['Select minute 30', '10:30'],
      ['Select hour 10', '10:00'],
      ['Select minute 00', '10:00'],
    ])('closes immediately after %s, including an unchanged selection', (selection, expectedTime) => {
      const { onCellIdChange } = renderEditor()
      const trigger = screen.getByRole('button', { name: 'Open time picker' })
      fireEvent.click(trigger)
      expect(screen.getByRole('group', { name: 'Choose time (UTC)' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: selection }))
      expect(screen.queryByRole('group', { name: 'Choose time (UTC)' })).not.toBeInTheDocument()
      expect(screen.getByLabelText('Time (UTC)')).toHaveValue(expectedTime)
      expect(trigger).toHaveFocus()
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      expect(onCellIdChange).not.toHaveBeenCalled()
      if (expectedTime !== '10:00') {
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
        expect(onCellIdChange).toHaveBeenCalledExactlyOnceWith(`2026-06-10_${expectedTime}`)
      } else {
        expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
      }
    })

    it.each([
      [15, '2026-06-10_10:00', ['00', '15', '30', '45']],
      [30, '2026-06-10_10:00', ['00', '30']],
      [60, '2026-06-10_10:00', ['00']],
      [30, '2026-06-10_10:15', ['15', '45']],
    ])('preserves minute step choices for interval %s and slot %s', (interval, cellId, minutes) => {
      renderEditor(interval, cellId)
      fireEvent.click(screen.getByRole('button', { name: 'Open time picker' }))
      const group = screen.getByRole('group', { name: 'Minute' })
      expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(minutes)
    })

    it('keeps manual typing focused and blocks malformed or empty values', () => {
      renderEditor()
      const time = screen.getByLabelText('Time (UTC)')
      time.focus()
      fireEvent.change(time, { target: { value: '11:' } })
      expect(time).toHaveFocus()
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
      fireEvent.change(time, { target: { value: '25:00' } })
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
      fireEvent.change(time, { target: { value: '11:30' } })
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled()
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '' } })
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    })

    it('opens with the keyboard, dismisses with Escape and outside interaction, and discards cancelled edits', () => {
      const { onCellIdChange } = renderEditor()
      const time = screen.getByLabelText('Time (UTC)')
      fireEvent.keyDown(time, { key: 'ArrowDown', altKey: true })
      expect(screen.getByRole('button', { name: 'Select hour 10' })).toHaveFocus()
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      expect(screen.queryByRole('group', { name: 'Choose time (UTC)' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Open time picker' }))
      fireEvent.pointerDown(screen.getByLabelText('Date'))
      expect(screen.queryByRole('group', { name: 'Choose time (UTC)' })).not.toBeInTheDocument()
      fireEvent.change(time, { target: { value: '11:30' } })
      const editorActions = screen.getByRole('button', { name: 'Apply' }).parentElement!
      fireEvent.click(within(editorActions).getByRole('button', { name: 'Cancel' }))
      expect(onCellIdChange).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Edit date and time manually' }))
      expect(screen.getByLabelText('Time (UTC)')).toHaveValue('10:00')
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    })

    it('provides independent border trace surfaces for entry and picker controls', () => {
      const showPicker = vi.fn()
      Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, value: showPicker })
      try {
        renderEditor()
        for (const label of ['Date', 'Time (UTC)']) {
          expect(screen.getByLabelText(label).parentElement).toHaveClass('meeting-editor-control')
        }
        for (const name of ['Open date picker', 'Open time picker']) {
          expect(screen.getByRole('button', { name }).parentElement).toHaveClass('meeting-editor-control')
        }
        fireEvent.click(screen.getByRole('button', { name: 'Open date picker' }))
        expect(showPicker).toHaveBeenCalledOnce()
      } finally {
        Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker')
      }
    })
  })
