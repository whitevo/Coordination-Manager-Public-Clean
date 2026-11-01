# Motion Catalog

## Contents

- Purposes and the three loop classes
- Reduced motion (required)
- Animation matrix (`@theme` utilities)
- Plugin and Tailwind built-ins
- Hand-written effects in index.css
- Feedback channels
- Border trace effect (index.css-owned)
- Tab navigation effect (component-owned)
- Transitions (baseline)
- Reuse rules

## Purposes and the three loop classes

Motion carries meaning here too. Classify by **purpose**:

| Purpose | What it does | Duration |
|---------|--------------|----------|
| `transition` | moves between two states | one-shot, < 400ms |
| `progress` | reports genuine in-progress work (loading) | loops while the work runs |
| `confirmation` | acknowledges something happened | one-shot, settles |
| `attention` | asks the user to act on a temporary state | loops while the state lasts |
| `ambient` | decoration with no state behind it | calm; stops under reduced motion |

Every **loop** belongs to exactly one of three classes. This is the user's
explicit policy (2026-10-18); it replaces the old "one looping attention
signal per screen" budget, so several loops may coexist when each one maps to
a live state.

| Loop class | Normal | Reduced motion | Examples in code |
|------------|--------|----------------|------------------|
| **Loading / progress** | loops while the work runs | **keeps running**, at most slowed; never stopped | `animate-spin`, `mailbox-filter-highlight-trace` (also the email-card loading border while a message opens), `animate-cyan-trace`, Mailbox list skeleton and `isSearchComputing` search pulse (`animate-pulse motion-reduce:[animation-duration:3s]`), Mailbox `RefreshCw` sync spinners (`motion-reduce:[animation-duration:2s]`) |
| **Temporary attention** | loops only while the state lasts, then stops | holds a **static highlighted frame** (no loop) | `editing-meeting-card` / `-cell` (meeting being edited), `animate-subscribe-attention` (not subscribed), `animate-unmarked-pulse` (weeks still to mark), `Layout` new-friend pill (`animate-pulse motion-reduce:animate-none` on `bg-primary-subtle text-primary border-primary-muted`), Mailbox `createTagHighlight` / `mailboxSettingsHighlight` (primary ring or primary intent kept), analytics `primary-pulse` (solid primary kept), Mailbox "Trust domain" chip (unverified email source; `animate-pulse motion-reduce:animate-none` on warning tokens, recorded alt) |
| **Ambient decoration** | calm: plays once or drifts slowly | stops | `today-col-header` ripple (plays once), `ai-assistant-btn` color cycle |

