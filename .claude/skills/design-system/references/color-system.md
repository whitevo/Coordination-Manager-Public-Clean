# Color System

## Contents

- The four namespaces
- Semantic color meanings
- Danger vs destructive
- Primary has no hue
- The default emphasis is neutral
- Status badge -- the canonical recipe
- FeatureAccent map
- Theme surfaces -- always tokens, never raw
- When not to use color
- Interaction states
- Deviating on purpose
- Raw palette exceptions (data and brand only)
- Known drift to converge (do not copy forward)

Colors in this app carry **meaning**, not decoration. Choose a role first; the
design system owns the hue behind that role. Unrecorded raw palette classes are
drift, not examples to copy.

## The four namespaces

Every color in the app belongs to exactly one of these. Knowing which one you
are in answers "can a theme change this?" and "does this mean something?".

| Namespace | Owns | Theme-overridable | Source of truth |
|-----------|------|-------------------|-----------------|
| Structural | surfaces, text, borders, focus ring | yes | `--background`, `--card`, `--foreground`, `--border`, `--ring` |
| Semantic | interaction and outcome state | `primary` yes; the rest **no** | `--primary`, `--info`, `--success`, `--warning`, `--danger`, `--neutral` |
| Feature identity | which area of the app you are in | no | `--feature-ai`, `--feature-chat`, `--feature-support`, `--feature-feedback`, `--feature-commons` |
| Data / category | quantity, intensity, user-chosen category | no (categories are user-chosen) | availability scale, saved-slot gradient, category colors |

## Semantic color meanings

Keep the semantic layer small and universal:

| Role | Hue | Used for | Token examples |
|------|-----|----------|----------------|
| `primary` | **whatever the active theme defines** | Primary actions, selected states, links | `bg-primary`, `bg-primary-subtle`, `text-primary` |
| `info` | blue (locked) | Informational messages | `bg-info-subtle`, `text-info` |
| `success` | green (locked) | Success, completed, confirmed | `bg-success-subtle`, `text-success` |
| `warning` | amber (locked) | Warning, attention, needs input | `bg-warning-subtle`, `text-warning` |
| `danger` | red (locked) | Error, destructive action, failure | `bg-danger-subtle`, `text-danger` |
| `neutral` | slate (locked) | Inactive, off, skipped, disabled, secondary | `bg-neutral-subtle`, `text-neutral` |

Do not create semantic roles for nearby hues. Emerald maps to `success`, rose
to `danger`, orange to `warning`, sky/cyan to `info`, and yellow progress to
`primary` or `neutral`.

## Danger vs destructive

Two red token families exist. Use **`danger`** for every new or touched red:
`bg-danger text-danger-foreground` (solid), `bg-danger-subtle`, `text-danger`,
`border-danger-muted`. `Button intent="danger"`, `StatusBadge tone="error"`,
`ConfirmDialog` and Toast errors all resolve to `danger`.

`--destructive` / `--destructive-foreground` are legacy shadcn-era tokens with
different values (light `0 84% 60%`, dark a dim `0 62.8% 30.6%`) and no
`-subtle`/`-muted` companions. They remain in some older files; do not
use them in new code, and convert `*-destructive` to the matching `*-danger`
class when you already touch that element. Like the other semantic roles,
neither family is user-overridable.

## Primary has no hue

**`primary` is not blue.** It is whatever the active theme defines. The base
light tokens resolve it to `222 47% 11%` (near-black) and the base dark tokens
to `0 0% 98%` (near-white); the 12 presets in `theme-types.ts` set it to
green, rose, amber, teal, plum, and more. New users start in dark mode with
the Forest preset (`DEFAULT_DARK_THEME_ID`), so their primary is green
(`150 60% 40%`) until they pick another theme (see `tokens`).

Consequences that are not optional:

- **No component is ever a fixed hue.** There is no blue button, green button,
  or indigo button. If a control needs emphasis it uses `primary`.
- **Selection never relies on hue alone.** Under a green theme, `primary` and
  `success` look the same. Every selected state also carries `aria-pressed` /
  `aria-selected` / `aria-checked`, or a check marker, or a border change.
- **`success`/`warning`/`danger`/`info`/`neutral` are deliberately excluded
  from theme overlays**, so a green theme cannot make danger green.

