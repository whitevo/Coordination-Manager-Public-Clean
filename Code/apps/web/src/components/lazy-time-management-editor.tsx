import { lazy, Suspense } from 'react'
import type { MarkdownComposerProps } from '@/pages/time-management-markdown-composer'

const Editor = lazy(async () => {
  const module = await import('@/pages/time-management-markdown-composer')
  return { default: module.MarkdownComposer }
})

export function MarkdownComposer(props: MarkdownComposerProps) {
  return (
    <Suspense fallback={
      <div className={`min-h-40 rounded-md border border-border bg-background p-2.5 ${props.className ?? ''}`}>
        <div role="status" className="text-xs text-muted-foreground">Loading note editor...</div>
        <p className="whitespace-pre-wrap text-xs">{props.value}</p>
      </div>
    }>
      <Editor {...props} />
    </Suspense>
  )
}
