# Component Matrix

## Contents

- Buttons
- Cards / surfaces
- Dialogs (blocking modals)
- Toast (transient notification)
- Tabs
- Side panels (non-blocking contextual)
- Status / badges
- Banners (persistent inline notice)
- Fields / inputs
- Data display
- Theme editor
- Deviating on purpose
- Remaining raw palette classes

The single lookup table for "what do we already have, and which version is the
default?" For each component: the **default** to reach for, the variants that
exist, its signature color (from `color-system`), its motion (from
`motion`), and the source file. When building a new page, pick the default
row unless there is a stated reason not to.

Legend: **D** = default (use this) - Alt = exists, use only when it fits -
Drift = inconsistent, converge toward the default.

---

## Buttons

**Default:** `Code/apps/web/src/components/ui/Button.tsx`
and `Code/apps/web/src/components/ui/IconButton.tsx`.
A raw `<button>` is allowed only for list or menu rows, grid cells, drag or
resize handles, scrims, inline text links, data- or brand-colored elements,
`AnimatedTabBar` tab strips and nav quick tools; anywhere else it is drift.
Live variants: docs Component Catalog
(`Code/apps/docs/src/design-catalog/registry.tsx`, `/design/catalog`).

`Switch` defaults to its standalone track. Use `variant="card"` for
a single on/off setting whose entire labeled surface should be clickable;
pass non-interactive label/description content as children and connect the
description with `aria-describedby`. It remains one focusable switch. The
card highlights on hover/focus, and its track outline traces only during
interaction (static under reduced motion). `cardTone="warning"` ties privacy
settings to a warning header; the default is primary. Other switches are unchanged.

The API has three independent dimensions and **no hue**:

| Prop | Values | Default | Notes |
|------|--------|---------|-------|
| `emphasis` | `solid \| outline \| ghost` | `solid` | visual weight |
| `intent` | `primary \| neutral \| danger \| success \| info \| warning` | `neutral` | meaning; `primary` follows the theme; `success`/`info`/`warning` only for status-bearing actions (save-state feedback after success, link-exists tiles, warning-banner actions), never decoration |
| `size` | `micro \| compact \| standard` | `standard` | `h-6` / `h-8` / `h-10`; `micro` only for dense rows, grid header controls, in-input clear buttons |
| `loading` | boolean | `false` | spinner, blocks interaction, keeps layout |
| `icon` | ReactNode | -- | rendered before the label |
| `fullWidth` | boolean | `false` | `w-full` |
| `className` | string | -- | layout only (margin, flex, width, grid); `cn()` does not merge, so a visual class competes by stylesheet order |

`IconButton` has **different defaults** -- it is a quiet toolbar control:

| Prop | Default | Notes |
|------|---------|-------|
| `label` | required | becomes `aria-label`, and the tooltip while `showTitle` is true |
| `icon` | required | the glyph |
| `emphasis` | `ghost` | |
| `intent` | `neutral` | |
| `intent` values | as Button | status intents only for status-bearing actions |
| `size` | `compact` | square `h-8 w-8`; `standard` `h-10 w-10`; `micro` `h-6 w-6` |
| icon sizing | by size | set on the child svg via `[&>svg]` (3.5 micro, 4 otherwise); do not size the icon or the button yourself |
| `showTitle` | `true` | renders `title={label}` |

There is deliberately no blue, green, emerald, or indigo variant, so a hue
cannot be reintroduced by copying a recipe.

Emphasis rule: one solid primary per view; secondary actions use outline
primary or a neutral emphasis.

Replacement map (historical recipes; most no longer exist in code, but use it
to translate any you meet):

