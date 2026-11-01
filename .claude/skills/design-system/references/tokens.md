# Design Tokens

## Contents

- Color Contract (HSL triplets, space separated)
- Theme Overlay System
- Radius
- Typography
- Motion durations (raw registry)
- Z-Index
- Docs Site Palette (separate system)
- Mutation Authority

Files of record:

- `Code/apps/web/src/index.css` -- CSS variable definitions (`:root`, `.dark`), base element styles, hand-written keyframes/utilities
- `Code/apps/web/src/theme-tokens.css` -- shared Tailwind 4 inline bindings and radius scale
- `Code/apps/web/src/lib/theme-types.ts` -- `ThemeColors`, `COLOR_VAR_MAP`, `COLOR_LABELS`, `COLOR_GROUPS`, `DEFAULT_LIGHT`, `DEFAULT_DARK`, preset themes, new-user defaults (`DEFAULT_DARK_THEME_ID`, `createDefaultThemePreferences`, `ACTIVE_THEME_CACHE_KEY`)
- `Code/apps/web/src/contexts/ThemeContext.tsx` -- runtime application of tokens
- `Code/apps/web/src/lib/design-tokens.ts` -- intent/emphasis/status class lookups (see `color-system`)
- `Code/apps/web/src/lib/overlay-layers.ts` -- overlay kinds, z-index and scrims (see `overlays-and-layers`)

## Color Contract (HSL triplets, space separated)

