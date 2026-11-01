import { useRef, useState } from 'react'
import { Check, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react'
import { IconButton } from '../../../web/src/components/ui'
import { useListPresence } from '../../../web/src/hooks/use-list-presence'
import { ResourceReconciliationGuard, type ResourceMutation } from '../../../web/src/lib/resource-reconciliation'

const FIXTURE = [
  { id: 'planning', label: 'Planning notes' },
  { id: 'invoice', label: 'Project invoice' },
  { id: 'newsletter', label: 'Newsletter' },
  { id: 'reminder', label: 'Team reminder' },
]

export function ReconciliationDemo() {
  const [items, setItems] = useState(FIXTURE)
  const [status, setStatus] = useState('Ready')
  const guard = useRef(new ResourceReconciliationGuard('catalog:synthetic:v1'))
  const read = useRef(guard.current.beginObservation('messages'))
  const operations = useRef<ResourceMutation[]>([])
  const presence = useListPresence(items)

  const complete = () => {
    for (const operation of operations.current) guard.current.endMutation(operation)
    operations.current = []
    setStatus('Saved')
  }

  return <div className="w-full max-w-sm space-y-2" data-testid="resource-contract-demo" data-scenario-version="1">
    <div className="flex items-center gap-1">
      <IconButton label="Trash selected emails" icon={<Trash2 className="h-4 w-4" />} intent="danger"
        disabled={operations.current.length > 0 || items.length !== FIXTURE.length}
        onClick={() => {
          operations.current = ['invoice', 'newsletter'].map(id => guard.current.beginMutation(id))
          setItems(current => current.filter(item => item.id !== 'invoice' && item.id !== 'newsletter'))
          setStatus('Saving')
        }} />
      <IconButton label="Replay stale refresh" icon={<RefreshCw className="h-4 w-4" />}
        onClick={() => setItems(current => guard.current.reconcile(current, FIXTURE, read.current, 'partial'))} />
      <IconButton label="Complete pending save" icon={<Check className="h-4 w-4" />}
        disabled={operations.current.length === 0} onClick={complete} />
      <IconButton label="Reject newsletter action" icon={<X className="h-4 w-4" />}
        disabled={operations.current.length === 0} onClick={() => {
          complete()
          setItems(current => [...current, FIXTURE[2]])
          setStatus('Newsletter could not be trashed')
        }} />
      <IconButton label="Reset fixture" icon={<RotateCcw className="h-4 w-4" />} onClick={() => {
        guard.current.reset()
        operations.current = []
        read.current = guard.current.beginObservation('messages')
        setItems(FIXTURE)
        setStatus('Ready')
      }} />
      <output className="ml-auto text-xs text-muted-foreground" data-testid="resource-contract-count">{items.length}</output>
    </div>
    <p role="status" className="text-xs text-muted-foreground">{status}</p>
    <div ref={presence.containerRef} tabIndex={-1} className="min-h-40 space-y-1">
      {presence.items.map(item => <div key={item.id} data-presence-key={item.id}
        data-testid={`resource-contract-${item.id}`} tabIndex={presence.exitingIds.has(item.id) ? -1 : 0}
        aria-hidden={presence.exitingIds.has(item.id) || undefined}
        className={`rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-[opacity,transform] duration-150 motion-reduce:transition-none ${presence.exitingIds.has(item.id) ? 'pointer-events-none -translate-x-4 opacity-0' : ''}`}>
        {item.label}
      </div>)}
    </div>
  </div>
}