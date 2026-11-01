import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, Extension, InputRule, useEditor, wrappingInputRule } from '@tiptap/react'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { BookOpen, Link as LinkIcon, Plus, X } from 'lucide-react'
import { isSafeUrl } from '../lib/calendar-utils'
import { isSafeNoteLinkTarget } from '../lib/note-link-utils'
import { useOverlayLayer } from '../lib/use-overlay-layer'
import { clampTopBelowObstruction } from '../lib/top-obstruction'
import { Button, IconButton, ToggleButton } from '../components/ui'

function isSafeNoteUrl(value: string): boolean {
  return isSafeUrl(value)
}

export interface MarkdownComposerProps {
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  placeholder: string
  className?: string
  showToolbar?: boolean
  compact?: boolean
  toolbarExtra?: ReactNode
  hideFormattingTools?: boolean
  onRevealTools?: () => void
  animateRevealedTools?: boolean
  highlightRevealedTools?: boolean
}

const MOBILE_TOOLS_REVEAL_CLASSES = 'animate-in fade-in slide-in-from-top-3 zoom-in-95 duration-500 motion-reduce:animate-none'

interface LinkPopoverState {
  from: number
  to: number
  href: string
  error: string
  left: number
  top: number
}

function MarkdownComposer({
  value,
  onChange,
  readOnly = false,
  placeholder,
  className = '',
  showToolbar = true,
  compact = false,
  toolbarExtra,
  hideFormattingTools = false,
  onRevealTools,
  animateRevealedTools = false,
  highlightRevealedTools = false,
}: MarkdownComposerProps) {
  const valueRef = useRef<string>('')
  const isApplyingExternalValueRef = useRef(false)
  const [isGuideOpen, setIsGuideOpen] = useState(false)
  const [linkPopover, setLinkPopover] = useState<LinkPopoverState | null>(null)
  // Portaled to body; resolves above the full editor (focusModal) it usually opens from.
  const { z: linkPopoverZ } = useOverlayLayer('popover', linkPopover !== null)
  const editorSizeClasses = compact
    ? 'min-h-40'
    : 'h-full min-h-40 sm:min-h-52 overflow-y-auto'

  const handleToolbarMouseDownCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (!target.closest('button')) return

    // Keep the editor selection intact so toolbar actions apply at the active cursor.
    event.preventDefault()
  }, [])

  const collapseAllDetails = useCallback((root: ParentNode) => {
    const detailsNodes = root.querySelectorAll<HTMLElement>("[data-type='details']")
    detailsNodes.forEach((detailsNode) => {
      detailsNode.classList.remove('is-open')
      const detailsContent = detailsNode.querySelector<HTMLElement>("[data-type='detailsContent']")
      if (detailsContent) {
        detailsContent.setAttribute('hidden', 'hidden')
      }
    })
  }, [])

  const countTrailingEmptyParagraphs = useCallback((targetEditor: NonNullable<ReturnType<typeof useEditor>>): number => {
    let trailingEmptyParagraphs = 0
    const { doc } = targetEditor.state

    for (let index = doc.childCount - 1; index >= 0; index -= 1) {
      const node = doc.child(index)
      if (node.type.name !== 'paragraph' || node.content.size > 0) {
        break
      }
      trailingEmptyParagraphs += 1
    }

    return trailingEmptyParagraphs
  }, [])

  const withTrailingParagraphSeparators = useCallback((markdown: string, trailingEmptyParagraphs: number): string => {
    if (trailingEmptyParagraphs <= 0) return markdown
    const withoutTrailingNewlines = markdown.replace(/\n+$/g, '')
    return `${withoutTrailingNewlines}${'\n\n'.repeat(trailingEmptyParagraphs)}`
  }, [])

  const syncMarkdownFromEditor = useCallback((targetEditor: NonNullable<ReturnType<typeof useEditor>>) => {
    if (isApplyingExternalValueRef.current) return

    const markdown = withTrailingParagraphSeparators(
      targetEditor.getMarkdown(),
      countTrailingEmptyParagraphs(targetEditor)
    )

    if (markdown !== valueRef.current) {
      valueRef.current = markdown
      onChange(markdown)
    }
  }, [countTrailingEmptyParagraphs, onChange, withTrailingParagraphSeparators])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      (() => {
        const markdownExtension = Markdown as typeof Markdown & {
          configure?: (options: { markedOptions?: { breaks?: boolean } }) => typeof Markdown
        }

        if (typeof markdownExtension.configure === 'function') {
          return markdownExtension.configure({
            markedOptions: {
              breaks: true,
            },
          })
        }

        return Markdown
      })(),
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: {
            class: 'rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground',
          },
        },
        link: {
          autolink: true,
          linkOnPaste: true,
          openOnClick: true,
          HTMLAttributes: {
            class: 'text-primary underline underline-offset-2',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          isAllowedUri: (url) => isSafeNoteLinkTarget(url),
          shouldAutoLink: (url) => isSafeNoteUrl(url),
        },
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === 'detailsSummary') return 'Spoiler title'
          if (node.type.name === 'detailsContent') return 'Hidden content'
          return placeholder
        },
        includeChildren: true,
        showOnlyCurrent: false,
      }),
      Details.configure({
        persist: false,
        renderToggleButton: ({ element, isOpen }) => {
          element.dataset.detailsToggle = 'true'
          element.setAttribute(
            'aria-label',
            isOpen ? 'Collapse details content' : 'Expand details content',
          )
          element.style.position = 'absolute'
          element.style.inset = '0 auto auto 0'
          element.style.width = '100%'
          element.style.height = '2.45rem'
          element.style.opacity = '0'
          element.style.display = 'block'
          element.style.zIndex = '2'
          element.style.cursor = 'pointer'
          element.style.background = 'transparent'
          element.style.border = '0'
          element.style.padding = '0'

          element.onmousedown = (event) => {
            if (typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function') {
              const elements = document.elementsFromPoint(event.clientX, event.clientY)
              const clickedAnchor = elements
                .map((el) => (el instanceof HTMLAnchorElement ? el : el.closest<HTMLAnchorElement>('a[href]')))
                .find((el): el is HTMLAnchorElement => Boolean(el?.href))
              if (clickedAnchor) {
                return
              }
            }
            event.preventDefault()
          }

          element.onclick = (event) => {
            if (typeof document !== 'undefined' && typeof document.elementsFromPoint === 'function') {
              const elements = document.elementsFromPoint(event.clientX, event.clientY)
              const clickedAnchor = elements
                .map((el) => (el instanceof HTMLAnchorElement ? el : el.closest<HTMLAnchorElement>('a[href]')))
                .find((el): el is HTMLAnchorElement => Boolean(el?.href))
              if (clickedAnchor) {
                const href = clickedAnchor.getAttribute('href') || clickedAnchor.href
                if (href && isSafeNoteLinkTarget(href)) {
                  window.open(href, '_blank', 'noopener,noreferrer')
                  return
                }
              }
            }

            window.requestAnimationFrame(() => {
              const currentEditor = editor
              if (!currentEditor) return

              const detailsNode = element.closest<HTMLElement>("[data-type='details']")
              const summaryElement = detailsNode?.querySelector<HTMLElement>('summary')
              if (!summaryElement) return

              const summaryPos = currentEditor.view.posAtDOM(summaryElement, 0) + 1
              currentEditor.chain().focus().setTextSelection(summaryPos).run()
            })
          }
        },
      }),
      DetailsSummary.extend({
        // Prevent default createBlockMarkdownSpec from separating inline children in summary with blank lines (\n\n)
        renderMarkdown(node, h) {
          const renderedContent = h.renderChildren(node.content || [], '')
          return `:::detailsSummary\n${renderedContent}\n:::`
        },
        parseMarkdown(token, h) {
          // Normalize inline tokens in summary to remove unintended hard breaks from multi-line raw markdown
          const rawTokens = (token.tokens || []) as Array<{ type?: string; text?: string; raw?: string }>
          const inlineTokens: typeof rawTokens = []
          for (let i = 0; i < rawTokens.length; i += 1) {
            const current = rawTokens[i]
            if (current.type === 'br') {
              const prev = inlineTokens[inlineTokens.length - 1]
              const next = rawTokens[i + 1]
              const prevEndsWithSpace = prev?.text ? /\s$/.test(prev.text) : false
              const nextStartsWithSpace = next?.text ? /^\s/.test(next.text) : false
              if (!prevEndsWithSpace && !nextStartsWithSpace) {
                inlineTokens.push({ type: 'text', raw: ' ', text: ' ' })
              }
            } else {
              inlineTokens.push(current)
            }
          }
          const nodeContent = h.parseInline(inlineTokens)
          return h.createNode('detailsSummary', token.attributes || {}, nodeContent)
        },
      }),
      DetailsContent,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Extension.create({
        name: 'markdownTypingShortcuts',
        addInputRules() {
          const editor = this.editor
          const orderedListType = editor.schema.nodes.orderedList

          const rules: InputRule[] = []

          if (orderedListType) {
            rules.push(
              wrappingInputRule({
                find: /^1\.$/,
                type: orderedListType,
              })
            )
          }

          rules.push(
            new InputRule({
              find: /^<$/,
              handler: ({ state, range }) => {
                const detailsType = editor.schema.nodes.details
                const summaryType = editor.schema.nodes.detailsSummary
                const contentType = editor.schema.nodes.detailsContent
                const paragraphType = editor.schema.nodes.paragraph
                if (!detailsType || !summaryType || !contentType || !paragraphType) return
                const $from = state.tr.doc.resolve(range.from)
                const parentDepth = $from.depth
                if (parentDepth < 1) return

                const detailsNode = detailsType.create({ open: true }, [
                  summaryType.create(),
                  contentType.create(null, paragraphType.create()),
                ])

                const before = $from.before(parentDepth)
                const after = $from.after(parentDepth)
                state.tr.replaceRangeWith(before, after, detailsNode)

                window.requestAnimationFrame(() => {
                  let summaryCaretPos: number | null = null
                  editor.state.doc.descendants((node, pos) => {
                    if (node.type.name !== 'detailsSummary') return
                    summaryCaretPos = pos + 1
                  })
                  if (summaryCaretPos !== null) {
                    editor.chain().focus().setTextSelection(summaryCaretPos).run()
                  }

                  const detailsNodes = editor.view.dom.querySelectorAll<HTMLElement>("[data-type='details']")
                  const currentDetails = detailsNodes.item(detailsNodes.length - 1)
                  if (!currentDetails) return
                  const content = currentDetails.querySelector<HTMLElement>("[data-type='detailsContent']")
                  if (!content || !content.hasAttribute('hidden')) return
                  const toggleButton = currentDetails.querySelector<HTMLButtonElement>('button')
                  toggleButton?.click()
                })
              },
            })
          )

          return rules
        },
        addKeyboardShortcuts() {
          return {
            '-': () => {
              const { state } = this.editor
              const { empty, $from } = state.selection
              if (!empty || !$from.parent.isTextblock) return false

              const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')
              const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
              const linePrefix = textBefore.split('\n').pop() ?? textBefore
              const lineSuffix = textAfter.split('\n')[0] ?? textAfter

              if (linePrefix.trim().length > 0) return false
              if (lineSuffix.trim().length > 0) return false

              return this.editor.chain().focus().toggleBulletList().run()
            },
            Enter: () => {
              const { state } = this.editor
              const { empty, $from } = state.selection
              if (!empty || !$from.parent.isTextblock) return false

              if (this.editor.isActive('detailsContent')) {
                if ($from.parent.content.size !== 0) return false
                let detailsContentDepth = -1
                for (let depth = $from.depth; depth > 0; depth -= 1) {
                  if ($from.node(depth).type.name === 'detailsContent') {
                    detailsContentDepth = depth
                    break
                  }
                }
                if (detailsContentDepth < 1) return false
                const detailsContentNode = $from.node(detailsContentDepth)
                const indexInContent = $from.index(detailsContentDepth)
                // Only exit when all trailing siblings are also empty (so we don't lose user content).
                for (let i = indexInContent + 1; i < detailsContentNode.childCount; i += 1) {
                  if (detailsContentNode.child(i).content.size > 0) return false
                }
                const detailsDepth = detailsContentDepth - 1
                const paragraphType = state.schema.nodes.paragraph
                if (!paragraphType) return false

                const cursorParaStart = $from.before()
                const detailsContentEnd = $from.end(detailsContentDepth)
                const afterDetailsBefore = $from.after(detailsDepth)
                const isOnlyChild = detailsContentNode.childCount === 1

                let caretPos = 0
                const ok = this.editor.commands.command(({ tr, dispatch }) => {
                  if (!isOnlyChild) {
                    tr.delete(cursorParaStart, detailsContentEnd)
                  }
                  const afterDetails = tr.mapping.map(afterDetailsBefore)
                  tr.insert(afterDetails, paragraphType.create())
                  caretPos = afterDetails + 1
                  if (dispatch) dispatch(tr)
                  return true
                })
                if (!ok) return false
                this.editor.chain().setTextSelection(caretPos).focus().scrollIntoView().run()
                return true
              }

              // Handle bulletList exit on empty list item
              if (this.editor.isActive('bulletList')) {
                const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')
                const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
                const currentLineText = `${textBefore}${textAfter}`.trim()
                if (currentLineText.length > 0) return false

                let listItemDepth = -1
                for (let depth = $from.depth; depth > 0; depth -= 1) {
                  if ($from.node(depth).type.name === 'listItem') {
                    listItemDepth = depth
                    break
                  }
                }

                if (listItemDepth > 0) {
                  const bulletListDepth = listItemDepth - 1
                  const bulletListNode = $from.node(bulletListDepth)
                  const listItemIndex = $from.index(bulletListDepth)
                  const isLastListItem = listItemIndex === bulletListNode.childCount - 1

                  if (isLastListItem) {
                    const listItemStart = $from.before(listItemDepth)
                    const listItemEnd = $from.after(listItemDepth)
                    const afterBulletListBefore = $from.after(bulletListDepth)
                    const paragraphType = state.schema.nodes.paragraph

                    let caretPos = 0
                    const exited = this.editor.commands.command(({ tr, dispatch }) => {
                      tr.delete(listItemStart, listItemEnd)
                      const afterBulletList = tr.mapping.map(afterBulletListBefore)
                      tr.insert(afterBulletList, paragraphType.create())
                      caretPos = afterBulletList + 1
                      if (dispatch) dispatch(tr)
                      return true
                    })

                    if (exited) {
                      this.editor.chain().focus().setTextSelection(caretPos).scrollIntoView().run()
                      return true
                    }
                  }
                }

                const lifted = this.editor.chain().focus().liftListItem('listItem').run()
                if (lifted) return true
                return this.editor.chain().focus().splitListItem('listItem').run()
              }

              // Handle orderedList exit on empty list item
              if (this.editor.isActive('orderedList')) {
                const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')
                const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
                const currentLineText = `${textBefore}${textAfter}`.trim()
                if (currentLineText.length > 0) return false

                let listItemDepth = -1
                for (let depth = $from.depth; depth > 0; depth -= 1) {
                  if ($from.node(depth).type.name === 'listItem') {
                    listItemDepth = depth
                    break
                  }
                }

                if (listItemDepth > 0) {
                  const orderedListDepth = listItemDepth - 1
                  const orderedListNode = $from.node(orderedListDepth)
                  const listItemIndex = $from.index(orderedListDepth)
                  const isLastListItem = listItemIndex === orderedListNode.childCount - 1

                  if (isLastListItem) {
                    const listItemStart = $from.before(listItemDepth)
                    const listItemEnd = $from.after(listItemDepth)
                    const afterOrderedListBefore = $from.after(orderedListDepth)
                    const paragraphType = state.schema.nodes.paragraph

                    let caretPos = 0
                    const exited = this.editor.commands.command(({ tr, dispatch }) => {
                      tr.delete(listItemStart, listItemEnd)
                      const afterOrderedList = tr.mapping.map(afterOrderedListBefore)
                      tr.insert(afterOrderedList, paragraphType.create())
                      caretPos = afterOrderedList + 1
                      if (dispatch) dispatch(tr)
                      return true
                    })

                    if (exited) {
                      this.editor.chain().focus().setTextSelection(caretPos).scrollIntoView().run()
                      return true
                    }
                  }
                }

                const lifted = this.editor.chain().focus().liftListItem('listItem').run()
                if (lifted) return true
                return this.editor.chain().focus().splitListItem('listItem').run()
              }

              if (!this.editor.isActive('taskList')) return false

              const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')
              const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
              const currentLineText = `${textBefore}${textAfter}`.trim()
              if (currentLineText.length > 0) return false

              let taskItemDepth = -1
              for (let depth = $from.depth; depth > 0; depth -= 1) {
                if ($from.node(depth).type.name === 'taskItem') {
                  taskItemDepth = depth
                  break
                }
              }

              if (taskItemDepth > 0) {
                const taskListDepth = taskItemDepth - 1
                const taskListNode = $from.node(taskListDepth)
                const taskItemIndex = $from.index(taskListDepth)
                const isLastTaskItem = taskItemIndex === taskListNode.childCount - 1
                const paragraphType = state.schema.nodes.paragraph

                if (isLastTaskItem && paragraphType) {
                  const taskItemStart = $from.before(taskItemDepth)
                  const taskItemEnd = $from.after(taskItemDepth)
                  const afterTaskListBefore = $from.after(taskListDepth)

                  let caretPos = 0
                  const exited = this.editor.commands.command(({ tr, dispatch }) => {
                    tr.delete(taskItemStart, taskItemEnd)
                    const afterTaskList = tr.mapping.map(afterTaskListBefore)
                    tr.insert(afterTaskList, paragraphType.create())
                    caretPos = afterTaskList + 1
                    if (dispatch) dispatch(tr)
                    return true
                  })

                  if (exited) {
                    this.editor.chain().focus().setTextSelection(caretPos).scrollIntoView().run()
                    return true
                  }
                }
              }

              const lifted = this.editor.chain().focus().liftListItem('taskItem').run()
              if (lifted) return true

              return this.editor.chain().focus().splitListItem('taskItem').run()
            },
            ']': () => {
              const { state } = this.editor
              const { from, empty, $from } = state.selection
              if (!empty || !$from.parent.isTextblock) return false

              const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')

              if (textBefore === '[' && from >= 1) {
                return this.editor.chain().focus().deleteRange({ from: from - 1, to: from }).toggleTaskList().run()
              }

              if (/^\[[xX]$/.test(textBefore) && from >= 2) {
                return this.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: from - 2, to: from })
                  .toggleTaskList()
                  .updateAttributes('taskItem', { checked: true })
                  .run()
              }

              return false
            },
            Space: () => {
              const { state } = this.editor
              const { from, empty, $from } = state.selection
              if (!empty || !$from.parent.isTextblock) return false

              const textBefore = $from.parent.textBetween(0, $from.parentOffset, '', '')
              const textAfter = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, '', '')
              const linePrefix = textBefore.split('\n').pop() ?? textBefore
              const lineSuffix = textAfter.split('\n')[0] ?? textAfter
              const isAtStartToken = lineSuffix.trim().length === 0
              if (!isAtStartToken) return false

              if ((linePrefix === '-' || linePrefix === '- ') && from >= linePrefix.length) {
                return this.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: from - linePrefix.length, to: from })
                  .toggleBulletList()
                  .run()
              }

              if ((linePrefix === '1.' || linePrefix === '1. ') && from >= linePrefix.length) {
                return this.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: from - linePrefix.length, to: from })
                  .toggleOrderedList()
                  .run()
              }

              if ((linePrefix === '[]' || linePrefix === '[] ') && from >= linePrefix.length) {
                return this.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: from - linePrefix.length, to: from })
                  .toggleTaskList()
                  .run()
              }

              if ((/^\[[xX]\]$/.test(linePrefix) || /^\[[xX]\]\s$/.test(linePrefix)) && from >= linePrefix.length) {
                return this.editor
                  .chain()
                  .focus()
                  .deleteRange({ from: from - linePrefix.length, to: from })
                  .toggleTaskList()
                  .updateAttributes('taskItem', { checked: true })
                  .run()
              }

              return false
            },
          }
        },
      }),
    ],
    // Start empty; the effect below loads the value as MARKDOWN via setContent.
    // Passing `content: value` directly here would parse it as HTML and show
    // the markdown source as literal text.
    content: '',
    editable: !readOnly,
    onUpdate: ({ editor: nextEditor }) => {
      // TipTap may normalize markdown when content is loaded from storage.
      // Ignore those unfocused updates so reloads do not rewrite notes.
      if (!nextEditor.isFocused) return

      syncMarkdownFromEditor(nextEditor)
    },
    onTransaction: ({ editor: nextEditor, transaction }) => {
      if (!transaction.docChanged) return

      // Checkbox toggles and similar click-driven changes can update the
      // document while focus is transient. Treat these as user edits so dirty
      // state and auto-save start immediately.
      const hasUiEvent = Boolean(transaction.getMeta('uiEvent'))
      if (!nextEditor.isFocused && !hasUiEvent) return

      syncMarkdownFromEditor(nextEditor)
    },
    editorProps: {
      attributes: {
        class:
          `tiptap markdown-editor w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-5 text-foreground outline-hidden focus:ring-0 ${editorSizeClasses}`,
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor) return

    const frame = window.requestAnimationFrame(() => {
      collapseAllDetails(editor.view.dom)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [editor, collapseAllDetails])

  useEffect(() => {
    if (!editor) return
    if (value === valueRef.current) return

    const nextMarkdown = withTrailingParagraphSeparators(
      editor.getMarkdown(),
      countTrailingEmptyParagraphs(editor)
    )
    if (nextMarkdown === value) {
      valueRef.current = value
      return
    }

    isApplyingExternalValueRef.current = true
    try {
      editor.commands.setContent(value, { contentType: 'markdown' })
    } finally {
      isApplyingExternalValueRef.current = false
    }
    valueRef.current = value
  }, [countTrailingEmptyParagraphs, editor, value, withTrailingParagraphSeparators])

  const focusDetailsSummaryAtOrAfter = useCallback((targetPos: number) => {
    if (!editor) return

    let summaryCaretPos: number | null = null
    editor.state.doc.descendants((node, pos) => {
      if (summaryCaretPos !== null) return false
      if (node.type.name !== 'detailsSummary' || pos < targetPos) return true
      summaryCaretPos = pos + 1 + node.content.size
      return false
    })

    if (summaryCaretPos !== null) {
      editor.chain().focus().setTextSelection(summaryCaretPos).run()
    }
  }, [editor])

  const focusTaskItemAtOrAfter = useCallback((targetPos: number) => {
    if (!editor) return

    let taskItemCaretPos: number | null = null
    editor.state.doc.descendants((node, pos) => {
      if (taskItemCaretPos !== null) return false
      if (node.type.name !== 'taskItem' || pos < targetPos) return true

      const paragraph = node.firstChild
      if (!paragraph) return false

      taskItemCaretPos = pos + 2 + paragraph.content.size
      return false
    })

    if (taskItemCaretPos !== null) {
      editor.chain().focus().setTextSelection(taskItemCaretPos).run()
    }
  }, [editor])

  const setHeading = useCallback((level: 1 | 2 | 3) => {
    editor?.chain().focus().toggleHeading({ level }).run()
  }, [editor])

  const wrapWithDetails = useCallback(() => {
    if (!editor) return
    const { from, to, empty } = editor.state.selection
    const hasSelection = !empty && to > from
    const insertPos = from

    let summaryText = ''
    let contentLines: string[] = []

    if (hasSelection) {
      const selectedText = editor.state.doc.textBetween(from, to, '\n', '\n')
      const lines = selectedText.split(/\r?\n/)
      summaryText = lines[0] ?? ''
      contentLines = lines.slice(1)
    }

    const contentParagraphs = contentLines.length > 0
      ? contentLines.map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }))
      : [{ type: 'paragraph' }]

    editor
      .chain()
      .focus()
      .insertContent({
        type: 'details',
        attrs: {
          open: true,
        },
        content: [
          {
            type: 'detailsSummary',
            ...(summaryText ? { content: [{ type: 'text', text: summaryText }] } : {}),
          },
          {
            type: 'detailsContent',
            content: contentParagraphs,
          },
        ],
      })
      .run()

    focusDetailsSummaryAtOrAfter(insertPos)

    // New collapse blocks should open immediately in the active editor so users can type hidden content.
    window.requestAnimationFrame(() => {
      const detailsNodes = editor.view.dom.querySelectorAll<HTMLElement>("[data-type='details']")
      const currentDetails = detailsNodes.item(detailsNodes.length - 1)
      if (!currentDetails) return

      const content = currentDetails.querySelector<HTMLElement>("[data-type='detailsContent']")
      if (!content || !content.hasAttribute('hidden')) return

      const toggleButton = currentDetails.querySelector<HTMLButtonElement>('button')
      toggleButton?.click()
    })
  }, [editor, focusDetailsSummaryAtOrAfter])

  const toggleTaskList = useCallback(() => {
    if (!editor) return

    if (editor.isActive('taskList')) {
      editor.chain().focus().splitListItem('taskItem').run()
      return
    }

    const insertPos = editor.state.selection.from

    editor.chain().focus().toggleTaskList().run()

    focusTaskItemAtOrAfter(insertPos)
  }, [editor, focusTaskItemAtOrAfter])

  const toggleBulletList = useCallback(() => {
    editor?.chain().focus().toggleBulletList().run()
  }, [editor])

  const toggleOrderedList = useCallback(() => {
    editor?.chain().focus().toggleOrderedList().run()
  }, [editor])

  const toggleBold = useCallback(() => {
    editor?.chain().focus().toggleBold().run()
  }, [editor])

  const toggleItalic = useCallback(() => {
    editor?.chain().focus().toggleItalic().run()
  }, [editor])

  const toggleCode = useCallback(() => {
    editor?.chain().focus().toggleCode().run()
  }, [editor])

  const openLinkPopover = useCallback(() => {
    if (!editor) return

    if (editor.isActive('link')) {
      editor.chain().extendMarkRange('link').run()
    }

    const { from, to } = editor.state.selection
    const selectionCoords = editor.view.coordsAtPos(to)
    const currentHref = editor.isActive('link')
      ? String(editor.getAttributes('link').href || '')
      : ''

    setLinkPopover({
      from,
      to,
      href: currentHref,
      error: '',
      left: Math.min(Math.max(selectionCoords.left, 12), Math.max(12, window.innerWidth - 300)),
      top: clampTopBelowObstruction(Math.min(Math.max(selectionCoords.bottom + 8, 12), Math.max(12, window.innerHeight - 132)), 12),
    })
  }, [editor])

  const applyLink = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editor || !linkPopover) return

    const href = linkPopover.href.trim()
    if (!href) {
      editor
        .chain()
        .focus()
        .setTextSelection({ from: linkPopover.from, to: linkPopover.to })
        .unsetLink()
        .run()
      setLinkPopover(null)
      return
    }

    if (!isSafeNoteLinkTarget(href)) {
      setLinkPopover((current) => current ? {
        ...current,
        error: 'Enter a full http(s) URL or a route beginning with /.',
      } : null)
      return
    }

    const { from, to } = linkPopover
    const hasSelection = to > from
    const isSingleCharacterSelection = to - from === 1

    editor.commands.command(({ tr, state, dispatch }) => {
      const linkMark = state.schema.marks.link
      if (!linkMark) return false

      const before = state.doc.textBetween(Math.max(0, from - 1), from, '', '')
      const after = state.doc.textBetween(to, Math.min(state.doc.content.size, to + 1), '', '')
      const needsSpaceBefore = !/\s$/.test(before)
      const needsSpaceAfter = !/^\s/.test(after)

      if (!hasSelection) {
        const prefix = needsSpaceBefore ? ' ' : ''
        const suffix = needsSpaceAfter ? ' ' : ''
        tr.insertText(`${prefix}${href}${suffix}`, from)
        tr.addMark(from + prefix.length, from + prefix.length + href.length, linkMark.create({ href }))
      } else {
        let linkFrom = from
        let linkTo = to

        if (isSingleCharacterSelection && needsSpaceAfter) {
          tr.insertText(' ', to)
        }
        if (isSingleCharacterSelection && needsSpaceBefore) {
          tr.insertText(' ', from)
          linkFrom += 1
          linkTo += 1
        }

        tr.addMark(linkFrom, linkTo, linkMark.create({ href }))
      }

      tr.setMeta('uiEvent', 'link')
      if (dispatch) dispatch(tr)
      return true
    })

    editor.commands.focus()
    setLinkPopover(null)
  }, [editor, linkPopover])

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      {showToolbar && !readOnly && (
        <div className="mb-2 space-y-2 text-[11px]" onMouseDownCapture={handleToolbarMouseDownCapture}>
          <div className="flex flex-wrap items-center gap-1.5">
            <ToggleButton
              size="compact"
              pressed={isGuideOpen}
              onPressedChange={() => setIsGuideOpen((prev) => !prev)}
              icon={<BookOpen className="h-3.5 w-3.5" />}
              title={isGuideOpen ? 'Hide formatting guide' : 'Show formatting guide'}
            >
              Guiding
            </ToggleButton>

            {hideFormattingTools && onRevealTools && (
              <Button
                emphasis="outline"
                size="compact"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={onRevealTools}
              >
                Reveal more tools
              </Button>
            )}

            {!hideFormattingTools && (
              <div className={animateRevealedTools ? `inline-flex flex-wrap items-center gap-1.5 ${MOBILE_TOOLS_REVEAL_CLASSES} ${highlightRevealedTools ? 'tools-reveal-highlight' : ''}` : 'contents'}>
                <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
                  <Button emphasis="outline" size="compact" onClick={toggleBold} className="font-semibold">B</Button>
                  <Button emphasis="outline" size="compact" onClick={toggleItalic} className="italic">I</Button>
                  <Button emphasis="outline" size="compact" onClick={() => setHeading(1)} className="font-semibold">H1</Button>
                  <Button emphasis="outline" size="compact" onClick={() => setHeading(2)} className="font-semibold">H2</Button>
                  <Button emphasis="outline" size="compact" onClick={() => setHeading(3)} className="font-semibold">H3</Button>
                </div>

                <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
                  <Button emphasis="outline" size="compact" onClick={toggleBulletList}>List</Button>
                  <Button emphasis="outline" size="compact" onClick={toggleOrderedList}>1.</Button>
                  <Button emphasis="outline" size="compact" onClick={toggleTaskList}>Checkbox</Button>
                </div>

                <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
                  <Button emphasis="outline" size="compact" onClick={wrapWithDetails}>Collapse</Button>
                  <Button emphasis="outline" size="compact" onClick={toggleCode} className="font-mono">Code</Button>
                  <Button
                    emphasis="outline"
                    size="compact"
                    icon={<LinkIcon className="h-3.5 w-3.5" />}
                    onClick={openLinkPopover}
                    title="Add, edit, or remove a link"
                  >
                    Link
                  </Button>
                </div>
                {toolbarExtra}
              </div>
            )}

          </div>

          {isGuideOpen && (
            <div className="rounded-md border border-info-muted bg-info-subtle p-2 text-xs text-info">
              <div className="grid gap-2 md:grid-cols-3">
                <div className="rounded-md border border-info-muted bg-background/70 p-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Text styles</p>
                  <p className="text-[11px] leading-5 text-foreground">Highlight words and add heading levels.</p>
                  <pre className="mt-1 overflow-x-auto rounded border border-border bg-muted/40 p-1.5 text-[11px] leading-4 text-foreground"><code>{`# Weekly priorities\n## Meetings\n### Follow ups\n**Owner:** Alex\n*Optional note*`}</code></pre>
                </div>

                <div className="rounded-md border border-info-muted bg-background/70 p-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lists and checkboxes</p>
                  <p className="text-[11px] leading-5 text-foreground">Create bullets, ordered steps, and quick task markers.</p>
                  <pre className="mt-1 overflow-x-auto rounded border border-border bg-muted/40 p-1.5 text-[11px] leading-4 text-foreground"><code>{`- Draft agenda\n- Share pre-read\n1. Confirm attendees\n2. Book room\n[] Send reminder\n[x] Attach notes`}</code></pre>
                </div>

                <div className="rounded-md border border-info-muted bg-background/70 p-2">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Collapse and code</p>
                  <p className="text-[11px] leading-5 text-foreground">Press <code className="rounded bg-muted/60 px-1">&lt;</code> on an empty line to start a collapse block, then type the summary. Wrap commands in backticks.</p>
                  <pre className="mt-1 overflow-x-auto rounded border border-border bg-muted/40 p-1.5 text-[11px] leading-4 text-foreground"><code>{`<details>\n<summary>Release notes</summary>\nHotfix window: 18:00\n</details>\n\n\`pnpm test:web\``}</code></pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={compact ? '' : 'flex min-h-0 flex-1 flex-col'}>
        <EditorContent editor={editor} className={compact ? '' : 'flex min-h-0 flex-1 flex-col'} />
      </div>

      {linkPopover && createPortal(
        <form
          onSubmit={applyLink}
          className="fixed w-72 rounded-md border border-border bg-background p-2 shadow-xl"
          style={{ left: linkPopover.left, top: linkPopover.top, zIndex: linkPopoverZ }}
          aria-label="Link URL"
        >
          <div className="flex items-center gap-1.5">
            <LinkIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              inputMode="url"
              value={linkPopover.href}
              onChange={(event) => setLinkPopover((current) => current ? {
                ...current,
                href: event.target.value,
                error: '',
              } : null)}
              placeholder="https://example.com or /route"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-hidden focus:ring-2 focus:ring-ring"
              aria-label="URL"
            />
            <Button type="submit" intent="primary" size="compact">
              Apply
            </Button>
            <IconButton
              label="Close link editor"
              icon={<X />}
              onClick={() => setLinkPopover(null)}
              title="Close"
            />
          </div>
          {linkPopover.error && <p className="mt-1.5 text-xs text-destructive">{linkPopover.error}</p>}
        </form>,
        document.body
      )}
    </div>
  )
}

export { MarkdownComposer }
