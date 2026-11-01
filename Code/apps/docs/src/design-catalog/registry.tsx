import { useEffect, useRef, useState } from 'react'
import {
  Check,
  X,
  Trash2,
  Pencil,
  CheckCircle2,
  Clock,
  XCircle,
  Eye,
  Sparkles,
  MessageCircle,
  LifeBuoy,
  MessageSquare,
  RefreshCw,
  GripVertical,
  Zap,
  Save,
  ArrowUp,
  ArrowDown,
  Tag,
  Archive,
  BookOpen,
  Repeat2,
  AlertTriangle,
  Users,
} from 'lucide-react'
import type { CatalogEntry, CatalogCategory } from './types'
import { ReconciliationDemo } from './ReconciliationDemo'
import { Dialog } from '../../../web/src/components/ui/Dialog'
import { CalendarQuickToolButton } from '../../../web/src/components/calendar-quick-tool-button'
import {
  Button,
  CategoryTag,
  CountBadge,
  Disclosure,
  IconButton,
  Lightbox,
  ScoreDisplay,
  SegmentedControl,
  StatusBadge,
  Switch,
  ToggleButton,
} from '../../../web/src/components/ui'

/* ─── Interactive demo helpers ──────────────────────────────────────────── */

function ToggleDemo() {
  const [on, setOn] = useState(true)
  return <Switch checked={on} onCheckedChange={setOn} label="Toggle demo" />
}

function CalendarQuickToolDemo() {
  const [active, setActive] = useState(false)
  return (
    <CalendarQuickToolButton
      active={active}
      onClick={() => setActive(value => !value)}
      icon={<Sparkles className="h-4 w-4" />}
    >
      Tools
    </CalendarQuickToolButton>
  )
}

function PillGroupDemo() {
  const [value, setValue] = useState('day')
  return (
    <SegmentedControl
      label="Calendar view"
      value={value}
      onChange={setValue}
      options={[
        { value: 'day', label: 'Day' },
        { value: 'week', label: 'Week' },
        { value: 'month', label: 'Month' },
      ]}
      showSelectedMarker
      size="compact"
    />
  )
}

function SegmentedDisabledDemo() {
  const [value, setValue] = useState('off')
  return (
    <SegmentedControl
      label="Captcha mode"
      value={value}
      onChange={setValue}
      options={[
        { value: 'on', label: 'Force ON', disabled: true, title: 'Captcha is unavailable' },
        { value: 'off', label: 'Force OFF' },
        { value: 'auto', label: 'Auto' },
      ]}
      size="compact"
    />
  )
}

function ToggleIntentDemo() {
  const [active, setActive] = useState(true)
  const [selecting, setSelecting] = useState(true)
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <ToggleButton size="micro" intent="success" pressed={active} onPressedChange={setActive}>
        {active ? 'Active' : 'Inactive'}
      </ToggleButton>
      <ToggleButton size="compact" intent="warning" pressed={selecting} onPressedChange={setSelecting}>
        Select template
      </ToggleButton>
    </div>
  )
}

const LIGHTBOX_SAMPLE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='320' height='200' fill='%2394a3b8'/><circle cx='90' cy='70' r='28' fill='%23f8fafc'/><path d='M0 200 L120 100 L200 170 L250 130 L320 200 Z' fill='%23475569'/></svg>"

function LightboxDemo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="overflow-hidden rounded-md border border-border">
        <img src={LIGHTBOX_SAMPLE} alt="Sample screenshot" className="h-16 w-24 object-cover" />
      </button>
      <Lightbox open={open} onClose={() => setOpen(false)} src={LIGHTBOX_SAMPLE} alt="Sample screenshot" />
    </>
  )
}

function ModalDemo() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative flex h-[132px] w-full items-center justify-center overflow-hidden rounded">
      <Button intent="primary" onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Are you sure?"
        description="This action cannot be undone." actions={<>
              <Button size="compact" emphasis="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="compact" intent="danger" onClick={() => setOpen(false)}>Delete</Button>
        </>} />
    </div>
  )
}

function SpinDemo() {
  const [n, setN] = useState(0)
  return (
    <button
      onClick={() => setN(v => v + 1)}
      className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground hover:bg-muted"
    >
      <RefreshCw key={n} className="h-4 w-4 animate-spin-once" />
      Refresh
    </button>
  )
}

function ReplayDemo({ animation, label }: { animation: string; label: string }) {
  const [n, setN] = useState(0)
  return (
    <div className="flex flex-col items-center gap-2">
      <div key={n} className={`rounded-md bg-card px-4 py-2 text-sm text-card-foreground shadow-sm ${animation}`}>
        {label}
      </div>
      <button
        onClick={() => setN(v => v + 1)}
        className="text-[11px] text-muted-foreground underline hover:text-foreground"
      >
        Replay
      </button>
    </div>
  )
}

function DragReorderDemo() {
  const [items, setItems] = useState(['Alpha', 'Beta', 'Gamma'])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div
          key={item}
          draggable
          onDragStart={() => setDragIndex(i)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => {
            if (dragIndex === null || dragIndex === i) return
            setItems(prev => {
              const next = [...prev]
              const [moved] = next.splice(dragIndex, 1)
              next.splice(i, 0, moved)
              return next
            })
            setDragIndex(null)
          }}
          className="flex w-40 cursor-grab items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-card-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          {item}
        </div>
      ))}
    </div>
  )
}

function SoftBadge({ tone, icon: Icon, label }: { tone: 'success' | 'pending' | 'error' | 'info' | 'neutral'; icon: typeof Check; label: string }) {
  return <StatusBadge tone={tone} icon={<Icon className="h-3 w-3" />}>{label}</StatusBadge>
}

function SidePanelSwatch({ accent, icon: Icon, label }: { accent: string; icon: typeof Sparkles; label: string }) {
  return (
    <div className={`flex h-24 w-28 flex-col rounded-md border border-border bg-card ${accent} border-l-2`}>
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold text-card-foreground">{label}</span>
        <X className="ml-auto h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1 p-2">
        <div className="mb-1 h-1.5 w-full rounded bg-muted" />
        <div className="h-1.5 w-2/3 rounded bg-muted" />
      </div>
    </div>
  )
}

/* ─── Mailbox interactive demos ─────────────────────────────────────────── */

function DisclosureDemo({ size, title }: { size: 'compact' | 'standard' | 'section'; title: string }) {
  return (
    <div className="w-full max-w-64">
      <Disclosure
        size={size}
        title={title}
        icon={size === 'compact' ? <Zap /> : undefined}
        trailing={<CountBadge count={2} className="mr-1" />}
        defaultExpanded
        panelClassName="px-3 py-2 text-[11px] text-muted-foreground"
      >
        Panel content
      </Disclosure>
    </div>
  )
}

function HoverHintDemo() {
  const [show, setShow] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return (
    <div className="relative">
      <span
        onMouseEnter={() => {
          timer.current = setTimeout(() => setShow(true), 1200)
        }}
        onMouseLeave={() => {
          if (timer.current) clearTimeout(timer.current)
          setShow(false)
        }}
        className="cursor-help text-sm text-muted-foreground underline decoration-dotted underline-offset-2"
      >
        Assessment
      </span>
      {show && (
        <span className="absolute left-1/2 top-full z-10 mt-1.5 w-56 -translate-x-1/2 rounded-md border border-border bg-popover px-2 py-1.5 text-[11px] text-popover-foreground shadow-lg">
          AI scores the email against your context and intent, then compares it to your confidence threshold.
        </span>
      )}
    </div>
  )
}

function MessageRowHoverDemo() {
  return (
    <div className="group flex w-72 items-start gap-2 rounded-lg border border-border bg-background px-2 py-1.5 transition-colors hover:border-primary/40 hover:bg-accent/40">
      <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold text-foreground">Weekly sync notes</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">2h</span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">Here are the action items from our...</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Archive">
          <Archive className="h-3.5 w-3.5" />
        </button>
        <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Tag">
          <Tag className="h-3.5 w-3.5" />
        </button>
        <button className="rounded p-1 text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-950/40" aria-label="Delete">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function SyncProgressDemo() {
  return (
    <div className="w-72 rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="relative h-5 w-5 shrink-0">
          <div className="absolute inset-0 rounded-full border-2 border-border" />
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Importing email history... 62%</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Fetching messages from Gmail</p>
        </div>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">18s</span>
      </div>
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: '62%' }} />
      </div>
    </div>
  )
}