A loop with no live state behind it (an attachment merely existing, "this
page is nice") is not attention: make it static or ambient. Attention loops
use existing tokens and keyframes (primary, warning, info); do not invent a
new hue for a pulse.

Registry: `@theme inline` animation utilities and hand-written keyframes in
`Code/apps/web/src/index.css` (the web app has no `tailwind.config.ts`).

## Reduced motion (required)

Every animation you add or reuse needs a reduced-motion path that matches its
loop class: loading keeps moving (slower), temporary attention holds a static
highlighted frame, ambient stops. The static frame must still show the state
(a highlight becomes a static outline or glow, not nothing).

`index.css` ends with one consolidated `@media (prefers-reduced-motion:
reduce)` block (unlayered, so it wins over Tailwind utilities). It holds a
static frame for the temporary attention loops (`animate-subscribe-attention`,
`editing-meeting-card`, `editing-meeting-cell`, `animate-unmarked-pulse`),
stops `.time-item-resize-handle[data-resize-active]`, and stops ambient
decoration (`ai-assistant-btn`, `today-col-header`). Loading
loops are deliberately **not** in it: `animate-cyan-trace` (6s -> 12s) and
`mailbox-filter-highlight-trace` (1.1s -> 2.2s) slow down in their own
blocks. Effects with their own block (`flow*`, `tab-thread`, `feedback-*`,
`tools-reveal`, `design-catalog`) are not repeated there.

Tailwind classes applied in TSX (`animate-pulse`, `animate-bounce`,
`animate-spin`, `animate-in`, arbitrary `animate-[...]`) and the one-shot
entrances are **not** covered by that block: add the path at the call site.

| Where the motion lives | Recipe |
|------------------------|--------|
| Tailwind class in TSX | temporary attention: `motion-reduce:animate-none` with the highlight classes still applied (the new-friend pill); ambient/one-shot: `motion-reduce:animate-none` or `motion-safe:`; loading: leave it running or slow it (`motion-reduce:[animation-duration:3s]`) |
| Keyframe/class in `index.css` | attention: add the class to the consolidated block with a static frame; ambient: add it to the ambient list there; loading: its own block that only raises `animation-duration` |
| JS-driven motion (WAAPI, timers) | check `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and commit the end state immediately, as `useListPresence` does |

Existing examples with a path: `tools-reveal-highlight`,
`design-catalog-highlight`, `home-flow-*`, `feedback-*`, `animate-cyan-trace`,
`mailbox-filter-highlight-trace`, `AnimatedTabBar` thread wave,
`useListPresence`, the `Layout` new-friend pill. Verify with
`page.emulateMedia({ reducedMotion: 'reduce' })` (see `workflow`).

## Animation matrix (`@theme` utilities)

| Utility | Loop class / purpose | Reduced motion | Where it is used today | Reuse it for |
|---------|----------------------|----------------|------------------------|--------------|
| `animate-unmarked-pulse` (warning tokens) | temporary attention | static warning border + glow | previous/next week navigation buttons in `Code/apps/web/src/pages/CalendarPage.tsx` while those weeks have slots to mark | Something awaiting the user that goes away when done |
| `animate-spin-once` | transition | one-shot | globe in `Code/apps/web/src/components/TimezoneSelector.tsx` | One-shot rotate on toggle/refresh |
| `animate-fade-in-out` | confirmation | one-shot | ephemeral notice in `Code/apps/web/src/pages/SetupPage.tsx` | Auto-dismissing status that self-removes |

## Plugin and Tailwind built-ins

| Classes | Purpose | Notes |
|---------|---------|-------|
| `animate-in fade-in slide-in-from-{top,bottom}-N zoom-in-95 duration-N` (`tailwindcss-animate`, `@plugin` in index.css) | transition | Default entrance for menus, popovers, inline reveals (e.g. `TimezoneSearchPanel`, `time-management-markdown-composer`). One-shot; still add `motion-reduce:animate-none`. |
| `animate-spin` | loading | Spinners only while work runs (`Button`/`IconButton` `loading` uses it on `Loader2`); keeps running under reduced motion, optionally slowed (`motion-reduce:[animation-duration:2s]` on Mailbox `RefreshCw`). |
| `animate-pulse` | loading or temporary attention | Loading skeletons and in-progress pulses keep pulsing, slowed (`motion-reduce:[animation-duration:3s]`: Mailbox list skeleton, `isSearchComputing`); a temporary attention pulse uses `motion-reduce:animate-none` with the highlight still applied (`Layout` new-friend pill, `createTagHighlight`, `mailboxSettingsHighlight`). |
| `animate-bounce` | loading | Typing dots in `AiChatPage` while a reply streams; not for attention. |

## Hand-written effects in index.css

| Class | Purpose | Loop | Used in | Reduced-motion path |
|-------|---------|------|---------|---------------------|
| `animate-slide-in-right` | transition | no (0.3s) | `Toast.tsx` entry | no |
| `animate-fade-in-up` | transition | no (0.7s) | `HomePage` hero; CalendarPage not-selectable popup | no |
| `animate-calendar-quick-add` | confirmation | no (1.45s) | quick tool just added: `Layout.tsx` nav, `CalendarPage` quick row | no |
| `animate-confetti` | confirmation | no (3.5s) | `GuestBookingPage` | no |
| `landscape-tip` (slideDown) | transition | no | CalendarPage landscape hint | no |
| `section-highlight`, `section-spark-*` | confirmation | no | `SettingsPage` deep-link/section jump: a text-gradient shine, applied only to the section heading (`h2`/`h3`) or an element marked `data-section-heading`, never a whole block (it clips buttons and icons) | no |
| `feedback-status-flash`, `-step-pop`, `-card-exit`, `-card-enter` | transition/confirmation | no | `FeedbackPage` | yes |
| `home-flow-*` | ambient | yes | `HomePage` backdrop | yes |
| `design-catalog-highlight` | attention | yes | `DesignCatalogHighlighter` (dev aid) | yes |
| `today-col-header` (todayRipple 2.4s) | ambient | no (plays once on arrival; the solid primary header is the static signal) | CalendarPage today header | yes (stops) |
| `animate-subscribe-attention` (subscribe-glow 3s, warning) | temporary attention | yes, while the calendar is not subscribed | CalendarPage subscribe button | yes (static warning glow) |
| `editing-meeting-card` (1.8s, info) / `editing-meeting-cell` (1.5s, recorded meeting-selection blue) | temporary attention | yes, while a meeting is being edited | CalendarPage meeting card and grid cells | yes (static highlighted frame) |
| `ai-assistant-btn` (aiColorCycle 36s) | ambient | yes | `AnnouncementsPage` | yes (stops) |
| `.time-item-resize-handle[data-resize-active]` | progress | yes, while resizing | `TimeManagementPage` | yes (stops) |

The `primary-pulse` keyframe (`hsl(var(--primary))` ring)
has no theme utility; it runs only as
`animate-[primary-pulse_1s_ease-in-out_3] motion-reduce:animate-none` on the
MailboxPage analytics button (temporary attention, 3 runs; the solid primary
intent is the static frame).

## Feedback channels

### Newly revealed tools

`tools-reveal-highlight` is a one-shot confirmation cue for mobile Time Management
full-view tools. It uses the active theme's primary token: an 8% area wash and
12% inset button wash, held for 1.2s then faded out by 2s. It does not replace
the separate expansion animation or change layout. The component removes the
class after 2s and clears its timer on close/unmount. Reduced motion uses a
static wash for the same interval. Guiding and existing fields are unaffected.

Motion is not the only signal, and often the wrong one. Pick the channel by how
long the message must stay reachable:

| Channel | For | Lifetime |
|---------|-----|----------|
| Inline text | field validation errors | until fixed |
| `Banner` | persistent page conditions | until resolved |
| `Toast` | transient acknowledgements | 4s (errors: manual dismiss) |
| Static indicator | routine state with no action pending, e.g. an attachment is present | until state changes |
| Temporary attention loop | a temporary state that needs the user, e.g. an unsaved draft | loops until the state ends; static frame under reduced motion |

Important information must never depend only on a disappearing toast.

## Border trace effect (index.css-owned)

A conic-gradient "light" that spins around a field's border via a `::before`
overlay (`@property` angle custom property + `mask-composite: exclude`), rather
than a flat pulse. Defined directly in `Code/apps/web/src/index.css` since it
needs the `@property`/mask plumbing. Both are **loading/progress** loops: under
`prefers-reduced-motion` they keep running at half speed (cyan 6s -> 12s,
mailbox 1.1s -> 2.2s), never stopped.

| Class | Signal | Where it is used today | Reuse it for |
|-------|--------|------------------------|--------------|
| `animate-cyan-trace` | active-state progress cue | `hsl(var(--info))` sweep, 6s loop, on the selected option (`bg-info-subtle text-info border-info`) of the `accent="cyan"` toggle group in `Code/apps/web/src/pages/SetupPage.tsx` | A calm, ongoing "this is available" cue |
| `mailbox-filter-highlight-trace` (primary) | "your search text / date range still applies to this new filter or sort" | search bar + Date From/To fields in `Code/apps/web/src/pages/MailboxPage.tsx`, triggered by `selectCustomFilter`/`updateCustomFilterSort`/`makeFilterPrimary`; the trace spins every 1.1s and the highlight window is `MAILBOX_ADDITIONAL_FILTERS_HIGHLIGHT_MS` (6s), only when the field is non-empty. Also the email-card loading border while a message opens (`isOpeningMailboxMessage`, with an sr-only "Loading email details..." status) | Confirming an existing input still applies after a sibling control changes |

## Tab navigation effect (component-owned)

The signature "thread wave" that travels to a newly selected tab is not a
utility -- it lives in
`Code/apps/web/src/components/AnimatedTabBar.tsx`
with constants `TAB_TRAVEL_MS = 1100`, `TAB_SEQUENCE_MS = 2000`,
`TAB_FADE_OUT_MS = 600`, disabled under reduced motion. Reuse `AnimatedTabBar`
for any primary tab strip so this effect stays consistent (it is covered by
`Code/apps/web/e2e/mailbox-tab-animation.spec.ts`).

## Transitions (baseline)

- `Switch variant="card"`: temporary attention while hovered or keyboard-focused;
  `.switch-card-trace::before` uses a masked conic-gradient border with
  `switch-card-trace-spin` (2s). Color follows the card tone (primary or warning).
  Reduced motion keeps a full static outline and disables card/track/thumb
  transitions. This interaction cue is not a loading indicator.
- Collection exit: the shared hook `useListPresence`
  (`Code/apps/web/src/hooks/use-list-presence.ts`, defaults 150ms exit / 180ms
  reflow) keeps presentation-only ghosts, exits a batch concurrently, then
  reflows survivors; reduced motion commits immediately. Its only consumer is
  `FeedbackPage` (300ms exit / 350ms move, `feedback-list-motion.ts`). Mailbox
  rows use their own constants in `MailboxPage.tsx` (160ms fade, collapse
  after 120ms for 220ms). Use the hook for a new animated list.
- Ghosts are inert and never cached or counted as domain entities. Completion reads current presentation state, not a captured semantic list.
- Calendar pointer-follow remains a separate policy. Reuse ownership and tokens across surfaces, not identical choreography.
- Meeting date/time editor: `.meeting-editor-control` reuses the Switch card border
  trace on both the entry area and its related picker trigger when either is
  hovered or focused (`.meeting-editor-pair`). Date and Time are separate pairs. It is a
  temporary interaction cue, not loading; reduced motion holds a static outline.
- Color/theme transitions: `transition-colors` (buttons, links, hovers).
- Panel width/slide: `transition-[width,transform,opacity] duration-300 ease-out`.
- Progress bars: `transition-[width] duration-700 ease-out`.
- Global theme swap: 0.3s ease on `background-color`/`color`/`border-color`
  (set in `index.css`).

## Reuse rules

- Match the **purpose**, not the look: do not use a one-shot for an ongoing
  state, and keep decoration calm (once or a slow drift).
- Name the loop class (loading, temporary attention, ambient) before adding a
  loop. Only ambient decoration may loop without a live state behind it, and
  it must stay calm.
- Every new loop needs the reduced-motion behavior of its class (loading
  slows, attention holds a static frame, ambient stops).
- Prefer an existing utility over a new keyframe; add a keyframe only when no
  existing purpose fits, register it in `index.css` with its reduced-motion
  block, and add it to this catalog. A new keyframe is a visual mutation
  (see `workflow`).