| Old recipe | Replacement |
|------------|-------------|
| `bg-blue-600 text-white hover:bg-blue-700` | `<Button intent="primary">` |
| `bg-green-600` / `bg-emerald-600` Save, Send, Accept | `<Button intent="primary">`; success only in the feedback **after** it succeeds |
| emerald "dirty save" | `<Button intent="primary">` + explicit "Unsaved changes" text |
| `bg-red-600` / `bg-rose-600` delete | `<Button intent="danger" emphasis="solid">` |
| soft red delete in a list | `<Button intent="danger" emphasis="outline">` |
| `bg-muted` cancel | `<Button emphasis="ghost" intent="neutral">` |
| `p-1 rounded hover:bg-muted` icon button | `<IconButton label="...">` |
| indigo copy button | `<Button intent="neutral">` + transient "Copied" |
| blue maximize | `<IconButton intent="neutral">` |
| two-click confirm-to-run | `ConfirmDialog` with `affectedCount` |
| selected pill | `ToggleButton` or `SegmentedControl` (it is selection, not an action) |

Rules:

- An intended outcome is not a successful result. Save is `primary` before it
  runs and `success` only in the confirmation afterwards.
- `danger` is for destructive consequences. A wide-scope bulk operation needs a
  confirmation showing the affected count, not a red button.
- Expanding a panel or copying a value does not deserve primary emphasis.

### Scoped calendar quick-tool treatment

`CalendarQuickToolButton` (`Code/apps/web/src/components/calendar-quick-tool-button.tsx`) is used only by the Coordination Calendar quick-button
row. Every tool uses the active theme's primary tint rather than an individual
palette: idle `bg-primary-subtle`; selected `bg-primary-muted` with primary
border/ring and `aria-pressed`, without an added check marker. Text stays `text-foreground`
instead of using a solid primary fill. One-shot actions omit `aria-pressed`.
Shared Button, ToggleButton, SegmentedControl and navigation states are
unchanged. Pin controls (`QuickPinButton`) use token gradients: pinned
`success-subtle` -> `info-subtle` with `text-success`, unpinned `warning`.

CalendarPage's Delete Calendar entry uses outlined danger; its final Delete
confirmation retains solid danger. Oversight and User List navigation use the
ordinary Tools menu recipe. The Coordinate Events Commons opener is an ordinary
tool, not a danger action.

Guardian, Oversight, and User List can be pinned to the navigation quickbar.
Oversight/User List pins follow the existing admin block-power visibility rule
on desktop and mobile; hidden pins remain saved. Guardian follows its menu's
existing visibility and sign-in navigation behavior.

Calendar invite-copy acknowledgment uses Toast's neutral appearance: card
surface, card foreground text, border, and success icon. Other toasts retain
their existing solid semantic appearance.

## Cards / surfaces

| Variant | Recipe | Status |
|---------|--------|--------|
| Card | `bg-card text-card-foreground rounded-lg border border-border` | **D** |
| Elevated card | Card + `shadow-xl` (dark: `--shadow-elevated`) | Alt (raised/floating) |
| Muted section | `bg-muted/50 rounded-lg p-4` | Alt (inset grouping) |
| Bordered stat row | `border border-border rounded-lg` + header `bg-muted` | Alt (no current example) |

Parts: `title`, `description` (`text-sm text-muted-foreground`), `content`,
`actions?`. In dark mode `--card` is intentionally lighter than `--background`.

## Dialogs (blocking modals)

**Shell:** `Code/apps/web/src/components/ui/Dialog.tsx`.
It owns scrim, layer, Escape, focus entry and return, focus trap, and scroll
lock plus background inertness/`aria-hidden`, so those are implemented once.
Escape closes only the topmost dialog.

`Dialog` props (`DialogProps`, `DialogSize` exported from the barrel):