function SkeletonDemo() {
  return (
    <div className="w-64 space-y-1" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-background px-2 py-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-2.5 w-2/5 rounded bg-muted animate-pulse motion-reduce:animate-none" />
              <div className="h-2 w-4/5 rounded bg-muted/70 animate-pulse motion-reduce:animate-none" />
            </div>
            <div className="h-2 w-10 shrink-0 rounded bg-muted/60 animate-pulse motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ConfirmRunDemo() {
  const [confirming, setConfirming] = useState(false)
  return (
    <Button
      intent={confirming ? 'danger' : 'primary'}
      size="compact"
      onClick={() => setConfirming(v => !v)}
      icon={<Zap className="h-3 w-3" />}
    >
      {confirming ? 'Confirm on 128 emails' : 'Apply to 128 showing'}
    </Button>
  )
}

function CaseToggleDemo() {
  const [on, setOn] = useState(false)
  return (
    <ToggleButton size="compact" pressed={on} onPressedChange={setOn} title={on ? 'Case sensitive' : 'Case insensitive'}>
      Aa
    </ToggleButton>
  )
}

function DirtySaveDemo() {
  const [dirty, setDirty] = useState(true)
  return (
    <Button
      emphasis={dirty ? 'solid' : 'outline'}
      intent={dirty ? 'primary' : 'neutral'}
      size="compact"
      onClick={() => setDirty(v => !v)}
      icon={<Save className="h-3 w-3" />}
    >
      {dirty ? 'Save rule *' : 'Saved'}
    </Button>
  )
}

function PriorityStepperDemo() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col">
        <IconButton size="micro" label="Raise priority" icon={<ArrowUp />} disabled />
        <IconButton size="micro" label="Lower priority" icon={<ArrowDown />} />
      </div>
      <span className="w-4 text-center text-[10px] font-semibold text-muted-foreground">1</span>
      <span className="text-xs text-foreground">Newest first</span>
    </div>
  )
}

function ContentDrawerSwatch() {
  return (
    <div className="flex items-end gap-4">
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-24 w-32 overflow-hidden rounded-md border border-border bg-background">
          <div className="flex-1 p-1.5">
            <div className="h-1.5 w-3/4 rounded bg-muted" />
          </div>
          <div className="w-14 border-l border-border bg-card p-1.5">
            <div className="mb-1 h-1.5 w-full rounded bg-muted" />
            <div className="h-1.5 w-2/3 rounded bg-muted" />
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground">Desktop: sticky border-l</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="relative h-24 w-20 overflow-hidden rounded-md border border-border bg-background">
          <div className="absolute inset-0 z-10 bg-card p-1.5 shadow-2xl">
            <div className="mb-1 h-1.5 w-full rounded bg-muted" />
            <div className="h-1.5 w-2/3 rounded bg-muted" />
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground">Mobile: fixed inset-0 z-95</span>
      </div>
    </div>
  )
}

/* ─── Time Manager interactive demos ────────────────────────────────────── */

function TimeboxResizeDemo() {
  return (
    <div className="group relative flex h-24 w-40 flex-col justify-center rounded-md border-2 border-blue-500 bg-blue-500/80 px-2 text-white shadow-sm">
      <span
        className="absolute left-[8%] right-[8%] top-[-3px] h-[3px] rounded-full bg-white/40 opacity-0 transition-opacity group-hover:bg-white/70 group-hover:opacity-100"
        style={{ cursor: 'ns-resize' }}
      />
      <div className="text-xs font-semibold leading-tight">Deep work</div>
      <div className="text-[10px] opacity-90">09:00 - 11:00</div>
      <span
        className="absolute bottom-[-3px] left-[8%] right-[8%] h-[3px] rounded-full bg-white/40 opacity-0 transition-opacity group-hover:bg-white/70 group-hover:opacity-100"
        style={{ cursor: 'ns-resize' }}
      />
      <GripVertical className="absolute bottom-0.5 right-0.5 h-3 w-3 opacity-80" />
    </div>
  )
}

function UnsavedPopinDemo() {
  const [n, setN] = useState(0)
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        key={n}
        className="w-56 rounded-lg border border-warning-muted bg-warning-subtle p-3 text-xs text-warning shadow-xl animate-[unsaved-pop-in_180ms_ease-out]"
      >
        You have unsaved changes to this item.
      </div>
      <button onClick={() => setN(v => v + 1)} className="text-[11px] text-muted-foreground underline hover:text-foreground">
        Replay
      </button>
    </div>
  )
}

function SelectionPulseDemo() {
  const [n, setN] = useState(0)
  return (
    <div className="flex flex-col items-center gap-2">
      <span
        key={n}
        className="inline-block rounded bg-muted px-2 py-1 font-mono text-sm text-foreground animate-[selection-time-pulse_0.75s_ease-out]"
      >
        09:30
      </span>
      <button onClick={() => setN(v => v + 1)} className="text-[11px] text-muted-foreground underline hover:text-foreground">
        Replay
      </button>
    </div>
  )
}

function TimeItemSelectionFeedbackDemo() {
  const [feedbackSequence, setFeedbackSequence] = useState(0)
  const [isSelected, setIsSelected] = useState(false)
  const [isFeedbackVisible, setIsFeedbackVisible] = useState(false)
  const [isFullViewOpen, setIsFullViewOpen] = useState(false)
  useEffect(() => {
    if (!isFeedbackVisible) return
    const timeoutId = window.setTimeout(() => setIsFeedbackVisible(false), 1600)
    return () => window.clearTimeout(timeoutId)
  }, [feedbackSequence, isFeedbackVisible])

  return (
    <div className="relative flex h-40 w-full items-center justify-center">
      <button
        type="button"
        onClick={() => {
          setIsSelected(true)
          setIsFeedbackVisible(true)
          setFeedbackSequence((previous) => previous + 1)
        }}
        onDoubleClick={() => setIsFullViewOpen(true)}
        className={`relative h-20 w-56 max-w-full rounded-md border-2 border-primary bg-primary-subtle px-3 text-left text-foreground ${isSelected ? 'ring-2 ring-primary' : ''}`}
      >
        <span className="block text-xs font-semibold">Planning session</span>
        <span className="block text-[11px]">09:00-10:00</span>
        {isFeedbackVisible && !isFullViewOpen && (
          <>
            <span key={feedbackSequence} aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] border-2 border-primary bg-primary/10 motion-safe:animate-[time-item-selection-pulse_650ms_ease-out]" />
            <span className="pointer-events-none absolute -top-1 left-0 -translate-y-full rounded border border-border bg-popover px-1.5 py-1 text-[10px] font-semibold text-popover-foreground shadow-xs">09:00-10:00 / 60 min total</span>
          </>
        )}
      </button>
      <Dialog open={isFullViewOpen} onClose={() => setIsFullViewOpen(false)} title="Planning session" description="09:00-10:00 / 60 min total" />
    </div>
  )
}

function CategoryBlocks() {
  const blocks = [
    { color: '#2563eb', text: '#ffffff', title: 'Deep work', time: '09:00 - 11:00' },
    { color: '#f59e0b', text: '#1f2937', title: 'Admin', time: '11:00 - 12:00' },
    { color: '#16a34a', text: '#ffffff', title: 'Break', time: '12:00 - 12:30' },
  ]
  return (
    <div className="flex items-stretch gap-2">
      {blocks.map(b => (
        <div
          key={b.title}
          className="flex h-24 w-24 flex-col justify-center rounded-md border-2 px-2 shadow-sm"
          style={{ backgroundColor: b.color, borderColor: b.color, color: b.text }}
        >
          <div className="text-xs font-semibold leading-tight">{b.title}</div>
          <div className="text-[10px] opacity-90">{b.time}</div>
        </div>
      ))}
    </div>
  )
}

function BlockHoverTooltipDemo() {
  return (
    <div className="group relative flex h-20 w-40 flex-col justify-center rounded-md border-2 border-indigo-500 bg-indigo-500/80 px-2 text-white shadow-sm">
      <div className="pointer-events-none absolute -top-1 left-0 z-30 -translate-y-full opacity-0 transition-opacity duration-100 group-hover:opacity-100">
        <div className="rounded border border-border bg-popover px-1.5 py-1 text-[10px] font-semibold leading-tight text-popover-foreground shadow-xs">
          <div>09:00 - 10:30</div>
          <div>starts in 2h</div>
        </div>
      </div>
      <div className="flex items-center gap-1 text-xs font-semibold">
        <Repeat2 className="h-3 w-3" />
        Design review
      </div>
      <div className="text-[10px] opacity-90">09:00 - 10:30</div>
    </div>
  )
}

/* ─── Admin / Calendar demos (Guardian, Oversight, Coordination Calendar) ── */

function AvailabilityHeatmap() {
  const heat = (n: number) =>
    n === 0 ? '' : n === 1 ? 'bg-green-200' : n === 2 ? 'bg-green-400' : n === 3 ? 'bg-green-500' : 'bg-green-600'
  const counts = [0, 1, 2, 3, 4, 2, 1, 0, 3, 4, 2, 1]
  return (
    <div className="grid grid-cols-6 gap-1">
      {counts.map((n, i) => (
        <div
          key={i}
          className={`flex h-7 w-9 items-center justify-center rounded-sm border border-border text-[9px] font-semibold ${heat(n)} ${n >= 3 ? 'text-white' : 'text-foreground/70'}`}
        >
          {n || ''}
        </div>
      ))}
    </div>
  )
}

function SavedGradient() {
  const g = (n: number) => (n === 0 ? 'bg-purple-300' : n === 1 ? 'bg-purple-400' : n === 2 ? 'bg-purple-500' : 'bg-purple-600')
  const counts = [0, 1, 2, 3, 1, 2]
  return (
    <div className="flex gap-1">
      {counts.map((n, i) => (
        <div key={i} className={`h-8 w-8 rounded-sm ${g(n)}`} />
      ))}
    </div>
  )
}

