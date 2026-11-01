import type { ReactNode } from 'react'
import { Maximize2, PanelRight, X } from 'lucide-react'
import { RightPanelPortal } from '../contexts/LayoutContext'
import type { AddToCalendarDisplayMode } from './add-to-calendar-shell-state'
import { Dialog } from './ui/Dialog'
import { IconButton } from './ui/IconButton'
import { useOverlayLayer } from '../lib/use-overlay-layer'
export const ADD_TO_CALENDAR_PANEL_WIDTH_PX = 460

interface AddToCalendarShellProps {
  mode: AddToCalendarDisplayMode
  isMobileLayout: boolean
  onClose: () => void
  onModeChange: (mode: AddToCalendarDisplayMode) => void
  children: ReactNode
  hidden?: boolean
}

/**
 * Hosts the "Add to calendar" UI either as a centered focus window or as a right side panel
 * that sits alongside the other right-hand panels instead of overlaying them.
 */
export function AddToCalendarShell({
  mode,
  isMobileLayout,
  onClose,
  onModeChange,
  children,
  hidden = false,
}: AddToCalendarShellProps) {
  const isPanel = mode === 'panel'
  // On phones the panel is a full-screen drawer, so it claims the drawer layer while shown.
  const { z: mobileDrawerZ } = useOverlayLayer('drawer', isPanel && isMobileLayout && !hidden)

  const modeToggle = (
    <IconButton
      emphasis="outline"
      data-testid="add-to-calendar-mode-toggle"
      onClick={() => onModeChange(isPanel ? 'window' : 'panel')}
      title={isPanel ? 'Show as focus window' : 'Move to right side panel'}
      label={isPanel ? 'Show add to calendar as focus window' : 'Move add to calendar to right side panel'}
      icon={isPanel ? <Maximize2 className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
    />
  )

  const header = (
    <div className="flex items-start justify-between gap-3">
      <h3 className="text-lg font-semibold">Add to calendar</h3>
      <div className="flex items-center gap-1">
        {modeToggle}
        <IconButton
          emphasis="outline"
          onClick={onClose}
          label="Close calendar picker"
          icon={<X className="h-4 w-4" />}
        />
      </div>
    </div>
  )

  if (isPanel) {
    const panelWidth = isMobileLayout ? '100vw' : `${ADD_TO_CALENDAR_PANEL_WIDTH_PX}px`
    return (
      <RightPanelPortal>
        <aside
          hidden={hidden}
          data-testid="add-to-calendar-side-panel"
          className={`${isMobileLayout ? 'fixed inset-0 h-screen w-screen border-0 shadow-2xl' : 'sticky top-0 h-screen shrink-0 border-l border-border'} overflow-hidden bg-card`}
          style={{ width: panelWidth, zIndex: isMobileLayout ? mobileDrawerZ : undefined }}
        >
          <div
            className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto p-4 lg:[&_.mailbox-calendar-targets]:grid-cols-1"
            style={{ width: panelWidth }}
          >
            {header}
            {children}
          </div>
        </aside>
      </RightPanelPortal>
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add to calendar"
      kind="focusModal"
      size="2xl"
      showCloseButton
      closeLabel="Close calendar picker"
      headerActions={modeToggle}
      panelTestId="add-to-calendar-window"
    >
      {children}
    </Dialog>
  )
}

export default AddToCalendarShell