| Prop | Default | Notes |
|------|---------|-------|
| `open`, `onClose` | required | |
| `title` | required | `ReactNode`; also names the dialog (`aria-labelledby`) |
| `description` | -- | `ReactNode`; `aria-describedby` |
| `children` | -- | body |
| `actions` | -- | right-aligned action row |
| `footer` | -- | free-form footer when the action row does not fit |
| `kind` | `dialog` | `dialog` (decisions) or `focusModal` (content-heavy forms); picks layer and scrim |
| `size` | `sm` for `dialog`, `2xl` for `focusModal` | `sm \| md \| lg \| xl \| 2xl \| 3xl` (`max-w-*`) |
| `dismissible` | `true` | false blocks Escape and scrim-click |
| `closeOnScrimClick` | = `dismissible` | false keeps Escape and the close button but ignores stray outside clicks |
| `showCloseButton`, `closeLabel` | `false`, `"Close"` | header X (`IconButton`) calling `onClose` |
| `headerActions` | -- | extra header controls before the close button |
| `scrollBody` | `false` | pins header and footer, scrolls only the body (`max-h-[85vh]`) |
| `initialFocusRef` | -- | element to focus on open |
| `panelTestId`, `className` | -- | test id / classes on the panel |

The panel is `max-h-[90vh] overflow-y-auto` by default, so long content
scrolls inside it. Initial focus order: `initialFocusRef`, else an
`autoFocus` field, else the first text field, else the close button, else the
first control; focus returns to the trigger on close. Dialogs are centered;
there are no anchored confirms.

**Compositions:**

| Need | Use |
|------|-----|
| Yes/no decision | `Code/apps/web/src/components/ConfirmDialog.tsx` (default export) |
| Three or more outcomes | `Code/apps/web/src/components/ui/ChoiceDialog.tsx` |
| Content-heavy form | `<Dialog kind="focusModal">` |
| Full-screen image preview | `Code/apps/web/src/components/ui/Lightbox.tsx` |

`ConfirmDialog` defaults are **destructive**: `intent` accepts only
`primary | danger` and defaults to `danger`; `confirmText` defaults to
`"Delete"`, `title` to `"Are you sure?"`, `cancelText` to `"Cancel"`. There is
no neutral intent. For a non-destructive confirmation (send, publish, apply)
pass `intent="primary"` and a specific `confirmText`; reserve `danger` for
destructive consequences. `affectedCount` appends `(N)` to the confirm label.
`children` adds detail between the message and the actions (scope lists,
opt-outs). Cancel is always ghost neutral and takes initial focus.

`ChoiceDialog` renders each choice as a full-width **outline** `Button`
(`choice.intent` defaults to `neutral`) plus a ghost Cancel, which takes
initial focus so Enter never commits an outcome by accident; set
`intent: 'danger'` only on the destructive choice.

`Lightbox` props: `open`, `onClose`, `src` (nothing renders while empty),
`alt`, `title?` (visually hidden name, default `"Image preview"`),
`closeLabel?` (default `"Close preview"`), `className?` (on the image). It is
portaled to `document.body` on the `focusModal` tier with the recorded
`LIGHTBOX_SCRIM` (alt, see Recorded deviations). `Dialog` and `Lightbox` share
`Code/apps/web/src/components/ui/use-modal-surface.ts` (`useModalSurface`:
layer claim, inert app root, focus entry/return, scroll lock, topmost-only
Escape, Tab trap). Clicking around the image closes it; clicking the image
does not.

Layers come from
`Code/apps/web/src/lib/overlay-layers.ts`, which
resolves z-index from the overlay kind **and the current stack**. A dialog
opened from another overlay lands above its parent automatically, so no new
overlay needs a bespoke escalated value. Never hardcode a z-index again.

## Toast (transient notification)

**Default:** `Code/apps/web/src/components/Toast.tsx` via
`useToast()`. Container portaled to `document.body` (outside the inert
`#root`), `fixed bottom-4 right-4` at `OVERLAY_LAYER_CLASS.toast`; item
`rounded-lg shadow-lg min-w-[250px] max-w-[400px]` with `animate-slide-in-right`.

