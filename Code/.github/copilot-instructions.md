<!-- Use this file to provide workspace-specific custom instructions to Copilot. -->

## Session First-Message Clarity Protocol

For the first substantive user message in each new chat session, run a clarity
pass before implementation:

1. Evaluate if the request has enough detail to implement safely.
2. If details are missing, ask up to 3 focused clarification questions.
3. Return a formalized implementation-ready brief with:
	- Objective
	- As-Is
	- To-Be
	- Scope in/out
	- Assumptions and risks
	- Acceptance checks
4. Ask for explicit confirmation to proceed:
	- Approve and start
	- Refine requirements
	- Quick start with stated assumptions

Use skill guidance from:
- `.claude/skills/prompt-enhancement-agent/SKILL.md`

Skip this protocol only for pure factual questions or trivial one-line ops
(for example date/time/version checks).

- [x] Verify that the copilot-instructions.md file in the .github directory is created.

- [x] Clarify Project Requirements
	<!-- Event Scheduling and Notification System: React 18 + TypeScript + Vite + TailwindCSS + shadcn/ui frontend, Node.js + Express + TypeScript backend, Supabase PostgreSQL database, Google Calendar API and Discord.js integrations -->

- [ ] Scaffold the Project
	<!-- Create monorepo structure with pnpm workspaces, frontend and backend apps -->

- [ ] Customize the Project
	<!-- Configure TypeScript, ESLint, Prettier, TailwindCSS, shadcn/ui, and set up folder structures -->

- [ ] Install Required Extensions
	<!-- No specific extensions required at this stage -->

- [ ] Compile the Project
	<!-- Install dependencies and verify builds -->
	<!-- When implementation is complete, run the relevant app tests automatically; do not ask for separate permission before running them. -->

- [ ] Create and Run Task
	<!-- Create tasks for running dev servers -->

- [ ] Launch the Project
	<!-- Run dev servers with the repo-root launcher script -->
	<!-- IMPORTANT: Always start full stack with `.\start.ps1` from repo root (or `pnpm dev:stack`).
	     This enforces the required sequence: safe stop -> wait -> launch terminals -> health check.
	     Do NOT use ad-hoc detached `pnpm dev` for full-stack startup. -->

- [ ] Ensure Documentation is Complete
	<!-- Verify README.md and all documentation is current -->

## React Component Code-Quality Rules

### Variable Declaration Order (Temporal Dead Zone Prevention)
When adding new `useState`, `useRef`, or any variable declaration inside a React component:
- **ALWAYS** declare derived variables (`const [a, b] = x.split(...)`) BEFORE any `useState()` that references them.
- `const` and `let` are NOT hoisted like `var` -- using them before their declaration causes a runtime `ReferenceError` (temporal dead zone crash).
- TypeScript does NOT catch TDZ errors at compile time, so they only appear as runtime crashes.
- **After adding new state**: visually verify that every variable used in a `useState()` initializer is declared on a PRIOR line.

Example of a crash:
```tsx
// BAD -- dateStr is used before declaration (TDZ crash)
const [localDate, setLocalDate] = useState(dateStr)
const [dateStr, timeStr] = safeCell.split('_')

// GOOD -- declaration before use
const [dateStr, timeStr] = safeCell.split('_')
const [localDate, setLocalDate] = useState(dateStr)
```

## Release Loop Trigger Rules

When the user message is exactly or clearly equivalent to "Prepare Public PR":
- Treat it as an execution request, not a planning request.
- Immediately run the full release loop command from repository root:
	- `pnpm release:loop`
- If any stage fails, apply fixes and restart from stage 1 by rerunning the same command.
- Do not skip stages unless the user explicitly asks for a skip variant.
- On success, continue to open-source sync preparation steps and report readiness for PR creation.
