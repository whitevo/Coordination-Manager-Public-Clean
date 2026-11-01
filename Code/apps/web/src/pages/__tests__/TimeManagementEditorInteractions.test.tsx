import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockUseAuth,
} from './time-management-test-harness'
import TimeManagementPage from '../TimeManagementPage'

describe('TimeManagement editor interaction regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isTraveler: false,
    })
    installDefaultApiMocks()
    installEditorDomPolyfills()
  })

  const openFullView = async (): Promise<HTMLElement> => {
    await screen.findByRole('heading', { name: 'Time Management' })
    fireEvent.click(screen.getByTitle('Open full view editor'))
    await screen.findByRole('button', { name: 'Collapse' }, { timeout: 5000 })

    const editor = document.querySelector('div.fixed.inset-0 .markdown-editor') as HTMLElement | null
    expect(editor).toBeTruthy()

    if (!editor) {
      throw new Error('Expected modal editor to be present')
    }

    return editor
  }

  const pasteText = (editor: HTMLElement, text: string): void => {
    fireEvent.paste(editor, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      },
    })
  }

  const pressEnter = (editor: HTMLElement): void => {
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', charCode: 13 })
  }

  it('turns on bullet and ordered list nodes from toolbar buttons', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const editor = await openFullView()

    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    await waitFor(() => {
      expect(editor.querySelector('ul')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '1.' }))
    await waitFor(() => {
      expect(editor.querySelector('ol')).toBeInTheDocument()
    })
  })

  it('changes the current block type when heading buttons are used', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const editor = await openFullView()

    fireEvent.click(screen.getByRole('button', { name: 'H1' }))
    await waitFor(() => {
      expect(editor.querySelector('h1')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'H2' }))
    await waitFor(() => {
      expect(editor.querySelector('h2')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'H3' }))
    await waitFor(() => {
      expect(editor.querySelector('h3')).toBeInTheDocument()
    })
  })

  it('turns HTTP URLs into safe clickable links after Space or Enter', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const editor = await openFullView()
    fireEvent.focus(editor)
    pasteText(editor, 'https://example.com/notes')
    fireEvent.keyDown(editor, { key: ' ', code: 'Space', charCode: 32 })
    pasteText(editor, 'https://example.com/agenda')
    pressEnter(editor)

    await waitFor(() => {
      const spaceAnchor = editor.querySelector('a[href="https://example.com/notes"]')
      const enterAnchor = editor.querySelector('a[href="https://example.com/agenda"]')
      expect(spaceAnchor).toBeInTheDocument()
      expect(spaceAnchor).toHaveAttribute('target', '_blank')
      expect(spaceAnchor).toHaveAttribute('rel', 'noopener noreferrer')
      expect(enterAnchor).toBeInTheDocument()
    })
  })

  it('adds a root-relative app route with the final Link toolbar button', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const editor = await openFullView()
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    const linkForm = await screen.findByRole('form', { name: 'Link URL' })
    expect(linkForm).toHaveClass('fixed')
    expect(linkForm).toHaveStyle({ left: '12px', top: '12px' })
    // The link popover claims the popover layer, so it resolves above the full editor it opened from.
    const fullEditorOverlay = screen.getByTestId('full-editor-overlay')
    expect(Number(linkForm.style.zIndex)).toBeGreaterThan(Number(fullEditorOverlay.style.zIndex))

    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), {
      target: { value: '/calendar/example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      const anchor = editor.querySelector('a[href="/calendar/example"]')
      expect(anchor).toBeInTheDocument()
      expect(anchor).toHaveTextContent('/calendar/example')
      expect(editor.textContent).toBe(' /calendar/example ')
    })
  })

  it('adds missing spaces around a linked single-character selection', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const editor = await openFullView()
    fireEvent.focus(editor)
    pasteText(editor, 'leftXright')

    const textNode = editor.querySelector('p')?.firstChild
    expect(textNode).toBeInstanceOf(Text)
    if (!(textNode instanceof Text)) return

    const range = document.createRange()
    range.setStart(textNode, 4)
    range.setEnd(textNode, 5)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))

    fireEvent.click(screen.getByRole('button', { name: 'Link' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'URL' }), {
      target: { value: 'https://example.com/x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      const anchor = editor.querySelector('a[href="https://example.com/x"]')
      expect(anchor).toHaveTextContent('X')
      expect(editor.textContent).toBe('left X right')
    })
  })

  it('moves out of an empty checklist item on Enter', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const editor = await openFullView()

    fireEvent.click(screen.getByRole('button', { name: 'Checkbox' }))
    await waitFor(() => {
      expect(editor.querySelector("ul[data-type='taskList']")).toBeInTheDocument()
    })

    fireEvent.focus(editor)
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', charCode: 13 })

    await waitFor(() => {
      expect(editor.querySelector("ul[data-type='taskList']")).toBeInTheDocument()
      expect(editor.querySelector('p')).toBeInTheDocument()
    })
  })

  it('preserves an intentional blank line after exiting checklist mode', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const editor = await openFullView()

    fireEvent.click(screen.getByRole('button', { name: 'Checkbox' }))
    await waitFor(() => {
      expect(editor.querySelector("ul[data-type='taskList']")).toBeInTheDocument()
    })

    fireEvent.focus(editor)

    // First Enter exits checklist mode from the empty task item.
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', charCode: 13 })

    // Second Enter creates an intentional spacer paragraph before typing.
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', charCode: 13 })
    pasteText(editor, 'After spacer line')

    await waitFor(() => {
      const rootChildren = Array.from(editor.children)
      expect(rootChildren.some((node) => node.matches("ul[data-type='taskList']"))).toBe(true)

      const paragraphNodes = rootChildren.filter((node) => node.tagName === 'P')
      expect(paragraphNodes.length).toBeGreaterThanOrEqual(2)
      expect(paragraphNodes.some((node) => (node.textContent ?? '').includes('After spacer line'))).toBe(true)
      expect(paragraphNodes.some((node) => (node.textContent ?? '').trim() === '')).toBe(true)
    })
  })

  it('keeps cursor flow stable through checklist, list, ordered list, collapse, and code steps', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    const editor = await openFullView()
    fireEvent.focus(editor)

    pasteText(editor, 'START TEXT HERE\nTEST TEXT HERE: starting test after this line')
    pressEnter(editor)

    fireEvent.click(screen.getByRole('button', { name: 'Checkbox' }))
    await waitFor(() => {
      expect(editor.querySelector("ul[data-type='taskList']")).toBeInTheDocument()
    })

    pasteText(editor, 'checkbox one')
    pressEnter(editor)
    pasteText(editor, 'checkbox two')
    pressEnter(editor)
    pressEnter(editor)

    await waitFor(() => {
      const taskList = editor.querySelector("ul[data-type='taskList']")
      expect(taskList).toBeInTheDocument()
      expect(taskList?.querySelectorAll(':scope > li').length ?? 0).toBeGreaterThanOrEqual(2)
    })

    pasteText(editor, 'AFTER CHECKBOX EXIT')

    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    await waitFor(() => {
      expect(editor.querySelector('ul')).toBeInTheDocument()
    })

    pasteText(editor, 'bullet one')
    pressEnter(editor)
    pasteText(editor, 'bullet two')
    pressEnter(editor)
    pressEnter(editor)

    await waitFor(() => {
      const bulletList = editor.querySelector("ul:not([data-type='taskList'])")
      expect(bulletList).toBeInTheDocument()
      expect(bulletList?.querySelectorAll(':scope > li').length ?? 0).toBeGreaterThanOrEqual(2)
    })

    pasteText(editor, 'AFTER BULLET EXIT')

    fireEvent.click(screen.getByRole('button', { name: '1.' }))
    await waitFor(() => {
      expect(editor.querySelector('ol')).toBeInTheDocument()
    })

    pasteText(editor, 'number one')
    pressEnter(editor)
    pasteText(editor, 'number two')
    pressEnter(editor)
    pressEnter(editor)

    await waitFor(() => {
      const orderedList = editor.querySelector('ol')
      expect(orderedList).toBeInTheDocument()
      expect(orderedList?.querySelectorAll(':scope > li').length ?? 0).toBeGreaterThanOrEqual(2)
    })

    pasteText(editor, 'AFTER NUMBERED EXIT')

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    await waitFor(() => {
      expect(editor.querySelector("[data-type='details']")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Code' }))
    pasteText(editor, 'inline-code')

    pressEnter(editor)
    pasteText(editor, 'THE END')

    await waitFor(() => {
      const text = editor.textContent ?? ''
      expect(text).toContain('START TEXT HERE')
      expect(text).toContain('TEST TEXT HERE: starting test after this line')
      expect(text).toContain('AFTER CHECKBOX EXIT')
      expect(text).toContain('AFTER BULLET EXIT')
      expect(text).toContain('AFTER NUMBERED EXIT')
      expect(text).toContain('THE END')
    })
  }, 10000)

})