| Type | Surface | Icon | Dismiss |
|------|---------|------|---------|
| success (default) | `bg-success text-success-foreground` | `Check` | 4s auto |
| info | `bg-info text-info-foreground` | `Info` | 4s auto |
| error | `bg-danger text-danger-foreground` | `AlertTriangle` | manual only |

Errors do not auto-dismiss: important information must not depend on a message
the user may not have seen. Use a `Banner` for persistent page conditions and
inline text for field errors.

## Tabs

**Default:** `Code/apps/web/src/components/AnimatedTabBar.tsx`
for any primary tab strip (keeps the thread-wave effect). Item contract:
`{ id, label, icon?, title? }`. Required props: `ariaLabel`, `testId`. State =
`selected` only. Use it for every tab strip that switches panels (Mailbox,
mailbox-mobile-navigation, FeedbackPage, GuardianPage).

## Side panels (non-blocking contextual)

**Default pattern:** `ml-auto h-full bg-card border-l-2 border-{accent} shadow-xl`
with responsive width `sm:w-88 md:w-96`. Each panel owns a signature accent
(see `color-system` accent map). Anatomy: `header` (title + close:
`IconButton label="Close"` on every panel below, including Meeting and
Calendar AI) >
`content` > optional `footer-actions`. Only one panel (`PanelId`:
`feedback | ai | chat | support | commons | null`) is open at a time. Governed with the
`side-panel-design` skill. Assistance panels layer with
`SHELL_LAYER_CLASS.sidePanel` (and `sidePanelBackdrop` for the mobile
backdrop), never a literal z-index.

| Panel | Accent | File |
|-------|--------|------|
| AI Assistant | `feature-ai` (nav icon only; panel border is `border-l border-border`) | `Code/apps/web/src/components/AiGuideSidePanel.tsx` |
| Chat | `feature-chat` | `Code/apps/web/src/components/ChatSidePanel.tsx` |
| Support | `feature-support` | `Code/apps/web/src/components/SupportSidePanel.tsx` |
| Feedback | `feature-feedback` | `Code/apps/web/src/components/FeedbackSidePanel.tsx` |
| Commons | `feature-commons` | `Code/apps/web/src/components/CommonsSidePanel.tsx` |
| Meeting (contextual) | `border-r-2 border-primary/40` (left-side panel) | `Code/apps/web/src/components/MeetingSidePanel.tsx` |

Large drawers (Mailbox editors, TimeManagement, AddToCalendar,
CoordinateEventsPage phone tools) use a fuller
pattern: desktop `sticky top-0 h-screen border-l/r`, mobile
`fixed inset-0 h-screen w-screen` with the `drawer` tier claimed through
`useOverlayLayer('drawer', open)` and the `OVERLAY_SCRIM.drawer` scrim. The
CoordinateEventsPage phone tools drawer starts below the nav instead of at
`inset-0` (`top` from `getTopObstructionPx()`). See `overlays-and-layers`.

## Status / badges

Four components share one geometry but answer different questions. Pick by what
the information **is**, not by how it should look.

| Component | Answers | File |
|-----------|---------|------|
| `StatusBadge` | what state is this in? | `Code/apps/web/src/components/ui/StatusBadge.tsx` |
| `CategoryTag` | what kind of thing is this? | `Code/apps/web/src/components/ui/CategoryTag.tsx` |
| `CountBadge` | how many? | `Code/apps/web/src/components/ui/CountBadge.tsx` |
| `ScoreDisplay` | how certain / how much? | `Code/apps/web/src/components/ui/ScoreDisplay.tsx` |

Only `StatusBadge` is colored by state. A count of five is not five problems,
and a channel name is not a status. See `color-system` for the tone map.

