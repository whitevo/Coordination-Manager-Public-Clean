import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { SHELL_LAYER_CLASS } from '../lib/overlay-layers'
import { Button } from './ui'

interface DeferredSidePanelProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
}

export function DeferredSidePanel({ isOpen, onClose, children }: DeferredSidePanelProps) {
  const [visited, setVisited] = useState(isOpen)
  useEffect(() => {
    if (isOpen) setVisited(true)
  }, [isOpen])
  if (!isOpen && !visited) return null

  return (
    <Suspense fallback={isOpen ? (
      <aside className={`fixed inset-y-0 right-0 ${SHELL_LAYER_CLASS.sidePanel} w-screen bg-card p-4 sm:sticky sm:top-0 sm:h-screen sm:w-88 sm:shrink-0 md:w-96`}>
        <Button emphasis="outline" onClick={onClose} className="mb-4">Close panel</Button>
        <p role="status">Loading panel...</p>
      </aside>
    ) : null}>
      {children}
    </Suspense>
  )
}
