import '@testing-library/jest-dom/vitest'
import { startOfWeek } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockDedupedGet,
  mockUseAuth,
} from './time-management-test-harness'
import { apiClient } from '../../lib/api-client'
import TimeManagementPage from '../TimeManagementPage'

describe('TimeManagement category context menu', () => {
  const originalWidth = window.innerWidth
  const originalHeight = window.innerHeight

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockUseAuth.mockReturnValue({ isLoading: false, isAuthenticated: true, isTraveler: false })
    installDefaultApiMocks()
    installEditorDomPolyfills()
    localStorage.setItem('time-management-v1', JSON.stringify({ openLeftPanelOnItemSelectionMode: 'never' }))
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight })
  })

  async function renderMenu(width: number, height: number, categoryCount = 2) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
    const week = startOfWeek(new Date(), { weekStartsOn: 1 })
    const start = new Date(Date.UTC(week.getFullYear(), week.getMonth(), week.getDate(), 12))
    const event = {
      id: 'category-menu-item', title: 'Category menu target', description: null,
      meeting_link: null, location: null, start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 3600000).toISOString(),
      source_type: 'manual', source_id: 'mode-main', category_ids: ['category-0'],
    }
    const defaultGet = mockDedupedGet.getMockImplementation()
    mockDedupedGet.mockImplementation(async (url: string) => {
      if (url === '/api/user-events') return { data: { events: [event] } }
      if (url === '/api/time-management/categories') {
        return { data: { categories: Array.from({ length: categoryCount }, (_, index) => ({
          id: `category-${index}`, label: `Category ${index}`, color: '#16a34a',
          font_color: '#ffffff', sort_order: index,
        })) } }
      }
      return defaultGet?.(url)
    })
    render(<MemoryRouter><TimeManagementPage /></MemoryRouter>)
    fireEvent.contextMenu((await screen.findAllByText(event.title))[0], { clientX: width - 20, clientY: height - 20 })
    return screen.getByRole('menuitem', { name: 'Assign Category' })
  }

  function touch(target: HTMLElement, type: string) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 20, clientY: 260 })
    fireEvent(target, event)
  }

  it.each(['plain', 'category', 'delete'])('dismisses the %s menu on an outside grid tap without selecting, then permits the next tap', async (kind) => {
    const categoryTrigger = await renderMenu(390, 844)
    if (kind === 'category') fireEvent.click(categoryTrigger)
    if (kind === 'delete') fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Item' }))
    const column = screen.getByTestId('calendar-day-column-0')
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 1248,
      width: 100, height: 1248, toJSON: () => ({}),
    })
    touch(column, 'pointerdown')
    touch(column, 'pointerup')
    fireEvent.mouseDown(column, { button: 0, clientY: 260 })
    fireEvent.click(column)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByTestId('selection-day-segment-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    touch(column, 'pointerdown')
    touch(column, 'pointerup')
    expect(screen.getByTestId('selection-day-segment-0')).toBeInTheDocument()
    expect(screen.getByTestId('full-editor-overlay')).toBeInTheDocument()
  })

  it('does not select an underlying item on the dismissal tap', async () => {
    localStorage.setItem('time-management-v1', JSON.stringify({ openLeftPanelOnItemSelectionMode: 'always' }))
    await renderMenu(390, 844)
    const item = screen.getAllByText('Category menu target')[0].closest<HTMLElement>('[data-time-management-item="true"]')
    if (!item) throw new Error('Expected item')
    // The menu is elsewhere; tapping another repeat of the same item is outside.
    touch(item, 'pointerdown')
    touch(item, 'pointerup')
    fireEvent.click(item)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(item).not.toHaveAttribute('data-selected', 'true')
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    touch(item, 'pointerdown')
    touch(item, 'pointerup')
    fireEvent.click(item)
    expect(screen.getByTestId('full-editor-overlay')).toBeInTheDocument()
  })

  it('keeps touch actions inside the menu and inline category submenu functional', async () => {
    const trigger = await renderMenu(390, 844)
    touch(trigger, 'pointerdown')
    touch(trigger, 'pointerup')
    fireEvent.click(trigger)
    const category = screen.getByRole('menuitemcheckbox', { name: 'Category 1' })
    touch(category, 'pointerdown')
    touch(category, 'pointerup')
    fireEvent.click(category)
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/api/user-events/category-menu-item', expect.objectContaining({ category_ids: ['category-0', 'category-1'] }),
    ))
    expect(screen.getByRole('menu', { name: 'Assign Category options' })).toBeInTheDocument()
  })

  it('allows cancelling the nested delete confirmation without triggering underlying actions', async () => {
    await renderMenu(390, 844)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Item' }))
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    touch(cancel, 'pointerdown')
    touch(cancel, 'pointerup')
    fireEvent.click(cancel)
    expect(screen.queryByText('Delete this item?')).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete Item' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
    expect(apiClient.delete).not.toHaveBeenCalled()
  })

  it('dismisses the selection menu without relocating the existing range', async () => {
    await renderMenu(390, 844)
    const column = screen.getByTestId('calendar-day-column-0')
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 1248,
      width: 100, height: 1248, toJSON: () => ({}),
    })
    touch(column, 'pointerdown')
    touch(column, 'pointerup')
    const mousePress = new Event('pointerdown', { bubbles: true, cancelable: true })
    Object.assign(mousePress, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 20, clientY: 260 })
    fireEvent(column, mousePress)
    fireEvent.mouseDown(column, { button: 0, clientX: 20, clientY: 260 })
    fireEvent.pointerCancel(window)
    const original = screen.getByTestId('selection-day-segment-0')
    const originalTop = original.style.top
    fireEvent.contextMenu(original, { clientX: 100, clientY: 260 })
    expect(document.getElementById('selection-paste-context-menu')).toBeInTheDocument()
    const nextDay = screen.getByTestId('calendar-day-column-1')
    touch(nextDay, 'pointerdown')
    touch(nextDay, 'pointerup')
    fireEvent.click(nextDay)
    expect(document.getElementById('selection-paste-context-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('selection-day-segment-0').style.top).toBe(originalTop)
    expect(screen.queryByTestId('selection-day-segment-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('full-editor-overlay')).not.toBeInTheDocument()
  })

  it.each([
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 667, height: 320 },
  ])('expands a scrollable inline list on phones at $width x $height and saves category changes', async ({ width, height }) => {
    const trigger = await renderMenu(width, height, 30)
    fireEvent.mouseEnter(trigger.parentElement!)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    const submenu = screen.getByRole('menu', { name: 'Assign Category options' })
    expect(submenu).not.toHaveClass('fixed', 'absolute')
    expect(submenu).toHaveClass('overflow-y-auto')
    expect(submenu.style.left).toBe('')
    expect(submenu.style.top).toBe('')
    expect(submenu.closest('#calendar-item-context-menu')).toHaveClass('overflow-y-auto', 'max-h-[calc(100dvh-1rem)]')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Category 0 checked' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('menuitemcheckbox')).toHaveLength(30)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Category 1' }))
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      '/api/user-events/category-menu-item',
      expect.objectContaining({ category_ids: ['category-0', 'category-1'] }),
    ))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu', { name: 'Assign Category options' })).not.toBeInTheDocument()
  })

  it.each([768, 1400].flatMap((width) => ['left', 'right'].map((edge) => ({ width, edge }))))(
    'positions the flyout from measured geometry at $width near the $edge edge', async ({ width, edge }) => {
    const height = 600
    const menuLeft = edge === 'left' ? 8 : width - 208
    const nativeRect = HTMLElement.prototype.getBoundingClientRect
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      let left = 0
      let top = 0
      let rectWidth = 0
      let rectHeight = 0
      if (this.id === 'calendar-item-context-menu') {
        left = menuLeft
        top = height - 248
        rectWidth = 200
        rectHeight = 240
      } else if (this.getAttribute('aria-label') === 'Assign Category options') {
        rectWidth = 224
        rectHeight = 288
      } else if (this.getAttribute('aria-haspopup') === 'menu') {
        top = height - 70
      } else {
        return nativeRect.call(this)
      }
      return { x: left, y: top, left, top, right: left + rectWidth, bottom: top + rectHeight,
        width: rectWidth, height: rectHeight, toJSON: () => ({}) }
    })
    try {
      const trigger = await renderMenu(width, height)
      fireEvent.mouseEnter(trigger.parentElement!)
      const submenu = screen.getByRole('menu', { name: 'Assign Category options' })
      expect(submenu).toHaveClass('fixed')
      expect(submenu.style.left).toBe(`${edge === 'left' ? menuLeft + 200 : menuLeft - 224}px`)
      expect(submenu.style.top).toBe(`${height - 288 - 8}px`)
      expect(Number.parseFloat(submenu.style.left)).toBeGreaterThanOrEqual(8)
      fireEvent.mouseDown(document.body)
      expect(screen.queryByRole('menu', { name: 'Assign Category options' })).not.toBeInTheDocument()
    } finally {
      rectSpy.mockRestore()
    }
  })

  it('shows the empty category explanation inside the phone menu', async () => {
    const trigger = await renderMenu(390, 844, 0)
    fireEvent.click(trigger)
    expect(screen.getByRole('menu', { name: 'Assign Category options' })).toHaveTextContent(
      'No categories yet. Create one in the Categories section.',
    )
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