All colors are HSL CSS variables consumed as `hsl(var(--token))`. Tailwind
exposes them as `bg-background`, `text-foreground`, `border-border`, etc.

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--background` | `0 0% 100%` | `222.2 47.4% 10%` | Page surface |
| `--foreground` | `222.2 47.4% 11.2%` | `0 0% 98%` | Primary text |
| `--card` | `0 0% 100%` | `222.2 47.4% 13%` | Card surface (lighter than bg in dark) |
| `--card-foreground` | `222.2 47.4% 11.2%` | `0 0% 98%` | Text on cards |
| `--popover` | `0 0% 100%` | `222.2 47.4% 15%` | Floating surfaces |
| `--popover-foreground` | `222.2 47.4% 11.2%` | `0 0% 98%` | Text on popovers |
| `--primary` | `222 47% 11%` | `0 0% 98%` | Primary action fill (inverts per mode) |
| `--primary-foreground` | `0 0% 98%` | `222 47% 11%` | Text on primary |
| `--secondary` | `210 40% 96.1%` | `217.2 32.6% 18.5%` | Secondary surface |
| `--secondary-foreground` | `222.2 47.4% 11.2%` | `0 0% 98%` | Text on secondary |
| `--muted` | `210 40% 96.1%` | `217.2 32.6% 14.5%` | Muted surface |
| `--muted-foreground` | `215.4 16.3% 46.9%` | `215 20.2% 65.1%` | De-emphasized text / descriptions |
| `--accent` | `210 40% 96.1%` | `217.2 32.6% 22.5%` | Hover/highlight surface |
| `--accent-foreground` | `222.2 47.4% 11.2%` | `0 0% 98%` | Text on accent |
| `--destructive` | `0 84% 60%` | `0 62.8% 30.6%` | **Legacy**; use `--danger` (see `color-system`) |
| `--destructive-foreground` | `0 0% 98%` | `0 0% 98%` | Legacy, text on destructive |
| `--border` | `214.3 31.8% 91.4%` | `217.2 32.6% 22.5%` | Borders/dividers (`* { border-border }` default) |
| `--input` | `214.3 31.8% 91.4%` | `217.2 32.6% 17.5%` | Form control borders |
| `--ring` | `215 20.2% 65.1%` | `215 20.2% 65.1%` | Focus ring |
| `--icon` | `222.2 47.4% 11.2%` | `0 0% 98%` | Lucide icon color (forced via `.lucide` rule) |
| `--shadow-elevated` | -- | `0 2px 16px 0 rgba(0,0,0,0.45)` | Dark-mode-only elevation shadow |

Semantic roles add `--info`, `--success`, `--warning`, `--danger`, and
`--neutral`. Each has `-subtle`, `-muted` and `-foreground` companions (all
defined per mode in `index.css` `:root` / `.dark`), exposed as classes such as
`text-success`, `bg-success-subtle`, `border-success-muted`,
`text-success-foreground`. Feature identity is exposed separately as
`feature-ai`, `feature-chat`, `feature-support`, `feature-feedback`, and
`feature-commons`, each with `-subtle` (12% alpha) and `-muted` (28% alpha)
derived in `theme-tokens.css`. `primary-subtle` / `primary-muted` are derived
the same way. Read the values from `index.css`; see `color-system` for
precedence and usage rules.

Dark mode is class-based: `ThemeContext` toggles `.dark` on `<html>`
(`@custom-variant dark` in `index.css`). Token classes flip automatically, so
they need no `dark:` twin. Use a `dark:` variant only when a value must differ
per mode and no token covers it (for example a recorded data scale); a raw
palette class plus its `dark:` twin is drift.

## Theme Overlay System

Users can overlay a color theme per mode (`ThemePreferences.darkThemeId` /
`lightThemeId`), with up to 3 custom themes (`MAX_CUSTOM_THEMES = 3`, defined in `components/ThemeCreator.tsx`).

- `COLOR_VAR_MAP` maps the 13 overridable `ThemeColors` keys to CSS variables
  (card, card-foreground, popover, popover-foreground, destructive,
  destructive-foreground, input are NOT user-overridable).
- `applyCssVariables()` writes inline `style.setProperty` overrides on
  `<html>`; removing them falls back to the CSS defaults above.
- Persistence: `localStorage('theme-preferences')` is read on boot; legacy
  `'theme-mode'` is only a migration fallback (default mode `dark`). Changes
  are debounced (1s) to PUT `/api/auth/profile` with `{ themePreferences }`
  (server stores `theme_preferences` JSONB).
- New-user default: **dark mode + the Forest preset** ("Dark Forest").
  `createDefaultThemePreferences()` returns `{ mode: 'dark', darkThemeId:
  DEFAULT_DARK_THEME_ID ('preset-forest'), lightThemeId: null, customThemes:
  [] }`; `loadLocal()` uses it when nothing is saved, and an account whose
  stored JSONB has no `mode` gets the Forest overlay too.
- First paint: an inline script in `Code/apps/web/index.html` applies `.dark`
  and the Forest (or cached) overlay before React mounts, reading
  `localStorage('theme-active-colors')` (`ACTIVE_THEME_CACHE_KEY`, written by
  ThemeContext as `{ id, vars }`). Editing that script changes its CSP hash:
  update `script-src` in `Code/apps/web/vercel.json`.
  `src/lib/__tests__/theme-defaults.test.ts` guards the hash, the Forest
  values, and that `DEFAULT_LIGHT` / `DEFAULT_DARK` match `:root` / `.dark`
  in `index.css`.
- Switching: the theme quick picker
  (`Code/apps/web/src/components/theme-quick-picker.tsx`: mode
  Light/Dark/System plus the overlay for the current mode) opens from a
  `Palette` `IconButton` labelled "Theme" in the account menu, on desktop and
  mobile. The nav light/dark toggle is gone; `showNavThemeToggle` survives in
  `ThemePreferences` only as a deprecated, unread key.
- Editing UI: `COLOR_GROUPS` defines the 5 editor sections (Backgrounds,
  Text & Icons, Accents, Accent Text, Edges) used by ThemeCreator.

## Radius

| Utility | Value |
|---------|-------|
| `rounded-lg` | `var(--radius)` = `0.5rem` |
| `rounded-md` | `calc(var(--radius) - 2px)` |
| `rounded-sm` | `calc(var(--radius) - 4px)` |

## Typography

- Body: `'Inter', system-ui, sans-serif`
- Code: web Tiptap inline code (`.tiptap code`) `'JetBrains Mono', 'Fira Code', Consolas, monospace`; docs `font-mono` `'JetBrains Mono', 'Fira Code', monospace`
- Base font size is raised to **18px** on `html` so all rem utilities scale up
  (~112.5% browser-zoom feel). Do not "fix" components that look large without
  accounting for this.

## Motion durations (raw registry)

Signal meanings and reuse rules live in `motion`; this is only the raw timing
registry from `index.css` (`@theme` animation utilities):

| Utility | Duration |
|---------|----------|
| `animate-unmarked-pulse` | 2s infinite |
| `animate-spin-once` | 0.5s |
| `animate-fade-in-out` | 1.8s once |

Many more effects are hand-written in `index.css`, and the
`tailwindcss-animate` plugin (`@plugin` in `index.css`) adds `animate-in`
entrance classes. The full catalog with purposes and reduced-motion coverage is
in `motion`. Tab travel is component-owned in `AnimatedTabBar`.

## Z-Index

The stacking tiers and scrim recipes live in `overlays-and-layers`. Overlay
bases (stacked): popovers `z-60`, tooltips `z-80`, drawers `z-95`, dialogs
`z-100`, focus modals `z-110`, toasts `z-200`. Shell layers (fixed, never
stacked): side-panel backdrop `z-40`, side panels `z-50`, nav `z-100 md:z-70`.
Use the constants in `overlay-layers.ts`, not the numbers.

Tailwind v4 spellings used in code: `backdrop-blur-xs`, bare `z-N` (not `z-[N]`),
`outline-hidden`, `shadow-(--var)`.

## Docs Site Palette (separate system)

`Code/apps/docs/src/index.css` imports the web app's `theme-tokens.css` and
scans `../../web/src` (`@source`), so the docs Component Catalog
(`docs/src/design-catalog/`, route `/design/catalog`) can render the real web
primitives. On top of that, docs pages use their own `brand` (indigo 50-950)
and `surface` (slate-derived 0-900) scales from
`Code/apps/docs/tailwind.config.ts` (loaded via `@config`) and `.prose-docs`
typography. Docs chrome uses the docs scales; catalog previews use web
tokens.

## Mutation Authority

Changing any value in the files of record above is a **visual mutation** and
requires explicit authorization in the proposal (see workflow). Adding a
field, fixing a bug, or renaming copy never implicitly authorizes token
changes.
