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
- `.claude/skills/session-first-message-clarity/SKILL.md`
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
