# Design System

How the Coordination Manager web app looks, moves, and speaks -- and, just as
important, how we describe those things to each other. The app grew feature by
feature, so the same idea (a primary button, a status badge, a modal, a
slide-in panel) exists in a few slightly different forms. This page names the
pieces, records the **default** version to reach for, and maps colors and motion
to meaning, so new screens reuse what already exists instead of adding another
variant.

The full machine-readable version lives in the repository under
`.claude/skills/design-system/`; this page is the human summary.

## The idea in one line

**Pick components, colors, and motion by meaning -- not by taste -- and default
to the versions we already built.**

## Styling runtime and browser support

The web and docs apps use Tailwind CSS 4 through `@tailwindcss/postcss`.
Supported browsers are Safari 16.4+, Chrome 111+, and Firefox 128+.
The migration removes Tailwind 3's transitive `braces` dependency, affected by
GHSA-vfj7-8cjw-p6xm; the security audit remains enabled without an exception.

Web theme bindings and radii live in
`Code/apps/web/src/theme-tokens.css`, imported by both apps so nested design
catalog previews resolve their local HSL variables correctly. Web animations
live in `Code/apps/web/src/index.css`. The docs palette and animations retain
their legacy configuration in `Code/apps/docs/tailwind.config.ts`, loaded by
`@config`. Content scanning is explicit, including shared web recipes in docs.

Keep class-based dark mode and runtime theme variables. Tailwind 4 utility
renames such as `shadow-sm` -> `shadow-xs` and `outline-none` ->
`outline-hidden` preserve the previous visual intent. The custom `rounded-sm`
radius keeps its original name and value.

## Four namespaces

Every color belongs to exactly one of these, which answers "can a theme change
this?" and "does this mean something?":

| Namespace | Owns | Theme-overridable |
|-----------|------|-------------------|
| Structural | surfaces, text, borders, focus ring | yes |
| Semantic | interaction and outcome state | `primary` yes; the rest no |
| Feature identity | which area of the app you are in | no |
| Data / category | quantity, intensity, user-chosen category | categories are user-chosen |

## Colors carry meaning

Color communicates state, hierarchy, or feature identity. It is not decoration.
Choose a role first; the design system owns the hue behind that role.

### Semantic colors: what is happening?

Semantic colors are deliberately small and universal:

| Role | Color | Used for |
|------|-------|----------|
| `primary` | the active theme's color | Primary actions, selected states, links |
| `info` | blue (locked) | Informational messages |
| `success` | green (locked) | Success, completed, confirmed |
| `warning` | amber (locked) | Warning, attention, needs input |
| `danger` | red (locked) | Error, destructive action, failure |
| `neutral` | slate (locked) | Inactive, off, skipped, disabled, secondary |

Emerald folds into success, rose into danger, and orange into warning. Yellow
in-progress states become primary or neutral. Indigo tags and cyan setup states
are categories or accents, not semantic states.

### Primary has no color of its own

**`primary` is not blue.** It is whatever theme is active. The base light
tokens resolve it to near-black and the base dark tokens to near-white, and
the presets make it green, rose, amber, teal, and more. New users start in
dark mode with the Forest preset, so their primary is green until they pick
another theme from the theme quick picker in the account menu.

Three things follow, and they are not optional:

- **No component is ever a fixed hue.** There is no blue button, green button,
  or indigo button. A control that needs emphasis uses `primary`.
- **Selection never relies on color alone.** Under a green theme, primary and
  success look alike, so every selected state also carries a state attribute, a
  check marker, or a border change.
- **Success, warning, danger, info, and neutral are locked**, so a green theme
  cannot turn danger green.

Because a screen has at most one primary action, buttons default to `neutral`:
emphasis has to be asked for.

#### Forest coordination calendar

In dark Forest, empty in-range coordination calendar slots use an opaque neutral
surface inspired by Archived calendar styling, with a subtle neutral hover cue.
This avoids competing with the fixed green availability colors. This empty-slot
adjustment is Forest-only; other themes keep their existing empty-slot surfaces.

#### Guest onboarding guidance

The availability-selection hint on every `/join/:hash` page uses an opaque
`muted` surface with `foreground` text, on both desktop and mobile. Keep these
structural colors theme-aware instead of pairing an accent background with
fixed purple text. Built-in theme pairs must meet 4.5:1 contrast for normal text.

#### Coordination calendar busy overlay

All light, dark, preset, and custom themes use 14 adjacent filled diagonal blocks
per busy time-slot cell, based on the approved Sunday comparison sample.
Blocks have identical width and slant, including the ends. Small neutral corner
triangles keep edge shapes whole, and 40% fill opacity preserves the underlying
availability colors. The block count stays fixed as columns resize.

