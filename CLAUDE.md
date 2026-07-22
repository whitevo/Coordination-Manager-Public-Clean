# Coordination Manager

A web-based platform for scheduling group meetings through shared availability calendars. Users create coordination calendars, share them via links, and participants mark their available time slots. The system identifies optimal meeting times based on overlapping availability.

## Architecture

Monorepo using pnpm workspaces:

```
Code/
  apps/api/              Express.js backend (port 3001)
  apps/web/              React 18 + Vite frontend (port 5173)
  apps/discord-bot/      Discord slash commands + platform integration
  apps/discord-guardian/  Discord moderation rule engine
  apps/docs/             Documentation site (Vite + React)
  packages/database/     Supabase schema + migrations
  figma-plugin/          Wireframe generator
  agents/                Fetch.ai uAgent (meeting-scheduler)
```

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS v3 (class-based dark mode, HSL CSS variables)
- **Backend**: Express.js, TypeScript, Helmet, socket-based rate limiting
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
pnpm dev:health       # Run health check against the running stack
```

Primary operational entrypoints (run from repo root):

```
pnpm dev              # Start all services (web + api + bot + guardian + docs)
pnpm dev:web          # Frontend only (port 5173)
pnpm dev:api          # API only (port 3001)
pnpm dev:bot          # Discord bot only
pnpm dev:guardian     # Guardian bot only
pnpm dev:docs         # Docs site only
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm lint             # Lint all packages
pnpm typecheck        # Typecheck all packages
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

Backend (`Code/apps/api/.env`): SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY, FRONTEND_URL, PORT, JWT_SECRET, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID

Frontend (`Code/apps/web/.env`): VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_TURNSTILE_SITE_KEY

## Skills

This repository uses the following development skills (in `.claude/skills/`):

| Skill | Purpose |
|-------|---------|
| react-frontend | React components, pages, hooks, routing, TailwindCSS theming |
| express-api | Express routes, auth middleware, rate limiting, error handling |
| supabase-database | Schema, migrations, RLS policies, JSONB patterns |
| coordination-calendar | Core domain: calendars, availability, meetings, recurrence |
| authentication-system | Google OAuth, Cardano wallet CIP-30, traveler accounts |
| discord-integration | Discord bot commands, guardian moderation, platform linking |
| monorepo-conventions | pnpm workspaces, scripts, cross-app patterns |
| testing-strategy | Vitest, Supertest, React Testing Library |
| side-panel-design | FloatingPanel architecture, FAB cluster, side panel patterns |
| mobile-audit | Audit mobile UX, accessibility, performance risks, and recommend fitting mobile UI libraries |
| mobile-interaction-refactor | Refactor screens into touch-safe phone/tablet/desktop variants with bottom sheets and non-drag fallbacks |
| environment-variables | Env var management across all apps and services |
| deployment | Vercel frontend + Railway backend deployment workflows |
| vercel-deploy | Build locally + deploy to Vercel CLI with zero build minutes |
| dev-server-workflow | Start, stop, debug 5 concurrent local services |
| github-workflow | Branching strategy, PRs, CI checks, release process |
| security-hardening | Platform hardening, open-source prep, security test scenarios || open-source-pipeline | Curated private -> public repo sync pipeline for occasional OSS releases || supply-chain-security | Dependency governance, CI hardening, SBOM, pnpm security controls |
| ai-feedback-loop | Analyse user AI feedback to improve AI agents, prompts, and docs |
| skill-updater | Route new instructions to the right skill |
| gamechanger-environment | GameChanger Wallet UDC service layer -- library setup, URL encoding, result decoding |
| gamechanger-scripting | Write GCScript DSL for Cardano transactions, minting, signing via GameChanger |
| cardano-fee-modeling | Model Cardano fee costs, min-ADA, Plutus execution units, network effects |

## Do NOT

- Put secrets or credentials in any committed file
- Use `any` type -- use `unknown` and narrow with type guards
- Expose raw UUIDs in calendar URLs (use hash)
- Expose supabaseAdmin or service role key in responses or logs
- Skip input validation on API endpoints
- Use CSS modules or styled-components (TailwindCSS only)
- Use class components (function components with hooks only)
