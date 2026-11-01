# Page Manifests

## Contents

- Composition Groups
- Composition Conventions
- Page Anatomy and Density
- Adding a Page (checklist)

Derived from `Code/apps/web/src/App.tsx`. Every page is
lazy-loaded via `React.lazy()` inside one shared `Suspense` boundary (spinner
fallback). Adding a page = new lazy import + route entry; pages live in
`Code/apps/web/src/pages/`.

## Composition Groups

### 1. No-layout routes (standalone)

| Route | Page | Notes |
|-------|------|-------|
| `/auth/login` | auth/LoginPage | |
| `/auth/callback` | auth/AuthCallbackPage | |
| `/join/invite/:code` | AcceptInvitePage | Guest invite flow |
| `/join/:hash` | GuestBookingPage | Distraction-free participant flow; hash URL, never raw UUID |
| `/policy`, `/privacy`, `/trademark`, `/terms`, `/email-abuse`, `/zoom-review` | Legal pages | Standalone legal/proposal docs |
| `/proposals/video-meeting`, `/proposals/data-privacy` | Proposal pages | Shared with users + sponsors |

### 2. Public routes inside AppShell (`Layout`)

| Route | Page | Logical ID root |
|-------|------|-----------------|
| `/` | HomePage (wrapped in HomeRoute) | `home` |
| `/setup` | SetupPage | `setup` -- localhost/dev only, hidden in production via `isSetupAccessible()` |
| `/calendars` | EventsPage | `calendars` (`/events` redirects here) |
| `/events-calendar` | EventsCalendarPage | `events-calendar` |
| `/time-management` | TimeManagementPage | `time-management` |
| `/calendar` | CalendarPage `key="create"` | `calendar.create` |
| `/calendar/:hash` | CalendarPage `key="view"` | `calendar.view` -- hash-based URL |
| `/meeting/:meetingId` | MeetingPage | `meeting` |
| `/support` | SupportPage | `support` |

### 3. Protected routes (ProtectedRoute + AppShell)

| Route | Page | Logical ID root |
|-------|------|-----------------|
| `/settings` | SettingsPage | `settings` (hosts `settings.theme-creator`) |
| `/coordinate-events` | CoordinateEventsPage | `coordinate-events` |
| `/mailbox` | MailboxPage | `mailbox` (tabs: `mailbox.tab-bar`) |
| `/distribute` | AnnouncementsPage | `distribute` (`/announcements` redirects here) |
| `/feedback` | FeedbackPage | `feedback` |
| `/ai-feedback` | AiFeedbackPage | `ai-feedback` |
| `/ai-chat` | AiChatPage | `ai-chat` |
| `/admin/users` | UserListPage | `admin.users` |
| `/admin/oversight` | PlatformOversightPage | `admin.oversight` |
| `/admin/network-relations` | NetworkRelationsPage | `admin.network-relations` |
| `/user-management` | UserManagementPage | `user-management` |
| `/guardian` | GuardianPage | `guardian` |

### 4. Catch-all

| `*` | NotFoundPage | `not-found` |

## Composition Conventions

1. **Lazy + Suspense**: one boundary at the root; fallback is a centered
   spinner (`animate-spin rounded-full border-b-2`).
2. **Key-forced remount**: same component, different mode = different `key`
   (`CalendarPage key="create"/"view"`). Prefer this over in-component mode
   resets.
3. **Redirects**: legacy paths use `<Navigate to=... replace>`, never silent
   dual routes.
4. **Early returns** only for initial loading/error when no usable content
   exists. Background refresh loading/errors keep the visible content, local
   drafts, selection and viewport (`.claude/rules/conventions.md`).
5. **URL identity**: user-facing calendar URLs carry a 10-char nanoid hash,
   never raw UUIDs (security rule).
6. **Page context for AI**: pages inside `Layout` may publish context via
   `useAiAssistant()` `setPageContext`; the AI Assistant panel
   (`AiGuideSidePanel`) consumes it. No-layout routes get no-op defaults.

## Page Anatomy and Density

These are composition rules, not yet shared React primitives. Pages may use
local markup until reusable components are approved and built.

| Pattern | Anatomy | Rule |
|---------|---------|------|
| Page header | title, optional description, primary page action | One solid primary at most; secondary actions are outline primary or neutral |
| Section | heading, optional description, optional toolbar, content | A section does not have to be wrapped in a card; collapsible = `Disclosure`. A Settings deep-link target needs a heading (`h2`/`h3`) or a `data-section-heading` element: the shine highlight lands only there, never on the whole block |
| Card | bounded surface, optional title/description/content/actions | Use only when boundedness carries meaning; do not card-wrap every section |
| Toolbar | filters and actions | Stable control height; keep related filters together |
| Form field | label, control, help, validation | Associate label/control and keep validation adjacent |
| Stat display | main metric, optional secondary metrics | Quantities use `CountBadge`/`ScoreDisplay`, not status color |

Density has two supported *profiles*, selected for a page or a coherent region:

- **Standard** is the default and uses the shared control heights and body type.
- **Compact** is for genuinely dense work surfaces such as mailbox tables and
   calendar grids. It reduces gaps and control padding; it does not shrink label
   text or selectively miniaturize only some controls.

The repository has no `PageHeader`, `Section`, `Toolbar`, `FormField`, or
`StatCard` component yet. Until those are built, treat the anatomy above as a
review contract, not an importable API.

## Adding a Page (checklist)

1. Create `src/pages/{Name}Page.tsx` (PascalCase, `Page` suffix).
2. Add lazy import + route in the correct group above.
3. Assign a stable logical ID root (`{area}` or `{area}.{sub}`).
4. Decide data states up front: `loading`, `empty`, `error`, `ready`.
5. If it adds a new canonical component type, update
   `vocabulary` in the same proposal.