Dark Forest retains the approved teal / charcoal pair. Other themes blend primary
with muted foreground in dark mode or background in light mode for a subdued
theme tint, and use a neutral companion
blended toward background in dark mode or foreground in light mode. CSS theme
variables keep these colors synchronized with presets and custom theme edits.
The fixed selection/availability colors, meeting indicators, and busy data are
unchanged. The weekday preview and legend have been removed; old
`busy-preview=weekdays` query parameters no longer affect rendering.

### Feature accents: what area am I in?

Feature identity is a separate `FeatureAccent` concept:

| Feature | Accent |
|---------|--------|
| AI | violet |
| Chat | sky |
| Support | blue |
| Feedback | amber |
| Commons | rose (current token; review because it sits near danger) |

**Semantic meaning overrides feature identity.** An AI delete button and AI
error badge use danger, not violet. Violet can remain on the panel icon,
heading accent, or border.

The Coordination Calendar quick-button row has a scoped theme-tinted recipe:
primary-subtle when idle, primary-muted when selected, foreground text, and a
primary border/ring and `aria-pressed` for selection, without an added check marker. This does not change pins,
shared toggles, other navigation, or theme foreground configuration.
Oversight and User List use ordinary Tools menu styling. The Coordinate Events
Commons opener is an ordinary tool, not a danger action.
Distribute's AI Context header uses an AI tint rather than the theme accent;
the expanded text field uses neutral card/border tokens.

Guardian, Platform Oversight, and User List are pinnable navigation shortcuts.
Admin shortcuts are only shown when their existing menu visibility rules permit
access, while hidden preferences stay saved.
The calendar invite-copy notification uses a neutral card surface and explicit
card foreground text with a success icon; other notifications are unchanged.

### Status badges

Status chips follow one recipe -- a soft tinted background, a matching text
color, and a leading icon:

```
inline-flex items-center gap-1  rounded  px-2 py-0.5  text-xs font-medium
bg-{status}-subtle  text-{status}  border-{status}-muted
```

Use this status vocabulary rather than inventing feature-specific colors:

| Status | Meaning | Semantic color |
|--------|---------|----------------|
| `neutral` | No active state | neutral |
| `info` | Informational | info |
| `pending` | Waiting for something | warning |
| `active` | Currently happening | primary |
| `success` | Finished successfully | success |
| `warning` | Requires attention | warning |
| `error` | Failed or problematic | danger |

Domain labels map onto these statuses: Draft and Skipped are `neutral`; Sending,
Processing, and Running are `active`; Pending and Needs input are `pending`;
Done, Completed, and Subscribed are `success`; Failed, Rejected, and
Disconnected are `error`. The interface may display the domain label while the
component receives the normalized tone, such as `tone="success"`.

## Surfaces use theme tokens

Everything structural -- page and card surfaces, text, borders, focus rings --
is written with theme tokens (`bg-background`, `bg-card`, `text-foreground`,
`border-border`, `ring-ring`) so light mode, dark mode, and user color overlays
all work automatically. Semantic colors use tokens too, such as
`bg-success-subtle`, `text-success`, and `border-success-muted`.

**Never choose a Tailwind palette color directly. Choose a semantic,
structural, or feature-accent token.** The token mapping owns contrast in every
theme and can be corrected centrally.

### When not to use color

- Ordinary cards do not get random colored borders.
- Tags do not get random hues unless their categories define an intentional palette.
- Icons inherit foreground color unless they communicate state.
- Headings do not become colored merely to make a screen more interesting.
- A component normally has one meaningful accent, not several.

### Interaction states

Every interactive component defines Default, Hover, Pressed, Focus, Disabled,
Loading, and Selected states. Hover strengthens the existing surface or accent;
it never introduces a new hue. Disabled components become neutral rather than
retaining semantic emphasis. Selected uses the active theme's `primary` token,
never a fixed hue, and must not be styled as success. Selection also has a
non-color state signal.

Tokens are HSL variables; dark mode is a class on the root element, and users
can overlay up to three custom color themes on top. Radius derives from a single
variable, body text is Inter, code is JetBrains Mono, and the base font size is
raised so the whole UI reads slightly larger than stock.

## Motion carries meaning

Motion is classified by purpose, not by whether it loops: a **transition** moves
between two states, **progress** reports genuine in-progress work, a
**confirmation** acknowledges something happened and then settles, and
**attention** asks the user to act.

Every loop belongs to one of three classes, each with its own reduced-motion
behavior:

- **Loading and progress** loops (spinners, indeterminate bars, the
  thread-edge pulse, the border traces including the mailbox email-card
  loading trace) run while the work runs. Under the reader's reduced-motion
  preference they keep running, only slower, because they are the feedback.
- **Temporary attention** loops (the meeting being edited, the subscribe
  glow, the weeks still to mark, the new-friend pill) loop only while that
  state lasts. Under reduced motion they hold a static highlighted frame.
- **Ambient decoration** stays calm: the today ripple plays once, and slow
  gradient drifts such as the AI assistant button stop under reduced motion.