| Component | Props (defaults) |
|-----------|------------------|
| `StatusBadge` | `tone` (a `StatusTone`), `children` (the domain label), `icon?` (optional), `density` (`standard` default, `compact`) |
| `CategoryTag` | `children`, `icon?`, `color?` (user category `#rrggbb`; foreground computed for contrast; omit for neutral) |
| `CountBadge` | `count`, `label?` (what is counted), `emphasis` (`quiet` default; `active` = `bg-primary-subtle text-primary`), `max` (99, shows `99+`) |
| `ScoreDisplay` | `value` (0..1 or 0..100), `label` (required, `role="meter"`), `showBar` (`false`) |

## Banners (persistent inline notice)

There is no generic Banner primitive. The only shared banner is
`Code/apps/web/src/components/FeatureDisabledBanner.tsx` (props `{ status }`;
one warning variant: `border-warning-muted bg-warning-subtle`, AlertTriangle
icon, dismiss button). For another persistent notice use the same recipe with
the semantic role that fits (`bg-info-subtle border-info-muted` for info,
`warning` for caution). Persistent -- use `Toast` when the message should
disappear.

## Fields / inputs

Recipe: `label` (`text-sm`) + native control
(`border border-input rounded-md bg-background text-foreground`,
`focus:ring-2 focus:ring-ring`) + optional helper
(`text-xs text-muted-foreground`).

### Selection controls -- pick by behaviour, not by looks

| Need | Use | ARIA |
|------|-----|------|
| Immediate on/off setting | `Code/apps/web/src/components/ui/Switch.tsx` | `role="switch"` + `aria-checked` |
| A toolbar mode that stays pressed | `Code/apps/web/src/components/ui/ToggleButton.tsx` | `aria-pressed` |
| Mutually exclusive choice | `Code/apps/web/src/components/ui/SegmentedControl.tsx` or a `select` | `role="radiogroup"` |
| Switching associated content panels | `Code/apps/web/src/components/AnimatedTabBar.tsx` | tablist |
| Selecting items / form choices | `Checkbox` (native) | `aria-checked` |

These share tokens but must **not** share ARIA roles: a switch is not a toggle
button and neither is a tab.

Props: `Switch` `checked`, `onCheckedChange`, `label?` (required unless a
visible label is wired), `size` `compact | standard`; `ToggleButton`
`pressed`, `onPressedChange`, `icon?`, `children`, `intent` (pressed tint,
default `primary`; status intents only for status-bearing modes; unpressed is
always neutral), `size` `micro | compact | standard`; `SegmentedControl`
`label` (required), `options` (`{ value, label, icon?, title?, disabled?,
testId? }`), `value`, `onChange`, `showSelectedMarker` (default `false`),
`size` `micro | compact | standard`. Arrow keys move and select the next
enabled option (wrapping), Home/End jump; disabled options are skipped.
Sizes default to `standard`. Pressed/selected = the subtle tint
(`bg-primary-subtle text-primary`).

`Switch` is on = `bg-primary`, off = `bg-neutral-muted`. Off is never red.
Every on/off setting uses `Switch`.
Never use a single button that cycles through hidden states (the old
Sort/Only/Hide control): options a user cannot see are options they cannot
find. Use `SegmentedControl` or a compact `select` and keep all meanings.

### Disclosure (collapsible section)

`Code/apps/web/src/components/ui/Disclosure.tsx`: every collapsible section.
Full-width header button with `aria-expanded` and a rotating chevron (static
under reduced motion).

| Prop | Default | Notes |
|------|---------|-------|
| `title` | required | also names the panel region |
| `description`, `icon` | -- | secondary line; muted decorative icon |
| `size` | `standard` | `compact` (text-xs card/editor header), `standard` (text-sm sidebar section), `section` (text-lg page section) |
| `headingLevel` | -- | `1..6`; wraps the button in `h1`..`h6` |
| `trailing` | -- | non-interactive content before the chevron (`CountBadge`, `StatusBadge`); never a control |
| `expanded` + `onToggle` / `defaultExpanded` | uncontrolled, `false` | controlled or uncontrolled |
| `children`, `panelClassName` | -- | with children the panel renders (only while open) with `panelId` |
| `panelId` | generated | without children, render your own panel with this id |
| `disabled`, `testId`, `className` | -- | `className` is layout only |