`primary-subtle` (12% alpha) and `primary-muted` (28% alpha) are derived from
`--primary`, so selected surfaces follow a custom theme automatically.

The Coordination Calendar quick-button row uses primary-subtle idle surfaces
and primary-muted selected surfaces with foreground text, a primary border/ring,
and `aria-pressed`, without an added check marker. This is a scoped variant, not a global control restyle.
Pin controls and other navigation retain their existing theme behavior.
Oversight and User List are ordinary menu tools, not AI or danger states.
The Coordinate Events Commons opener also uses ordinary tool styling.

Distribute's AI Context header uses `feature-ai-subtle` with foreground text,
not `accent` (which can be green under Forest). Its expanded input uses neutral
card and border tokens.

## The default emphasis is neutral

A screen has at most one primary action. `Button` therefore defaults to
`intent="neutral"`: primary has to be asked for. Reaching for emphasis by
default is what produced the current spread of blue across the app.

## Status badge -- the canonical recipe

Use `StatusBadge` rather than hand-rolling a chip. Its recipe:

```
inline-flex items-center gap-1  rounded  px-2 py-0.5  text-xs font-medium
bg-{status}-subtle  text-{status}  border-{status}-muted
```

The mapping lives in `Code/apps/web/src/lib/design-tokens.ts` as an explicit
lookup. **Never build a Tailwind class by interpolating a runtime value**
(`bg-${tone}-subtle`) -- the JIT scanner cannot see it and purges the class.

Use this normalized vocabulary internally while preserving domain-specific
display labels:

| Status | Meaning | Semantic role |
|--------|---------|---------------|
| `neutral` | No active state | `neutral` |
| `info` | Informational | `info` |
| `pending` | Waiting for something | `warning` |
| `active` | Currently happening | `primary` |
| `success` | Finished successfully | `success` |
| `warning` | Requires attention | `warning` |
| `error` | Failed or problematic | `danger` |

Domain label conventions (callers keep showing their own label; only the
colour decision follows this mapping):

| Tone | Domain values |
|------|---------------|
| `neutral` | draft, skipped, composing, muted_bot, not_configured, opted_out, unsubscribed |
| `info` | invited |
| `pending` | pending, waiting, needs_input, scheduled |
| `active` | sending, processing, running, syncing |
| `success` | done, completed, sent, subscribed, synced |
| `error` | failed, rejected, disconnected, error |

Map a new domain value onto one of these tones at the call site rather than
inventing a new tone.
`STATUS_TONE_SOLID_CLASS` (same file) is the solid per-tone surface for
high-emphasis feedback such as toasts.

### Context matters more than the word

- A deliberate user opt-out (`opted_out`, `unsubscribed`) is `neutral`. The
  user chose it; it is not a failure.
- A failed delivery is `error`.
- Read-only is an **access property**, not a warning. Access and sync state are
  separate: `Read-only - Synced` is a valid, healthy combination.
- Distinguish `not configured`, `waiting`, `syncing`, `synced`, and `failed`.
  Not every unsynced state is red.

### Status is not the only kind of chip

| Component | Answers | Colored by |
|-----------|---------|------------|
| `StatusBadge` | what state is this in? | status tone |
| `CategoryTag` | what kind of thing is this? | category, or neutral |
| `CountBadge` | how many? | nothing (a count is not a state) |
| `ScoreDisplay` | how certain / how much? | nothing (the number carries it) |

A confidence percentage keeps its numeric meaning separately from whether the
match was applied; that execution state is a neighbouring `StatusBadge`.

## FeatureAccent map

Each Assistance panel has a `FeatureAccent` that matches its nav icon color in
`Code/apps/web/src/components/Layout.tsx` `ASSISTANCE_OPTIONS` (Commons has no entry there).
Keep this 1:1 -- the accent is how users tell the panels apart.

| Panel | Token | Source |
|-------|-------|--------|
| AI Assistant | `--feature-ai` (violet; nav icon only, panel border is neutral) | `Code/apps/web/src/components/AiGuideSidePanel.tsx` |
| Chat | `--feature-chat` (sky) | `Code/apps/web/src/components/ChatSidePanel.tsx` |
| Support | `--feature-support` (blue) | `Code/apps/web/src/components/SupportSidePanel.tsx` |
| Feedback | `--feature-feedback` (amber) | `Code/apps/web/src/components/FeedbackSidePanel.tsx` |
| Commons | `--feature-commons` (rose) | `Code/apps/web/src/components/CommonsSidePanel.tsx` |

