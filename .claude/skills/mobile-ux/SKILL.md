---
name: mobile-ux
description: Audits and refactors Coordination Manager React screens for phone and touch use -- thumb reach, breakpoint checks, touch targets, touch-safe actions, non-drag fallbacks, phone layout variants, and mobile performance. Use when the user asks for a mobile audit or mobile issue list, or asks to make a page or component work on phones or touch devices (hover, right-click, drag, dense layouts). Not for choosing components, overlay layers, z-index or animation (use design-system) or for the Assistance side panels (use side-panel-design).
---

# mobile-ux

Treat mobile as a distinct interaction mode, not a narrower desktop layout.
Two workflows: **Audit** (find and prioritize issues) and **Refactor**
(implement variants). A refactor request without a prior audit starts with
audit steps 1-2 for the target screen only.

## Rules (both workflows)

- Check `360px`, `390px`, `430px`, tablet width, and phone landscape. The app
  splits at Tailwind `sm` (640px) and `md` (768px); JS phone checks use
  `matchMedia('(max-width: 767px)')` and nav panels dismiss below 768px.
- Touch targets: aim for >= 44px on phone. `IconButton` is 40px (`standard`), 32px
  (`compact`) or 24px (`micro`), so phone layouts add a local `min-h-11` / larger hit area.
- Every drag interaction needs a non-drag fallback.
- No critical action may depend only on hover, right-click, or long press.
- Split behavior by input capability (`hover`, `any-hover`, `pointer`,
  `any-pointer`), not only by width.
- Stay inside the React + Vite + Tailwind stack and the ui primitives; a new
  library is a proposal that needs user approval.
- Review the target screen and its direct child components only.

## Components and libraries

Phone/touch work uses the in-repo primitives first; which primitive, layer and
motion to use is owned by `design-system` (read it before choosing).

| Need | First pick (in repo) |
|------|----------------------|
| Dialog or full-screen form on phone | `ui/Dialog` (`kind="focusModal"`, `scrollBody`, `initialFocusRef`) |
| Phone drawer or sheet (large editor, tools) | `useOverlayLayer('drawer', isPhone && open)` + `OVERLAY_SCRIM.drawer` (layers: design-system overlays-and-layers) |
| Fixed popover near the top | `useOverlayLayer('popover', open)` + `clampTopBelowObstruction()` |
| Phone segmented view or section collapse | `ui/SegmentedControl`, `ui/Disclosure` |
| Icon actions | `ui/IconButton` (`label` required); sizes below |
| Panels on phone | `MobilePanelSwitcher` (side-panel-design) |

Libraries NOT installed in `apps/web` (not installed; propose to the user first, never
add unprompted): Radix UI, Vaul, react-swipeable, React Hook Form + Zod, @dnd-kit,
TanStack Virtual / react-window, TanStack Query, Zustand, Jotai, Framer Motion,
vite-plugin-pwa. `@floating-ui/dom` is only a transitive Tiptap dependency, not
declared; do not import it directly.

## Audit

1. **Task path.** Name the screen's main user action and type (browse, edit,
   plan, reorder, review, admin).
2. **Widths.** At each width, record clipping, overflow, double scroll
   regions, fixed-height traps, unsafe sticky elements, and places that look
   like squeezed desktop.
3. **Touch.** Primary action reachable with one thumb; side panels that should
   become sheets, drawers, or full-screen flows; hover/right-click actions
   available through visible buttons or menus.
   - Calendar/timeline: selection must finish before a full-screen editor
     opens; opening on pointer-down fights touch selection.
   - Compact ribbons: flag several buttons that open the same tool surface;
     prefer one direct action plus 1-2 real shortcuts.
4. **Drag and density.** Reorder needs handles or `Move up` / `Move down`;
   card moves need `tap card -> choose list -> confirm`; tables need a phone
   presentation (cards, stacked list, segmented view). Time grids must use
   pointer capture with pointerup/pointercancel, not mouse events. Flag tiny
   inline action pills over small selections.
5. **Accessibility and performance.** Tap targets, visible focus, labels,
   dialog focus trapping, color-only state, unnamed icon buttons; decorative
   motion, heavy blur, hidden desktop panels still mounted, long lists needing
   virtualization; multi-row mobile headers caused by repeated titles, date
   ranges, or verbose timezone labels.
6. **Output.** Per issue: screen, severity, user impact, width or input-mode
   trigger, recommended pattern, and a library only if justified. Separate
   structural issues from polish.

## Refactor

1. **List the desktop assumptions** in the target: right-click menus, hover
   reveals, drag as the main interaction, wide multi-column layout, small hit
   areas.
2. **Define variants.** Desktop: sidebar + main + panel when justified.
   Tablet: collapsible sidebar + drawer. Phone: one active view + bottom
   sheet, full-screen editor, segmented control, or bottom action bar. For
   phone time grids: `select -> release -> open full-screen editor`.
3. **Replace behaviors.**

   | Desktop | Phone/touch replacement |
   |---------|-------------------------|
   | Right click | dropdown menu, action bar, or visible buttons |
   | Hover reveal | persistent labels or always-visible controls |
   | Drag panel | bottom sheet, drawer, tabs, or stepper |
   | Drag reorder | handle plus `Move up` / `Move down` |
   | Dense table | cards (phone), compact table (tablet), full grid (desktop) |
   | Task-heavy modal | `Dialog kind="focusModal"` or the drawer tier on small screens; a hand-built `fixed inset-0` overlay is drift (design-system) |
   | Tall planner header | one compact row; drop redundant titles and badges before shrinking the grid |
   | Tool ribbon | one non-scrolling row of real shortcuts plus a single tools entry |

4. **Accessibility and forms.** Keep focus styles, focus trapping, and icon
   button names. Use `inputMode`, `autoComplete`, `enterKeyHint`, and explicit
   labels. On phone, when a modal opens for a fresh selection, its secondary
   action is `Cancel` and clears the selection.
5. **Performance.** Do not mount hidden desktop panels on phone (render
   conditionally); follow the loop classes and reduced-motion recipe in design-system
   `references/motion.md`; avoid heavy blur and
   backdrop-filter on mobile; virtualize or paginate long lists; touch drag and
   selection use pointer events with pointer capture.
6. **Validate the slice.** After the first substantive edit, run the narrowest
   relevant test, typecheck, or lint. Verify each variant you introduced and
   that critical actions stay reachable without hover, right-click, or long
   press. Do not add a library without user approval.