Several loops may share a screen when each one maps to a live state. Routine
state with nothing pending, such as an attachment being present, is a static
indicator, not a pulse. Tab navigation has a signature "thread wave" that
travels to the newly selected tab. New animations must add the reduced-motion
path of their class.

Feedback picks its channel by how long the message must stay reachable: inline
text for field errors, a banner for persistent page conditions, and a toast for
transient acknowledgements. Errors do not auto-dismiss, because important
information must never depend on a message the user may not have seen.

## Components: reach for the default

Common UI has one shared implementation each, in `components/ui/`. New and
touched screens use them; older screens are still migrating:

- **Buttons** are a `Button` primitive with three independent dimensions:
  emphasis (solid, outline, ghost), intent (primary, neutral, danger), and size.
  There is deliberately no blue, green, or indigo variant, so a hue cannot be
  reintroduced by copying a recipe. `IconButton` adds a required accessible
  name and a consistent hit area.
- **Whole-card switch:** `Switch variant="card"` makes a single setting's
  label, description, padding, and track one keyboard-accessible toggle.
  Hover/focus highlights the card and rotates a trace around the track outline;
  reduced motion keeps a static outline. `cardTone="warning"` matches warning
  headers (used by Hidden mode); the default is primary. Use non-interactive children and
  `aria-describedby` for supporting text. The default switch is unchanged.
- **Selection controls** split by behavior: `Switch` for an immediate on/off
  setting, `ToggleButton` for a pressed toolbar mode, `SegmentedControl` for a
  mutually exclusive choice, tabs for switching content. They share tokens but
  not ARIA roles. A switch that is off is neutral, never red.
- **Badges** split by what the information is: `StatusBadge` for state,
  `CategoryTag` for classification, `CountBadge` for quantity, and
  `ScoreDisplay` for a measured value. Only status is colored by state -- a
  count of five is not five problems.
- **Cards** are a bordered `card` surface; an elevated variant adds a shadow.
- **Dialogs** share one `Dialog` shell that owns the scrim, layer, Escape,
  focus return, focus trap, and scroll lock. `ConfirmDialog` handles yes/no,
  `ChoiceDialog` handles three or more outcomes. `Lightbox` is the full-screen
  image preview; it shares the same modal behavior with `Dialog` and sits on
  the focus-modal layer with a darker media scrim.
- **Toasts** are transient notifications; errors do not auto-dismiss, and a
  **banner** is used when a message should persist.
- **Tabs** reuse the shared animated tab bar so the thread-wave stays
  consistent.
- **Side panels** slide in from the edge with their signature accent border, and
  only one is open at a time.

The repository matrix lists, for every component, the default, the
alternatives, the signature color, the motion, and the source file.

The Component Catalog labels each preview as either a web primitive or a recipe
snapshot. A snapshot documents existing markup; it is not evidence that the
rendered recipe is the live implementation. Entries also show their color
namespace and, for drift, the recommended replacement.

## Overlays stack by context, not by number

Overlays claim a **named layer** rather than a hand-picked z-index. The kind
sets a floor -- drawers, then dialogs, then focus modals, then toasts -- and the
current stack does the rest, so a dialog opened from an editor automatically
lands above it. No new overlay ever needs a bigger number than the last one.

Scrims range from a light tint for simple decisions to a blurred tint for focus
modals. Toasts always sit above modals and never take focus.

## Deviating on purpose

Unifying is not meant to freeze the UI. It is meant to make the next deviation
a decision instead of an accident.

Use the default. If it genuinely does not fit, use something else **and record
why** in the component matrix. A deviation with a recorded reason is a
documented alternative; a deviation without one is drift, and drift is a bug.

## Page Anatomy and Density

Until shared page-composition components exist, treat these as review rules:

| Pattern | Contract |
|---------|----------|
| Page header | Title, optional description, at most one primary action |
| Section | Related heading/content; not automatically a card |
| Card | Bounded surface only when the boundary carries meaning |
| Toolbar | Related filters/actions with stable control height |
| Form field | Label, control, help, and validation kept together |
| Stat display | Quantity/score stays distinct from workflow status |

Standard density is the default. Compact density is for genuinely dense
surfaces such as mailbox tables and calendar grids: reduce gaps and control
padding, not label text. `PageHeader`, `Section`, `Toolbar`, `FormField`, and
`StatCard` are not shipped primitives yet.

## How we describe a change

When we propose a UI or UX change, we name each element with the shared
vocabulary, state which default variant, color, and motion it reuses, list
anything genuinely new it must add, and note how it will be validated.
Validation uses Playwright to capture the semantic structure and a screenshot of
the changed area in both light and dark themes, so intended changes are obvious
and accidental drift is caught. The design-system skill is active guidance for
every UI change: changes that only compose existing primitives and tokens are
implemented directly, while new tokens, variants, or animations are proposed for
review first.

## This docs site

The documentation site you are reading has its own visual system -- an indigo
brand scale and a slate surface scale -- separate from the web app's tokens,
though it follows the same "meaning over taste" philosophy.
