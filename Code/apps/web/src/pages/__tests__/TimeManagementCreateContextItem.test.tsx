import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { startOfWeek } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks, installEditorDomPolyfills, mockDedupedGet, mockUseAuth,
} from './time-management-test-harness'
import { apiClient } from '../../lib/api-client'
import TimeManagementPage from '../TimeManagementPage'

describe('Time Management create-item context action', () => {
  const originalWidth = window.innerWidth

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false })
    installDefaultApiMocks()
    installEditorDomPolyfills()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    localStorage.setItem('time-management-v1', JSON.stringify({ isLeftPanelOpen: false, expandedSections: [] }))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
  })

  async function openGrid(slotMinutes = 30, external = false) {
    const week = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate() + 2, 8))
    const event = {
      id: 'existing-item', title: 'Existing item', description: 'Existing notes', location: 'Existing location',
      source_type: external ? 'google_oauth' : 'manual', source_id: external ? 'external-source' : 'mode-main',
      start_time: start.toISOString(), end_time: new Date(start.getTime() + 180 * 60000).toISOString(),
      category_ids: [], recurrence_rule: { type: 'none' },
    }
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/time-management/modes') return { data: {
        activeModeId: 'mode-main',
        modes: [{
          id: 'mode-main', name: 'Main', main_color: '#2563eb', slot_minutes: slotMinutes,
          sync_calendars: external ? [{ id: 'external-source', enabled: true }] : [],
          time_backgrounds: [], collapsed_background_ids: [], quick_templates: [],
        }],
      } }
      if (url === '/api/user-events') return { data: { events: [event] } }
      if (external && url === '/api/calendar-sources') return { data: { sources: [{
        id: 'external-source', source_type: 'google_oauth', display_name: 'External calendar',
        is_active: true, sync_enabled: true,
      }] } }
      return defaultGet?.(url)
    })
    render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    await screen.findAllByText('Existing item')
    const column = screen.getByTestId('calendar-day-column-2')
    const height = 1440 / slotMinutes * 26
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 100, top: 100, left: 0, right: 200, bottom: 100 + height,
      width: 200, height, toJSON: () => ({}),
    })
    const item = column.querySelector<HTMLElement>('[data-time-management-item="true"]')
    if (!item) throw new Error('Expected the existing item in Wednesday column')
    const clientY = 100 + 615 / slotMinutes * 26
    return { column, item, event, start, clientY, slotMinutes }
  }

  function openContext(target: HTMLElement, clientY: number) {
    fireEvent.contextMenu(target, { clientX: 120, clientY })
  }

  function createFromMenu() {
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create new time item' }))
  }

  function pointer(target: HTMLElement | Window, type: string, clientY: number, pointerId = 1) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, clientX: 120, clientY })
    fireEvent(target, event)
  }

  it.each([
    { slotMinutes: 15, occupied: false }, { slotMinutes: 30, occupied: false }, { slotMinutes: 60, occupied: false },
    { slotMinutes: 15, occupied: true }, { slotMinutes: 30, occupied: true }, { slotMinutes: 60, occupied: true },
  ])('creates a fresh one-interval draft with interval $slotMinutes and occupied=$occupied', async ({ slotMinutes, occupied }) => {
    const { column, item, clientY } = await openGrid(slotMinutes)
    openContext(occupied ? item : column, clientY)
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    createFromMenu()
    const editor = screen.getByTestId('full-editor-overlay')
    expect(within(editor).getByPlaceholderText('Type Title for Time Item')).toHaveValue('')
    expect(editor).not.toHaveTextContent('Existing notes')
    expect(editor).not.toHaveTextContent('Existing location')
    expect(screen.getByTestId('selection-day-segment-2')).toHaveStyle({
      top: `${Math.floor(615 / slotMinutes) * 26}px`, height: '26px',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(apiClient.put).not.toHaveBeenCalledWith('/api/user-events/existing-item', expect.anything())
  })

  it('saves a separate item at the invoked day and slot rather than the underlying item start or duration', async () => {
    const { item, event, start, clientY } = await openGrid()
    const startTime = new Date(start.getTime() + 120 * 60000).toISOString()
    const endTime = new Date(start.getTime() + 150 * 60000).toISOString()
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { event: {
      ...event, id: 'new-item', title: 'New time item', description: null, location: null,
      start_time: startTime, end_time: endTime,
    } } })
    openContext(item, clientY)
    createFromMenu()
    const editor = screen.getByTestId('full-editor-overlay')
    fireEvent.change(within(editor).getByPlaceholderText('Type Title for Time Item'), { target: { value: 'New time item' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({
      title: 'New time item', start_time: startTime, end_time: endTime,
      description: null, location: null, category_ids: [],
    })))
    await waitFor(() => expect(screen.getByTestId('calendar-day-column-2').querySelectorAll('[data-time-management-item="true"]')).toHaveLength(2))
    expect(item).toHaveAttribute('title', expect.stringContaining('Existing item'))
    expect(apiClient.put).not.toHaveBeenCalledWith('/api/user-events/existing-item', expect.anything())
    expect(apiClient.delete).not.toHaveBeenCalled()
  })

  it('uses a single interval at the context position even when an existing selection is longer', async () => {
    const { column, clientY } = await openGrid()
    fireEvent.mouseDown(column, { button: 0, clientY: clientY - 104 })
    fireEvent.mouseMove(column, { clientY: clientY + 104 })
    fireEvent.mouseUp(window)
    const selection = screen.getByTestId('selection-day-segment-2')
    expect(selection).not.toHaveStyle({ height: '26px' })
    openContext(selection, clientY)
    expect(screen.getByRole('menuitem', { name: /^Paste Item/ })).toBeInTheDocument()
    createFromMenu()
    expect(screen.getByTestId('selection-day-segment-2')).toHaveStyle({ top: '520px', height: '26px' })
    expect(screen.getByTestId('full-editor-overlay')).toBeVisible()
  })

  it('allows a fresh manual item over a read-only connected-calendar item', async () => {
    const { item, clientY } = await openGrid(30, true)
    openContext(item, clientY)
    expect(screen.queryByRole('menuitem', { name: 'Delete Item' })).not.toBeInTheDocument()
    createFromMenu()
    expect(within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item')).toHaveValue('')
    expect(screen.getByTestId('selection-day-segment-2')).toHaveStyle({ top: '520px', height: '26px' })
    expect(apiClient.post).not.toHaveBeenCalledWith('/api/user-events', expect.anything())
  })

  it('clamps an invocation at the day bottom to its final complete interval', async () => {
    const { column } = await openGrid(15)
    openContext(column, column.getBoundingClientRect().bottom)
    createFromMenu()
    expect(screen.getByTestId('selection-day-segment-2')).toHaveStyle({ top: '2470px', height: '26px' })
  })

  it('opens the mobile menu after a half-second hold and suppresses the release click and native menu', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const { item, clientY } = await openGrid()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    pointer(item, 'pointerdown', clientY)
    act(() => { vi.advanceTimersByTime(499) })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('menuitem', { name: 'Create new time item' })).toBeVisible()
    openContext(item, clientY)
    pointer(window, 'pointerup', clientY)
    fireEvent.click(item)
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    createFromMenu()
    expect(within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item')).toHaveValue('')
    expect(screen.getByTestId('selection-day-segment-2')).toHaveStyle({ top: '520px', height: '26px' })
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(apiClient.put).not.toHaveBeenCalledWith('/api/user-events/existing-item', expect.anything())
  })

  it.each(['swipe', 'pointercancel', 'blur', 'second-finger'])('cancels the mobile item hold on %s without opening a menu or editing', async (reason) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const { item, clientY } = await openGrid()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    pointer(item, 'pointerdown', clientY)
    if (reason === 'swipe') pointer(window, 'pointermove', clientY + 40)
    else if (reason === 'blur') fireEvent(window, new Event('blur'))
    else if (reason === 'second-finger') pointer(item, 'pointerdown', clientY, 2)
    else pointer(window, 'pointercancel', clientY)
    act(() => { vi.advanceTimersByTime(500) })
    pointer(window, 'pointerup', clientY)
    fireEvent.click(item)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(touchMove)
    expect(touchMove.defaultPrevented).toBe(false)
  })

  it('allows the next mobile tap immediately after a cancelled swipe', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const { item, clientY } = await openGrid()
    pointer(item, 'pointerdown', clientY)
    pointer(window, 'pointermove', clientY + 40)
    pointer(window, 'pointerup', clientY + 40)
    pointer(item, 'pointerdown', clientY)
    pointer(window, 'pointerup', clientY)
    fireEvent.click(item)
    expect(within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item')).toHaveValue('Existing item')
  })

  it('preserves an unsaved new draft when the user chooses Keep editing', async () => {
    const { column, clientY } = await openGrid()
    openContext(column, clientY)
    createFromMenu()
    const title = within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item')
    fireEvent.change(title, { target: { value: 'Unsaved new item' } })
    fireEvent.click(within(screen.getByTestId('full-editor-overlay')).getByRole('button', { name: 'Close' }))
    openContext(column, clientY + 104)
    createFromMenu()
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByPlaceholderText('Type Title for Time Item')).toHaveValue('Unsaved new item')
    expect(screen.getByTestId('selection-day-segment-2')).toHaveStyle({ top: '520px', height: '26px' })
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('saves an unsaved new draft before opening a fresh item at the new context position', async () => {
    const { column, event, clientY } = await openGrid()
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { event: {
      ...event, id: 'saved-draft', title: 'Draft to save',
    } } })
    openContext(column, clientY)
    createFromMenu()
    fireEvent.change(within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item'), {
      target: { value: 'Draft to save' },
    })
    fireEvent.click(within(screen.getByTestId('full-editor-overlay')).getByRole('button', { name: 'Close' }))
    openContext(column, clientY + 104)
    createFromMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument())
    expect(apiClient.post).toHaveBeenCalledWith('/api/user-events', expect.objectContaining({ title: 'Draft to save' }))
    expect(within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item')).toHaveValue('')
    expect(screen.getByTestId('selection-day-segment-2')).toHaveStyle({ top: '624px', height: '26px' })
  })

  it.each(['keep', 'save'])('protects edits to a saved item when choosing to %s before creating another', async (choice) => {
    const { column, item, clientY } = await openGrid()
    fireEvent.click(item)
    fireEvent.change(screen.getByPlaceholderText('Type Title for Time Item'), { target: { value: 'Edited existing item' } })
    openContext(column, clientY)
    createFromMenu()
    expect(screen.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible()
    if (choice === 'keep') {
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
      expect(screen.getByPlaceholderText('Type Title for Time Item')).toHaveValue('Edited existing item')
      expect(screen.queryByTestId('selection-day-segment-2')).not.toBeInTheDocument()
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument())
      expect(apiClient.put).toHaveBeenCalledWith('/api/user-events/existing-item', expect.objectContaining({ title: 'Edited existing item' }))
      expect(within(screen.getByTestId('full-editor-overlay')).getByPlaceholderText('Type Title for Time Item')).toHaveValue('')
      expect(screen.getByTestId('selection-day-segment-2')).toHaveStyle({ top: '520px', height: '26px' })
    }
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('cleans up a pending mobile hold when the page unmounts', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    const { item, clientY } = await openGrid()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    pointer(item, 'pointerdown', clientY)
    cleanup()
    act(() => { vi.advanceTimersByTime(500) })
    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true })
    document.dispatchEvent(touchMove)
    expect(touchMove.defaultPrevented).toBe(false)
  })
})
