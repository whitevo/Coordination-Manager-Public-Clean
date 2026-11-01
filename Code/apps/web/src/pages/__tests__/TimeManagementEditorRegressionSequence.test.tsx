import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeEach, describe, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

// vi.hoisted ensures the editor capture array exists before vi.mock factories run.
const { capturedEditors } = vi.hoisted(() => ({ capturedEditors: [] as unknown[] }))

vi.mock('@tiptap/react', async () => {
  const actual = await vi.importActual<typeof import('@tiptap/react')>('@tiptap/react')
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args)
      if (editor && !capturedEditors.includes(editor)) {
        capturedEditors.push(editor)
      }
      return editor
    },
  }
})

import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockUseAuth,
} from './time-management-test-harness'
import TimeManagementPage from '../TimeManagementPage'

type StepStatus = 'PASS' | 'FAIL'
interface StepResult {
  step: number
  name: string
  status: StepStatus
  message?: string
  detail?: Record<string, unknown>
}

interface ProseMirrorView {
  dom: HTMLElement
  someProp: <T>(name: string, callback: (value: (view: ProseMirrorView, from: number, to: number, text: string) => boolean) => T) => T
  dispatch: (tr: unknown) => void
}

interface TiptapLike {
  view: ProseMirrorView
  state: {
    selection: { from: number; to: number; empty: boolean; $from: ProseMirrorResolvedPos }
    doc: ProseMirrorNode
    schema: { nodes: Record<string, unknown> }
    tr: { insertText: (text: string, from?: number, to?: number) => unknown }
  }
  commands: {
    focus: () => boolean
    insertContent: (content: string) => boolean
    setTextSelection: (pos: number | { from: number; to?: number }) => boolean
    setContent: (value: string, options?: { contentType?: string }) => boolean
    clearContent: () => boolean
  }
  isActive: (name: string, attrs?: Record<string, unknown>) => boolean
  getJSON: () => unknown
  getMarkdown: () => string
}

interface ProseMirrorNode {
  type: { name: string }
  textContent: string
  childCount: number
  child: (index: number) => ProseMirrorNode
  maybeChild: (index: number) => ProseMirrorNode | null
  descendants: (
    callback: (node: ProseMirrorNode, pos: number) => boolean | void,
  ) => void
  firstChild: ProseMirrorNode | null
}

interface ProseMirrorResolvedPos {
  parent: ProseMirrorNode
  parentOffset: number
  depth: number
  index: (depth?: number) => number
  node: (depth?: number) => ProseMirrorNode
  before: (depth?: number) => number
  after: (depth?: number) => number
}

const report: StepResult[] = []
const pendingRafTimers = new Set<ReturnType<typeof setTimeout>>()

