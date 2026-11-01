# UI/UX Change-Proposal Workflow

## Contents

- Step 1 -- Re-read the contract
- Step 2 -- Classify
- Step 3 -- Declare the delta
- Step 4 -- Proposal format
- UI Change Proposal: <title>
- Step 5 -- Validate with Playwright
- Step 6 -- Review checklist (maintainer)

When to use the full proposal loop:

- **Implement directly** (with `react-frontend` for the code) when the change
  only composes existing primitives, tokens, motion and layers. Steps 1-2 and
  the review checklist still apply; no written proposal is needed.
- **Propose first and wait for approval** when the change includes a visual
  mutation (Step 3), or the user asked for a design proposal or a UI/UX review.

```
re-read contract -> classify -> declare delta -> authorize dimensions ->
implement (visual mutations only after approval) -> validate -> review
```

## Step 1 -- Re-read the contract

Never design from memory. Read, in order, only what the task touches:

1. `vocabulary` -- always (name the pieces)
2. `component-matrix` -- the default variant for each piece
3. `color-system` -- the meaning-driven color for each piece
4. `motion` -- reuse motion by signal
5. `overlays-and-layers` -- if a modal/panel/layer is involved
6. `tokens` -- if anything else visual is involved
7. `pages` -- the manifest of touched routes
8. The actual source files each reference points to (the references summarize;
   the source is truth)

## Step 2 -- Classify

Every element in the request maps to a canonical type
(`Button`, `Card`, `Dialog`, `Popover`, `Toast`, `Tabs`, `SidePanel`, `Banner`, `Field`,
`Status`, `Metric`, `Grid`, `Description`, `Metadata`, `Icon`) and, where
relevant, a precise state (`selected` / `pressed` / `checked`, data state).
Apply the normalization table: no `Desc`, no bare `Panel`/`Info`/`Box`, no
generic `active`.

Unclassifiable element = stop and ask the maintainer; do not invent a synonym.

## Step 3 -- Declare the delta

State explicitly which dimensions change:

| Dimension | Examples | Authorization |
|-----------|----------|---------------|
| Structure | Add/remove/reorder components on a page | Implied by the request |
| Content | Copy, labels, icons | Implied by the request |
| State | New data state, new interaction state | Must be named in the proposal |
| Visual | Tokens, radius, spacing, shadows, typography, motion, variants | **Never implicit -- requires explicit maintainer approval** |

"Add a field" authorizes structure + content only.

## Step 4 -- Proposal format

```markdown
## UI Change Proposal: <title>
- Logical IDs touched: mailbox.tab-bar, ...
- Classification: <element> -> <canonical type> (<states>)
- Delta: [x] structure  [ ] content  [ ] state  [ ] visual
- Visual mutations requested: none | <list with token/component refs>
- Files: <paths>
- Validation: <pages x themes to snapshot>
```

## Step 5 -- Validate with Playwright

Config: `Code/apps/web/playwright.config.ts`
(baseURL `http://localhost:5173`, chromium only, tests in `e2e/`).
Starter spec: `Code/apps/web/e2e/design-snapshot.spec.ts`.

Preconditions: dev stack running (`pnpm dev:stack` from repo root).

Run from `Code/apps/web`:

```bash
npx playwright test e2e/design-snapshot.spec.ts            # compare
npx playwright test e2e/design-snapshot.spec.ts -u         # record baselines
```

What to capture for any visual change:

1. **ARIA snapshot** (`toMatchAriaSnapshot`) of the changed region -- catches
   semantic/structure drift (names, roles, states) that screenshots miss.
2. **Screenshot** (`toHaveScreenshot`) of the region or page -- catches token,
   spacing, and radius drift.
3. **Both themes** -- in an init script before load, set
   `localStorage('theme-preferences')` to
   `{ mode, darkThemeId: null, lightThemeId: null, customThemes: [] }`;
   ThemeContext reads that key on boot (`theme-mode` is only a legacy
   fallback). The starter spec's `forceTheme` already does this. Without the
   key a fresh browser gets the new-user default, dark mode + Forest overlay.
4. **Reduced motion** (`page.emulateMedia({ reducedMotion: 'reduce' })`) when
   the change involves animation.

Snapshot naming uses stable logical IDs: `mailbox-tab-bar-dark.png`, never
copy text like `inbox-tab.png`.

The docs Component Catalog (`/design/catalog`, registry
`Code/apps/docs/src/design-catalog/registry.tsx`) renders every variant live
from the real primitives and is the visual reference for side-by-side review.
If it ever disagrees with `components/ui`, the code wins.

## Step 6 -- Review checklist (maintainer)

- [ ] Every new element classified into the canonical vocabulary
- [ ] No new synonyms or leaf `Info`/`Panel`/`Box`/`Desc`
- [ ] Reused the **default** variant from `component-matrix` (or justified a new one)
- [ ] Colors chosen by meaning per `color-system` (no new hue for an existing meaning)
- [ ] Motion reused by signal per `motion`, with a reduced-motion path
- [ ] Overlays use a tier + scrim from `overlays-and-layers` (no literal overlay z-index)
- [ ] Deviations recorded in `component-matrix` in the same change
- [ ] Visual mutations explicitly listed and approved
- [ ] State names precise (`selected` vs `pressed` vs `checked`)
- [ ] ARIA snapshots green in light + dark
- [ ] Screenshots reviewed (diffs are intentional only)
- [ ] Token files untouched unless the proposal said so
- [ ] New variants/types added to the matrix in the same change
