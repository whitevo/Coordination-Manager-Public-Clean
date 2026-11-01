# Coordination Manager Root Copilot Instructions

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

Skip this protocol only for pure factual questions or trivial one-line ops.

When the user message is exactly or clearly equivalent to "Prepare Public PR":
- Treat it as an execution request.
- Run the full release loop from repository root with:
  - pnpm prepare:public-pr
- If any stage fails, apply fixes and restart from stage 1.
- Do not skip stages unless the user explicitly requests a skip variant.

Optional variants only when explicitly requested:
- pnpm release:loop:no-ci
- pnpm release:loop:prep

## Test & Verification Execution

When executing tests, typechecks, or linters:
- Prefer using the local MCP test runner tools (`run_vitest`, `run_typecheck`, `run_lint`, `run_custom_scenario`) when available, or clean single-line commands (e.g. `pnpm --dir ./Code/apps/web vitest run <file>` or `powershell -File ./scripts/test-web-copilot.ps1 -Target <file>`).
- Do NOT chain multi-statement PowerShell scripts with variable assignments (`$x = $LASTEXITCODE`) or conditional blocks (`if ($x -ne 0) { exit 1 }`) in interactive terminals, as they trip VS Code terminal approval checks.
- Before running any terminal validation command, do this low-cost command-shape check:
  - Pass: one direct command such as `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm security:check`, `pnpm --dir ./Code/apps/web exec vitest run <file>`, or `git -C <repo> status --short --branch`.
  - Fail: command contains `foreach`, `$LASTEXITCODE`, `$step`, `if (...) { exit ... }`, or multiple validation commands joined by `;`, `&&`, or `||`.
  - If it fails, split the work into separate MCP runner calls or separate clean terminal commands instead of asking for approval on the chained command.
