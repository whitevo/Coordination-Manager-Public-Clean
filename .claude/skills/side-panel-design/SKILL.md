---
name: side-panel-design
description: Builds the Assistance nav dropdown and sliding right-edge side panels in Coordination Manager (Layout.tsx, panel-types.ts, ASSISTANCE_OPTIONS, color-coded panel identity, MobilePanelSwitcher, remote open events). Use when the user wants to add a contextual tool panel, change the Assistance dropdown or panel set, open a panel from another component, or add a panel to the mobile switcher.
---

# side-panel-design

Panels are contextual tools that slide in from the right edge without leaving the page.
Not for primary navigation or multi-step workflows.

## Workflow

1. **Pick a distinct color identity** (new panels must not reuse one):

   | Panel (`PanelId`) | Token | Icon | Purpose |
   |-------------------|-------|------|---------|
   | Feedback (`feedback`) | `feature-feedback` (amber) | MessageSquare | Bug reports, ideas |
   | AI Assistant (`ai`) | `feature-ai` (violet) | Sparkles | Page-aware guidance and actions |
   | Chat (`chat`) | `feature-chat` (sky) | MessageCircle | Talk with other accounts |
   | Support (`support`) | `feature-support` (blue) | LifeBuoy | Hours, cases, knowledge base |
   | Commons (`commons`) | `feature-commons` (rose) | Scale | Governance; opened from Coordinate Events |

   Tokens are `--feature-*` in `Code/apps/web/src/index.css`, mapped to `--color-feature-*`
   (plus `-subtle` and `-muted`) in `theme-tokens.css`; use `border-feature-*` and
   `text-feature-*`, never raw palette colors.

2. **Build the component** at `Code/apps/web/src/components/{Name}SidePanel.tsx`
   (props `isOpen: boolean`, `onClose: () => void`, `onPanelChange: (panel: Exclude<PanelId, null>) => void`):
   - Copy the shell from `SupportSidePanel.tsx`: an outer `aside` (`fixed inset-y-0 right-0
     ${SHELL_LAYER_CLASS.sidePanel} w-screen`, full screen on phones, `translate-x-full` when closed below `sm`; on `sm+` it is
     in flow: `sm:sticky sm:w-0` closed, `sm:w-88 md:w-96` open) wrapping
     `ml-auto h-full w-screen flex flex-col bg-card border-l-2 border-feature-{name} shadow-xl
     sm:w-88 sm:min-w-88 md:w-96 md:min-w-[24rem]`.
     Take the exact class strings from that file, not from memory.
   - Header: icon + title + pin toggle (`CalendarQuickButtonToggle`, its `toolKey` must be the panel id) + close (X)
     button, then
     `<MobilePanelSwitcher activePanel="{id}" onPanelChange={onPanelChange} />`
   - Body: `flex-1 overflow-y-auto px-4 py-4` (Support adds `space-y-4`); optional footer for links or actions

3. **Register the panel**:
   - Add the ID to `PanelId` in `Code/apps/web/src/components/panel-types.ts`
   - Add an entry to `ASSISTANCE_OPTIONS` in `Code/apps/web/src/components/Layout.tsx`
     (id, label, description, lucide icon, `iconClass`, `panel: true`). Commons is not in this
     list; it is reached through its own openers. Entries can also be non-panel links
     (`panel: false` + `to`, e.g. Documentation)
   - Also update `loadActivePanel` (the active id is persisted, see step 4), `NAV_TOOL_META`
     (entry `{ panel: true, label, icon }`, or the `Record` will not typecheck),
     `NAV_QUICK_TOOL_ORDER`, and `MobilePanelSwitcher` `OPTIONS`
   - Lazy-import the panel and render it in a `DeferredSidePanel` in Layout.tsx with the others

4. **Layout state rules** (all in Layout.tsx):
   - `activePanel` is the single source of truth; only one panel open at a time
   - The Assistance dropdown opens on hover/focus; the trigger button is inert (`cursor-default`)
   - Selecting the already-open panel closes it
   - `activePanel` is persisted in `sessionStorage` key `cm-active-right-panel`
   - Esc closes the active panel, except in inputs/contenteditable or with modifier keys
   - `DeferredSidePanel` renders nothing until first open, shows a loading aside, then stays
     mounted
   - Each change dispatches `rightPanelChanged` (`detail.activePanel`);
     `cm:mobile-navigation-panel-dismiss` closes panels on navigation below 768px
   - The same `ASSISTANCE_OPTIONS` list renders in the mobile hamburger menu

5. **Remote opening**: dispatch `window.dispatchEvent(new Event('open{Name}Panel'))`;
   Layout.tsx listens with `window.addEventListener('open{Name}Panel', handler)`. Add one
   `useEffect` listener per event; the handler
   toggles via `setActivePanel` (a second dispatch closes the open panel). Existing events: `openAiPanel`,
   `openFeedbackPanel`, `openChatPanel`, `openSupportPanel`, `openCommonsPanel` (also navigates
   to `/coordinate-events`). `closeRightSidebarPanels` closes whichever panel is open; its `detail.closed` is set to
   true/false so callers know whether a panel closed.

6. **Mobile**: below `sm` the panel covers the screen (no backdrop); `MobilePanelSwitcher`
   moves between panels. It is `sm:hidden` with `grid-cols-5`; a 6th panel needs a grid change. The mobile menu renders the same `ASSISTANCE_OPTIONS`.

## Gotchas

- Z-order: panels use `SHELL_LAYER_CLASS.sidePanel` (backdrop: `.sidePanelBackdrop`) and
  the nav uses `SHELL_LAYER_CLASS.nav`; Assistance dropdown menus use
  `OVERLAY_LAYER_CLASS.popover` (all from `lib/overlay-layers.ts`; never write z literals;
  see design-system overlays-and-layers).
- Do NOT reintroduce a floating overlay launcher; it obscured page content.
