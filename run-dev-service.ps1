# run-dev-service.ps1 - Entrypoint for a single CM dev service window/tab
# Usage:
#   .\run-dev-service.ps1 -Title "[CM] WEB" -CodeDir "C:\...\Code" -ServiceCommand "pnpm dev:web"

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ServiceName,

    [Parameter(Mandatory = $true)]
    [string]$Title,

    [Parameter(Mandatory = $true)]
    [string]$CodeDir,

    [Parameter(Mandatory = $true)]
    [string]$ServiceCommand,

    [string]$LogPath
)

$ErrorActionPreference = "Stop"

function Resolve-ExecutablePath {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$CandidateNames,

        [string[]]$CandidatePaths = @()
    )

    foreach ($name in $CandidateNames) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source) {
            return [string]$cmd.Source
        }
    }

    foreach ($path in $CandidatePaths) {
        if ($path -and (Test-Path $path)) {
            return [string]$path
        }
    }

    return $null
}

$markerDir = Join-Path $PSScriptRoot ".cm-stop-markers"
$markerPath = Join-Path $markerDir "$ServiceName.requested"
if (-not $LogPath) {
    $logDir = Join-Path $PSScriptRoot ".cm-dev-logs"
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $LogPath = Join-Path $logDir "$ServiceName.log"
} else {
    $logDir = Split-Path -Parent $LogPath
    if ($logDir) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
}

if (Test-Path $LogPath) {
    Remove-Item $LogPath -Force -ErrorAction SilentlyContinue
}

[Console]::Title = $Title
$Host.UI.RawUI.WindowTitle = $Title
Set-Location -LiteralPath $CodeDir

# Keep the intended title even if child shells/tools attempt to change it.
$__cmOriginalPrompt = $function:prompt
function global:prompt {
    [Console]::Title = $Title
    $Host.UI.RawUI.WindowTitle = $Title
    & $__cmOriginalPrompt
}

[Console]::Title = $Title
$Host.UI.RawUI.WindowTitle = $Title
try {
    # Some spawned shells miss user-level PATH entries (where pnpm usually lives).
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    if ($userPath -or $machinePath) {
        $env:Path = @($userPath, $machinePath) -join ';'
    }

    $resolvedServiceCommand = $ServiceCommand.Trim()
    if ($resolvedServiceCommand.Length -ge 2 -and $resolvedServiceCommand.StartsWith('"') -and $resolvedServiceCommand.EndsWith('"')) {
        $resolvedServiceCommand = $resolvedServiceCommand.Substring(1, $resolvedServiceCommand.Length - 2)
    }

    if ($resolvedServiceCommand -match '^\s*pnpm(\s|$)') {
        $pnpmPath = Resolve-ExecutablePath -CandidateNames @('pnpm.cmd', 'pnpm', 'pnpm.ps1') -CandidatePaths @(
            (Join-Path $env:APPDATA 'npm\pnpm.cmd'),
            (Join-Path $env:ProgramFiles 'nodejs\pnpm.cmd')
        )

        if ($pnpmPath) {
            $safePnpmPath = $pnpmPath.Replace('"', '""')
            $resolvedServiceCommand = $resolvedServiceCommand -replace '^\s*pnpm\b', "`"$safePnpmPath`""
        } else {
            $corepackPath = Resolve-ExecutablePath -CandidateNames @('corepack.cmd', 'corepack', 'corepack.ps1') -CandidatePaths @(
                (Join-Path $env:ProgramFiles 'nodejs\corepack.cmd')
            )

            if ($corepackPath) {
                $safeCorepackPath = $corepackPath.Replace('"', '""')
                $resolvedServiceCommand = $resolvedServiceCommand -replace '^\s*pnpm\b', "`"$safeCorepackPath`" pnpm"
            }
        }
    }

    $cmdCommand = $resolvedServiceCommand

    "Executing: $cmdCommand" | Tee-Object -FilePath $LogPath
    # Native output can bypass Start-Transcript. Pipe both streams to disk and the window.
    cmd.exe /C "$cmdCommand 2>&1" | Tee-Object -FilePath $LogPath -Append
    $serviceExitCode = $LASTEXITCODE
    if ($serviceExitCode -ne 0) {
        "ERROR: Service '$ServiceName' exited with code $serviceExitCode." | Tee-Object -FilePath $LogPath -Append
    }
} catch {
    "ERROR: Service '$ServiceName' could not run: $($_.Exception.Message)" | Tee-Object -FilePath $LogPath -Append
    throw
} finally {
    [Console]::Title = $Title
}

if (Test-Path $markerPath) {
    Remove-Item $markerPath -Force -ErrorAction SilentlyContinue
    exit 0
}

Write-Host "Service '$ServiceName' exited unexpectedly. Keeping this tab open for diagnostics."
Read-Host 'Press Enter to close this tab'