Use `text-feature-*` / `border-feature-*` (plus `-subtle` / `-muted` tints).
The accent marks **identity**: the panel's left border, its nav/header icon,
and content that is identified as coming from that feature (for example
AI-generated rules, suggestions and matches use `feature-ai` /
`feature-ai-subtle`). It never marks an action's importance or a state: buttons
inside a panel use `Button` intents, and states use `StatusBadge` tones.

**Open question:** `--feature-commons` is rose, which is close to `danger`. It
is registered at its existing value so it is at least tokenized, but a Commons
panel accent that reads as "error" is worth revisiting.

A new contextual panel should claim a new signature hue and register it here.

**Semantic meaning overrides feature identity.** An AI delete button or error
badge uses `danger`, not violet. Feature accents belong on panel icons, heading
accents, borders, and other identity-bearing details.

## Theme surfaces -- always tokens, never raw

Structure (surfaces, text, borders) uses the **HSL token classes** so light/dark
and user theme overlays work: `bg-background`, `bg-card`, `bg-muted`,
`text-foreground`, `text-muted-foreground`, `border-border`, `border-input`,
`ring-ring`. See `tokens` for the full contract.

Semantic colors are tokens too. **Never choose a Tailwind palette color
directly. Choose a semantic, structural, or feature-accent token.** This keeps
contrast and theme changes centralized.

## When not to use color

- Ordinary cards do not get random colored borders.
- Tags do not get random hues unless their categories define a palette.
- Icons inherit foreground color unless they communicate state.
- Headings do not become colored merely for visual interest.
- A component normally has one meaningful accent, not several.

## Interaction states

Define Default, Hover, Pressed, Focus, Disabled, Loading, and Selected states.
Hover strengthens the existing surface or accent and never introduces a new
hue. Disabled components become neutral instead of retaining semantic emphasis.
Selected uses `primary`; it is not `success`.

**Off is `neutral`, never `danger`.** Turning a setting off is a choice, not an
error. The previous `off = bg-rose-300` switch recipe is removed, not an
alternative.

## Deviating on purpose

Use the default. If it genuinely does not fit, use something else **and record
why** in `component-matrix`. A deviation with a recorded reason is `alt`; a
deviation without one is `drift` and is a bug.

## Raw palette exceptions (data and brand only)

Raw palette was swept to tokens across `web/src`. The only raw colors left,
all recorded in component-matrix "Recorded deviations":

- Availability heatmap green scale (`getHeatmapColor`, CalendarPage and
  GuestBookingPage).
- Saved-availability purple scale (`getPurpleGradient`) and its tooltip
  legend dots in CalendarPage.
- CalendarPage meeting-selection `bg-blue-400` data layer (and its
  `editingMeetingCellPulse` blue in `index.css`).
- CalendarPage `suggestedColors` categorical series for suggested meetings.
- Chart series in the Mailbox analytics and PlatformOversight charts.
- Brand marks: Luma (orange-pink gradient, incl. the MeetingSidePanel Luma
  connect/publish buttons), Discord `#5865F2`, Outlook `#0078d4`, the Google
  logo; HomePage hero art (`.home-flow-*`).
- Current-time indicator red dot and line.
- User- or category-chosen inline colors (category tags, time sources,
  network colors, Discord role colors, the CoordinateEvents subscribed-meetings
  source `#8B5CF6`), and color pickers and palettes.
- Neutral plumbing: `rgba(0,0,0,a)` elevation shadows, mask colors, and the
  white resize-handle overlays on user-colored time items.

Anything else raw is drift.

## Known drift to converge (do not copy forward)

- A raw `<button>` outside the allowed categories (SKILL.md checklist item 2)
  -> `Button`, `IconButton`, `ToggleButton`, `SegmentedControl`.
- Any raw palette class outside the exceptions above -> `feature-ai-subtle`
  for AI meaning, `info` for sky hints, `CategoryTag` for role/category chips,
  `StatusBadge` for states.
- `*-destructive` classes -> `*-danger`.
