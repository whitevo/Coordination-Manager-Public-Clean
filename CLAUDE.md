# Coordination Manager

A web-based platform for scheduling group meetings through shared availability calendars. Users create coordination calendars, share them via links, and participants mark their available time slots. The system identifies optimal meeting times based on overlapping availability.

## Architecture

Monorepo using pnpm workspaces:

```
Code/
  apps/api/              Express.js backend (port 3001)
  apps/web/              React 19 + Vite frontend (port 5173)
  apps/discord-bot/      Discord slash commands + platform integration
  apps/discord-guardian/  Discord moderation rule engine
  apps/docs/             Documentation site (Vite + React)
  packages/database/     Supabase schema + migrations
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TailwindCSS v4 (class-based dark mode, HSL CSS variables)
- **Backend**: Express.js, TypeScript, Helmet, per-client rate limiting (`getRateLimitKey`)
- **Database**: Supabase (PostgreSQL) with Row Level Security
- **Auth**: Google OAuth + Cardano CIP-30 wallet + traveler (guest) accounts
- **Bots**: Discord.js (slash commands + moderation guardian)
- **Build**: pnpm workspaces, concurrently

## Conventions

- TypeScript strict mode across all packages
- TailwindCSS for all styling (no CSS modules or styled-components)
- Function components with hooks only (no class components)
- async/await for all async operations (no raw promise chains)
- Input validation at API boundary with sanitize helpers
- Custom error classes (ValidationError, UnauthorizedError, ApplicationError)
- Calendar URLs use hash (nanoid 10 chars), never raw UUIDs
- `created_by` is TEXT type -- holds UUID, email, traveler_name, or wallet_address
- ASCII-safe text in all source files (no smart quotes or em dashes)

## Commands

Preferred full-stack startup (from repo root):

```
pnpm dev:stack        # Run start.ps1 (safe stop -> launch service terminals -> health check)
pnpm dev:stack:no-check  # Same launch flow, skip health check only when explicitly needed
pnpm dev:stack:localhost # Launch web, API, and docs only
pnpm dev:health       # Run health check against the running stack
```

Primary operational entrypoints (run from repo root):

```
pnpm dev              # Start all services in one terminal (fallback; prefer dev:stack)
pnpm dev:web          # Frontend only (port 5173)
pnpm dev:api          # API only (port 3001)
pnpm dev:bot          # Discord bot only
pnpm dev:guardian     # Guardian bot only
pnpm dev:docs         # Docs site only
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm lint             # Lint all packages
pnpm typecheck        # Typecheck all packages
pnpm verify:release   # Full production preflight: install, quality gates, security, and deployment artifacts
pnpm format           # Format with Prettier
pnpm dev:stop         # Stop stack services
```

Equivalent direct commands (run from `Code/` directory):

```
pnpm dev              # Start all services (web + api + bot + guardian + docs)
pnpm dev:web          # Frontend only (port 5173)
pnpm dev:api          # API only (port 3001)
pnpm dev:bot          # Discord bot only
pnpm dev:guardian     # Guardian bot only
pnpm dev:docs         # Docs site only
pnpm stop             # Stop all services
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm test:api         # API tests only
pnpm test:web         # Frontend tests only
pnpm lint             # Lint all packages
pnpm typecheck        # Typecheck all packages
pnpm format           # Format with Prettier
```

## Environment Variables

Backend (`Code/apps/api/.env`, core): SUPABASE_URL, SUPABASE_KEY, SUPABASE_SECRET_KEY_LOCALHOST (development/test) or SUPABASE_SECRET_KEY_PRODUCTION (NODE_ENV=production), FRONTEND_URL, PORT, NODE_ENV, JWT_SECRET, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAILBOX_ENCRYPTION_KEY, AI_API_KEY, BOT_API_URL, BOT_API_SECRET, DISCORD_CLIENT_ID

Frontend (`Code/apps/web/.env`): VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_TURNSTILE_SITE_KEY

Full list (optional vars, bots, guardian, agents) lives in the environment-variables skill and each app's `.env.example`.

## Skills

This repository uses the following development skills (in `.claude/skills/`):

| Skill | Purpose |
|-------|---------|
| react-frontend | How to code React components, pages, hooks, contexts, routing, and data fetching (UI choices come from design-system) |
| express-api | Express routes, auth middleware, rate limiting, error handling |
| supabase-database | Schema, migrations, RLS policies, JSONB patterns |
| coordination-calendar | Core domain: calendars, availability, meetings, recurrence |
| mailbox-feature | Mailbox architecture dependencies, sync model, and workflow for improving features/tests |
| authentication-system | Google OAuth, Cardano wallet CIP-30, traveler accounts |
| discord-integration | Discord bot commands, guardian moderation, platform linking |
| monorepo-conventions | pnpm workspaces, scripts, cross-app patterns |
| testing-strategy | Vitest, Supertest, React Testing Library |
| side-panel-design | Assistance nav dropdown, side panel patterns |
| design-system | Active UI/UX guidance for every web UI change: components/ui primitives, semantic color tokens, motion and reduced motion, overlay layers, recorded deviations, UI/UX review workflow |
| mobile-ux | Mobile audit and touch-safe phone/tablet/desktop refactors, bottom sheets, non-drag fallbacks, library choice |
| environment-variables | Env var management across all apps and services |
| deployment | Vercel frontend + Railway backend deployment workflows |
| dev-server-workflow | Start, stop, debug 5 concurrent local services |
| run-coordination-manager | `/run-coordination-manager`: start localhost frontend, API, and docs |
| github-workflow | Branching strategy, PRs, CI checks, release process |
| security-hardening | Platform hardening, open-source prep, security test scenarios |
| open-source-pipeline | Curated private -> public repo sync pipeline for occasional OSS releases |
| supply-chain-security | Dependency governance, CI hardening, SBOM, pnpm security controls |
| ai-feedback-loop | Analyse user AI feedback to improve AI agents, prompts, and docs |
| prompt-enhancement-agent | Clarity check and scaffolding for ambiguous or multi-part requests (As-Is/To-Be, dependencies, tests) |
| updating-skills | Route new instructions to the right skill |

## Do NOT

- Put secrets or credentials in any committed file
- Use `any` type -- use `unknown` and narrow with type guards
- Expose raw UUIDs in calendar URLs (use hash)
- Expose supabaseAdmin or service role key in responses or logs
- Skip input validation on API endpoints
- Use CSS modules or styled-components (TailwindCSS only)
- Use class components (function components with hooks only)
