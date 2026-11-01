import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Check, X, AlertTriangle, Info } from 'lucide-react'
import { STATUS_TONE_SOLID_CLASS, type StatusTone } from '../lib/design-tokens'
import { OVERLAY_LAYER_CLASS } from '../lib/overlay-layers'

type ToastType = 'success' | 'error' | 'info'
type ToastAppearance = 'solid' | 'neutral'

const TOAST_TONE: Record<ToastType, StatusTone> = {
  success: 'success',
  error: 'error',
  info: 'info',
}

/** Simple acknowledgements self-dismiss; errors stay until dismissed. */
const TOAST_DURATION_MS: Record<ToastType, number | null> = {
  success: 4000,
  info: 4000,
  error: null,
}

interface ToastItem {
  id: number
  message: string
  type: ToastType
  appearance: ToastAppearance
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, appearance?: ToastAppearance) => void
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} })

// eslint-disable-next-line react-refresh/only-export-components -- hook intentionally co-located with its provider
export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const showToast = useCallback((message: string, type: ToastType = 'success', appearance: ToastAppearance = 'solid') => {
    const id = nextId.current++
    setToasts(prev => [...prev, { id, message, type, appearance }])
  }, [])

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Portaled outside the app root: an open Dialog makes #root inert and
          aria-hidden, and toasts must stay announced and dismissible then. */}
      {createPortal(
        <div
          data-testid="toast-region"
          className={`fixed bottom-4 right-4 ${OVERLAY_LAYER_CLASS.toast} flex flex-col gap-2 pointer-events-none`}
        >
          {toasts.map(toast => (
            <ToastNotification key={toast.id} toast={toast} onRemove={removeToast} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

function ToastNotification({ toast, onRemove }: { toast: ToastItem; onRemove: (id: number) => void }) {
  useEffect(() => {
    const duration = TOAST_DURATION_MS[toast.type]
    if (duration === null) return
    const timer = setTimeout(() => onRemove(toast.id), duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.type, onRemove])

  const icon = toast.type === 'success' ? <Check className="w-4 h-4" /> :
    toast.type === 'error' ? <AlertTriangle className="w-4 h-4" /> :
    <Info className="w-4 h-4" />

  const colors = toast.appearance === 'neutral'
    ? 'bg-card text-card-foreground border border-border'
    : STATUS_TONE_SOLID_CLASS[TOAST_TONE[toast.type]]
  const iconColor = toast.type === 'success' ? 'text-success' : toast.type === 'error' ? 'text-danger' : 'text-info'

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg ${colors} animate-slide-in-right min-w-[250px] max-w-[400px]`}
    >
      <span className={toast.appearance === 'neutral' ? iconColor : undefined}>{icon}</span>
      <span className="text-sm font-medium flex-1">{toast.message}</span>
      <button onClick={() => onRemove(toast.id)} aria-label="Dismiss notification" className="p-0.5 rounded hover:bg-foreground/10 transition-colors shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
