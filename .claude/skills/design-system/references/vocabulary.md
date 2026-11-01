# Canonical Vocabulary

The semantic contract for the web app. A canonical concept is stable; the
implementation (Tailwind recipe or component file) is replaceable.

## Canonical Component Types

| Canonical type | What it is | Binding in this repo |
|----------------|------------|----------------------|
| `Button` | Single action trigger | `Code/apps/web/src/components/ui/Button.tsx` (and `IconButton.tsx`); see component-matrix |
| `Link` | Navigation to a route/URL | `react-router-dom` `Link` / `NavLink` |
| `Card` | Self-contained bordered surface grouping related content | Recipe: `bg-card text-card-foreground rounded-lg border border-border` |
| `Dialog` | Modal overlay requiring a decision | `Code/apps/web/src/components/ui/Dialog.tsx` (shell); `ConfirmDialog.tsx` and `ui/ChoiceDialog.tsx` are compositions |
| `Toast` | Transient status notification | `Code/apps/web/src/components/Toast.tsx` |
| `Tabs` | Mutually exclusive views of one region | `Code/apps/web/src/components/AnimatedTabBar.tsx` |
| `SidePanel` | Sliding contextual panel beside content | `ChatSidePanel`, `FeedbackSidePanel`, `SupportSidePanel`, `CommonsSidePanel`, `AiGuideSidePanel`, `MeetingSidePanel` (see `side-panel-design` skill) |
| `Popover` | Non-blocking floating surface anchored to a trigger (menu, dropdown, tooltip) | Recipe + `popover`/`tooltip` layer; see `overlays-and-layers` |
| `Banner` | Persistent inline status strip | Recipe; `Code/apps/web/src/components/FeatureDisabledBanner.tsx` is the one shared instance |
| `Field` | Labeled form control (label + input + helper) | Tailwind recipes in pages; native inputs use `border-input` token |
| `Status` | Point-in-time state badge (text/color) | `Code/apps/web/src/components/ui/StatusBadge.tsx` |
| `Metric` | Single prominent numeric/statistic display | `GuardianTimeSeries`, `GuardianActionTimeSeries`, `CountBadge`, `ScoreDisplay` (ui/) |
| `Grid` | Dense data matrix | `Code/apps/web/src/components/SentimentGrid.tsx`, `Code/apps/web/src/components/ColorGridPicker.tsx` |
| `Description` | Supporting prose under a title | `text-sm text-muted-foreground` recipe |
| `Metadata` | Key/value facts about an entity | Inline `dl`-style recipes in pages |
| `Icon` | Decorative/signaling glyph | `lucide-react`; color forced by `.lucide { color: hsl(var(--icon)) }` |

## Normalization Rules

The human prompt may use casual words; machine-readable proposals must emit the
canonical form.

| Incoming word | Canonical rule |
|---------------|----------------|
| `Desc` | Normalize to `Description`. Never emit `Desc` in contracts. |
| `CTA` | An intent, not a component. Resolve to `Button` or `Link` by behavior. |
| `Panel` | Resolve to `SidePanel`, `Card`, `TabPanel`, or `Banner`. Never emit bare `Panel`. |
| `Tile` | Resolve to `Card` only if it matches Card semantics; otherwise unresolved -- ask. |
| `Box` / `Container` | Layout primitives, not canonical components. Do not emit. |
| `Info` | Forbidden as a leaf type. Resolve to `Metadata`, `Metric`, `Status`, `Description`, or `Banner`. |
| `Label` | Resolve by context: form label, button text, data key, or `Status`. |
| `Active` | Never assume. Use the precise interaction state below. |
| `Popup` / `Modal` | Resolve to `Dialog` (blocking), `SidePanel` (non-blocking, beside content), or `Popover` (non-blocking, anchored). |
| `Menu` / `Dropdown` / `Tooltip` | Resolve to `Popover`. |
| `Notification` | Resolve to `Toast` (transient) or `Banner` (persistent). |

## State Vocabulary

Never use one generic `active` boolean. Two separate axes:

```yaml
interaction_states:
  - default
  - hover
  - focus-visible
  - active        # transient activation, e.g. pointer down
  - selected      # member chosen from a set (tabs, list items)
  - pressed       # toggle-button state
  - checked       # checkbox/radio/switch value
  - expanded
  - collapsed
  - disabled
  - read-only

data_states:
  - loading
  - ready
  - empty
  - error
  - success
  - unavailable
```

Concrete bindings:

- `AnimatedTabBar` uses `selected` (ARIA tab semantics), never `pressed`.
- Theme preset buttons in `Code/apps/web/src/components/ThemeCreator.tsx`
  use `selected` (ring + check badge), not `active`.
- Toast `type` (`success` | `error` | `info`) is a data state, not an
  interaction state.

## Stable Logical IDs

Refer to UI entities by logical IDs independent of text and layout:
`mailbox.tab-bar`, `mailbox.tab.settings`, `settings.theme-creator`,
`calendar.availability-grid`. A title change ("Mailbox" -> "Inbox") must not
change the ID. Use these in proposals and in Playwright snapshot names.

## Governance Rules

1. Instantiating a canonical type is allowed in any page change.
2. Adding a NEW canonical type or synonym requires editing this file in the
   same proposal -- vocabulary changes are deliberately harder than page changes.
3. Renaming visible copy does not require vocabulary change; changing what a
   thing IS does.
4. The docs site (`Code/apps/docs`) has its own palette (brand/surface scales)
   and is out of scope for this vocabulary except as a consumer of the same
   governance rules.
