---
name: devops
description: "Restart, stop, or start localhost dev servers safely without crashing VS Code. Use when: restart localhost, kill localhost, stop dev server, start dev server, restart dev, dev server management, port 5173, port 3001, catch up, dev state, what is running."
argument-hint: "e.g. restart, stop, start, status, or a specific service like web/api/bot"
---

# DevOps — Safe Localhost Management

## Why This Skill Exists

VS Code runs on Electron (Node.js). Careless process killing crashes the editor.
This skill documents the **only safe ways** to manage dev servers.

### Root Causes of Past Crashes

1. `Stop-Process -Force` sends `TerminateProcess` which corrupts VS Code's PTY
   (pseudo-terminal) layer — the integrated terminal host process destabilizes.
2. `pnpm dev` uses `concurrently` to run 5 services. Force-killing child PIDs
   leaves orphaned parent processes and broken terminal sessions in VS Code.
3. Port 24678 (Vite HMR websocket) may share connections with VS Code extensions.
4. Killing multiple PIDs in rapid succession overwhelms VS Code's terminal cleanup.

## Project Architecture

| Service          | Port  | Package                                  | Start Command     |
|------------------|-------|------------------------------------------|-------------------|
| Web (Vite)       | 5173  | `@coordination-manager/web`              | `pnpm dev:web`    |
| API (Express)    | 3001  | `@coordination-manager/api`              | `pnpm dev:api`    |
| Discord Bot      | 3002  | `@coordination-manager/discord-bot`      | `pnpm dev:bot`    |
| Discord Guardian | —     | `@coordination-manager/discord-guardian` | `pnpm dev:guardian` |
| Docs (Vite)      | 5174  | `@coordination-manager/docs`             | `pnpm dev:docs`   |
| Vite HMR         | 24678 | (shared by Vite services)                | —                 |

**Repo root:** contains `start.ps1` launcher
**Monorepo root:** `Code/` (contains `pnpm-workspace.yaml`)
**Run command (full stack):** `.\start.ps1` (or `pnpm dev:stack` from repo root)

## Pre-Flight Check (MANDATORY before every START/RESTART)

Before launching any dev server, the agent MUST:

1. **Count open terminals** — if there are more than 5 terminals visible in context,
   do NOT spawn new background terminals. Instead, tell the user:
   > "You have N terminals open. Please close unused terminals first
   > (right-click terminal tab → Kill Terminal), then ask me again."
2. **Run STATUS** (see below) to check if services are already listening.
3. **If services are already running**, use `pnpm restart` (or per-service restart)
   instead of spawning a new `pnpm dev` terminal. Never stack duplicate servers.
4. **If no services are running**, proceed with START using `start.ps1`.

**Why:** Each background terminal is a new `conhost.exe` + PTY pair. VS Code keeps
all of them alive. Accumulating 10+ terminals with running node processes causes
VS Code's Electron process to run out of handles/memory and crash.

### Terminal Hygiene Rules

- **One background dev terminal at a time** — never spawn a second `pnpm dev`.
- **Reuse existing terminals** for stop/status commands (non-background).
- **If >10 terminals are open**, the agent must warn the user to close unused ones
  before proceeding. Do NOT blindly add more.
- **After stopping servers**, there is no need to keep the stop terminal open.

## Procedures

### STATUS — Check What's Running

Before any action, check the current state. Run in a **non-background** terminal:

