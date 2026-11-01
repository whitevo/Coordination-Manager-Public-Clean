---
name: design-system
description: Design system and UI/UX guidance for the Coordination Manager web app (Code/apps/web) - which component, variant, color token, motion, overlay layer and page pattern to use. Use when making any web UI change (new or changed component, page, button, badge, chip, color, animation, modal, dialog, drawer, popover, z-index) or when the user asks for a UI/UX review, design proposal or conformance check. Pairs with react-frontend, which covers how to code it (hooks, contexts, routing, data fetching).
---

# design-system

Active UI/UX guidance. This skill decides **what** to use (component, variant,
token, motion, layer); `react-frontend` covers **how** to code it. The code in
`Code/apps/web/src` is the source of truth: if a reference disagrees with it,
follow the code and fix the reference.

## Checklist for any UI change

1. **Name the pieces** with the vocabulary reference ("a Card with a warning
   StatusBadge and a primary Button").
2. **Use the primitives** from the `Code/apps/web/src/components/ui/` barrel
   (`index.ts`): `Button`, `IconButton`, `Switch`, `ToggleButton`,
   `SegmentedControl`, `Disclosure`, `StatusBadge`, `CategoryTag`,
   `CountBadge`, `ScoreDisplay`, `Dialog`, `ChoiceDialog`, `Lightbox`; plus
   `ConfirmDialog` (default export of `components/ConfirmDialog.tsx`).
   A raw `<button>` is allowed only for: list or menu rows, grid cells, drag
   or resize handles, scrims, inline text links, data- or brand-colored
   elements, `AnimatedTabBar` tab strips, and nav quick tools. Everything else
   uses a primitive. Defaults that are easy to get wrong:
   - `Button`: `emphasis="solid"`, `intent="neutral"`, `size="standard"`.
   - `IconButton`: `emphasis="ghost"`, `intent="neutral"`, `size="compact"`,
     `label` required (becomes `aria-label` and the tooltip).
   - `className` on a primitive is layout only (margin, flex, width, grid):
     `cn()` does not merge conflicting classes, so change visuals through
     `emphasis`, `intent` and `size`.
   - `ConfirmDialog`: `intent` is only `primary | danger` and **defaults to
     `danger`** with `confirmText="Delete"`. For a non-destructive confirm pass
     `intent="primary"` and a real `confirmText`.
   - `Dialog`: `kind="dialog"` (decisions, `size` default `sm`) or
     `"focusModal"` (content-heavy forms, default `2xl`); `dismissible`
     defaults to true; `showCloseButton`, `scrollBody`, `footer` and
     `initialFocusRef` cover what hand-rolled modals used to do.
   - `Lightbox`: full-screen image preview (`open`, `onClose`, `src`, `alt`,
     `title?`, `closeLabel?`, `className?`); shares `useModalSurface` with
     `Dialog` and sits on the `focusModal` tier.
3. **Pick colors by meaning** (color-system). `primary` has **no fixed hue**:
   the base tokens resolve it to near-black (light) / near-white (dark), new
   users start in dark mode with the Forest preset (green primary), and
   presets change it. Never use a Tailwind palette class (`bg-blue-600`).
   Red means `danger` tokens (`bg-danger`, `text-danger`, `bg-danger-subtle`);
   `destructive` is a legacy token, not for new code.
4. **Default to `intent="neutral"`.** One solid primary per view; secondary
   actions are outline primary or neutral. `success`/`info`/`warning`
   intents are only for status-bearing actions (component-matrix).
5. **Patterns**: on/off setting = `Switch`; collapsible section =
   `Disclosure`; tab strip that switches panels = `AnimatedTabBar`; pressed
   state = the subtle tint (`bg-primary-subtle`, as `ToggleButton` and
   `SegmentedControl` do); side-panel close (every panel, including
   `MeetingSidePanel`) = `IconButton label="Close"`.
6. **Layers** come from `Code/apps/web/src/lib/overlay-layers.ts`; never
   write a literal overlay z-index (`z-50`, `z-9999`) or pick a scrim by hand.
   Blocking: `Dialog`/`ConfirmDialog`/`ChoiceDialog`. Fixed or portaled
   popovers, tooltips and mobile drawers: `useOverlayLayer(kind, open)`
   (drawers add `OVERLAY_SCRIM.drawer`), and clamp a fixed popover's top with
   `clampTopBelowObstruction()` so it never sits under the nav. In-flow
   menus: `OVERLAY_LAYER_CLASS.popover`. Side panels and nav:
   `SHELL_LAYER_CLASS`. Toasts: `useToast()`.
7. **Motion by purpose** (motion). Every loop is one of three classes:
   **loading/progress** loops run while the work runs and only slow down under
   reduced motion; **temporary attention** loops run while the state lasts and
   hold a static highlighted frame under reduced motion; **ambient
   decoration** stays calm (plays once or drifts slowly) and stops under
   reduced motion. Every new or reused animation needs the reduced-motion path
   of its class (`motion-reduce:` in TSX or
   `@media (prefers-reduced-motion: reduce)` in `index.css`).
8. **Theme**: token classes (`bg-card`, `text-foreground`, `border-border`)
   flip under `.dark` automatically. Use `dark:` only where no token covers
   the case, never as a twin for a raw palette class.
9. **Deviate only on record.** If no default fits, use something else and add
   a row to component-matrix "Recorded deviations" in the same change (what,
   deviates from, why, where). Recorded = `alt`; unrecorded = `drift` (a bug).
10. **Validate** in light and dark, and with reduced motion when animation is
   involved (workflow).

Changing token values, adding a variant, primitive, or keyframe is a
**visual mutation**: name it and get the user's approval before coding
(workflow). Composing existing primitives and tokens needs no proposal.

## Conformance

The primitive migration is complete: hand-built buttons remain only in the
raw-`<button>` categories of checklist item 2. A hand-built button, switch,
chip or modal outside those categories, a literal overlay z-index, a raw
palette class, or a loop without a reduced-motion path is drift: never copy
it, and mention it rather than fixing unrelated UI unless asked. Do not quote
adoption counts; re-grep `Code/apps/web/src` with file:line evidence.

When a refactor leaves classes, animations or catalog entries unused, remove
them in the same change, after grepping `web/src`, `docs/src` and `index.html`.

## References

Names are files under `references/`.

| File | Read when |
|------|-----------|
| [component-matrix](references/component-matrix.md) | You need a component's props, **default**, variants, source file, or the recorded deviations |
| [color-system](references/color-system.md) | You choose a color by meaning, a status tone, danger vs destructive, or a feature accent |
| [motion](references/motion.md) | You add or reuse an animation, or need the reduced-motion recipe |
| [overlays-and-layers](references/overlays-and-layers.md) | You build a modal, drawer, menu, popover or tooltip, or touch a z-index or scrim |
| [tokens](references/tokens.md) | You need the HSL token contract, radius, typography, theme overlays, or the docs-site palette |
| [pages](references/pages.md) | You add a page or need routes, page anatomy, or density |
| [vocabulary](references/vocabulary.md) | You name UI elements or normalize words like "popup" or "tag" |
| [workflow](references/workflow.md) | You write a UI/UX proposal or review, or validate with Playwright |

Visual reference for every variant: the docs Component Catalog
(`Code/apps/docs/src/design-catalog/registry.tsx`, route `/design/catalog`).
Human-readable companion (docs site, under Design): `docs/public/DESIGN_SYSTEM.md`.
