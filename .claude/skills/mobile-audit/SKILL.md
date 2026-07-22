---
name: mobile-audit
description: Audit React mobile UX for thumb reach, layout breakpoints, touch-safe actions, accessibility risks, motion cost, and recommend the right mobile UI libraries and patterns
---

# mobile-audit

## Purpose

Audits Coordination Manager screens from a mobile-first perspective and produces a prioritized issue list with recommended implementation patterns and library choices. Covers UX, accessibility, interaction-mode mismatch, and mobile performance risks in one audit pass.

## When to Use

- Auditing any page in `Code/apps/web/src/pages/`
- Reviewing shared UI in `Code/apps/web/src/components/`
- Building a backlog of mobile fixes before implementation
- Checking whether a screen depends on hover, right-click, drag, or desktop-only density
- Deciding whether a new library is justified for a specific mobile problem

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Target page or component set | User specifies or agent selects | yes |
| Audit depth | quick, medium, or thorough | no |
| Known pain points | User feedback, screenshots, or bug reports | no |

## Rules

- Treat mobile as a distinct interaction mode, not a narrower desktop layout
- Check `360px`, `390px`, `430px`, tablet width, and phone landscape
- Every drag interaction must have a non-drag fallback
- No critical action may depend only on hover, right-click, or long press
- Recommend new libraries only when the problem repeats or the current stack would become brittle
- Prefer the lightest tool that fits the problem and preserves the current React + Vite + Tailwind architecture

## Workflow

1. **Define the mobile task path**:
   - Start with the main user action for the target screen
   - Note whether the screen is browse, edit, plan, reorder, review, or admin heavy
   - Review the screen and directly used child components only; avoid broad exploration

2. **Check critical widths and orientations**:
   - Validate behavior at `360px`, `390px`, `430px`, tablet width, and phone landscape
   - Record clipping, overflow, double scroll regions, fixed-height traps, and unsafe sticky elements
   - Flag places where mobile looks like a squeezed desktop instead of a simplified flow

3. **Audit touch-first interaction quality**:
   - Confirm the primary action is reachable with one thumb when practical
   - Check whether side panels should become bottom sheets, drawers, or full-screen flows
   - Confirm right-click and hover actions are available through visible buttons, kebab menus, swipe actions, or tap flows
   - Confirm long press is not the only way to access critical actions
   - For calendar or timeline screens, confirm selection completes before any full-screen editor opens; opening on pointer-down usually fights touch selection
   - For compact mobile ribbons, flag duplicate actions that all open the same tool surface; prefer one direct action plus 1-2 real shortcuts

4. **Audit drag, density, and hidden desktop assumptions**:
   - Every drag action must have a non-drag fallback
   - Reordering should support visible handles or explicit `Move up` / `Move down` actions
   - Kanban or card movement should support `tap card -> choose status/list -> confirm`
   - Tables and grids should have a phone-safe presentation: cards, stacked lists, compact tables, or segmented views
   - For time-grid selection on phone, check whether the implementation still depends on mouse events; touch paths should use pointer capture and pointerup or pointercancel handling
   - Flag inline micro-action pills rendered over tiny mobile selections; these usually obscure the target instead of helping

5. **Audit accessibility and mobile performance risks**:
   - Check tap target comfort, visible focus, labels, dialog focus trapping, and keyboard independence
   - Flag color-only state, icon-only actions without names, and overlay focus confusion
   - Flag decorative motion, heavy blur, layered shadows, and hidden desktop panels still rendering on mobile
   - Flag long lists or dense boards that likely need virtualization or progressive disclosure
   - Flag multi-row mobile headers created by secondary labels such as repeated page titles, date ranges, or verbose timezone labels when the screen already needs vertical space for a dense grid

6. **Recommend the lightest fitting library**:
   - **Radix UI**: best first pick for accessible primitives such as dialogs, popovers, dropdown menus, and toggles
   - **Vaul**: best first pick for phone bottom sheets and drawers layered on top of Radix patterns
   - **Floating UI**: use for anchored menus/popovers when Radix alone is not enough; already present transitively via Tiptap, so conceptually aligned with the stack
   - **react-swipeable**: use for narrow, explicit swipe actions where swipe improves speed without hiding critical actions
   - **React Hook Form + Zod**: best first pick when mobile forms become hard to manage or validation grows
   - **@dnd-kit**: use only when drag remains essential after adding non-drag fallbacks
   - **TanStack Virtual** or `react-window`: use when long mobile lists visibly hurt scroll performance
   - Defer **TanStack Query**, **Zustand**, **Jotai**, **Framer Motion**, and **vite-plugin-pwa** unless the audit shows a repeated architectural need

7. **Produce a prioritized output**:
   - For each issue include: screen, severity, user impact, width/input mode trigger, recommended pattern, and library recommendation if one is justified
   - Separate structural issues from polish issues
   - Prefer recommendations that fit the current lean React + Vite + Tailwind stack without forcing a broad rewrite

## Anti-Patterns

- Auditing the whole app broadly before identifying the local mobile task path
- Treating hover, long press, or swipe as the only route to important actions
- Recommending drag-and-drop on mobile without a tap-based fallback
- Suggesting heavyweight state or data libraries when the issue is local UI structure
- Reporting cosmetic spacing feedback without identifying the mobile interaction failure

## Component Examples

- Sidebar-heavy page -> desktop side panel, tablet drawer, phone bottom sheet with `Vaul`
- Calendar planner -> desktop side panel plus inline editor, phone grid selection followed by full-screen editor only after selection ends
- Context menu actions -> visible kebab menu using `Radix UI` dropdown menu
- Dense table -> phone card list, tablet compact table, desktop full table
- Long mobile list -> stacked cards plus virtualization via `TanStack Virtual` or `react-window` when scroll jank is visible
- Multi-step mobile form -> `React Hook Form + Zod` plus `inputMode`, `autoComplete`, and `enterKeyHint`

## Testing Requirements

- Verify the target flow at `360px`, `390px`, `430px`, tablet width, and phone landscape
- Confirm primary actions remain reachable without mouse, hover, or right-click
- Confirm drag flows have a visible non-drag fallback
- Check tap targets, focus visibility, overlay focus behavior, and icon button labels in the touched flow
- If a recommendation includes a new library, explain why the existing stack is insufficient for that slice

## Definition of Done

- [ ] User asked for a mobile audit, issue list, or mobile library recommendation
- [ ] Task mentions phone UX, thumb reach, drag pain, accessibility, or mobile performance
- [ ] Target files are in `Code/apps/web/src/`
- [ ] Reviewed the main action path for each target screen
- [ ] Checked the required widths and landscape behavior
- [ ] Identified panel, drag, hover, accessibility, and performance risks
- [ ] Produced a prioritized issue list with specific mobile patterns and library guidance
- [ ] Findings are tied to concrete screens and interaction failures
- [ ] Recommendations prefer the lightest tool that fits the problem
- [ ] Structural issues are separated from cosmetic issues
- [ ] Audit explicitly notes where mobile should behave differently from desktop
- [ ] File stays under 200 lines
- [ ] YAML frontmatter is valid
- [ ] No non-ASCII characters in the skill text