Composite: `Code/apps/web/src/components/DualThumbSlider.tsx`,
`Code/apps/web/src/components/TimezoneSelector.tsx`.

## Data display

| Component | Type | File |
|-----------|------|------|
| GuardianTimeSeries | Metric (time series) | `Code/apps/web/src/components/GuardianTimeSeries.tsx` |
| GuardianActionTimeSeries | Metric | `Code/apps/web/src/components/GuardianActionTimeSeries.tsx` |
| GuardianSystemLog | Metadata (log stream) | `Code/apps/web/src/components/GuardianSystemLog.tsx` |
| SentimentGrid | Grid | `Code/apps/web/src/components/SentimentGrid.tsx` |
| ColorGridPicker | Grid (selector) | `Code/apps/web/src/components/ColorGridPicker.tsx` |

Progress bar default: track `bg-muted rounded-full`, fill `bg-primary`,
`transition-[width] duration-700`. A completed progress operation may use a
separate success indicator; do not recolor the measured data bar at 100%.

## Theme editor

`Code/apps/web/src/components/ThemeCreator.tsx`:
`preset-grid` (selected = primary ring + check badge), 3 custom slots (max 3),
grouped editor (`COLOR_GROUPS`), save/reset/cancel/rename actions.

## Deviating on purpose

Use the default. If it genuinely does not fit, use something else **and add a
row here** recording what it deviates from, why, and where it is used. A
deviation with a recorded reason is `alt`. A deviation without one is `drift`
and is a bug.

### Recorded deviations

