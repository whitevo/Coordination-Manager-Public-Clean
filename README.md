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

## Tech Stack

- **Frontend:** React 18 + TypeScript, Vite, TailwindCSS, React Router, Axios
- **Backend:** Node.js + Express, TypeScript
- **Database:** Supabase (PostgreSQL) with Row Level Security
- **Auth:** Supabase Auth (Google OAuth + anonymous/traveler accounts + Cardano Wallets)
- **Monorepo:** pnpm workspaces

## Prerequisites

- Node.js 20+
- pnpm
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

Run the consolidated schema in the Supabase SQL Editor:

```
-- Copy and run the contents of:
-- packages/database/migrations/000_full_schema.sql
```

This creates all tables, indexes, RLS policies, and the traveler cleanup function in one step.
For a fresh database, run only this file. The other `000_feature-*.sql` files are incremental feature migrations for existing databases and do not need to be run separately during initial setup.

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
```

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
