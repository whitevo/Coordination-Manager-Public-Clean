# Overlays & Layers

## Contents

- Named layers (use these, never a literal z-index)
- Shell layers (fixed app chrome)
- Claiming a layer outside Dialog
- Floating surfaces (menus, popovers, tooltips)
- Toasts
- What Dialog guarantees
- Modal vs panel decision
- Panel ownership
- Remaining literals (recorded, do not copy)

## Named layers (use these, never a literal z-index)

`Code/apps/web/src/lib/overlay-layers.ts` owns ordering: `OverlayKind`,
`OVERLAY_BASE_Z`, `OVERLAY_SCRIM`, `OVERLAY_LAYER_CLASS`, `SHELL_LAYER_Z`,
`SHELL_LAYER_CLASS`, `pushOverlay(kind)`, `isTopOverlay(id)`,
`isBlockingOverlayKind(kind)`. The React hook `useOverlayLayer(kind, active)`
lives in `Code/apps/web/src/lib/use-overlay-layer.ts`. Use `Dialog` (which
claims its layer itself), the hook, or a static class, and render at the
z-index they give. Re-read the file before relying on this
table; new kinds may have been added.

| Kind | Base z | Use | Scrim (`OVERLAY_SCRIM`) |
|------|--------|-----|-------------------------|
| `popover` | 60 | Anchored menus, dropdowns, popovers, hover cards (non-blocking) | none |
| `tooltip` | 80 | Tooltips (non-blocking) | none |
| `drawer` | 95 | Mobile full-screen drawers, large side editors | `bg-black/55` |
| `dialog` | 100 | Decisions: confirm, choice | `bg-black/30` |
| `focusModal` | 110 | Content-heavy forms needing focus | `bg-black/45 backdrop-blur-xs` |
| `toast` | 200 | Transient notifications | none |

**The base is a floor, not a fixed value.** The resolver tracks the stack, so a
blocking overlay (`drawer`, `dialog`, `focusModal`) opened from another lands
at least 2 above its parent (`STACK_STEP`). A `popover`/`tooltip` claimed with
`pushOverlay` lands 1 above the current blocking stack, so a menu inside a
dialog renders over it while a dialog opened from that menu still lands above
the menu; floating kinds never raise later overlays and never count for
`isTopOverlay`. That is why the old "escalated confirm at 210" slot is gone:
the TimeManagement recurring-resize decision sits above its editor because it
was opened from it, not because someone picked a bigger number. Toasts always
resolve to their fixed base, so they stay above blocking overlays without
being pushed higher by them.

## Shell layers (fixed app chrome)

Persistent chrome is mounted, not claimed: these values are fixed and never go
on the overlay stack. They interleave with the overlay bases on purpose.

| Shell layer | z | Class (`SHELL_LAYER_CLASS`) | Why there |
|-------------|---|-----------------------------|-----------|
| `sidePanelBackdrop` | 40 | `sidePanelBackdrop` (`z-40`) | mobile backdrop of assistance side panels, under page popovers |
| `sidePanel` | 50 | `sidePanel` (`z-50`) | assistance side panels (full width on phones), under page popovers |
| `navDesktop` / `navMobile` | 70 / 100 | `nav` (`z-100 md:z-70`) | desktop nav covers page popovers but stays under tooltips and blocking overlays; on phones it stays above full-screen drawers so it remains reachable (dialogs still paint above it because they portal after the app root) |

Use these classes for side panels and the nav; do not write the numbers.

## Claiming a layer outside Dialog

Use `useOverlayLayer(kind, active)` for any **fixed or portaled** popover,
tooltip or drawer that may need to sit above a dialog. It claims the layer in a
layout effect while `active` is true (so it is placed before first paint),
releases it on close/unmount, and returns `{ z, layer }` (`z` is the kind's
base while inactive; `layer.id` is for `isTopOverlay`).

```tsx
const { z: drawerZ } = useOverlayLayer('drawer', isPhoneLayout && isOpen)
// <div className={`fixed inset-0 ${OVERLAY_SCRIM.drawer}`} style={{ zIndex: drawerZ }} />
// <aside className="fixed inset-0 ..." style={{ zIndex: drawerZ }}>...</aside>
```

Mobile full-screen drawers claim the `drawer` tier this way and render the
`OVERLAY_SCRIM.drawer` scrim (Mailbox, TimeManagement, AddToCalendar, the
CalendarPage left drawer, and the CoordinateEventsPage phone tools drawer,
whose panel `top` is `getTopObstructionPx()` from `lib/top-obstruction.ts` so
it starts below the nav). Call `pushOverlay` directly only outside React.

Prefer `Dialog` whenever the content fits it: it also provides focus trap,
focus return, scroll lock and background inertness, which a custom surface
must then reimplement.

## Floating surfaces (menus, popovers, tooltips)

Use the `popover` and `tooltip` kinds; never a literal like `z-50`, `z-150`
or `z-9999`.

| Where the floating element renders | How to layer it |
|------------------------------------|-----------------|
| Absolutely positioned in page flow (not inside a dialog or drawer) | static class `OVERLAY_LAYER_CLASS.popover` (`z-60`) or `.tooltip` (`z-80`) |
| `fixed` or portaled, or inside/above a blocking overlay | `useOverlayLayer('popover' \| 'tooltip', open)` and `style={{ zIndex: z }}` |

