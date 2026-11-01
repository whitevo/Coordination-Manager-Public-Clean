import { CodeBlock } from '../components/CodeBlock'
import { Callout } from '../components/Callout'
import { Link } from 'react-router-dom'

export function ArchitecturePage() {
  return (
    <div className="prose-docs">
      <h1>Technical Architecture</h1>
      <p className="text-lg text-gray-400 mb-8">
        Coordination Manager is a monorepo with a React frontend, Express API backend,
        Supabase database, and first-class support for AI agent integrations.
      </p>

      <h2>High-Level Diagram</h2>
      <div className="bg-surface-850 border border-surface-700 rounded-lg p-6 mb-6 font-mono text-sm text-gray-300">
        <pre className="bg-transparent! border-0! p-0! mb-0!">{`
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│   React Web UI  │────▶│   Express API    │────▶│   Supabase   │
│   (Vite, TS)    │     │   (Node.js, TS)  │     │  (PostgreSQL)│
│   port: 5173    │     │   port: 3001     │     │              │
└─────────────────┘     └──────────────────┘     └──────────────┘
                              ▲
                              │  Bearer Token Auth
                        ┌─────┴──────┐
                        │  AI Agents │
                        │  (uAgents, │
                        │  LangChain,│
                        │  custom)   │
                        └────────────┘
        `}</pre>
      </div>

      <h2>Technology Stack</h2>
      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>Technology</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Frontend</td><td>React 19 + TypeScript + Vite</td><td>Web UI for calendar management, meeting scheduling</td></tr>
          <tr><td>Styling</td><td>TailwindCSS + shadcn/ui</td><td>Component library with dark/light themes</td></tr>
          <tr><td>Backend</td><td>Node.js + Express + TypeScript</td><td>REST API with auth, rate limiting, validation</td></tr>
          <tr><td>Database</td><td>Supabase (PostgreSQL)</td><td>User data, calendars, availability, meetings</td></tr>
          <tr><td>Auth</td><td>Supabase Auth + Agent API Keys</td><td>User sessions + scoped agent tokens</td></tr>
          <tr><td>Integrations</td><td>Discord.js, Google Calendar API</td><td>Notifications and calendar sync</td></tr>
          <tr><td>Agent integrations</td><td>REST Agent API</td><td>External clients using scoped API keys</td></tr>
          <tr><td>Deployment</td><td>Vercel (web) + Railway (API)</td><td>Production hosting</td></tr>
        </tbody>
      </table>

      <h2>Project Structure</h2>
      <CodeBlock language="text" title="Monorepo Layout">{`coordination-manager/
├── apps/
│   ├── web/                 # React frontend (Vite)
│   ├── api/                 # Express backend
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── agent-api.ts    ← Agent API endpoints
│   │       │   ├── calendars.ts
│   │       │   ├── meetings.ts
│   │       │   ├── announcements.ts
│   │       │   └── ...
│   │       ├── middleware/
│   │       └── services/
│   ├── discord-bot/         # Discord bot for notifications
│   └── docs/                # This documentation site
├── packages/
│   ├── database/            # SQL migrations & schema
│   └── shared/              # Shared types
└── docs/                    # Internal AI context docs`}</CodeBlock>

      <h2>Agent API Architecture</h2>
      <p>
        The Agent API lives at <code>/api/agent/*</code> and uses a separate authentication
        mechanism from the web UI. Agents authenticate with Bearer tokens (API keys) that
        are scoped to specific permissions.
      </p>

      <h3>Security Model</h3>
      <ul>
        <li>
          <strong>Bearer token auth</strong> — each API key is stored in <code>agent_api_keys</code> table
          with a user association, scopes, and optional expiration.
        </li>
        <li>
          <strong>Scope-based access</strong> — keys can be granted fine-grained scopes:
          <code>read</code>, <code>write:calendars</code>, <code>write:meetings</code>,
          <code>write:announcements</code>, <code>write:feedback</code>, or <code>*</code> (wildcard).
        </li>
        <li>
          <strong>Human-in-the-loop</strong> — write operations create <em>draft</em> resources.
          Distribution (sending announcements, exporting meetings) always requires human approval
          via the web UI.
        </li>
      </ul>

      <Callout variant="info" title="Rate Limiting">
        The API has a global rate limit of 1,200 requests per 15 minutes per socket address, with
        stricter per-feature limits on authentication, AI, mailbox, and write endpoints. Localhost
        traffic is exempt during development. See <Link to="/limits">Limits</Link> for the full
        breakdown, including AI usage quotas.
      </Callout>

      <h2>Production Security Evidence</h2>
      <p>
        Production runs with the web app on Vercel and the API on Railway. Security assessment
        evidence should be collected from the deployed domains, not from localhost, because TLS,
        DNS, security headers, and deployment secrets are platform-level controls.
      </p>
      <ul>
        <li>
          <strong>TLS and certificates</strong> -- export Qualys SSL Labs results for the frontend
          and API domains, showing trusted certificates and TLS 1.2+ support.
        </li>
        <li>
          <strong>Security headers</strong> -- capture deployed response headers showing HSTS,
          Content Security Policy, <code>X-Frame-Options</code>, and <code>X-Content-Type-Options</code>.
        </li>
        <li>
          <strong>Secrets</strong> -- keep private screenshots or exports showing sensitive values
          stored in Vercel, Railway, and Supabase secret stores rather than source files.
        </li>
        <li>
          <strong>DNS ownership</strong> -- export DNS records and confirm third-party CNAME targets
          are claimed and active to prevent subdomain takeover.
        </li>
      </ul>
      <p>
        The complete security-assessment evidence checklist lives in the
        <Link to="/legal/security-policy"> Security Policy</Link>.
      </p>

      <h2>Data Flow</h2>
      <ol>
        <li>Users create a <strong>coordination calendar</strong> in the web UI (or an agent creates one via API).</li>
        <li>Participants submit their <strong>availability</strong> on the shared calendar page.</li>
        <li>An agent (or the AI chat) analyzes <strong>overlapping availability</strong> and proposes the optimal meeting time.</li>
        <li>The meeting is created as a <strong>draft</strong> — the calendar owner reviews and approves.</li>
        <li>Optionally, an <strong>announcement template</strong> is created for distribution via Discord.</li>
      </ol>
    </div>
  )
}