function record(step: number, name: string, fn: () => void, detail?: () => Record<string, unknown>): void {
  try {
    fn()
    report.push({ step, name, status: 'PASS', detail: detail?.() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    let collectedDetail: Record<string, unknown> | undefined
    try {
      collectedDetail = detail?.()
    } catch {
      collectedDetail = undefined
    }
    report.push({ step, name, status: 'FAIL', message, detail: collectedDetail })
  }
}

async function recordAsync(
  step: number,
  name: string,
  fn: () => void | Promise<void>,
  detail?: () => Record<string, unknown>,
): Promise<void> {
  try {
    await fn()
    report.push({ step, name, status: 'PASS', detail: detail?.() })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    let collectedDetail: Record<string, unknown> | undefined
    try {
      collectedDetail = detail?.()
    } catch {
      collectedDetail = undefined
    }
    report.push({ step, name, status: 'FAIL', message, detail: collectedDetail })
  }
}

function getModalEditor(): TiptapLike {
  for (let i = capturedEditors.length - 1; i >= 0; i -= 1) {
    const candidate = capturedEditors[i] as TiptapLike | undefined
    const dom = candidate?.view?.dom as HTMLElement | undefined
    if (dom?.closest('div.fixed.inset-0')) {
      return candidate as TiptapLike
    }
  }
  throw new Error('Modal editor not captured. Make sure Full View is open.')
}

function dispatchKey(editor: TiptapLike, key: string, code?: string): void {
  fireEvent.keyDown(editor.view.dom, { key, code: code ?? key, charCode: key.length === 1 ? key.charCodeAt(0) : 0 })
}

function pressEnter(editor: TiptapLike): void {
  dispatchKey(editor, 'Enter', 'Enter')
}

function pressSpace(editor: TiptapLike): void {
  dispatchKey(editor, ' ', 'Space')
}

function pressBracketClose(editor: TiptapLike): void {
  dispatchKey(editor, ']', 'BracketRight')
}

function pressLessThan(editor: TiptapLike): void {
  // Try the canonical handleTextInput path first (this is how real typing reaches the
  // inputRules plugin). If a plugin claims it, the rule fires and dispatches a tr.
  const { from, to } = editor.state.selection
  const view = editor.view
  const handled = view.someProp('handleTextInput', (fn) => fn(view, from, to, '<'))
  if (handled) return

  // Fallback: dispatch the text with `applyInputRules` meta so the inputRules plugin
  // schedules a deferred run() (matches TipTap's `insertContent` simulated-input flow).
  const tr = (editor.state.tr.insertText('<', from, to) as unknown) as { setMeta: (key: string, value: unknown) => void }
  tr.setMeta('applyInputRules', { from, text: '<' })
  editor.view.dispatch(tr)
}

function caretLineText(editor: TiptapLike): string {
  return editor.state.selection.$from.parent.textContent
}

function caretNodeName(editor: TiptapLike): string {
  return editor.state.selection.$from.parent.type.name
}

function topChildren(editor: TiptapLike): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = []
  for (let i = 0; i < editor.state.doc.childCount; i += 1) {
    out.push(editor.state.doc.child(i))
  }
  return out
}

function findFirstPositionAtEndOfText(editor: TiptapLike, text: string): number {
  let result = -1
  editor.state.doc.descendants((node, pos) => {
    if (result !== -1) return false
    if (!node.type.name.startsWith('paragraph') && node.type.name !== 'paragraph') return true
    if (node.textContent === text) {
      // pos points to the paragraph itself, +1 to enter, + length to end of text
      result = pos + 1 + text.length
      return false
    }
    return true
  })
  return result
}

function snapshotDoc(editor: TiptapLike): Record<string, unknown> {
  return {
    caretFrom: editor.state.selection.from,
    caretNode: caretNodeName(editor),
    caretLine: caretLineText(editor),
    children: topChildren(editor).map((node) => ({
      type: node.type.name,
      text: node.textContent,
      childCount: node.childCount,
    })),
  }
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

describe('TimeManagement editor regression sequence (user walkthrough)', () => {
  beforeEach(() => {
    capturedEditors.length = 0
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ isAuthenticated: true, isTraveler: false })
    installDefaultApiMocks()
    installEditorDomPolyfills()
    // The harness installs a synchronous requestAnimationFrame which breaks the details
    // input rule (the rule schedules an rAF BEFORE the dispatch happens and assumes the
    // rAF fires after dispatch). Re-stub here so the rAF defers to the next tick.
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      const timerId = setTimeout(() => {
        pendingRafTimers.delete(timerId)
        callback(0)
      }, 0)
      pendingRafTimers.add(timerId)
      return timerId as unknown as number
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
      pendingRafTimers.delete(id as unknown as ReturnType<typeof setTimeout>)
    })
  })

  afterEach(() => {
    for (const timerId of pendingRafTimers) {
      clearTimeout(timerId)
    }
    pendingRafTimers.clear()
  })

  afterAll(() => {
    const reportsDir = join(process.cwd(), 'test-reports')
    try {
      mkdirSync(reportsDir, { recursive: true })
      writeFileSync(
        join(reportsDir, 'editor-regression-report.json'),
        JSON.stringify(
          { timestamp: new Date().toISOString(), summary: summarize(), results: report },
          null,
          2,
        ),
        'utf8',
      )
    } catch {
      // best-effort report file
    }

    // Console summary (also visible in vitest output)
    const passed = report.filter((r) => r.status === 'PASS').length
    const failed = report.filter((r) => r.status === 'FAIL').length
     
    console.log('\n===== Editor Regression Report =====')
    for (const r of report) {
      const marker = r.status === 'PASS' ? '[PASS]' : '[FAIL]'
       
      console.log(`${marker} Step ${r.step}: ${r.name}${r.message ? ' -- ' + r.message : ''}`)
    }
     
    console.log(`\nTotal: ${report.length} | Passed: ${passed} | Failed: ${failed}`)
     
    console.log(`Report file: ${join(reportsDir, 'editor-regression-report.json')}`)
  })

  function summarize(): { total: number; passed: number; failed: number } {
    const passed = report.filter((r) => r.status === 'PASS').length
    const failed = report.filter((r) => r.status === 'FAIL').length
    return { total: report.length, passed, failed }
  }

  // Single end-to-end walkthrough so report ordering matches the user's manual flow.
  it('runs the 19-step typing walkthrough and records pass/fail per step', async () => {
    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: 'Time Management' })

    // Step 1: Click the "Full view" button
    record(
      1,
      'Click the Full View button to open the editor modal',
      () => {
        fireEvent.click(screen.getByTitle('Open full view editor'))
      },
    )

    // Wait for the modal editor to mount and the capture hook to record it.
    await waitFor(() => {
      const modalDom = document.querySelector('div.fixed.inset-0 .markdown-editor')
      if (!modalDom) throw new Error('modal editor DOM not mounted yet')
    })
    await waitFor(() => {
      // Ensure useEditor captured an editor whose DOM is inside the modal.
      const modal = capturedEditors.find((cand) => {
        const dom = (cand as TiptapLike | undefined)?.view?.dom
        return dom?.closest('div.fixed.inset-0')
      })
      if (!modal) throw new Error('modal editor not captured yet')
    })

    const editor = getModalEditor()
    editor.commands.focus()
    editor.commands.clearContent()

    // Step 2: Cursor is on the description editor (implicit after Full View)
    record(
      2,
      'Editor is focused with empty document on first paragraph',
      () => {
        expect(caretNodeName(editor) === 'paragraph', `caret node is ${caretNodeName(editor)}, expected paragraph`)
        expect(caretLineText(editor) === '', `expected empty line, got '${caretLineText(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 3: Type "Start test"
    record(
      3,
      'Type "Start test" on the first line',
      () => {
        editor.commands.insertContent('Start test')
        expect(caretLineText(editor) === 'Start test', `line text was '${caretLineText(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 4: Enter
    record(
      4,
      'Press Enter to start a new paragraph',
      () => {
        pressEnter(editor)
        expect(caretLineText(editor) === '', `expected empty new line, got '${caretLineText(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 5: Type "End text"
    record(
      5,
      'Type "End text" on the second line',
      () => {
        editor.commands.insertContent('End text')
        expect(caretLineText(editor) === 'End text', `line text was '${caretLineText(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 6: Click at the end of "Start test" -> place caret programmatically
    record(
      6,
      'Place caret at the end of the "Start test" line',
      () => {
        const targetPos = findFirstPositionAtEndOfText(editor, 'Start test')
        expect(targetPos > 0, 'could not find "Start test" paragraph')
        editor.commands.setTextSelection(targetPos)
        expect(caretLineText(editor) === 'Start test', `caret moved into '${caretLineText(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 7: Enter -- inserts a new empty paragraph between Start/End
    record(
      7,
      'Enter inserts a new empty line between Start test and End text',
      () => {
        pressEnter(editor)
        expect(caretLineText(editor) === '', `expected empty middle line, got '${caretLineText(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 8: Caret should sit on the middle empty paragraph between Start and End
    record(
      8,
      'Caret is on the empty middle paragraph with Start test above and End text below',
      () => {
        const { $from } = editor.state.selection
        const parentIndex = $from.index(0)
        const prev = editor.state.doc.maybeChild(parentIndex - 1)
        const next = editor.state.doc.maybeChild(parentIndex + 1)
        expect(prev?.textContent === 'Start test', `previous block was '${prev?.textContent ?? '<none>'}'`)
        expect(next?.textContent === 'End text', `next block was '${next?.textContent ?? '<none>'}'`)
        expect(caretLineText(editor) === '', `middle line was '${caretLineText(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 9: Type "[]" -- inserts '[' then sends ']' which triggers checkbox shortcut
    record(
      9,
      'Type "[" then "]" to trigger the checkbox shortcut',
      () => {
        editor.commands.insertContent('[')
        pressBracketClose(editor)
      },
      () => snapshotDoc(editor),
    )

    // Step 10: Checkbox appeared and caret is inside an empty task item
    record(
      10,
      'A checkbox was created and the caret is right of it (empty task item)',
      () => {
        expect(editor.isActive('taskItem'), `expected taskItem active, isActive was '${caretNodeName(editor)}'`)
        expect(caretLineText(editor) === '', `task line text was '${caretLineText(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 11: Type "test1"
    record(
      11,
      'Type "test1" inside the first checkbox',
      () => {
        editor.commands.insertContent('test1')
        expect(caretLineText(editor) === 'test1', `task content was '${caretLineText(editor)}'`)
        expect(editor.isActive('taskItem'), 'caret should still be inside a task item')
      },
      () => snapshotDoc(editor),
    )

    // Step 12: Enter -- splits to a fresh empty task item
    record(
      12,
      'Enter splits the task list into a new empty checkbox row',
      () => {
        pressEnter(editor)
        expect(editor.isActive('taskItem'), 'expected to still be in a task item after split')
        expect(caretLineText(editor) === '', `new task line text was '${caretLineText(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 13: New checkbox visible (no typing in this step per user spec)
    record(
      13,
      'A second empty checkbox is visible with caret right of it',
      () => {
        // Find the task list and confirm it has at least 2 task items
        let taskItemCount = 0
        editor.state.doc.descendants((node) => {
          if (node.type.name === 'taskItem') taskItemCount += 1
          return true
        })
        expect(taskItemCount >= 2, `expected >= 2 task items, found ${taskItemCount}`)
        expect(editor.isActive('taskItem'), 'caret should be in a task item')
      },
      () => snapshotDoc(editor),
    )

    // Step 14: Enter again on the empty checkbox -- should lift to a plain paragraph
    record(
      14,
      'Enter on the empty checkbox lifts the row out of the task list',
      () => {
        pressEnter(editor)
      },
      () => snapshotDoc(editor),
    )

    // Step 15: Caret on a plain empty paragraph one line before End text; no extra blank lines lost
    record(
      15,
      'Caret on plain paragraph between the task list and End text (no blank lines lost)',
      () => {
        expect(!editor.isActive('taskItem'), 'caret should no longer be in a task item')
        expect(caretNodeName(editor) === 'paragraph', `caret node was '${caretNodeName(editor)}'`)
        expect(caretLineText(editor) === '', `paragraph text was '${caretLineText(editor)}'`)

        // The very next sibling at depth 0 should be the "End text" paragraph.
        const { $from } = editor.state.selection
        const parentIndex = $from.index(0)
        const next = editor.state.doc.maybeChild(parentIndex + 1)
        expect(next?.textContent === 'End text', `next sibling was '${next?.textContent ?? '<none>'}'`)

        // The previous sibling should still be the task list with exactly one remaining
        // task item containing "test1" (so we didn't accidentally swallow it).
        const prev = editor.state.doc.maybeChild(parentIndex - 1)
        expect(prev?.type.name === 'taskList', `previous sibling type was '${prev?.type.name ?? '<none>'}'`)
        expect(prev?.childCount === 1, `task list child count was ${prev?.childCount ?? -1}`)
        expect(prev?.textContent === 'test1', `remaining task item text was '${prev?.textContent ?? '<none>'}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 16: Type "-" then Space -- triggers bullet list
    record(
      16,
      'Type "-" then Space to start a bullet list on the same line',
      () => {
        editor.commands.insertContent('-')
        pressSpace(editor)
      },
      () => snapshotDoc(editor),
    )

    // Step 17: Bullet visible and caret right of it (empty list item)
    record(
      17,
      'Bullet list is active with caret in an empty list item',
      () => {
        expect(editor.isActive('bulletList'), `expected bulletList active, current node was '${caretNodeName(editor)}'`)
        expect(caretLineText(editor) === '', `bullet line text was '${caretLineText(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 18: Type "test2"
    record(
      18,
      'Type "test2" inside the bullet',
      () => {
        editor.commands.insertContent('test2')
        expect(caretLineText(editor) === 'test2', `bullet content was '${caretLineText(editor)}'`)
        expect(editor.isActive('bulletList'), 'caret should still be in a bullet list')
      },
      () => snapshotDoc(editor),
    )

    // ------- Step 19+: continue with same logic to cover remaining shortcuts -------

    // Step 19: Exit bullet (Enter on empty bullet should remove the list item).
    record(
      19,
      'Enter on an empty bullet line exits the bullet list back to a paragraph',
      () => {
        pressEnter(editor) // splits to a new empty bullet
        pressEnter(editor) // empty bullet should exit
        expect(!editor.isActive('bulletList'), 'expected to have exited bullet list')
        expect(caretNodeName(editor) === 'paragraph', `node after exit was '${caretNodeName(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 20: "1." + Space -> ordered list
    record(
      20,
      'Type "1." then Space to start an ordered list',
      () => {
        editor.commands.insertContent('1.')
        pressSpace(editor)
        expect(editor.isActive('orderedList'), `expected orderedList active, current node '${caretNodeName(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 21: Type content in ordered list, then Enter twice to exit.
    record(
      21,
      'Type "first", Enter, Enter to exit ordered list back to paragraph',
      () => {
        editor.commands.insertContent('first')
        pressEnter(editor)
        pressEnter(editor)
        expect(!editor.isActive('orderedList'), 'expected to have exited ordered list')
        expect(caretNodeName(editor) === 'paragraph', `node after exit was '${caretNodeName(editor)}'`)
      },
      () => snapshotDoc(editor),
    )

    // Step 22: "<" on an empty line creates a details/collapse block with the caret in the summary.
    await recordAsync(
      22,
      'Type "<" on an empty line to create a collapse block with caret in summary',
      async () => {
        pressLessThan(editor)
        // The inputRules plugin schedules the rule's run() via setTimeout(0); flush it.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(
          editor.isActive('detailsSummary') || editor.isActive('details'),
          `expected to be inside the collapse block, current node '${caretNodeName(editor)}'`,
        )
      },
      () => snapshotDoc(editor),
    )

    // Step 23: Type a summary title inside the collapse block.
    await recordAsync(
      23,
      'Type "spoiler title" inside the collapse summary',
      async () => {
        editor.commands.insertContent('spoiler title')
        // The detailsSummary may not show isActive in some TipTap versions; assert content instead.
        let foundSummary = false
        editor.state.doc.descendants((node) => {
          if (foundSummary) return false
          if (node.type.name === 'detailsSummary' && node.textContent === 'spoiler title') {
            foundSummary = true
            return false
          }
          return true
        })
        expect(foundSummary, 'expected a detailsSummary node containing "spoiler title"')
      },
      () => snapshotDoc(editor),
    )

    // Step 24: Verify the document still contains the earlier checkpoints (no destructive normalization).
    record(
      24,
      'Document still contains Start test, test1 checkbox, test2 bullet, ordered "first", and End text',
      () => {
        const text = editor.view.dom.textContent ?? ''
        const json = JSON.stringify(editor.getJSON())
        expect(text.includes('Start test'), '"Start test" missing from document')
        expect(text.includes('test1'), '"test1" missing from document')
        expect(text.includes('test2'), '"test2" missing from document')
        expect(text.includes('first'), 'ordered list "first" entry missing from document')
        expect(text.includes('End text'), '"End text" missing from document')
        expect(json.includes('"taskItem"'), 'taskItem node missing from document JSON')
        expect(json.includes('"bulletList"'), 'bulletList node missing from document JSON')
        expect(json.includes('"orderedList"'), 'orderedList node missing from document JSON')
      },
      () => ({
        markdown: editor.getMarkdown(),
        json: editor.getJSON(),
      }),
    )
  })
})
