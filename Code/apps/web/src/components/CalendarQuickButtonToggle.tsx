import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { PanelId } from './panel-types'
import QuickPinButton from './QuickPinButton'

interface CalendarQuickButtonToggleProps {
  toolKey: Exclude<PanelId, null>
  label: string
}

export default function CalendarQuickButtonToggle({ toolKey, label }: CalendarQuickButtonToggleProps) {
  const [isPinned, setIsPinned] = useState(false)
  const { pathname } = useLocation()
  // The pinned toggle only affects the quick-tool bar rendered on the Coordination Calendar page.
  const isCalendarPageVisible = pathname === '/calendar' || pathname.startsWith('/calendar/')

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handler = (event: Event) => {
      const toolKeys = (event as CustomEvent<{ toolKeys?: unknown }>).detail?.toolKeys
      setIsPinned(Array.isArray(toolKeys) && toolKeys.includes(toolKey))
    }

    window.addEventListener('calendarQuickToolsChanged', handler)
    return () => window.removeEventListener('calendarQuickToolsChanged', handler)
  }, [toolKey])

  const handleClick = () => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent('toggleCalendarQuickTool', { detail: { toolKey } }))
  }

  if (!isCalendarPageVisible) return null

  return <QuickPinButton pinned={isPinned} onToggle={handleClick} label={label} />
}