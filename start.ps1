# start.ps1 - Launch dev servers in external PowerShell windows
# Usage: .\start.ps1 [-SkipHealthCheck] [-StartupDelaySeconds 8]

[CmdletBinding()]
param(
	[switch]$SkipHealthCheck,
	[int]$StartupDelaySeconds = 8,
	[ValidateSet("full", "localhost")]
	[string]$Mode = "full"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$code = Join-Path $root "Code"
$stateFile = Join-Path $root ".cm-dev-state.json"
$logDir = Join-Path $root ".cm-dev-logs"
$serviceRunner = Join-Path $root "run-dev-service.ps1"
$markerDir = Join-Path $root ".cm-stop-markers"
$tag = "[CM]"
$hasWindowsTerminal = $null -ne (Get-Command wt -ErrorAction SilentlyContinue)
$pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
$powershellCommand = Get-Command powershell -ErrorAction SilentlyContinue
if ($pwshCommand) {
	$shellExe = $pwshCommand.Path
} elseif ($powershellCommand) {
	$shellExe = $powershellCommand.Path
} else {
	throw "Neither 'pwsh' nor 'powershell' is available on PATH."
}
$wtWindowName = "cm-dev"
$wtProfileName = "CM PowerShell"
# Opt-in only: set CM_USE_WT=1 to use wt tabs.
$useWindowsTerminal = $hasWindowsTerminal -and $env:CM_USE_WT -eq "1"

$services = @(
	@{ Name = "web"; Title = "$tag Front End"; Command = "pnpm dev:web" },
	@{ Name = "api"; Title = "$tag API Server"; Command = "pnpm dev:api" },
	@{ Name = "bot"; Title = "$tag Coordination Bot"; Command = "pnpm dev:bot" },
	@{ Name = "guardian"; Title = "$tag Guardian Bot"; Command = "pnpm dev:guardian" },
	@{ Name = "docs"; Title = "$tag Wiki"; Command = "pnpm dev:docs" }
)

if ($Mode -eq "localhost") {
	$services = @(
		@{ Name = "web"; Title = "$tag Front End"; Command = "pnpm dev:web" },
		@{ Name = "api"; Title = "$tag API Server"; Command = "pnpm dev:api" }
	)
}

Write-Host "[1/3] Stopping existing dev processes..."
node "$code\scripts\stop-servers.js"

Write-Host "[2/3] Waiting for clean port release..."
Start-Sleep -Seconds 2

if (Test-Path $markerDir) {
	Remove-Item $markerDir -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $logDir) {
	Remove-Item $logDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

Write-Host "[3/3] Launching service windows..."
$launched = @()

foreach ($service in $services) {
	$serviceLogPath = Join-Path $logDir ("{0}.log" -f $service.Name)
	$runnerArgs = @(
		"-ExecutionPolicy", "Bypass", "-File", "`"$serviceRunner`"",
		"-ServiceName", $service.Name,
		"-Title", "`"$($service.Title)`"",
		"-CodeDir", "`"$code`"",
		"-ServiceCommand", "`"$($service.Command)`"",
		"-LogPath", "`"$serviceLogPath`""
	)

	if ($useWindowsTerminal) {
		$wtArgs = @("-w", $wtWindowName, "new-tab", "-p", $wtProfileName)
		$wtArgs += @(
			"--title", $service.Title,
			"--suppressApplicationTitle",
			"--",
			$shellExe,
			"-ExecutionPolicy", "Bypass",
			"-File", $serviceRunner,
			"-ServiceName", $service.Name,
			"-Title", $service.Title,
			"-CodeDir", $code,
			"-ServiceCommand", $service.Command,
			"-LogPath", $serviceLogPath
		)
		$proc = Start-Process wt -ArgumentList $wtArgs -WorkingDirectory $code -PassThru
		$launchMode = "windows-terminal-tab"
	} else {
		$proc = Start-Process $shellExe -ArgumentList $runnerArgs -WorkingDirectory $code -PassThru
		$launchMode = "powershell-window"
	}

	$launched += [pscustomobject]@{
		name = $service.Name
		title = $service.Title
		command = $service.Command
		logPath = $serviceLogPath
		launcherPid = $proc.Id
		launchMode = $launchMode
		startedAt = (Get-Date).ToString("o")
	}

	Write-Host ("  Launched {0}: PID {1}, title '{2}', mode={3}" -f $service.Name, $proc.Id, $service.Title, $launchMode)

	# Windows Terminal can miss rapid consecutive new-tab calls while the window initializes.
	Start-Sleep -Milliseconds 250
}

$state = [pscustomobject]@{
	tag = $tag
	root = $root
	codeDir = $code
	launchedAt = (Get-Date).ToString("o")
	services = $launched
}

$state | ConvertTo-Json -Depth 5 | Set-Content -Path $stateFile -Encoding utf8
Write-Host "State saved: $stateFile"

if (-not $SkipHealthCheck) {
	Write-Host "Running health check..."
	& "$root\check-health.ps1" -StartupDelaySeconds $StartupDelaySeconds -StateFile $stateFile -Mode $Mode
	exit $LASTEXITCODE
}

Write-Host "Stack launch command complete. Health check skipped by flag."
