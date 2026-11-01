import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { startOfWeek } from 'date-fns'
import { installDefaultApiMocks, installEditorDomPolyfills, mockDedupedGet, mockUseAuth } from './time-management-test-harness'
import TimeManagementPage from '../TimeManagementPage'
import { apiClient } from '../../lib/api-client'

function pointer(target: HTMLElement | Window, type: string, clientY = 260, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, clientX: 100, clientY })
  fireEvent(target, event)
}

describe('Time Management touch selection', () => {
  const originalWidth = window.innerWidth
  let frames: Map<number, FrameRequestCallback>
  let nextFrame: number

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false })
    installDefaultApiMocks()
    installEditorDomPolyfills()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    frames = new Map()
    nextFrame = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame++
      frames.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  async function openGrid(readyLabel = 'No meetings found on the selected calendars.') {
    render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    await screen.findAllByText(readyLabel)
    const column = screen.getByTestId('calendar-day-column-0')
    const container = screen.getByTestId('calendar-scroll-container')
    container.scrollTop = 0
    vi.spyOn(column, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: -container.scrollTop, top: -container.scrollTop, left: 0,
      right: 200, bottom: 1248 - container.scrollTop, width: 200, height: 1248, toJSON: () => ({}),
    }))
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 100, top: 100, left: 0, right: 390, bottom: 600, width: 390, height: 500, toJSON: () => ({}),
    })
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 3744 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 500 })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    return { column, container }
  }

  function advanceHold(ms = 500) {
    act(() => { vi.advanceTimersByTime(ms) })
  }

  function runFrame() {
    act(() => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback(0))
    })
  }

  function installMoveEvents(recurring = false) {
    const week = startOfWeek(new Date(), { weekStartsOn: 1 })
    const timestamp = (day: number, hour: number, minute = 0) =>
      new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate() + day, hour, minute)).toISOString()
    const events = [0, 1].map((index) => ({
      id: `move-source-${index}`, title: `Move source ${index}`, description: `Notes ${index}`,
      meeting_link: null, location: 'Office', source_type: 'manual', source_id: 'mode-main',
      start_time: timestamp(index, 2 + index), end_time: timestamp(index, 3 + index, 30),
      category_ids: [], recurrence_rule: { type: recurring ? 'weekly' : 'none' },
    }))
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') return { data: { events } }
      return defaultGet?.(url)
    })
    return { events, timestamp }
  }

  function startMove() {
    fireEvent.contextMenu(screen.getAllByText('Move source 0')[0], { clientX: 100, clientY: 100 })
    fireEvent.click(screen.getByRole('menuitem', { name: /Move Item/ }))
  }

  it('clears untitled selections from the grid without saving or discarding manual draft text', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 })
    const { column } = await openGrid()
    expect(screen.queryByTestId('calendar-grid-clear-selection')).not.toBeInTheDocument()
    pointer(column, 'pointerdown')
    pointer(window, 'pointerup')

    const closeButton = screen.getAllByRole('button', { name: 'Clear time selection' })[0]
    expect(closeButton.previousElementSibling).toHaveAttribute('data-testid', 'calendar-grid-open-full-view')
    expect(closeButton).toHaveAttribute('title', 'Clear time selection (Esc)')

    const titleInput = screen.getByPlaceholderText('Type Title for Time Item')
    fireEvent.change(titleInput, { target: { value: 'A titled selection' } })
    expect(screen.queryByTestId('calendar-grid-clear-selection')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('calendar-grid-save-button').length).toBeGreaterThan(0)

    fireEvent.change(titleInput, { target: { value: '   ' } })
    expect(screen.queryByTestId('calendar-grid-save-button')).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear time selection' })[0])

    expect(screen.queryByTestId('selection-day-segment-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('calendar-grid-clear-selection')).not.toBeInTheDocument()
    expect(titleInput).toHaveValue('   ')
    expect(screen.getByTitle('Hide left panel')).toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(apiClient.put).not.toHaveBeenCalled()
    expect(apiClient.delete).not.toHaveBeenCalled()
  })

  it('does not render the grid close control on phones with an untitled selection', async () => {
    const { column } = await openGrid()
    pointer(column, 'pointerdown')
    pointer(window, 'pointerup')

    expect(screen.getByTestId('selection-day-segment-0')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-grid-clear-selection')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('calendar-grid-clear-selection')).not.toBeInTheDocument()
  })

  it.each([390, 1024].flatMap((width) =>
    ['direct', 'deselected'].flatMap((transition) =>
      ['manual', 'autosave'].map((saveMethod) => ({ width, transition, saveMethod }))),
  ))(
    'starts a blank draft after editing and saving an item at $width ($transition, $saveMethod)',
    async ({ width, transition, saveMethod }) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
      const { events } = installMoveEvents()
      const { column } = await openGrid('Move source 0')
      fireEvent.click(screen.getAllByText('Move source 0')[0])
      const editor = width === 390 ? within(screen.getByTestId('full-editor-overlay')) : screen
      fireEvent.change(editor.getByPlaceholderText('Type Title for Time Item'), { target: { value: 'Saved edits' } })
      if (saveMethod === 'autosave') {
        await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
      } else {
        await act(async () => {
          fireEvent.click(screen.getByTestId(width === 390 ? 'full-editor-save-button' : 'left-sidebar-update-button'))
        })
      }
      expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/move-source-0', expect.objectContaining({ title: 'Saved edits' }))
      if (width === 390) fireEvent.click(editor.getByRole('button', { name: /^Close$/ }))
      if (transition === 'deselected') fireEvent.keyDown(window, { key: 'Escape' })
      for (const minuteY of [520, 600]) {
        await act(async () => {
          pointer(column, 'pointerdown', minuteY)
          pointer(window, 'pointerup', minuteY)
        })
        const newEditor = width === 390 ? within(screen.getByTestId('full-editor-overlay')) : screen
        expect(newEditor.getByPlaceholderText('Type Title for Time Item')).toHaveValue('')
        expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
        if (width === 390) fireEvent.keyDown(window, { key: 'Escape' })
      }
      expect(apiClient.post).not.toHaveBeenCalled()
      vi.mocked(apiClient.post).mockImplementation(async (_url, payload: unknown) => {
        if (!payload || typeof payload !== 'object') throw new Error('Expected an event payload')
        return { data: { event: { ...events[0], ...payload, id: 'fresh-after-edit' } } }
      })
      if (width === 390) {
        pointer(column, 'pointerdown', 650)
        pointer(window, 'pointerup', 650)
      }
      const newEditor = width === 390 ? within(screen.getByTestId('full-editor-overlay')) : screen
      fireEvent.change(newEditor.getByPlaceholderText('Type Title for Time Item'), { target: { value: 'Fresh after edit' } })
      await act(async () => {
        fireEvent.click(screen.getByTestId(width === 390 ? 'full-editor-save-button' : 'left-sidebar-save-button'))
      })
      expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
        title: 'Fresh after edit', description: null, location: null, category_ids: [], recurrence_rule: { type: 'none' },
      }))
    },
  )

  it.each([390, 1024])('starts fresh after saving a new item and deselecting it at width %s', async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    const { events } = installMoveEvents()
    const { column } = await openGrid('Move source 0')
    vi.mocked(apiClient.post).mockImplementation(async (_url, payload: unknown) => {
      if (!payload || typeof payload !== 'object') throw new Error('Expected an event payload')
      return { data: { event: { ...events[0], ...payload, id: 'newly-created' } } }
    })
    pointer(column, 'pointerdown', 520)
    pointer(window, 'pointerup', 520)
    const editor = width === 390 ? within(screen.getByTestId('full-editor-overlay')) : screen
    fireEvent.change(editor.getByPlaceholderText('Type Title for Time Item'), { target: { value: 'First created item' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId(width === 390 ? 'full-editor-save-button' : 'left-sidebar-save-button'))
    })
    expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({ title: 'First created item' }))
    if (width === 390) fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'Escape' })
    pointer(column, 'pointerdown', 650)
    pointer(window, 'pointerup', 650)
    const newEditor = width === 390 ? within(screen.getByTestId('full-editor-overlay')) : screen
    expect(newEditor.getByPlaceholderText('Type Title for Time Item')).toHaveValue('')
    fireEvent.change(newEditor.getByPlaceholderText('Type Title for Time Item'), { target: { value: 'Second created item' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId(width === 390 ? 'full-editor-save-button' : 'left-sidebar-save-button'))
    })
    expect(apiClient.post).toHaveBeenLastCalledWith('/api/user-events', expect.objectContaining({
      title: 'Second created item', description: null, location: null, category_ids: [], recurrence_rule: { type: 'none' },
    }))
    expect(apiClient.post).toHaveBeenCalledTimes(2)
  })

  it.each([390, 1024])('keeps an unsaved new draft while readjusting its time at width %s', async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    const { column } = await openGrid()
    pointer(column, 'pointerdown', 520)
    pointer(window, 'pointerup', 520)
    const editor = width === 390 ? within(screen.getByTestId('full-editor-overlay')) : screen
    fireEvent.change(editor.getByPlaceholderText('Type Title for Time Item'), { target: { value: 'Still unsaved' } })
    if (width === 390) {
      fireEvent.click(editor.getByRole('button', { name: 'Reveal more tools' }))
      fireEvent.click(editor.getByRole('button', { name: 'Adjust selection time' }))
      fireEvent.click(editor.getByTitle('Move start 30 minutes later'))
    } else {
      fireEvent.keyDown(window, { key: 'Escape' })
      pointer(column, 'pointerdown', 650)
      pointer(window, 'pointerup', 650)
    }
    const reopened = width === 390 ? within(screen.getByTestId('full-editor-overlay')) : screen
    expect(reopened.getByPlaceholderText('Type Title for Time Item')).toHaveValue('Still unsaved')
    expect(screen.getByTestId('selection-day-segment-0')).toHaveStyle({ top: width === 390 ? '546px' : '650px' })
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('retains a rejected new draft when its time is readjusted', async () => {
    const { column } = await openGrid()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(apiClient.post).mockRejectedValueOnce({ response: { status: 400 } })
    pointer(column, 'pointerdown', 520)
    pointer(window, 'pointerup', 520)
    fireEvent.change(within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item'), {
      target: { value: 'Retry this draft' },
    })
    await act(async () => { fireEvent.click(screen.getByTestId('full-editor-save-button')) })
    expect(screen.getByText('Could not save item. Try again.')).toBeInTheDocument()
    const editor = within(screen.getByTestId('full-editor-overlay'))
    fireEvent.click(editor.getByRole('button', { name: 'Reveal more tools' }))
    fireEvent.click(editor.getByRole('button', { name: 'Adjust selection time' }))
    fireEvent.click(editor.getByTitle('Move start 30 minutes later'))
    expect(editor.getByPlaceholderText('Type Title for Time Item')).toHaveValue('Retry this draft')
    expect(screen.getByTestId('selection-day-segment-0')).toHaveStyle({ top: '546px' })
    errorLog.mockRestore()
  })

  it.each([390, 1024])('protects unsaved edits after an existing-item save fails at width %s', async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    installMoveEvents()
    const { column } = await openGrid('Move source 0')
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(apiClient.put).mockRejectedValueOnce({ response: { status: 400 } })
    fireEvent.click(screen.getAllByText('Move source 0')[0])
    const editor = width === 390 ? within(screen.getByTestId('full-editor-overlay')) : screen
    fireEvent.change(editor.getByPlaceholderText('Type Title for Time Item'), { target: { value: 'Unsaved existing edits' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId(width === 390 ? 'full-editor-save-button' : 'left-sidebar-update-button'))
    })
    if (width === 390) fireEvent.click(editor.getByRole('button', { name: /^Close$/ }))
    pointer(column, 'pointerdown', 650)
    pointer(window, 'pointerup', 650)
    const guardedEditor = width === 390 ? within(screen.getByTestId('full-editor-overlay')) : screen
    expect(guardedEditor.getByPlaceholderText('Type Title for Time Item')).toHaveValue('Unsaved existing edits')
    expect(screen.queryByTestId('selection-day-segment-0')).not.toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
    errorLog.mockRestore()
  })

  it.each([360, 390, 430, 740])('moves once on destination tap release at phone width %s', async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    const { timestamp } = installMoveEvents()
    const { column } = await openGrid('Move source 0')
    startMove()
    expect(screen.getByText('Move mode active. Tap a destination to move.')).toBeInTheDocument()
    expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', 'false')
    pointer(column, 'pointerdown', 520)
    expect(apiClient.put).not.toHaveBeenCalled()
    await act(async () => { pointer(window, 'pointerup', 520) })
    expect(apiClient.put).toHaveBeenCalledExactlyOnceWith('/api/user-events/move-source-0', expect.objectContaining({
      title: 'Move source 0', description: 'Notes 0',
      start_time: timestamp(0, 10), end_time: timestamp(0, 11, 30),
    }))
    fireEvent.mouseDown(column, { button: 0, clientY: 520 })
    fireEvent.click(column)
    expect(apiClient.put).toHaveBeenCalledTimes(1)
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    expect(screen.queryByTestId('selection-day-segment-0')).not.toBeInTheDocument()
  })

  it.each(['swipe', 'pointercancel', 'blur', 'second-finger'])('does not place a pending move on %s', async (reason) => {
    installMoveEvents()
    const { column } = await openGrid('Move source 0')
    startMove()
    pointer(column, 'pointerdown', 520)
    if (reason === 'swipe') pointer(window, 'pointermove', 560)
    else if (reason === 'second-finger') pointer(column, 'pointerdown', 520, 2)
    else if (reason === 'blur') fireEvent(window, new Event('blur'))
    else pointer(window, 'pointercancel', 520)
    advanceHold()
    await act(async () => { pointer(window, 'pointerup', 560) })
    expect(apiClient.put).not.toHaveBeenCalledWith('/api/user-events/move-source-0', expect.anything())
    expect(apiClient.post).not.toHaveBeenCalled()
    const touchMove = new Event('touchmove', { cancelable: true })
    document.dispatchEvent(touchMove)
    expect(touchMove.defaultPrevented).toBe(false)
    await act(async () => {
      pointer(column, 'pointerdown', 520)
      pointer(window, 'pointerup', 520)
    })
    expect(vi.mocked(apiClient.put).mock.calls.filter(([url]) => url === '/api/user-events/move-source-0')).toHaveLength(1)
  })

  it('keeps the original duration during a hold and moves on release instead of selecting a range', async () => {
    const { timestamp } = installMoveEvents()
    const { column } = await openGrid('Move source 0')
    startMove()
    pointer(column, 'pointerdown', 520)
    advanceHold()
    pointer(window, 'pointermove', 600)
    expect(apiClient.put).not.toHaveBeenCalledWith('/api/user-events/move-source-0', expect.anything())
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    await act(async () => { pointer(window, 'pointerup', 600) })
    expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/move-source-0', expect.objectContaining({
      start_time: timestamp(0, 10), end_time: timestamp(0, 11, 30),
    }))
  })

  it('places over another card without selecting that card or opening its editor', async () => {
    const { timestamp } = installMoveEvents()
    const { column } = await openGrid('Move source 0')
    startMove()
    const card = column.querySelector<HTMLElement>('[data-time-management-item="true"]')
    expect(card).not.toBeNull()
    await act(async () => {
      pointer(card!, 'pointerdown', 520)
      pointer(window, 'pointerup', 520)
    })
    fireEvent.click(card!)
    expect(apiClient.put).toHaveBeenCalledExactlyOnceWith('/api/user-events/move-source-0', expect.objectContaining({
      start_time: timestamp(0, 10),
    }))
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
  })

  it('prevents a second placement while the first save is still pending', async () => {
    installMoveEvents()
    const { column } = await openGrid('Move source 0')
    let finish!: (value: { data: object }) => void
    vi.mocked(apiClient.put).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    startMove()
    pointer(column, 'pointerdown', 520)
    pointer(window, 'pointerup', 520)
    pointer(column, 'pointerdown', 600)
    pointer(window, 'pointerup', 600)
    expect(apiClient.put).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ data: {} }) })
  })

  it('retains move mode after a rejected save so a later tap can retry', async () => {
    installMoveEvents()
    const { column } = await openGrid('Move source 0')
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(apiClient.put).mockRejectedValueOnce({ response: { status: 400 } })
    startMove()
    await act(async () => {
      pointer(column, 'pointerdown', 520)
      pointer(window, 'pointerup', 520)
    })
    expect(screen.getByText('Could not move item. Try again.')).toBeInTheDocument()
    await act(async () => {
      pointer(column, 'pointerdown', 600)
      pointer(window, 'pointerup', 600)
    })
    expect(apiClient.put).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Item moved.')).toBeInTheDocument()
    errorLog.mockRestore()
  })

  it('asks for recurring scope before saving a one-tap move and allows cancellation', async () => {
    installMoveEvents(true)
    const { column } = await openGrid('Move source 0')
    startMove()
    await act(async () => {
      pointer(column, 'pointerdown', 520)
      pointer(window, 'pointerup', 520)
    })
    expect(screen.getByRole('heading', { name: 'Edit recurring item' })).toBeInTheDocument()
    expect(apiClient.put).not.toHaveBeenCalled()
    expect(apiClient.post).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ })) })
    expect(screen.queryByRole('heading', { name: 'Edit recurring item' })).not.toBeInTheDocument()
    expect(apiClient.put).not.toHaveBeenCalled()
  })

  it('moves a cut group with one tap while preserving its day/time offsets and metadata', async () => {
    const { events, timestamp } = installMoveEvents()
    const { column } = await openGrid('Move source 0')
    fireEvent.click(screen.getAllByText(events[0].title)[0], { ctrlKey: true })
    fireEvent.click(screen.getAllByText(events[1].title)[0], { ctrlKey: true })
    fireEvent.contextMenu(screen.getAllByText(events[0].title)[0], { clientX: 100, clientY: 100 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cut Selected' }))
    vi.mocked(apiClient.post).mockImplementation(async (_url, payload: unknown) => {
      if (!payload || typeof payload !== 'object') throw new Error('Expected an event payload')
      return { data: { event: { ...events[0], ...payload, id: `moved-${vi.mocked(apiClient.post).mock.calls.length}` } } }
    })
    await act(async () => {
      pointer(column, 'pointerdown', 520)
      pointer(window, 'pointerup', 520)
    })
    expect(apiClient.post).toHaveBeenCalledTimes(2)
    expect(apiClient.post).toHaveBeenNthCalledWith(1, '/api/user-events', expect.objectContaining({
      title: events[0].title, description: events[0].description, location: 'Office',
      start_time: timestamp(0, 10), end_time: timestamp(0, 11, 30),
    }))
    expect(apiClient.post).toHaveBeenNthCalledWith(2, '/api/user-events', expect.objectContaining({
      title: events[1].title, start_time: timestamp(1, 11), end_time: timestamp(1, 12, 30),
    }))
    expect(apiClient.delete).toHaveBeenCalledWith('/api/user-events/move-source-0')
    expect(apiClient.delete).toHaveBeenCalledWith('/api/user-events/move-source-1')
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
  })

  it('keeps tablet touch moves as destination selection without automatic saving', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    installMoveEvents()
    const { column } = await openGrid('Move source 0')
    startMove()
    await act(async () => {
      pointer(column, 'pointerdown', 520)
      pointer(window, 'pointerup', 520)
    })
    expect(apiClient.put).not.toHaveBeenCalled()
    expect(screen.getByTestId('selection-day-segment-0')).toBeInTheDocument()
  })

  it('returns to normal selection after a successful one-tap move', async () => {
    installMoveEvents()
    const { column } = await openGrid('Move source 0')
    startMove()
    await act(async () => {
      pointer(column, 'pointerdown', 520)
      pointer(window, 'pointerup', 520)
    })
    expect(apiClient.put).toHaveBeenCalledTimes(1)
    expect(apiClient.post).not.toHaveBeenCalled()
    await act(async () => {
      pointer(column, 'pointerdown', 600)
      pointer(window, 'pointerup', 600)
    })
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(screen.getByTestId('full-editor-overlay')).toBeInTheDocument()
  })

  it('does not automatically paste ordinary copied items on a phone grid tap', async () => {
    installMoveEvents()
    const { column } = await openGrid('Move source 0')
    fireEvent.contextMenu(screen.getAllByText('Move source 0')[0], { clientX: 100, clientY: 100 })
    fireEvent.click(screen.getByRole('menuitem', { name: /Copy Item/ }))
    await act(async () => {
      pointer(column, 'pointerdown', 520)
      pointer(window, 'pointerup', 520)
    })
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(apiClient.put).not.toHaveBeenCalled()
    expect(screen.getByTestId('full-editor-overlay')).toBeInTheDocument()
  })

  it('opens a one-slot item only on tap release and ignores compatibility mouse events', async () => {
    const { column } = await openGrid()
    pointer(column, 'pointerdown')
    fireEvent.mouseDown(column, { button: 0, clientY: 500 })
    expect(screen.queryByTestId('selection-day-segment-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    pointer(window, 'pointerup')
    expect(screen.getByTestId('selection-day-segment-0')).toHaveStyle({ height: '26px', top: '260px' })
    expect(screen.getByTestId('full-editor-overlay')).toBeInTheDocument()
  })

  it('leaves an immediate swipe to native scrolling without a draft or editor', async () => {
    const { column } = await openGrid()
    pointer(column, 'pointerdown')
    pointer(window, 'pointermove', 300)
    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(touchMove)
    expect(touchMove.defaultPrevented).toBe(false)
    advanceHold(1200)
    pointer(window, 'pointerup', 300)
    expect(screen.queryByTestId('selection-day-segment-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
  })

  it.each([390, 900])('activates at exactly half a second and preserves the anchor when reversing at width %s', async (width) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    const { column } = await openGrid()
    pointer(column, 'pointerdown')
    advanceHold(499)
    expect(screen.queryByTestId('selection-day-segment-0')).not.toBeInTheDocument()
    advanceHold(1)
    expect(screen.getByTestId('selection-day-segment-0')).toHaveStyle({ height: '26px' })
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    pointer(window, 'pointermove', 208)
    expect(screen.getByTestId('selection-day-segment-0')).toHaveStyle({ top: '208px', height: '78px' })
    pointer(window, 'pointermove', 312)
    expect(screen.getByTestId('selection-day-segment-0')).toHaveStyle({ top: '260px', height: '78px' })
    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(touchMove)
    expect(touchMove.defaultPrevented).toBe(true)
    pointer(window, 'pointerup', 312)
    if (width === 390) expect(screen.getByTestId('full-editor-overlay')).toBeInTheDocument()
    else expect(screen.getByTestId('time-management-left-panel')).toHaveAttribute('data-open', 'true')
    const afterRelease = new Event('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(afterRelease)
    expect(afterRelease.defaultPrevented).toBe(false)
  })

  it.each(['bottom', 'top'])('continues scrolling and extending at the %s edge with a stationary finger', async (edge) => {
    const { column, container } = await openGrid()
    if (edge === 'top') container.scrollTop = 500
    pointer(column, 'pointerdown')
    advanceHold()
    pointer(window, 'pointermove', edge === 'bottom' ? 599 : 101)
    const beforeScroll = container.scrollTop
    const beforeHeight = screen.getByTestId('selection-day-segment-0').style.height
    for (let i = 0; i < 5; i++) runFrame()
    expect(edge === 'bottom' ? container.scrollTop > beforeScroll : container.scrollTop < beforeScroll).toBe(true)
    expect(parseFloat(screen.getByTestId('selection-day-segment-0').style.height)).toBeGreaterThan(parseFloat(beforeHeight))
    pointer(window, 'pointerup')
    const finalScroll = container.scrollTop
    runFrame()
    expect(container.scrollTop).toBe(finalScroll)
  })

  it.each(['pointercancel', 'blur', 'second-finger'])('clears active selection and stops scrolling on %s', async (reason) => {
    const { column, container } = await openGrid()
    pointer(column, 'pointerdown')
    advanceHold()
    pointer(window, 'pointermove', 599)
    if (reason === 'second-finger') pointer(column, 'pointerdown', 300, 2)
    else if (reason === 'blur') fireEvent(window, new Event('blur'))
    else pointer(window, 'pointercancel')
    expect(screen.queryByTestId('selection-day-segment-0')).not.toBeInTheDocument()
    pointer(window, 'pointerup')
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    const finalScroll = container.scrollTop
    runFrame()
    expect(container.scrollTop).toBe(finalScroll)
  })

  it('retains immediate mouse selection', async () => {
    const { column } = await openGrid()
    fireEvent.mouseDown(column, { button: 0, clientY: 260 })
    expect(screen.getByTestId('selection-day-segment-0')).toHaveStyle({ height: '26px' })
    fireEvent.pointerUp(window)
    expect(screen.getByTestId('full-editor-overlay')).toBeInTheDocument()
  })

  it('preserves an in-progress new draft when relocating its touch range', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    const { column } = await openGrid()
    fireEvent.mouseDown(column, { button: 0, clientY: 260 })
    fireEvent.pointerUp(window)
    fireEvent.change(screen.getByPlaceholderText('Type Title for Time Item'), { target: { value: 'Unsaved draft' } })
    pointer(column, 'pointerdown', 520)
    advanceHold()
    expect(screen.getByTestId('selection-day-segment-0')).toHaveStyle({ top: '520px', height: '26px' })
    expect(screen.getByPlaceholderText('Type Title for Time Item')).toHaveValue('Unsaved draft')
    pointer(window, 'pointerup', 520)
  })

  it('respects the unsaved-edit guard and releases native scrolling when a new range is declined', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    const week = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate(), 2))
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') return { data: { events: [{
        id: 'saved-item', title: 'Saved item', source_type: 'manual', source_id: 'mode-main',
        start_time: start.toISOString(), end_time: new Date(start.getTime() + 30 * 60000).toISOString(),
        category_ids: [], recurrence_rule: { type: 'none' },
      }] } }
      return defaultGet?.(url)
    })
    const { column } = await openGrid('Saved item')
    fireEvent.click(screen.getAllByText('Saved item')[0])
    fireEvent.change(screen.getByPlaceholderText('Type Title for Time Item'), { target: { value: 'Edited saved item' } })
    pointer(column, 'pointerdown', 520)
    advanceHold()
    expect(screen.queryByTestId('selection-day-segment-0')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type Title for Time Item')).toHaveValue('Edited saved item')
    const touchMove = new Event('touchmove', { cancelable: true })
    document.dispatchEvent(touchMove)
    expect(touchMove.defaultPrevented).toBe(false)
    pointer(window, 'pointerup', 520)
  })

  it('removes the active touch scroll blocker when the page unmounts', async () => {
    const { column } = await openGrid()
    pointer(column, 'pointerdown')
    advanceHold()
    cleanup()
    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(touchMove)
    expect(touchMove.defaultPrevented).toBe(false)
  })
})
