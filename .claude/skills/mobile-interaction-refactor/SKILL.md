---
name: mobile-interaction-refactor
description: Refactor React screens into phone, tablet, and desktop interaction variants using touch-safe patterns, accessible primitives, bottom sheets, non-drag fallbacks, and mobile performance guards
---

# mobile-interaction-refactor

## Purpose

Implements mobile-first interaction changes for Coordination Manager screens. Converts desktop assumptions into explicit phone, tablet, and desktop variants while preserving accessibility and keeping render cost under control.

## When to Use

- Refactoring pages in `Code/apps/web/src/pages/` for phone and tablet usability
- Updating shared components that currently depend on hover, right-click, or drag
- Replacing sidebars, dense grids, or precision actions with touch-safe alternatives
- Implementing bottom sheets, drawers, overflow menus, swipe actions, or form improvements
- Applying fixes from `mobile-audit`

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Target component or page | User specifies | yes |
| Current desktop interaction pattern | Existing code | yes |
| Desired phone/tablet behavior | Audit output or user request | no |

## Rules

- Use TailwindCSS and current project conventions
- Prefer incremental library adoption over broad rewrites
- Every drag interaction must ship with a non-drag fallback
- No critical action may depend only on hover, right-click, or long press
- Use `hover`, `any-hover`, `pointer`, and `any-pointer` when behavior depends on input capability, not only viewport width
- Do not rely on horizontal scrolling unless the content truly requires it

## Workflow

1. **Identify the desktop assumptions to remove**:
   - Right-click menus
   - Hover-reveal actions
   - Drag panels or drag reorder as the main interaction
   - Wide multi-column layouts
   - Small hit areas that assume fine pointer precision

2. **Create explicit interaction variants**:
   - Desktop: sidebar + main content + supporting panel when justified
   - Tablet: collapsible sidebar + main view + drawer
   - Phone: single active view + bottom sheet, full-screen editor, segmented control, or bottom action bar
   - Use `hover`, `any-hover`, `pointer`, and `any-pointer` when behavior depends on input capability, not only viewport width
   - For calendar or time-grid screens on phone, prefer `select on grid -> release -> open full-screen editor`; do not auto-open the editor on the first pointer-down

3. **Pick libraries that fit the current app**:
   - **Radix UI**: first choice for accessible dialog, dropdown menu, popover, tooltip, toggle, tabs, and collapsible primitives
   - **Vaul**: first choice for mobile drawers and bottom sheets; use when a side panel becomes a phone sheet
   - **Floating UI**: use for precise anchored positioning when a menu or popover needs custom control beyond existing primitives
   - **react-swipeable**: use for bounded swipe gestures such as archive, reveal actions, or list navigation; keep visible fallback actions
   - **React Hook Form + Zod**: use for complex forms, mobile-friendly validation, and reliable error state handling
   - **@dnd-kit**: only when drag remains core after adding explicit tap-based alternatives
   - **TanStack Virtual** or `react-window`: use for long mobile lists or boards with visible scroll jank
   - Avoid adding **TanStack Query**, **Zustand**, **Jotai**, **Framer Motion**, or **vite-plugin-pwa** as a default. Add them only when the touched slice proves the current architecture is insufficient.

4. **Replace desktop-only behaviors**:
   - Right click -> dropdown menu, action bar, or visible buttons
   - Hover reveal -> persistent labels, tap-to-expand sections, or always-visible controls
   - Drag panels -> bottom sheet, drawer, tabs, or stepper
   - Drag reorder -> visible handles and `Move up` / `Move down` fallback
   - Dense tables -> cards on phone, compact table on tablet, full grid on desktop
   - Modals -> full-screen sheet on small screens for task-heavy editing
   - Dense planner headers -> one compact mobile row; drop redundant page titles, repeated date labels, and verbose badges before shrinking the grid
   - Tool ribbons on phone -> one non-scrolling row with real shortcuts plus a single tools entry; avoid multiple buttons that all open the same destination

5. **Bake in accessibility and mobile form behavior**:
   - Keep critical actions visible without hover or long press
   - Preserve visible focus styles, dialog focus trapping, and accessible names for icon buttons
   - Prefer mobile-friendly inputs: `inputMode`, `autoComplete`, `enterKeyHint`, and explicit labels
   - Use React Hook Form plus Zod when validation logic grows beyond simple local state
   - On phone, if a modal is opened for a fresh selection, the secondary action should behave as `Cancel` and clear that selection instead of merely hiding the modal

6. **Protect mobile performance during the refactor**:
   - Do not keep heavy desktop panels mounted on phone when hidden
   - Prefer conditional rendering over invisible but mounted desktop UI
   - Respect `prefers-reduced-motion`
   - Avoid heavy blur, backdrop-filter, and decorative animation on mobile
   - Virtualize or paginate long lists when necessary
   - For touch drag or selection, use pointer events with pointer capture; do not rely on mousemove or mouseup alone for the phone path

7. **Validate the touched slice immediately**:
   - Run the narrowest relevant test, typecheck, or lint command after the first substantive edit
   - If accessibility changes are substantial, add or update tests using available frontend test patterns
   - Keep follow-up edits adjacent to the same slice before widening scope

## Anti-Patterns

- Adding a new library by default before proving the local UI cannot be fixed with the current stack
- Leaving hidden desktop panels mounted on phone when they still consume render cost
- Replacing right-click with long press only
- Preserving drag as the only primary mobile action
- Splitting behavior only by width when the real difference is pointer capability

## Component Examples

- Desktop side panel -> phone bottom sheet using `Vaul`
- Calendar selection overlay -> phone full-screen editor opened on pointer release, with no tiny inline action pills over the selected block
- Hover-only actions -> persistent mobile action row or `Radix UI` dropdown menu
- Dense settings table -> phone cards, tablet compact table, desktop full grid
- Reorderable list -> visible drag handle plus `Move up` / `Move down` actions; use `@dnd-kit` only if drag still matters
- Complex mobile form -> `React Hook Form + Zod` with explicit mobile input attributes

## Testing Requirements

- Run the narrowest relevant validation after the first substantive edit: focused test, typecheck, or lint
- Verify phone, tablet, and desktop behavior where the refactor introduces distinct variants
- Confirm critical actions remain visible and reachable without hover, right-click, or long press
- Check focus visibility, overlay focus trapping, accessible names, and form behavior in the touched flow
- If long lists or heavy panels were changed, verify hidden desktop UI is not unnecessarily rendered on mobile

## Definition of Done

- [ ] User asked to refactor a screen for mobile or touch compatibility
- [ ] Component depends on hover, right-click, drag, or wide desktop layout
- [ ] Task involves responsive interaction changes, not only spacing tweaks
- [ ] Desktop assumptions were identified and replaced
- [ ] Phone, tablet, and desktop variants are explicit where behavior differs
- [ ] Critical actions remain visible and reachable on touch devices
- [ ] Hidden desktop-only structures are not unnecessarily rendered on mobile
- [ ] The chosen library matches a concrete problem instead of being added preemptively
- [ ] The resulting layout is simpler on phones, not just narrower
- [ ] Focus, labels, and dialog behavior still work after the refactor
- [ ] Render cost was reduced or held steady for the mobile path
- [ ] File stays under 200 lines
- [ ] YAML frontmatter is valid
- [ ] No non-ASCII characters in the skill text