**Clamp fixed/portaled popovers below the nav.** The nav sits above page
popovers, so a fixed or portaled popover positioned near the viewport top must
compute its `top` with `clampTopBelowObstruction(top, gap?)` from
`Code/apps/web/src/lib/top-obstruction.ts`. It reads the bottom edge of the
element marked `data-app-nav` (the Layout nav) and keeps an 8px default gap,
so the popover never renders under the nav.

Recipe: `bg-popover text-popover-foreground border border-border rounded-lg
shadow-lg`, menus with `role="menu"`; entrance `animate-in fade-in
slide-in-from-top-1` with `motion-reduce:animate-none`. Close on Escape and
outside click and return focus to the trigger. No scrim. A tooltip on an
icon-only control comes free with `IconButton` (`title`). Example consumers:
the nav menus in `Code/apps/web/src/components/Layout.tsx`,
`TimezoneSearchPanel.tsx` (hook + clamp), and the Time Management context
menus.

Types: `BlockingOverlayKind` (`drawer | dialog | focusModal`, the keys of
`OVERLAY_SCRIM`), `NonBlockingOverlayKind` (`popover | tooltip | toast`, the
keys of `OVERLAY_LAYER_CLASS`), `FloatingOverlayKind` (`popover | tooltip`).

## Toasts

`Toast.tsx` portals its container to `document.body`, outside the `#root` that
an open dialog makes inert, at `OVERLAY_LAYER_CLASS.toast` (`z-200`). Toasts
therefore stay readable and dismissible above a dialog. Use `useToast()`;
never render a toast-like notice inside a page with its own z-index.

## What Dialog guarantees

`Code/apps/web/src/components/ui/Dialog.tsx` implements these once so no
overlay has to get them right again:

- Scrim tint for its kind, and scrim click closes when `dismissible`.
- Escape closes **only the topmost** dialog, so a dialog over a dialog does not
  close both.
- Initial focus: `initialFocusRef`, else an `autoFocus` field, else the first
  text field, else the header close button, else the first control
  (`ConfirmDialog` and `ChoiceDialog` focus Cancel). Focus returns to the
  trigger on close.
- Tab is trapped inside the panel.
- Body scroll is locked while open.
- The app root is `inert` and `aria-hidden` while the dialog is open, then its
  previous state is restored (including when dialogs are nested).
- `role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`.
- Rendered in a portal on `document.body`, centered; the panel scrolls
  internally (`max-h-[90vh]`, or a pinned header/footer with `scrollBody`).

Props and defaults: component-matrix, Dialogs.

## Modal vs panel decision

| Need | Use | Blocking? |
|------|-----|-----------|
| A yes/no decision | `ConfirmDialog` (`intent="danger"` default; pass `"primary"` if not destructive) | Yes |
| Three or more outcomes | `ChoiceDialog` | Yes |
| A focused form/review | `<Dialog kind="focusModal">` | Yes |
| A full-screen image preview | `Lightbox` (`focusModal` tier, shares `useModalSurface` with `Dialog`) | Yes |
| Ongoing contextual tool beside content | Side panel (`PanelId`) | No |
| A large editor (mailbox, timeboxing) | Side drawer pattern (`useOverlayLayer('drawer', ...)` + `OVERLAY_SCRIM.drawer` on mobile) | No (desktop), full-screen (mobile) |
| An anchored menu or popover | `popover` layer (above) | No |
| Transient feedback | `Toast` via `useToast()` | No |

## Panel ownership

- Exactly **one assistance panel** (`ai | chat | feedback | support | commons`)
  is open at a time.
- An assistance panel and a desktop content drawer may coexist: the drawer
  belongs to the page's content, the panel is contextual help.
- On narrow screens they do not coexist -- the assistance panel takes over, and
  `MobilePanelSwitcher` is how the user moves between panels.
- Hiding or switching a panel must **not** discard editor state. Panels are
  visibility changes, not unmounts of the user's work.

## Remaining literals (recorded, do not copy)

Blocking modals use `Dialog`, `ConfirmDialog`, `ChoiceDialog` or `Lightbox`; drawers,
floating surfaces, side panels, the nav and toasts use the layer module. The
intentional exceptions are recorded in component-matrix "Recorded
deviations":

- Layout mobile nav menus: `z-30` click-catcher scrim and `z-40` menu, local
  to the nav's stacking context (alt).
- `Lightbox` scrim `LIGHTBOX_SCRIM` (`bg-black/80 backdrop-blur-xs`, alt: a
  darker media scrim; the layer itself is the claimed `focusModal` tier).

Small local values (`z-0`..`z-30` inside a `relative` container, for example
sticky headers or a badge over a card) are local stacking, not overlay
layers, and are fine. Anything else with a literal overlay z-index is drift:
re-grep (`z-[0-9]+`, `fixed inset-0`, `bg-black/`) rather than trusting a
list, and move it to the layer module when you touch it (SKILL.md
Conformance).
