import { ReactNode } from 'react'
import { Info, AlertTriangle, Lightbulb, AlertCircle } from 'lucide-react'

type Variant = 'info' | 'warning' | 'tip' | 'danger'

const icons: Record<Variant, ReactNode> = {
  info: <Info className="w-5 h-5 text-blue-400 shrink-0" />,
  warning: <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />,
  tip: <Lightbulb className="w-5 h-5 text-emerald-400 shrink-0" />,
  danger: <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />,
}

const labels: Record<Variant, string> = {
  info: 'Info',
  warning: 'Warning',
  tip: 'Tip',
  danger: 'Important',
}

interface CalloutProps {
  variant?: Variant
  title?: string
  children: ReactNode
}

export function Callout({ variant = 'info', title, children }: CalloutProps) {
  return (
    <div className={`callout callout-${variant} flex gap-3`}>
      <div className="mt-0.5">{icons[variant]}</div>
      <div>
        <p className="font-semibold text-sm mb-1">{title || labels[variant]}</p>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  )
}
