---
name: run-coordination-manager
description: Starts the Coordination Manager localhost frontend, API, and docs with pnpm dev:stack:localhost and reports each service's health-check result, without the Discord bot or guardian. Use when the user invokes /run-coordination-manager or asks to start the localhost frontend, API and docs.
user-invocable: true
disable-model-invocation: true
---

# run-coordination-manager

This is an execution command, not a request for a plan or intent scaffolding.

## Workflow

1. Run `pnpm dev:stack:localhost` from the repository root. The launcher stops existing managed dev services before starting the selected services in dedicated terminals.
2. Keep health checks enabled unless the user explicitly asks to skip them. Do not substitute the full-stack `pnpm dev:stack` command.
3. Wait for the launcher and health check to finish. Report each service's actual health-check result and any startup errors. Never claim success when a service fails.
4. Return the service URLs:
   - Frontend: http://localhost:5173
   - API health: http://localhost:3001/health
   - Docs: http://localhost:5174

Related variants (only when asked): `pnpm dev:stack:localhost:no-check` skips the health check; `pnpm dev:health:localhost` re-runs just the localhost health check. Other start/stop/restart work: dev-server-workflow.
