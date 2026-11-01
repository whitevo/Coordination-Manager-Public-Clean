# Coordination Manager

A web-based platform for scheduling group meetings through shared availability calendars. Users create coordination calendars, share them via links, and participants mark their available time slots. The system identifies optimal meeting times based on overlapping availability.

## Features

- **Coordination Calendars** — Create calendars with configurable date ranges, time intervals, and meeting hours
- **Shared Availability** — Share a link so participants can mark their available time slots
- **Meeting Suggestions** — Automatic detection of time slots where multiple participants are available
- **Confirmed Meetings** — Calendar creators can confirm meeting times with details and links
- **Google OAuth** — Sign in with Google for persistent accounts
- **Traveler Accounts** — Temporary guest accounts (64-day expiry) for quick participation without sign-up
- **Public & Unlisted Calendars** — Public calendars appear in the events listing; unlisted ones are only accessible via direct link
- **Cardano Wallet Login** — Sign in with Lace, Eternl, Typhon, or Yoroi via CIP-30 signature
- **User Settings** — Configurable default time intervals and meeting hours

## Live Deployment

- **Frontend:** Deployed on Vercel (https://coordinationmanager.com)
- **Backend:** Deployed on Railway

### Recovery after frontend updates

An older open tab can request hashed JavaScript or CSS files that no longer
exist in the current deployment. A 404 response may also produce a stylesheet
MIME warning; changing MIME headers does not restore the missing file.

The frontend loads [asset recovery](Code/apps/web/public/asset-recovery.js)
before its application modules. Asset failures before the app mounts get at
most one automatic same-URL reload per entry-module hash and tab session.
Offline browsers and browsers without session storage get a manual reload
notice instead. Failures after mounting never trigger an automatic asset
reload: users are prompted to save or copy any available unsaved work first.
React render failures can still replace the affected content with the error
boundary; this mechanism does not restore drafts already lost to a crash.

The recovery notice does not depend on React or successful stylesheet loading.
It leaves original module errors visible for diagnosis, and does not reload
tabs merely because they were idle. Deploy the recovery script and HTML with
the frontend build; tabs using HTML from before this change still require a
manual refresh to receive it.

## Tech Stack

- **Frontend:** React 19 + TypeScript, Vite, TailwindCSS, React Router, Axios
- **Backend:** Node.js + Express, TypeScript
- **Database:** Supabase (PostgreSQL) with Row Level Security
- **Auth:** Supabase Auth (Google OAuth + anonymous/traveler accounts + Cardano Wallets)
- **Monorepo:** pnpm workspaces

## Prerequisites

- Node.js 26.12.1+
- pnpm 12 (`npm install -g pnpm@12.15.0`; Node 26 no longer bundles corepack)
- A Supabase project

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd Coordination-Manager
pnpm --dir ./Code install
```

### 2. Set Up Environment Variables

**Backend** (`apps/api/.env`):
```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_role_key
FRONTEND_URL=http://localhost:5173
PORT=3001
```

**Frontend** (`apps/web/.env`):
```
VITE_API_URL=http://localhost:3001
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Set Up Database

Run the core and feature baselines in the Supabase SQL Editor. Start with:

```
-- Copy and run the contents of:
-- packages/database/migrations/000_full_schema.sql
```

Then run the required `000_feature-*.sql` files in the order documented in
[`Code/packages/database/migrations/README.md`](Code/packages/database/migrations/README.md).
The core file does not create every feature schema; in particular, run the
Time Management, feedback, mailbox, and wallet/auth baselines before the
security baseline. The feature baselines are idempotent and intended for fresh
setup. For existing databases, apply only unapplied historical upgrades from
`Code/packages/database/migrations/archive/`; do not treat a baseline as an
upgrade script.

### 4. Configure Google OAuth

1. In Google Cloud Console, create OAuth credentials
2. Add `http://localhost:5173` to authorized origins
3. Add `http://localhost:5173/auth/callback` to redirect URIs
4. In Supabase Dashboard > Authentication > Providers > Google, add your Client ID and Secret

### 5. Start Development

From the repository root, start all local services:

```bash
pnpm dev
```

To start only the frontend, API, and docs (without the Discord bot or guardian), run:

```bash
pnpm dev:stack:localhost
```

This opens the services at `http://localhost:5173` (frontend), `http://localhost:3001` (API), and `http://localhost:5174` (docs).

In VS Code Copilot Chat, invoke `/run-coordination-manager` for the same launch
and health-check workflow. The command is provided by the
[run-coordination-manager skill](.claude/skills/run-coordination-manager/SKILL.md).
Agent Host sessions load skills, not the older `.github/prompts` prompt files.
If the command is missing, open **Chat: Open Customizations** from the Command
Palette and check the **Skills** section for the current harness. After adding
the skill, start a new chat; if discovery is still stale, use **Developer: Reload
Window**.

Or start a specific service:

```bash
pnpm dev:web
pnpm dev:api
pnpm dev:bot
pnpm dev:guardian
pnpm dev:docs
```

Or start frontend and backend individually in separate terminals:

```bash
# Terminal 1: Backend API
pnpm dev:api
# → http://localhost:3001

# Terminal 2: Frontend
pnpm dev:web
# → http://localhost:5173
```

Both servers:
- Frontend: http://localhost:5173
- Backend: http://localhost:3001

Common operational entrypoints from repository root:

```bash
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm format
pnpm dev:stop
pnpm dev:stack
pnpm dev:health
pnpm verify:release
```

Run `pnpm verify:release` before a production update. It verifies the frozen
dependency install, approved package build scripts, typecheck, lint, tests,
high/critical dependency audit, committed-history secret scan, all workspace
builds, and the Vercel frontend-plus-docs artifact.

## Project Structure

```
Code/
├── apps/
│   ├── api/              # Express backend
│   │   └── src/
│   │       ├── routes/    # API endpoints
│   │       └── middleware/ # Auth middleware, error handling
│   └── web/              # React frontend
│       └── src/
│           ├── pages/     # CalendarPage, EventsPage, SettingsPage, LoginPage
│           ├── components/ # Layout, ProtectedRoute
│           ├── contexts/  # AuthContext
│           └── lib/       # API client, auth service, Supabase client
├── packages/
│   └── database/         # SQL migrations
└── docs/                 # Documentation
```

## Web Route Map (Developer)

Source of truth for route wiring: `Code/apps/web/src/App.tsx`.

### Public + Guest Routes

| Route | Page File | Purpose |
|---|---|---|
| `/` | `Code/apps/web/src/pages/HomePage.tsx` | Landing/home experience. |
| `/events` | `Code/apps/web/src/pages/EventsPage.tsx` | Event listing and discovery. |
| `/events-calendar` | `Code/apps/web/src/pages/EventsCalendarPage.tsx` | Calendar-style view of public events. |
| `/time-management` | `Code/apps/web/src/pages/TimeManagementPage.tsx` | Personal planning workspace with synced/manual events. |
| `/calendar` | `Code/apps/web/src/pages/CalendarPage.tsx` | Create a new coordination calendar. |
| `/calendar/:hash` | `Code/apps/web/src/pages/CalendarPage.tsx` | View/edit a specific coordination calendar. |
| `/meeting/:meetingId` | `Code/apps/web/src/pages/MeetingPage.tsx` | Meeting detail and participant context view. |
| `/support` | `Code/apps/web/src/pages/SupportPage.tsx` | Support/help entrypoint. |
| `/join/invite/:code` | `Code/apps/web/src/pages/AcceptInvitePage.tsx` | Accept invite flow. |
| `/join/:hash` | `Code/apps/web/src/pages/GuestBookingPage.tsx` | Guest booking flow for shared calendars. |
| `/auth/login` | `Code/apps/web/src/pages/auth/LoginPage.tsx` | Auth/login screen. |
| `/auth/callback` | `Code/apps/web/src/pages/auth/AuthCallbackPage.tsx` | OAuth callback handler. |

### Legal + Proposal Routes (Standalone)

| Route | Page File | Purpose |
|---|---|---|
| `/policy` | `Code/apps/web/src/pages/PolicyPage.tsx` | Policy landing page. |
| `/privacy` | `Code/apps/web/src/pages/PrivacyPolicyPage.tsx` | Privacy policy route. |
| `/trademark` | `Code/apps/web/src/pages/TrademarkPolicyPage.tsx` | Trademark policy route. |
| `/terms` | `Code/apps/web/src/pages/TermsOfServicePage.tsx` | Terms of service route. |
| `/email-abuse` | `Code/apps/web/src/pages/EmailAbusePage.tsx` | Abuse reporting and verification route. |
| `/zoom-review` | `Code/apps/web/src/pages/ZoomReviewPage.tsx` | Zoom integration review page. |
| `/proposals/video-meeting` | `Code/apps/web/src/pages/VideoMeetingProposalPage.tsx` | Video meeting proposal page. |
| `/proposals/data-privacy` | `Code/apps/web/src/pages/DataPrivacyProposalPage.tsx` | Data privacy proposal page. |

### Authenticated Routes

| Route | Page File | Purpose |
|---|---|---|
| `/settings` | `Code/apps/web/src/pages/SettingsPage.tsx` | Profile, preferences, integrations, account settings. |
| `/coordinate-events` | `Code/apps/web/src/pages/CoordinateEventsPage.tsx` | Coordination tools for scheduling workflows. |
| `/distribute` | `Code/apps/web/src/pages/AnnouncementsPage.tsx` | Compose and distribute announcements. |
| `/announcements` | Redirect to `/distribute` | Backward-compatible route alias. |
| `/feedback` | `Code/apps/web/src/pages/FeedbackPage.tsx` | User feedback management. |
| `/ai-feedback` | `Code/apps/web/src/pages/AiFeedbackPage.tsx` | AI feedback capture and review. |
| `/ai-chat` | `Code/apps/web/src/pages/AiChatPage.tsx` | AI assistant chat interface. |
| `/admin/users` | `Code/apps/web/src/pages/UserListPage.tsx` | Admin user listing and oversight actions. |
| `/admin/oversight` | `Code/apps/web/src/pages/PlatformOversightPage.tsx` | Platform telemetry and oversight dashboard. |
| `/admin/network-relations` | `Code/apps/web/src/pages/NetworkRelationsPage.tsx` | Admin network-relations configuration page. |
| `/user-management` | `Code/apps/web/src/pages/UserManagementPage.tsx` | User-level management tools. |
| `/guardian` | `Code/apps/web/src/pages/GuardianPage.tsx` | Discord Guardian moderation/admin UI. |

### Conditional Dev-Only Route

| Route | Page File | Purpose |
|---|---|---|
| `/setup` | `Code/apps/web/src/pages/SetupPage.tsx` | Localhost/dev setup wizard (gated via `isSetupAccessible`). |

### Fallback Route

| Route | Page File | Purpose |
|---|---|---|
| `*` | `Code/apps/web/src/pages/NotFoundPage.tsx` | 404 fallback. |

## Security

Secret scanning is enforced via [Gitleaks](https://github.com/gitleaks/gitleaks) on every PR and push to `main`. To run the full local security gate:

```bash
pnpm security:check
```

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities and secret rotation procedures.

## License

- **Source code:** [MIT License](LICENSE) (MIT).
  You may use, study, modify, self-host, and distribute Coordination Manager, including in private hosted deployments, subject to MIT notice and license requirements.
- **Documentation** (this README, files under `docs/`, etc.): [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (CC BY 4.0).
- **Trademarks & branding:** "Coordination Manager" and "Voltaire Swarm" are trademarks of Voltaire Swarm OÜ and are **not** covered by the MIT license. See [TRADEMARKS.md](TRADEMARKS.md). Forks must rebrand.

A copy of the full licence text is in [LICENSE](LICENSE). See [NOTICE](NOTICE) for attribution and third-party component information.

## Contributing

We welcome contributions. Before you open a pull request, please read:

- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow, conventions, expectations.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — community standards (Contributor Covenant 2.1).
- [CLA.md](CLA.md) — Contributor Licence Agreement (signed once via the GitHub bot on your first PR).
- [GOVERNANCE.md](GOVERNANCE.md) — how decisions are made.
- [SECURITY.md](SECURITY.md) — how to report security issues responsibly.

## Acknowledgments

- SingularityNET Ambassador Program
- Cardano governance communities and organisations (Swarm, Project Catalyst, Intersect)
- Built with Claude (Anthropic)