```powershell
Write-Host "`n=== Dev Server Status ===" -ForegroundColor Cyan
$ports = @(@{Name="Web";Port=5173}, @{Name="API";Port=3001}, @{Name="Guardian";Port=3002}, @{Name="Docs";Port=5174}, @{Name="HMR";Port=24678})
foreach ($svc in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $svc.Port -ErrorAction SilentlyContinue
    if ($conn) {
        $p = Get-Process -Id $conn.OwningProcess[0] -ErrorAction SilentlyContinue
        Write-Host "  $($svc.Name) (port $($svc.Port)): RUNNING (PID $($conn.OwningProcess[0]), $($p.ProcessName))" -ForegroundColor Green
    } else {
        Write-Host "  $($svc.Name) (port $($svc.Port)): stopped" -ForegroundColor DarkGray
    }
}
Write-Host ""
```

### STOP — Graceful Shutdown (Safe)

**Preferred: use the built-in pnpm script** (runs `scripts/stop-servers.js`):

```powershell
Set-Location "Code"; pnpm stop
```

To stop a single service:
```powershell
pnpm stop:web       # Web (port 5173)
pnpm stop:api       # API (port 3001)
pnpm stop:guardian   # Guardian (port 3002)
pnpm stop:docs      # Docs (port 5174)
```

Run in a **non-background** terminal, wait for completion.

### START — Launch Dev Servers

Use the repo-root launcher (required):

```powershell
.\start.ps1   # from the repository root
```

Or npm wrapper:

```powershell
pnpm dev:stack
```

This performs required sequence automatically:
1. Safe stop (`Code/scripts/stop-servers.js`)
2. Wait for release
3. Launch per-service terminals/tabs
4. Run health check (`check-health.ps1`)

### RESTART — Stop then Start

**Preferred: re-run launcher (includes health check):**

```powershell
.\start.ps1   # from the repository root
```

**Alternative (Code root):**

```powershell
Set-Location "Code"; pnpm restart
```

Or per-service:
```powershell
pnpm restart:web
pnpm restart:api
```

If running manually:
1. `pnpm stop` (non-background, wait for completion).
2. `.\start.ps1` from repo root.

**If a detached window is already running**, stop it first by finding the process:
```powershell
# Check for existing detached server windows
Get-Process powershell | Where-Object { $_.MainWindowTitle -like '*Dev Servers*' } | Select-Object Id, MainWindowTitle
```
Then close that window manually or use `Stop-Process -Id <pid>` on those PIDs only.

### STOP a Single Service

```powershell
pnpm stop:web       # port 5173
pnpm stop:api       # port 3001
pnpm stop:guardian   # port 3002
pnpm stop:docs      # port 5174
```

### START a Single Service

From the `Code/` directory, run as **background** terminal:

```powershell
pnpm dev:web       # Web only (port 5173)
pnpm dev:api       # API only (port 3001)
pnpm dev:bot       # Discord bot
pnpm dev:guardian   # Discord guardian (port 3002)
pnpm dev:docs      # Docs site (port 5174)
```

## Critical Rules — NEVER VIOLATE

1. **NEVER** `Stop-Process -Name node` — kills VS Code.
2. **NEVER** `Get-Process node | Stop-Process` — kills VS Code.
3. **NEVER** `taskkill /IM node.exe /F` — kills all node including VS Code.
4. **NEVER** `Stop-Process -Force` on a PID without first confirming it is NOT
   a `Code` process via `Get-Process -Id <pid>`.
5. **ALWAYS** collect VS Code PIDs first: `(Get-Process -Name "Code").Id` and
   exclude them from any kill list.
6. **ALWAYS** try graceful shutdown first (`taskkill /PID` without `/F`), wait
   1-2 seconds, then force-kill only survivors.
7. **NEVER** kill multiple PIDs in rapid succession without a sleep between batches.
8. **Run STOP in non-background terminal**, wait for full completion.
9. **Run START via `start.ps1` from repo root**.
10. **Start full stack from repo root with `start.ps1`; run per-service pnpm commands from `Code/`.**
11. **NEVER use `$pid` as a variable name** — it's a read-only PowerShell automatic variable.
12. **NEVER run stop and start in parallel** — always sequential with a pause between.
13. **NEVER spawn a new dev terminal if one is already running** — use restart instead.
14. **ALWAYS run pre-flight check** before any START — see "Pre-Flight Check" section.
15. **WARN user if >10 terminals are open** — VS Code crashes with too many PTY sessions.

## Catching Up — Dev State Context

When resuming a session or needing to understand current state, follow this checklist:

1. **Run STATUS** (above) to see which services are listening.
2. **Check for errors** — use `get_errors` tool with no file path to see all workspace errors.
3. **Check git status** — `git status --short` and `git log --oneline -5` to see recent changes.
4. **Read open file** — check the user's currently open editor file for context.
5. **Check terminal output** — use `get_terminal_output` on background terminals to see
   server logs and any runtime errors.

This gives a full picture of the dev environment state without guessing.