| Deviation | Deviates from | Why | Where |
|-----------|---------------|-----|-------|
| Multi-select ring uses `info` (`ring-4 ring-info ring-offset-1`, inline border `hsl(var(--info))`) | selected = `primary` | Two selection *kinds* coexist on one surface: single-edit selection (`ring-2 ring-primary`) and the multi-select cohort, which also sets `data-multi-selected`. Ring width alone was not a reliable distinction while dragging. | `Code/apps/web/src/pages/TimeManagementPage.tsx` calendar items |
| Current-time indicator uses a fixed red (`bg-red-600` dot + red gradient line) | semantic tokens | Data-layer indicator, not a state. It must stay legible against arbitrary user category colours and must not shift when the theme primary changes. | `TimeManagementPage.tsx`, `CalendarPage.tsx`, `CoordinateEventsPage.tsx`, `EventsCalendarPage.tsx` |
| Availability heatmap uses a green intensity scale (`bg-green-200..600`) | semantic tokens | Data namespace. The scale encodes *how many people are free*, a quantity, not a success outcome. Converting it to tokens would destroy the intensity ramp. | `CalendarPage.tsx`, `GuestBookingPage.tsx` `getHeatmapColor` |
| Saved-availability overlay uses a purple scale (`bg-purple-300..600`), with matching tooltip legend dots (`bg-purple-500` you, `bg-green-500` others) | semantic tokens | Second data scale, deliberately distinct from the green one so "my saved slots" never reads as "group availability". | `CalendarPage.tsx`, `GuestBookingPage.tsx` `getPurpleGradient`; CalendarPage cell tooltip |
| Meeting-selection grid cells use `bg-blue-400` (and the blue `editing-meeting-cell` pulse) | semantic tokens | Data layer that sits *under* user-chosen participant colours and must stay distinct from them and from the green/purple scales. Cells also carry `data-meeting-selection` so logic never depends on the colour. Other cell states are tokens (import preview `bg-info-muted`, in-range `bg-success-subtle` or `bg-neutral-subtle` under Forest dark, skipped/out-of-range/busy `neutral`). | `Code/apps/web/src/pages/CalendarPage.tsx` day grid |
| Meeting blocks: `info` = recurring, `warning` = single (`warning/70` for future-week projections), `neutral` = past | `info`/`warning` meanings | Category distinction between meeting kinds; recurring is also dashed and carries a `Repeat2` icon so the meaning is not colour-only. | `Code/apps/web/src/pages/CalendarPage.tsx` meeting overlays and hover card |
| Chart series use fixed hues (Mailbox: `bg-emerald/blue/amber/violet-400`, SVG strokes; Oversight: per-series hex in the series config) | semantic tokens | Data series must stay mutually distinguishable and stable across themes; they are not states. | `MailboxPage.tsx` analytics, `PlatformOversightPage.tsx` |
| Brand marks keep brand colors (Luma orange-pink gradient, Discord `#5865F2`, Outlook `#0078d4`, Google logo fills) and HomePage hero art (`.home-flow-*`) | semantic tokens | Third-party identity; decorative brand art. | `SettingsPage.tsx`, `MeetingSidePanel.tsx`, `AnnouncementsPage.tsx`, `CoordinateEventsPage.tsx`, `EventsCalendarPage.tsx`, `MeetingPage.tsx`, Google sign-in buttons |
| User- or category-chosen colors applied inline, and categorical series | semantic tokens | The user picked the color (text uses a computed contrast color), or the hue only tells categories apart. | categories, time sources, Mailbox tags, network colors, Discord roles, color pickers and palettes, CalendarPage `suggestedColors`, CoordinateEvents subscribed-meetings source `#8B5CF6` |
| Neutral non-semantic colors | semantic tokens | Not hues: `rgba(0,0,0,a)` elevation shadows, mask colors, white resize-handle overlays on user-colored time items. | `index.css`, `TimeManagementPage.tsx` |
| Mailbox "Trust domain" chip pulses in warning tokens (`border-warning-muted bg-warning-subtle text-warning animate-pulse motion-reduce:animate-none`) on a raw `<button>` | `StatusBadge` / no attention loop on chips | Marks an UNVERIFIED email source whose HTML is not yet trusted; a temporary attention loop that ends once the domain is trusted. The user explicitly wants the pulse and the distinct color. | `Code/apps/web/src/pages/MailboxPage.tsx` thread message header |
| Layout mobile nav menus use local literals (alt) | overlay tiers | `z-30` click-catcher (`bg-black/20`) and `z-40` dropdown, positioned inside the nav's own stacking context, so they only need to order against each other. | `Code/apps/web/src/components/Layout.tsx` mobile menu and mobile account menu |
| Lightbox scrim `LIGHTBOX_SCRIM` = `bg-black/80 backdrop-blur-xs` (alt) | `OVERLAY_SCRIM.focusModal` (`bg-black/45 backdrop-blur-xs`) | Media scrim: darker than the form scrims so the image reads as the only content; `OVERLAY_SCRIM` has no media entry yet. Layer, focus and Escape still come from `useModalSurface` on the `focusModal` tier. | `Code/apps/web/src/components/ui/Lightbox.tsx` (used by `Code/apps/web/src/components/FeedbackSidePanel.tsx`, `Code/apps/web/src/pages/FeedbackPage.tsx`) |

### Accent consolidations (Mailbox)

Two ad hoc hues in Mailbox were standing in for concepts the token system
already had, so they were folded in rather than registered as deviations:

| Was | Now | Meaning |
|-----|-----|---------|
| purple / violet | `feature-ai` | AI-generated rules, suggestions, and matches |
| sky | `info` | Informational chips, hints, and notices |

Feature accents gained `-subtle` (12% alpha) and `-muted` (28% alpha) variants
so an accent can tint a surface without defining its own CSS variables.

## Remaining raw palette classes

After the token sweep, raw palette remains only for the data and brand
exceptions recorded above (list in `color-system`). Do not infer that a
remaining palette class is approved; if it is not recorded here, it is drift.