function AvailabilitySelectDemo() {
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [painting, setPainting] = useState(false)
  const toggle = (i: number, add: boolean) =>
    setSel(prev => {
      const n = new Set(prev)
      if (add) n.add(i)
      else n.delete(i)
      return n
    })
  return (
    <div className="select-none" onPointerUp={() => setPainting(false)} onPointerLeave={() => setPainting(false)}>
      <div className="grid grid-cols-6 gap-1">
        {Array.from({ length: 24 }).map((_, i) => {
          const on = sel.has(i)
          return (
            <div
              key={i}
              onPointerDown={() => {
                setPainting(true)
                toggle(i, !on)
              }}
              onPointerEnter={() => {
                if (painting) toggle(i, true)
              }}
              className={`h-6 w-8 cursor-pointer rounded-sm border transition-colors ${on ? 'border-green-600 bg-green-500' : 'border-border bg-background hover:bg-muted'}`}
            />
          )
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">Click or drag to paint availability</p>
    </div>
  )
}

function GuardianStatCards() {
  return (
    <div className="flex gap-2">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
        <div className="rounded-lg bg-accent/50 p-2">
          <Eye className="h-5 w-5 text-foreground" />
        </div>
        <div>
          <div className="text-2xl font-bold text-foreground">12,480</div>
          <div className="text-xs text-muted-foreground">Messages Scanned</div>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
        <div className="rounded-lg bg-danger-subtle p-2">
          <AlertTriangle className="h-5 w-5 text-danger" />
        </div>
        <div>
          <div className="text-2xl font-bold text-danger">37</div>
          <div className="text-xs text-muted-foreground">Flagged</div>
        </div>
      </div>
    </div>
  )
}

function OversightStatCard() {
  return (
    <div className="w-56 space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Users className="h-4 w-4" /> Sign-ups
      </div>
      <p className="text-2xl font-bold text-foreground">1,204</p>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>
          24h: <span className="font-medium text-foreground">18</span>
        </span>
        <span>
          7d: <span className="font-medium text-foreground">96</span>
        </span>
        <span>
          30d: <span className="font-medium text-foreground">318</span>
        </span>
      </div>
    </div>
  )
}

function MiniBarChartDemo() {
  const data = [2, 5, 1, 7, 3, 6, 0, 4, 5, 2]
  const max = Math.max(...data, 1)
  return (
    <div className="w-56">
      <div className="flex h-20 items-end gap-[3px]">
        {data.map((c, i) => {
          const isHot = c >= 5
          return (
            <div key={i} className="group relative flex h-full flex-1 flex-col items-center justify-end">
              <div
                className={`min-h-[2px] w-full rounded-t transition-all ${isHot ? 'bg-red-500 dark:bg-red-400' : c > 0 ? 'bg-blue-500 dark:bg-blue-400' : 'bg-muted'}`}
                style={{ height: `${Math.max((c / max) * 100, 3)}%` }}
              />
              <div className="pointer-events-none absolute bottom-full mb-1 hidden whitespace-nowrap rounded border border-border bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground shadow-sm group-hover:block">
                Day {i + 1}: {c}
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">Hover a bar</p>
    </div>
  )
}

function OversightLiveDot() {
  const [required, setRequired] = useState(true)
  return (
    <button onClick={() => setRequired(v => !v)} className="flex items-center gap-2 text-xs text-foreground">
      <span className={`h-3 w-3 rounded-full ${required ? 'bg-danger animate-pulse' : 'bg-success'}`} />
      {required ? 'Captcha required' : 'All clear'}
    </button>
  )
}

/* ─── Registry ──────────────────────────────────────────────────────────── */

type CatalogDefinition = Omit<CatalogEntry, 'namespace' | 'previewSource' | 'migration' | 'category'> & {
  category: CatalogCategory | 'Badges'
}

const catalogDefinitions: CatalogDefinition[] = [
  {
    id: 'motion.resource-reconciliation',
    concept: 'resource-reconciliation',
    conceptLabel: 'Resource Reconciliation',
    category: 'Motion',
    name: 'Concurrent exit and guarded refresh',
    status: 'default',
    color: 'token',
    recipe: 'ResourceReconciliationGuard + useListPresence',
    usedOn: ['MailboxPage', 'TimeManagementPage (data guard only)'],
    tags: ['refresh', 'mutation', 'bulk', 'stale', 'failure', 'reduced-motion'],
    note: 'Synthetic Tier 1 fixture; pending intent survives stale reads, and exits own presentation only.',
    render: () => <ReconciliationDemo />,
  },
  /* ── Buttons ── */
  {
    id: 'button.primary-token',
    concept: 'primary-button',
    conceptLabel: 'Primary Button',
    category: 'Buttons',
    name: 'Token primary',
    status: 'default',
    color: 'token',
    recipe: 'Button intent="primary" emphasis="solid"',
    usedOn: ['CoordinateEventsPage', 'SettingsPage', 'MailboxPage'],
    tags: ['button', 'primary', 'cta', 'token', 'action'],
    note: 'One primary per screen; follows the active theme.',
    render: () => <Button intent="primary">Save changes</Button>,
  },
  {
    id: 'button.primary-outline',
    concept: 'primary-button',
    conceptLabel: 'Primary Button',
    category: 'Buttons',
    name: 'Primary outline',
    status: 'alt',
    color: 'theme primary',
    recipe: 'Button intent="primary" emphasis="outline"',
    usedOn: ['NetworkRelationsPage', 'AnnouncementsPage', 'time-item-recurrence-status'],
    tags: ['button', 'primary', 'outline', 'secondary'],
    render: () => <Button intent="primary" emphasis="outline">Add rule</Button>,
  },
  {
    id: 'button.intent-success',
    concept: 'status-intent',
    conceptLabel: 'Status Intent Button',
    category: 'Buttons',
    name: 'Success intent',
    status: 'alt',
    color: 'success',
    recipe: 'Button | IconButton | ToggleButton intent="success"',
    usedOn: ['SettingsPage (copy wallet address)', 'PlatformOversightPage', 'NetworkRelationsPage'],
    tags: ['button', 'intent', 'success', 'status', 'green'],
    note: 'Status-bearing actions only; Save stays primary.',
    render: () => (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button intent="success" emphasis="outline" icon={<Check className="h-4 w-4" />}>Copied</Button>
        <IconButton intent="success" label="Copy address" icon={<Check />} />
      </div>
    ),
  },
  {
    id: 'button.intent-info',
    concept: 'status-intent',
    conceptLabel: 'Status Intent Button',
    category: 'Buttons',
    name: 'Info intent',
    status: 'alt',
    color: 'info',
    recipe: 'Button intent="info"',
    usedOn: ['MailboxPage (Learner Guide)', 'TimezoneSelector'],
    tags: ['button', 'intent', 'info', 'status', 'blue', 'learner'],
    render: () => (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button intent="info" emphasis="outline" size="compact">Learner Guide</Button>
        <Button intent="info" size="compact">UTC+2</Button>
      </div>
    ),
  },
  {
    id: 'button.intent-warning',
    concept: 'status-intent',
    conceptLabel: 'Status Intent Button',
    category: 'Buttons',
    name: 'Warning intent',
    status: 'alt',
    color: 'warning',
    recipe: 'Button | IconButton intent="warning"',
    usedOn: ['AnnouncementsPage (template overwrite)', 'SettingsPage', 'FeatureDisabledBanner', 'HomePage'],
    tags: ['button', 'intent', 'warning', 'status', 'amber', 'banner'],
    render: () => (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button intent="warning" size="compact">Overwrite</Button>
        <Button intent="warning" emphasis="outline" size="compact">Continue as guest</Button>
      </div>
    ),
  },
  {
    id: 'button.size-micro',
    concept: 'control-size',
    conceptLabel: 'Control Size',
    category: 'Buttons',
    name: 'Micro',
    status: 'alt',
    color: 'token',
    recipe: 'size="micro" (h-6; IconButton h-6 w-6, icon on child svg)',
    usedOn: ['MailboxSortOrderEditor', 'GuardianPage', 'AnnouncementsPage'],
    tags: ['button', 'size', 'micro', 'dense', 'icon'],
    note: 'Dense rows, grid headers and in-input clear buttons only.',
    render: () => (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="micro" emphasis="outline">Edit</Button>
        <IconButton size="micro" label="Remove" icon={<X />} />
        <Button size="compact" emphasis="outline">Compact</Button>
        <Button emphasis="outline">Standard</Button>
      </div>
    ),
  },
  {
    id: 'button.destructive-solid',
    concept: 'destructive-button',
    conceptLabel: 'Destructive Button',
    category: 'Buttons',
    name: 'Destructive solid',
    status: 'default',
    color: 'red',
    recipe: 'Button intent="danger" emphasis="solid"',
    usedOn: ['ConfirmDialog', 'Hard deletes across pages'],
    tags: ['button', 'destructive', 'delete', 'danger', 'red'],
    note: 'Default for confirmed, irreversible deletes.',
    render: () => <Button intent="danger">Delete</Button>,
  },
  {
    id: 'button.destructive-soft',
    concept: 'destructive-button',
    conceptLabel: 'Destructive Button',
    category: 'Buttons',
    name: 'Destructive soft',
    status: 'alt',
    color: 'red',
    recipe: 'Button intent="danger" emphasis="outline"',
    usedOn: ['MailboxAutomationPanel (Run on all visible)', 'TimeManagementPage (delete occurrence)', 'AnnouncementsPage (disconnect Discord)', 'GuardianBanList'],
    tags: ['button', 'destructive', 'delete', 'soft', 'red', 'outline', 'run'],
    note: 'Entry point to a destructive flow; the final confirm stays solid danger.',
    render: () => <Button intent="danger" emphasis="outline" icon={<Trash2 />}>Remove</Button>,
  },
  {
    id: 'button.muted-cancel',
    concept: 'secondary-button',
    conceptLabel: 'Secondary / Cancel Button',
    category: 'Buttons',
    name: 'Muted / cancel',
    status: 'default',
    color: 'token',
    recipe: 'Button intent="neutral" emphasis="ghost"',
    usedOn: ['ConfirmDialog', 'Secondary actions across pages'],
    tags: ['button', 'secondary', 'cancel', 'muted'],
    note: 'Default secondary / cancel action.',
    render: () => <Button emphasis="ghost">Cancel</Button>,
  },
  {
    id: 'button.ghost-icon',
    concept: 'icon-button',
    conceptLabel: 'Icon Button',
    category: 'Buttons',
    name: 'Ghost icon',
    status: 'default',
    color: 'token',
    recipe: 'IconButton label="..." intent="neutral" emphasis="ghost"',
    usedOn: ['MailboxPage', 'SettingsPage', 'TimeManagementPage'],
    tags: ['button', 'icon', 'ghost', 'dismiss', 'edit'],
    note: 'Icon-only affordance for dismiss/edit.',
    render: () => (
      <div className="flex gap-1">
        <IconButton label="Edit" icon={<Pencil />} />
        <IconButton label="Close" icon={<X />} />
      </div>
    ),
  },
  {
    id: 'button.selected-pill',
    concept: 'toggle-pill',
    conceptLabel: 'Selected Pill (toggle set)',
    category: 'Buttons',
    name: 'Selected pill group',
    status: 'default',
    color: 'theme primary',
    recipe: 'SegmentedControl with primary selection marker and non-color state',
    usedOn: ['CalendarPage', 'TimeManagementPage', 'MailboxSortOrderEditor'],
    tags: ['button', 'pill', 'segmented', 'selected', 'toggle', 'interactive'],
    note: 'Single choice; arrow keys move the selection.',
    render: () => <PillGroupDemo />,
  },
  {
    id: 'button.segmented-disabled',
    concept: 'toggle-pill',
    conceptLabel: 'Selected Pill (toggle set)',
    category: 'Buttons',
    name: 'Disabled option',
    status: 'alt',
    color: 'theme primary',
    recipe: 'SegmentedOption { disabled, title, testId }',
    usedOn: ['PlatformOversightPage (captcha mode)', 'CalendarPage (visibility)', 'SetupPage'],
    tags: ['button', 'segmented', 'disabled', 'option', 'keyboard', 'interactive'],
    note: 'Arrow keys skip disabled options; title explains why.',
    render: () => <SegmentedDisabledDemo />,
  },

  /* ── Cards ── */
  {
    id: 'card.default',
    concept: 'card',
    conceptLabel: 'Card',
    category: 'Cards',
    name: 'Card (default)',
    status: 'default',
    color: 'token',
    recipe: 'bg-card text-card-foreground rounded-lg border border-border',
    usedOn: ['SettingsPage', 'Most feature pages'],
    tags: ['card', 'surface', 'container', 'panel'],
    note: 'Default bordered surface. In dark mode card is lighter than background.',
    render: () => (
      <div className="w-56 rounded-lg border border-border bg-card p-4 text-card-foreground">
        <h4 className="mb-1 text-sm font-semibold">Card title</h4>
        <p className="text-xs text-muted-foreground">Supporting description text goes here.</p>
      </div>
    ),
  },
  {
    id: 'card.elevated',
    concept: 'card',
    conceptLabel: 'Card',
    category: 'Cards',
    name: 'Elevated card',
    status: 'alt',
    color: 'token',
    recipe: 'bg-card ... rounded-lg border border-border shadow-xl',
    usedOn: ['ConfirmDialog panel', 'Toast', 'Floating menus'],
    tags: ['card', 'elevated', 'shadow-sm', 'raised', 'floating'],
    note: 'Raised surface for floating/overlay content.',
    render: () => (
      <div className="w-56 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xl">
        <h4 className="mb-1 text-sm font-semibold">Floating card</h4>
        <p className="text-xs text-muted-foreground">Used for popovers and dialogs.</p>
      </div>
    ),
  },
  {
    id: 'card.muted-section',
    concept: 'card',
    conceptLabel: 'Card',
    category: 'Cards',
    name: 'Muted section',
    status: 'alt',
    color: 'token',
    recipe: 'bg-muted/50 rounded-lg p-4',
    usedOn: ['Inset groupings inside pages'],
    tags: ['card', 'muted', 'section', 'inset', 'group'],
    note: 'Low-emphasis grouping inside a page.',
    render: () => (
      <div className="w-56 rounded-lg bg-muted/50 p-4">
        <p className="text-xs text-muted-foreground">A muted inset section groups related fields without a hard border.</p>
      </div>
    ),
  },
  {
    id: 'card.bordered-stat',
    concept: 'card',
    conceptLabel: 'Card',
    category: 'Cards',
    name: 'Bordered stat row',
    status: 'alt',
    color: 'token',
    recipe: 'border border-border rounded-lg + header bg-muted',
    usedOn: ['RoadmapPage (docs)', 'Stat/summary rows'],
    tags: ['card', 'stat', 'header', 'summary'],
    note: 'Header + body split for stat/summary blocks.',
    render: () => (
      <div className="w-56 overflow-hidden rounded-lg border border-border">
        <div className="bg-muted px-3 py-2 text-xs font-semibold text-foreground">This week</div>
        <div className="bg-card px-3 py-2 text-lg font-bold text-card-foreground">128 meetings</div>
      </div>
    ),
  },

  /* ── Badges ── */
  {
    id: 'badge.soft-success',
    concept: 'status-badge',
    conceptLabel: 'Status Badge',
    category: 'Badges',
    name: 'Soft chip — success',
    status: 'default',
    color: 'success',
    recipe: 'StatusBadge tone="success"',
    usedOn: ['ResponsesTab', 'AnnouncementsPage', 'CoordinateEventsPage'],
    tags: ['badge', 'status', 'chip', 'success', 'green', 'subscribed', 'sent'],
    note: 'Default status chip. Hue chosen by meaning.',
    render: () => <SoftBadge tone="success" icon={CheckCircle2} label="Subscribed" />,
  },
  {
    id: 'badge.soft-pending',
    concept: 'status-badge',
    conceptLabel: 'Status Badge',
    category: 'Badges',
    name: 'Soft chip — pending',
    status: 'default',
    color: 'warning',
    recipe: 'StatusBadge tone="pending"',
    usedOn: ['ResponsesTab', 'AiFeedbackPage'],
    tags: ['badge', 'status', 'chip', 'pending', 'amber', 'warning', 'no response'],
    render: () => <SoftBadge tone="pending" icon={Clock} label="No response" />,
  },
  {
    id: 'badge.soft-error',
    concept: 'status-badge',
    conceptLabel: 'Status Badge',
    category: 'Badges',
    name: 'Soft chip — error',
    status: 'default',
    color: 'danger',
    recipe: 'StatusBadge tone="error"',
    usedOn: ['ResponsesTab', 'AnnouncementsPage'],
    tags: ['badge', 'status', 'chip', 'error', 'failed', 'red', 'opted out'],
    render: () => <SoftBadge tone="error" icon={XCircle} label="Failed" />,
  },
  {
    id: 'badge.soft-info',
    concept: 'status-badge',
    conceptLabel: 'Status Badge',
    category: 'Badges',
    name: 'Soft chip — info',
    status: 'default',
    color: 'info',
    recipe: 'StatusBadge tone="info"',
    usedOn: ['ResponsesTab'],
    tags: ['badge', 'status', 'chip', 'info', 'blue', 'received'],
    render: () => <SoftBadge tone="info" icon={Eye} label="Received" />,
  },
  {
    id: 'badge.soft-neutral',
    concept: 'status-badge',
    conceptLabel: 'Status Badge',
    category: 'Badges',
    name: 'Soft chip — neutral',
    status: 'default',
    color: 'neutral',
    recipe: 'StatusBadge tone="neutral"',
    usedOn: ['ResponsesTab (unsubscribed/skipped)'],
    tags: ['badge', 'status', 'chip', 'neutral', 'slate', 'skipped', 'inactive'],
    render: () => <SoftBadge tone="neutral" icon={XCircle} label="Skipped" />,
  },

  /* ── Inputs ── */
  {
    id: 'input.toggle-switch',
    concept: 'toggle-switch',
    conceptLabel: 'Toggle Switch',
    category: 'Inputs',
    name: 'Pill switch',
    status: 'default',
    color: 'theme primary',
    recipe: 'Switch: on bg-primary / off bg-neutral-muted',
    usedOn: ['SettingsPage', 'TimeManagementPage', 'GuardianPage'],
    tags: ['input', 'toggle', 'switch', 'boolean', 'interactive'],
    note: 'Primitive preview. On follows the active theme; off is neutral.',
    render: () => <ToggleDemo />,
  },
  {
    id: 'input.text-field',
    concept: 'text-field',
    conceptLabel: 'Text Field',
    category: 'Inputs',
    name: 'Field (label + input + helper)',
    status: 'default',
    color: 'token',
    recipe: 'border border-input rounded-md bg-background focus:ring-2 focus:ring-ring',
    usedOn: ['Most forms', 'TimezoneSearchPanel'],
    tags: ['input', 'field', 'form', 'text'],
    note: 'Focus the input to see the ring.',
    render: () => (
      <label className="flex w-56 flex-col gap-1 text-left">
        <span className="text-sm text-foreground">Calendar name</span>
        <input
          type="text"
          placeholder="Team sync"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">Shown to participants.</span>
      </label>
    ),
  },

  /* ── Overlays ── */
  {
    id: 'overlay.dialog',
    concept: 'dialog',
    conceptLabel: 'Dialog (decision)',
    category: 'Overlays',
    name: 'Confirm dialog',
    status: 'default',
    color: 'token',
    recipe: 'Dialog (useModalSurface: focus trap, Escape, scroll lock)',
    usedOn: ['ConfirmDialog (used app-wide)', 'CoordinateEventsPage', 'TimeManagementPage'],
    tags: ['overlay', 'dialog', 'modal', 'confirm', 'decision', 'interactive'],
    note: 'Click "Open dialog", then the scrim or a button to close.',
    render: () => <ModalDemo />,
  },
  {
    id: 'overlay.lightbox',
    concept: 'lightbox',
    conceptLabel: 'Lightbox',
    category: 'Overlays',
    name: 'Image lightbox',
    status: 'default',
    color: 'token',
    recipe: 'Lightbox (useModalSurface, focusModal tier, bg-black/80 scrim)',
    usedOn: ['FeedbackPage (screenshots)', 'FeedbackSidePanel'],
    tags: ['overlay', 'lightbox', 'image', 'preview', 'modal', 'interactive'],
    note: 'Click the thumbnail; Escape or the scrim closes it.',
    render: () => <LightboxDemo />,
  },
  {
    id: 'overlay.scrim-tiers',
    concept: 'scrim',
    conceptLabel: 'Scrim / Layer',
    category: 'Overlays',
    name: 'Scrim tint tiers',
    status: 'default',
    color: 'token',
    recipe: 'light decision bg-black/30 · focus modal bg-black/45 backdrop-blur-sm · drawer bg-black/55',
    usedOn: ['overlays-and-layers.md tiers'],
    tags: ['overlay', 'scrim', 'backdrop', 'z-index', 'layer', 'tier'],
    note: 'Target scrim tints. Avoid black/80 for new work.',
    render: () => (
      <div className="flex gap-2">
        {[
          { c: 'bg-black/30', l: '/30 dialog' },
          { c: 'bg-black/45', l: '/45 modal' },
          { c: 'bg-black/55', l: '/55 drawer' },
        ].map(s => (
          <div key={s.l} className="flex flex-col items-center gap-1">
            <div className="relative h-12 w-16 overflow-hidden rounded bg-card">
              <div className={`absolute inset-0 ${s.c}`} />
            </div>
            <span className="text-[10px] text-muted-foreground">{s.l}</span>
          </div>
        ))}
      </div>
    ),
  },

  /* ── Panels ── */
  {
    id: 'panel.accents',
    concept: 'side-panel',
    conceptLabel: 'Side Panel',
    category: 'Panels',
    name: 'Signature accent map',
    status: 'default',
    color: 'multi',
    recipe: 'ml-auto bg-card border-l-2 border-{accent} shadow-xl · one PanelId open at a time',
    usedOn: ['AiGuideSidePanel', 'ChatSidePanel', 'SupportSidePanel', 'FeedbackSidePanel'],
    tags: ['panel', 'side panel', 'drawer', 'assistance', 'accent'],
    note: 'Each panel is told apart by its signature accent (matches nav icon color).',
    render: () => (
      <div className="flex flex-wrap gap-2">
        <SidePanelSwatch accent="border-l-purple-400 dark:border-l-purple-500" icon={Sparkles} label="AI" />
        <SidePanelSwatch accent="border-l-sky-400 dark:border-l-sky-500" icon={MessageCircle} label="Chat" />
        <SidePanelSwatch accent="border-l-blue-400 dark:border-l-blue-500" icon={LifeBuoy} label="Support" />
        <SidePanelSwatch accent="border-l-amber-400 dark:border-l-amber-500" icon={MessageSquare} label="Feedback" />
      </div>
    ),
  },

  /* ── Motion ── */
  {
    id: 'motion.unmarked-pulse',
    concept: 'pulse',
    conceptLabel: 'Attention Pulse',
    category: 'Motion',
    name: 'Unmarked pulse (amber)',
    status: 'default',
    color: 'amber',
    recipe: 'animate-unmarked-pulse',
    usedOn: ['CalendarPage (unmarked availability)'],
    tags: ['motion', 'pulse', 'amber', 'attention', 'unmarked', 'unfinished'],
    note: 'Signals "this needs marking".',
    render: () => (
      <div className="h-14 w-24 rounded-md border-2 border-warning-muted bg-card animate-unmarked-pulse" />
    ),
  },
  {
    id: 'motion.spin-once',
    concept: 'entrance',
    conceptLabel: 'One-shot Motion',
    category: 'Motion',
    name: 'Spin once (refresh)',
    status: 'default',
    color: 'token',
    recipe: 'animate-spin-once (remount to replay)',
    usedOn: ['TimezoneSelector (globe on expand)'],
    tags: ['motion', 'spin', 'refresh', 'one-shot', 'interactive'],
    note: 'Click to replay the one-shot rotation.',
    render: () => <SpinDemo />,
  },
  {
    id: 'motion.slide-in-right',
    concept: 'entrance',
    conceptLabel: 'One-shot Motion',
    category: 'Motion',
    name: 'Slide in right (toast)',
    status: 'default',
    color: 'token',
    recipe: 'animate-slide-in-right',
    usedOn: ['Toast'],
    tags: ['motion', 'slide', 'toast', 'entrance', 'interactive'],
    note: 'Entrance for edge-anchored transient UI. Click replay.',
    render: () => <ReplayDemo animation="animate-slide-in-right" label="Saved" />,
  },
  {
    id: 'motion.fade-in-up',
    concept: 'entrance',
    conceptLabel: 'One-shot Motion',
    category: 'Motion',
    name: 'Fade in up (content)',
    status: 'default',
    color: 'token',
    recipe: 'animate-fade-in-up ([animation-delay] for stagger)',
    usedOn: ['HomePage hero', 'CalendarPage popup'],
    tags: ['motion', 'fade', 'entrance', 'stagger', 'interactive'],
    render: () => <ReplayDemo animation="animate-fade-in-up" label="Welcome" />,
  },
  {
    id: 'input.drag-reorder',
    concept: 'drag',
    conceptLabel: 'Drag & Reorder',
    category: 'Inputs',
    name: 'Draggable reorder list',
    status: 'alt',
    color: 'token',
    recipe: 'draggable + onDragStart/onDragOver/onDrop',
    usedOn: ['CalendarPage (quick tools)', 'FeedbackPage (status order)'],
    tags: ['input', 'drag', 'reorder', 'sortable', 'interactive'],
    note: 'Drag a row to reorder.',
    render: () => <DragReorderDemo />,
  },

  /* ── Mailbox: Buttons ── */
  {
    id: 'button.dirty-save',
    concept: 'stateful-button',
    conceptLabel: 'Stateful Button',
    category: 'Buttons',
    name: 'Dirty-state save',
    status: 'default',
    color: 'theme primary',
    recipe: 'Button emphasis={dirty ? "solid" : "outline"} intent={dirty ? "primary" : "neutral"}',
    usedOn: ['MailboxAutomationPanel (Save rule)'],
    tags: ['button', 'save', 'dirty', 'mailbox', 'automation', 'interactive'],
    note: 'Solid primary only while there are unsaved changes. Click to flip.',
    render: () => <DirtySaveDemo />,
  },
  {
    id: 'button.confirm-to-run',
    concept: 'stateful-button',
    conceptLabel: 'Stateful Button',
    category: 'Buttons',
    name: 'Two-step confirm-to-run',
    status: 'default',
    color: 'red',
    recipe: 'Button intent={confirming ? "danger" : "primary"}',
    usedOn: ['MailboxMassActionsPanel (Apply -> Confirm)'],
    tags: ['button', 'confirm', 'two-step', 'mass action', 'danger', 'mailbox', 'interactive'],
    note: 'First click arms the action, second click runs it. Click to try.',
    render: () => <ConfirmRunDemo />,
  },
  {
    id: 'button.case-toggle',
    concept: 'toggle-button',
    conceptLabel: 'Toggle Button',
    category: 'Buttons',
    name: 'Pressed toggle (primary)',
    status: 'default',
    color: 'theme primary',
    recipe: 'ToggleButton pressed={...} size="compact"',
    usedOn: ['MailboxAutomationEditor ("Aa" case toggle)', 'time-management-markdown-composer (Guiding)', 'CalendarPage'],
    tags: ['button', 'toggle', 'case', 'pressed', 'toolbar', 'interactive'],
    note: 'Pressed state uses tint plus aria-pressed. Click to flip.',
    render: () => <CaseToggleDemo />,
  },
  {
    id: 'button.toggle-intent',
    concept: 'toggle-button',
    conceptLabel: 'Toggle Button',
    category: 'Buttons',
    name: 'Status intent pressed',
    status: 'alt',
    color: 'multi',
    recipe: 'ToggleButton intent="success" | "warning" (pressed tint only)',
    usedOn: ['NetworkRelationsPage (rule active)', 'PlatformOversightPage', 'TimeManagementPage (template selection)'],
    tags: ['button', 'toggle', 'intent', 'success', 'warning', 'pressed', 'interactive'],
    note: 'Unpressed is always neutral.',
    render: () => <ToggleIntentDemo />,
  },
  {
    id: 'button.priority-stepper',
    concept: 'stepper',
    conceptLabel: 'Priority Stepper',
    category: 'Buttons',
    name: 'Up/down priority stepper',
    status: 'default',
    color: 'token',
    recipe: 'stacked IconButton size="micro" (ArrowUp / ArrowDown)',
    usedOn: ['MailboxSortOrderEditor', 'MailboxAutomationEditor'],
    tags: ['button', 'stepper', 'reorder', 'priority', 'arrows', 'micro', 'mailbox'],
    note: 'Reorders without drag; ends are disabled.',
    render: () => <PriorityStepperDemo />,
  },

  /* ── Mailbox: Badges ── */
  {
    id: 'badge.take-action',
    concept: 'status-badge',
    conceptLabel: 'Status Badge',
    category: 'Badges',
    name: 'Take-action chip (warning)',
    status: 'alt',
    color: 'warning',
    recipe: 'border border-warning-muted bg-warning-subtle text-warning',
    usedOn: ['MailboxMassActionsPanel', 'MailboxAutomationEditor'],
    tags: ['badge', 'chip', 'action', 'amber', 'warning', 'zap', 'mailbox'],
    note: 'Marks an automation/mass-action step that performs a change.',
    render: () => (
      <span className="inline-flex items-center gap-1 rounded border border-warning-muted bg-warning-subtle px-1.5 py-0.5 text-[10px] font-medium text-warning">
        <Zap className="h-3 w-3" />
        Take action
      </span>
    ),
  },
  {
    id: 'badge.count-primary',
    concept: 'count-badge',
    conceptLabel: 'Count Badge',
    category: 'Badges',
    name: 'Count badge (primary tint)',
    status: 'default',
    color: 'token',
    recipe: 'CountBadge emphasis="active"',
    usedOn: ['MailboxMassActionsPanel (step count)', 'CoordinateEventsPage', 'CalendarPage'],
    tags: ['badge', 'count', 'primary', 'mailbox'],
    note: 'Small numeric count next to a control label.',
    render: () => (
      <div className="flex items-center gap-1.5 text-xs text-foreground">
        Mass Actions
        <CountBadge count={3} emphasis="active" />
      </div>
    ),
  },
  {
    id: 'badge.confidence-pill',
    concept: 'score-display',
    conceptLabel: 'Score Display',
    category: 'Badges',
    name: 'Confidence score + execution state',
    status: 'default',
    color: 'neutral',
    recipe: 'ScoreDisplay value={0.92} + separate StatusBadge tone="success"',
    usedOn: ['MailboxAutomationPanel (run result rows)'],
    tags: ['badge', 'pill', 'confidence', 'percent', 'emerald', 'mailbox'],
    note: 'Confidence stays color-free; whether the action applied is separate status.',
    render: () => (
      <div className="flex items-center gap-2">
        <ScoreDisplay value={1} label="match confidence" />
        <ScoreDisplay value={0.8} label="match confidence" />
        <ScoreDisplay value={0.4} label="match confidence" />
        <StatusBadge tone="success" density="compact">Applied</StatusBadge>
      </div>
    ),
  },
  {
    id: 'badge.pass-fail',
    concept: 'status-badge',
    conceptLabel: 'Status Badge',
    category: 'Badges',
    name: 'PASS / FAIL check label',
    status: 'default',
    color: 'success',
    recipe: 'PASS text-success / FAIL text-danger',
    usedOn: ['MailboxAutomationPanel (per-check rows)'],
    tags: ['badge', 'pass', 'fail', 'check', 'success', 'danger', 'mailbox'],
    note: 'Inline per-condition result inside a rule preview.',
    render: () => (
      <div className="space-y-0.5 text-[11px] text-muted-foreground">
        <p><span className="text-success">PASS</span> Subject contains "invoice"</p>
        <p><span className="text-danger">FAIL</span> From is a known contact</p>
      </div>
    ),
  },

  /* ── Mailbox: Inputs ── */
  {
    id: 'input.mode-cycle',
    concept: 'tag-mode-select',
    conceptLabel: 'Tag Mode Select',
    category: 'Inputs',
    name: 'Sort / Only / Hide visible options',
    status: 'default',
    color: 'theme primary',
    recipe: 'select with Sort / Only / Hide options',
    usedOn: ['MailboxSortOrderEditor (tag modes)'],
    tags: ['input', 'select', 'sort', 'only', 'hide', 'filter', 'mailbox', 'interactive'],
    note: 'All choices are visible and discoverable; no hidden-state cycle.',
    render: () => (
      <label className="flex items-center gap-2 text-xs text-foreground">
        Tag mode
        <select defaultValue="sort" className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
          <option value="sort">Sort</option>
          <option value="only">Only</option>
          <option value="hide">Hide</option>
        </select>
      </label>
    ),
  },

  /* ── Mailbox: Disclosure ── */
  {
    id: 'disclosure.collapsible-section',
    concept: 'collapsible',
    conceptLabel: 'Collapsible Section',
    category: 'Disclosure',
    name: 'Disclosure compact',
    status: 'default',
    color: 'token',
    recipe: 'Disclosure size="compact" icon trailing={<CountBadge />}',
    usedOn: ['MailboxMassActionsPanel', 'CoordinateEventsPage', 'AnnouncementsPage'],
    tags: ['disclosure', 'collapse', 'expand', 'accordion', 'chevron', 'compact', 'interactive'],
    note: 'Trailing slot is non-interactive. Click to toggle.',
    render: () => <DisclosureDemo size="compact" title="Mass Actions" />,
  },
  {
    id: 'disclosure.standard',
    concept: 'collapsible',
    conceptLabel: 'Collapsible Section',
    category: 'Disclosure',
    name: 'Disclosure standard',
    status: 'default',
    color: 'token',
    recipe: 'Disclosure size="standard" headingLevel={3}',
    usedOn: ['CalendarPage (sidebar sections)', 'GuardianPage', 'TimeManagementPage'],
    tags: ['disclosure', 'collapse', 'expand', 'sidebar', 'heading', 'interactive'],
    render: () => <DisclosureDemo size="standard" title="Participants" />,
  },
  {
    id: 'disclosure.section',
    concept: 'collapsible',
    conceptLabel: 'Collapsible Section',
    category: 'Disclosure',
    name: 'Disclosure section',
    status: 'default',
    color: 'token',
    recipe: 'Disclosure size="section" headingLevel={2}',
    usedOn: ['EventsPage (page sections)'],
    tags: ['disclosure', 'collapse', 'expand', 'section', 'heading', 'interactive'],
    render: () => <DisclosureDemo size="section" title="Upcoming" />,
  },
  {
    id: 'disclosure.hover-hint',
    concept: 'hover-hint',
    conceptLabel: 'Hover Explainer',
    category: 'Disclosure',
    name: 'Delayed hover tooltip',
    status: 'default',
    color: 'token',
    recipe: 'delay ~2s then popover: rounded-md border border-border bg-popover text-popover-foreground shadow-lg',
    usedOn: ['MailboxAutomationEditor (HoverHintLabel)'],
    tags: ['disclosure', 'hover', 'tooltip', 'explainer', 'popover', 'mailbox', 'interactive'],
    note: 'Explainer appears only after a deliberate hover (real delay is 2s; demo uses ~1.2s). Hover the label.',
    render: () => <HoverHintDemo />,
  },
  {
    id: 'disclosure.row-hover-actions',
    concept: 'hover-reveal',
    conceptLabel: 'Hover-reveal Actions',
    category: 'Disclosure',
    name: 'Hover-reveal actions',
    status: 'default',
    color: 'token',
    recipe: 'group + group-hover:opacity-100 on an opacity-0 action cluster',
    usedOn: ['FeedbackPage (screenshot actions)', 'FeedbackSidePanel', 'AnnouncementsPage (copy hint)'],
    tags: ['disclosure', 'hover', 'reveal', 'row', 'actions', 'interactive'],
    note: 'Actions stay hidden until hover. Hover the row.',
    render: () => <MessageRowHoverDemo />,
  },

  /* ── Mailbox: Feedback ── */
  {
    id: 'feedback.sync-progress',
    concept: 'progress',
    conceptLabel: 'Progress Indicator',
    category: 'Feedback',
    name: 'Sync progress banner',
    status: 'default',
    color: 'token',
    recipe: 'spinner + label + % + ETA; bar bg-primary (emerald-500 at 100%), transition-[width] duration-700',
    usedOn: ['MailboxPage (account sync)'],
    tags: ['feedback', 'progress', 'sync', 'spinner', 'loading', 'mailbox'],
    note: 'One continuous 0-100 curve; the bar turns emerald on completion.',
    render: () => <SyncProgressDemo />,
  },
  {
    id: 'feedback.skeleton-rows',
    concept: 'skeleton',
    conceptLabel: 'Loading Skeleton',
    category: 'Feedback',
    name: 'Inbox skeleton rows',
    status: 'default',
    color: 'token',
    recipe: 'bg-muted animate-pulse motion-reduce:[animation-duration:3s] placeholder blocks',
    usedOn: ['MailboxPage (inbox loading)'],
    tags: ['feedback', 'skeleton', 'loading', 'placeholder', 'pulse', 'mailbox'],
    note: 'Structure-matched placeholders; respects reduced motion.',
    render: () => <SkeletonDemo />,
  },

  /* ── Mailbox: Panels ── */
  {
    id: 'panel.content-drawer',
    concept: 'content-drawer',
    conceptLabel: 'Content Drawer',
    category: 'Panels',
    name: 'Sticky vs full-screen drawer',
    status: 'default',
    color: 'token',
    recipe: 'desktop: sticky top-0 h-screen border-l / mobile: fixed inset-0 z-95 w-screen; transition-[width,transform,opacity] duration-300',
    usedOn: ['MailboxAutomationPanel', 'Mailbox tag panel', 'TimeManagement', 'AddToCalendarShell'],
    tags: ['panel', 'drawer', 'sticky', 'full-screen', 'responsive', 'mailbox'],
    note: 'Large editor drawers dock beside content on desktop and take over the screen on mobile.',
    render: () => <ContentDrawerSwatch />,
  },

  /* ── Time Manager: Buttons ── */
  {
    id: 'button.calendar-quick-tool',
    concept: 'calendar-quick-tool',
    conceptLabel: 'Calendar Quick Tool',
    category: 'Buttons',
    name: 'Calendar quick tool (theme tint)',
    status: 'default',
    color: 'theme primary tint',
    recipe: 'CalendarQuickToolButton: idle primary-subtle; active primary-muted + primary border/ring + aria-pressed; no added check marker',
    usedOn: ['CalendarPage (quick-button row only)'],
    tags: ['button', 'calendar', 'toolbar', 'theme', 'interactive'],
    note: 'Scoped to calendar quick tools. Does not change pins, shared toggles, or other navigation.',
    render: () => <CalendarQuickToolDemo />,
  },

  /* -- Time Manager: Inputs -- */
  {
    id: 'input.timebox-resize',
    concept: 'resize-handle',
    conceptLabel: 'Resize Handles',
    category: 'Inputs',
    name: 'Timebox resize handles',
    status: 'default',
    color: 'token',
    recipe: 'ns-resize handles, opacity-0 -> group-hover:opacity-100, brighten on hover, pulse while active',
    usedOn: ['TimeManagementPage (time item blocks)'],
    tags: ['input', 'resize', 'drag', 'handle', 'timebox', 'time manager', 'interactive'],
    note: 'Top/bottom edge handles appear on hover and brighten. Hover the block.',
    render: () => <TimeboxResizeDemo />,
  },

  /* ── Time Manager: Cards ── */
  {
    id: 'card.category-blocks',
    concept: 'time-block',
    conceptLabel: 'Category Time Block',
    category: 'Cards',
    name: 'Category-colored blocks',
    status: 'default',
    color: 'multi',
    recipe: 'inline backgroundColor = category color; text auto-picks black/white for legibility',
    usedOn: ['MailboxPage (category tags)'],
    tags: ['card', 'block', 'timebox', 'category', 'color', 'legend', 'time manager'],
    note: 'Blocks take their category color; the text color is chosen for contrast (getLegibleTextColor).',
    render: () => <CategoryBlocks />,
  },
  {
    id: 'card.info-banner-blue',
    concept: 'banner',
    conceptLabel: 'Inline Banner',
    category: 'Cards',
    name: 'Info banner',
    status: 'default',
    color: 'info',
    recipe: 'rounded-md border border-info-muted bg-info-subtle text-info',
    usedOn: ['TimeManagementPage', 'MailboxPage', 'SettingsPage'],
    tags: ['card', 'banner', 'info', 'blue', 'notice', 'time manager'],
    note: 'Persistent inline notice; warning tokens for caution.',
    render: () => (
      <div className="flex max-w-xs items-start gap-2 rounded-md border border-info-muted bg-info-subtle px-2.5 py-2 text-[11px] text-info">
        <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Drag on the grid to create a timebox, then resize its edges to adjust.
      </div>
    ),
  },

  /* ── Time Manager: Disclosure ── */
  {
    id: 'disclosure.block-hover-tooltip',
    concept: 'hover-hint',
    conceptLabel: 'Hover Explainer',
    category: 'Disclosure',
    name: 'Timeline block tooltip',
    status: 'alt',
    color: 'token',
    recipe: 'bg-popover border-border tooltip above a block, opacity-0 -> group-hover:opacity-100, -translate-y-full',
    usedOn: ['TimeManagementPage (time item blocks)'],
    tags: ['disclosure', 'hover', 'tooltip', 'popover', 'timebox', 'time manager', 'interactive'],
    note: 'Shows exact times / "starts in" above the block on hover. Hover the block.',
    render: () => <BlockHoverTooltipDemo />,
  },

  /* ── Time Manager: Feedback ── */
  {
    id: 'feedback.unsaved-popin',
    concept: 'notice',
    conceptLabel: 'Floating Notice',
    category: 'Feedback',
    name: 'Unsaved changes pop-in',
    status: 'default',
    color: 'warning',
    recipe: 'border-warning-muted bg-warning-subtle text-warning floating card, animate-[unsaved-pop-in_180ms_ease-out]',
    usedOn: ['TimeManagementPage (unsaved item warning)'],
    tags: ['feedback', 'notice', 'unsaved', 'amber', 'popin', 'time manager', 'interactive'],
    note: 'A floating amber warning that pops in when there are unsaved edits. Click replay.',
    render: () => <UnsavedPopinDemo />,
  },
  {
    id: 'feedback.highlighted-day',
    concept: 'highlight',
    conceptLabel: 'Highlight Pulse',
    category: 'Feedback',
    name: 'Highlighted day ring-3',
    status: 'default',
    color: 'blue',
    recipe: 'finite primary ring-3 and subtle surface',
    usedOn: ['TimeManagementPage (jump-to-day highlight)'],
    tags: ['feedback', 'highlight', 'ring', 'blue', 'pulse', 'time manager'],
    note: 'Finite emphasis for a target day cell; no infinite attention pulse.',
    render: () => (
      <div className="flex h-20 w-20 items-center justify-center rounded-md bg-primary-subtle text-sm font-semibold text-primary ring-2 ring-inset ring-primary">
        Tue 14
      </div>
    ),
  },

  /* ── Time Manager: Motion ── */
  {
    id: 'motion.selection-pulse',
    concept: 'entrance',
    conceptLabel: 'One-shot Motion',
    category: 'Motion',
    name: 'Selection-time pulse',
    status: 'default',
    color: 'token',
    recipe: 'animate-[selection-time-pulse_0.75s_ease-out] (scaleX + opacity)',
    usedOn: ['TimeManagementPage (start/end labels when an edge changes)'],
    tags: ['motion', 'pulse', 'selection', 'time', 'one-shot', 'time manager', 'interactive'],
    note: 'A quick horizontal pulse on the time label whose edge just changed. Click replay.',
    render: () => <SelectionPulseDemo />,
  },
  {
    id: 'motion.time-item-selection-feedback',
    concept: 'entrance',
    conceptLabel: 'One-shot Motion',
    category: 'Motion',
    name: 'Time Item selection feedback',
    status: 'default',
    color: 'token',
    recipe: 'Primary outline pulse (650ms), real-duration badge (1600ms), static reduced-motion fallback',
    usedOn: ['TimeManagementPage (single-click Time Item selection)'],
    tags: ['motion', 'selection', 'duration', 'reduced-motion', 'time manager', 'interactive'],
    note: 'Single-click replays a presentation-only cue without forcing the side panel open. Double-click opens Full View.',
    render: () => <TimeItemSelectionFeedbackDemo />,
  },

  /* ── Coordination Calendar ── */
  {
    id: 'data.availability-heatmap',
    concept: 'availability-heatmap',
    conceptLabel: 'Availability Heatmap',
    category: 'Data',
    name: 'Overlap heatmap (green scale)',
    status: 'default',
    color: 'green',
    recipe: 'bg-green-200 / 400 / 500 / 600 by overlapping-user count (getHeatmapColor)',
    usedOn: ['CalendarPage', 'GuestBookingPage'],
    tags: ['data', 'heatmap', 'availability', 'calendar', 'green', 'overlap'],
    note: 'Cell green deepens with how many participants are free at that slot.',
    render: () => <AvailabilityHeatmap />,
  },
  {
    id: 'data.saved-gradient',
    concept: 'availability-heatmap',
    conceptLabel: 'Availability Heatmap',
    category: 'Data',
    name: 'Saved-beneath gradient (purple)',
    status: 'alt',
    color: 'purple',
    recipe: 'bg-purple-300 / 400 / 500 / 600 by saved-user count (getPurpleGradient)',
    usedOn: ['CalendarPage'],
    tags: ['data', 'heatmap', 'availability', 'calendar', 'purple', 'saved'],
    note: 'Purple layer showing how many people already saved a slot beneath the current selection.',
    render: () => <SavedGradient />,
  },
  {
    id: 'input.availability-select',
    concept: 'availability-select',
    conceptLabel: 'Availability Painter',
    category: 'Inputs',
    name: 'Drag-select time grid',
    status: 'default',
    color: 'green',
    recipe: 'pointer paint: on = border-green-600 bg-green-500 / idle = border-border bg-background hover:bg-muted',
    usedOn: ['CalendarPage', 'GuestBookingPage'],
    tags: ['input', 'grid', 'drag', 'select', 'paint', 'availability', 'calendar', 'interactive'],
    note: 'The core coordination interaction: click or drag across cells to mark availability. Try it.',
    render: () => <AvailabilitySelectDemo />,
  },
  {
    id: 'badge.source-status',
    concept: 'source-status',
    conceptLabel: 'Source Status Pills',
    category: 'Badges',
    name: 'Calendar source tri-state',
    status: 'default',
    color: 'multi',
    recipe: 'neutral access StatusBadge + independent sync StatusBadge (neutral/success/error)',
    usedOn: ['CalendarPage (calendar sources)'],
    tags: ['badge', 'status', 'source', 'calendar', 'sync', 'tri-state'],
    note: 'Access and sync state stay separate badges.',
    render: () => (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <StatusBadge tone="neutral" density="compact">Read-only</StatusBadge>
        <StatusBadge tone="neutral" density="compact">Not selected</StatusBadge>
        <StatusBadge tone="success" density="compact">Synced</StatusBadge>
      </div>
    ),
  },

  /* ── Guardian ── */
  {
    id: 'data.stat-card-guardian',
    concept: 'stat-card',
    conceptLabel: 'Stat Card',
    category: 'Data',
    name: 'Icon stat (accent variant)',
    status: 'default',
    color: 'token',
    recipe: 'bg-card border rounded-lg p-4; accent: icon bg-danger-subtle + text-danger value',
    usedOn: ['GuardianPage'],
    tags: ['data', 'stat', 'card', 'metric', 'guardian', 'accent'],
    note: 'Icon + big number tile; the accent variant uses danger tokens for alerts.',
    render: () => <GuardianStatCards />,
  },
  {
    id: 'badge.matched-highlight',
    concept: 'text-highlight',
    conceptLabel: 'Inline Highlight',
    category: 'Badges',
    name: 'Matched-text highlight (red)',
    status: 'default',
    color: 'danger',
    recipe: 'text-danger font-semibold bg-danger-subtle px-0.5 rounded',
    usedOn: ['GuardianPage (flagged content)'],
    tags: ['badge', 'highlight', 'match', 'red', 'danger', 'guardian', 'inline'],
    note: 'Highlights the substring that matched a moderation rule inside a message.',
    render: () => (
      <p className="max-w-xs text-xs text-foreground">
        Check out this{' '}
        <span className="rounded bg-danger-subtle px-0.5 font-semibold text-danger">sketchy-link.example</span>{' '}
        before the meeting.
      </p>
    ),
  },

  /* ── Platform Oversight ── */
  {
    id: 'data.stat-card-oversight',
    concept: 'stat-card',
    conceptLabel: 'Stat Card',
    category: 'Data',
    name: 'Stat with sub-metrics',
    status: 'alt',
    color: 'token',
    recipe: 'border rounded-lg bg-card p-4; total + wrapped sub label/value pairs',
    usedOn: ['PlatformOversightPage'],
    tags: ['data', 'stat', 'card', 'metric', 'oversight', 'sub'],
    note: 'A total with a row of secondary time-window breakdowns.',
    render: () => <OversightStatCard />,
  },
  {
    id: 'data.mini-bar-chart',
    concept: 'mini-chart',
    conceptLabel: 'Mini Bar Chart',
    category: 'Data',
    name: 'Pure-CSS bar chart',
    status: 'default',
    color: 'multi',
    recipe: 'flex items-end bars; hot(>=5) bg-red-500 / active bg-blue-500 / empty bg-muted; hover tooltip',
    usedOn: ['PlatformOversightPage'],
    tags: ['data', 'chart', 'bars', 'oversight', 'sparkline', 'interactive'],
    note: 'No chart library -- flex bars colored by intensity, with a hover tooltip. Hover a bar.',
    render: () => <MiniBarChartDemo />,
  },
  {
    id: 'badge.oversight-channel-pills',
    concept: 'category-tag',
    conceptLabel: 'Category Tag',
    category: 'Badges',
    name: 'Category tag',
    status: 'default',
    color: 'neutral',
    recipe: 'CategoryTag',
    usedOn: ['CalendarPage (visibility, participant tags)'],
    tags: ['badge', 'tag', 'category', 'label', 'neutral'],
    render: () => (
      <div className="flex items-center gap-1.5">
        <CategoryTag>Public</CategoryTag>
        <CategoryTag>You</CategoryTag>
        <CategoryTag>Past</CategoryTag>
      </div>
    ),
  },
  {
    id: 'feedback.live-status-dot',
    concept: 'live-dot',
    conceptLabel: 'Live Status Dot',
    category: 'Feedback',
    name: 'Pulsing status dot',
    status: 'default',
    color: 'multi',
    recipe: 'required: bg-danger animate-pulse / ok: bg-success',
    usedOn: ['PlatformOversightPage (captcha, recent activity)'],
    tags: ['feedback', 'dot', 'status', 'live', 'pulse', 'oversight', 'guardian', 'interactive'],
    note: 'A pulsing red dot for attention-needed state, steady green when clear. Click to toggle.',
    render: () => <OversightLiveDot />,
  },
]

const PRIMITIVE_PREVIEWS = new Set([
  'button.calendar-quick-tool',
  'button.primary-token',
  'button.primary-outline',
  'button.intent-success',
  'button.intent-info',
  'button.intent-warning',
  'button.size-micro',
  'button.destructive-solid',
  'button.destructive-soft',
  'button.muted-cancel',
  'button.ghost-icon',
  'button.selected-pill',
  'button.segmented-disabled',
  'button.dirty-save',
  'button.confirm-to-run',
  'button.case-toggle',
  'button.toggle-intent',
  'button.priority-stepper',
  'disclosure.collapsible-section',
  'disclosure.standard',
  'disclosure.section',
  'overlay.dialog',
  'overlay.lightbox',
  'input.toggle-switch',
  'badge.soft-success',
  'badge.soft-pending',
  'badge.soft-error',
  'badge.soft-info',
  'badge.soft-neutral',
  'badge.count-primary',
  'badge.confidence-pill',
  'badge.source-status',
  'badge.oversight-channel-pills',
])

const DATA_IDS = new Set([
  'card.category-blocks',
  'badge.count-primary',
  'badge.confidence-pill',
  'badge.oversight-channel-pills',
])

const FEATURE_IDS = new Set(['panel.accents'])

const BADGE_CATEGORY: Record<string, CatalogCategory> = {
  'badge.count-primary': 'Count',
  'badge.confidence-pill': 'Score',
  'badge.oversight-channel-pills': 'Category',
}

/** Replacement target for 'drift' entries. Empty: every tracked drift recipe has converged. */
const MIGRATION_BY_ID: Record<string, string> = {}

export const catalog: CatalogEntry[] = catalogDefinitions.map(entry => {
  const category = entry.category === 'Badges'
    ? BADGE_CATEGORY[entry.id] ?? 'Status'
    : entry.category
  const namespace = DATA_IDS.has(entry.id) || category === 'Data' || category === 'Category' || category === 'Count' || category === 'Score'
    ? 'data'
    : FEATURE_IDS.has(entry.id)
      ? 'feature'
      : category === 'Buttons' || category === 'Inputs' || category === 'Status'
        ? 'semantic'
        : 'structural'

  return {
    ...entry,
    category,
    namespace,
    previewSource: PRIMITIVE_PREVIEWS.has(entry.id) ? 'primitive' : 'recipe snapshot',
    migration: MIGRATION_BY_ID[entry.id],
  }
})
