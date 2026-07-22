# Coordination Manager Root Copilot Instructions

When the user message is exactly or clearly equivalent to "Prepare Public PR":
- Treat it as an execution request.
- Run the full release loop from repository root with:
  - pnpm prepare:public-pr
- If any stage fails, apply fixes and restart from stage 1.
- Do not skip stages unless the user explicitly requests a skip variant.

Optional variants only when explicitly requested:
- pnpm release:loop:no-ci
- pnpm release:loop:prep
