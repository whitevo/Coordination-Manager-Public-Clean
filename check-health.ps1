# check-health.ps1 - Verify all dev services are responding
# Usage: .\check-health.ps1 [-StartupDelaySeconds 8] [-StateFile .cm-dev-state.json]

[CmdletBinding()]
param(
    [int]$StartupDelaySeconds = 8,
    [int]$MaxWaitSeconds = 45,
    [int]$PollIntervalSeconds = 3,
    [int]$ObservationSeconds = 6,
    [int]$LogTailLines = 120,
    [string]$StateFile = (Join-Path $(if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }) ".cm-dev-state.json"),
    [ValidateSet("full", "localhost")]
    [string]$Mode = "full"
)

$ErrorActionPreference = "Stop"
$rootDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
$defaultLogDir = Join-Path $rootDir ".cm-dev-logs"

$consoleErrorPatterns = @(
    '(?i)\\bunhandled rejection\\b',
    '(?i)\\buncaught exception\\b',
    '(?i)\\bexception\\b',
    '(?i)\\bfatal\\b',
    '(?i)\\bvalidationerror\\b',
    '(?i)\\bfail(?:ed|ure)?\\b',
    '(?i)\\berror\\b',
    '(?i)\\bwarn(?:ing)?\\b'
)

$consoleIgnorePatterns = @(
    '(?i)\\b0\\s+errors?\\b',
    '(?i)\\bno\\s+errors?\\b',
    '(?i)\\bwithout\\s+errors?\\b',
    '(?i)\\b0\\s+warnings?\\b',
    '(?i)\\bno\\s+warnings?\\b',
    '(?i)\\bwithout\\s+warnings?\\b'
)

function Get-ServiceLogMap {
    param(
        [string]$StateFilePath,
        [string]$FallbackLogDir
    )

    $map = @{}

    if (Test-Path $StateFilePath) {
        try {
            $state = Get-Content -Path $StateFilePath -Raw | ConvertFrom-Json
            if ($state.services) {
                foreach ($svc in $state.services) {
                    if (-not $svc.name) { continue }

                    if ($svc.logPath) {
                        $map[$svc.name] = [string]$svc.logPath
                        continue
                    }

                    $map[$svc.name] = Join-Path $FallbackLogDir ("{0}.log" -f $svc.name)
                }
            }
        } catch {
            # If state is unreadable, continue with fallback log paths.
        }
    }

    foreach ($svcName in @('web', 'api', 'bot', 'guardian', 'docs')) {
        if (-not $map.ContainsKey($svcName)) {
            $map[$svcName] = Join-Path $FallbackLogDir ("{0}.log" -f $svcName)
        }
    }

    return $map
}

function Test-ServiceConsoleLog {
    param(
        [string]$ServiceName,
        [string]$LogPath,
        [int]$TailLines,
        [string[]]$Patterns,
        [string[]]$IgnorePatterns
    )

    if (-not (Test-Path $LogPath)) {
        return [pscustomobject]@{ ok = $true; detail = "No console log file yet" }
    }

    try {
        $lines = @(Get-Content -Path $LogPath -Tail $TailLines -ErrorAction Stop)
    } catch {
        return [pscustomobject]@{ ok = $false; detail = "Cannot read console log: $($_.Exception.Message)" }
    }

    if ($lines.Count -eq 0) {
        return [pscustomobject]@{ ok = $true; detail = "No console output yet" }
    }

    for ($idx = $lines.Count - 1; $idx -ge 0; $idx--) {
        $line = $lines[$idx]
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        $match = Select-String -InputObject $line -Pattern $Patterns -AllMatches
        if (-not $match) { continue }

        $isIgnored = $false
        foreach ($ignorePattern in $IgnorePatterns) {
            if ($line -match $ignorePattern) {
                $isIgnored = $true
                break
            }
        }
        if ($isIgnored) { continue }

        $snippet = $line.Trim()
        if ($snippet.Length -gt 180) {
            $snippet = $snippet.Substring(0, 180) + '...'
        }

        return [pscustomobject]@{ ok = $false; detail = "Console contains error text: $snippet" }
    }

    return [pscustomobject]@{ ok = $true; detail = "No error keywords in recent console output" }
}

function Test-Http {
    param(
        [string]$Url,
        [int]$ExpectedStatusCode = 200
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 6
        return [pscustomobject]@{
            ok = ($response.StatusCode -eq $ExpectedStatusCode)
            detail = "HTTP $($response.StatusCode)"
        }
    } catch {
        return [pscustomobject]@{
            ok = $false
            detail = $_.Exception.Message
        }
    }
}

function Test-ListeningPort {
    param([int]$Port)

    try {
        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($listener) {
            return [pscustomobject]@{ ok = $true; detail = "TCP listener active" }
        }

        return [pscustomobject]@{ ok = $false; detail = "No listener detected" }
    } catch {
        return [pscustomobject]@{ ok = $false; detail = $_.Exception.Message }
    }
}

function Test-GuardianProcess {
    try {
        $guardianNode = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq "node.exe" -and
                $_.CommandLine -and
                $_.CommandLine -match "discord-guardian"
            } |
            Select-Object -First 1

        if ($guardianNode) {
            return [pscustomobject]@{ ok = $true; detail = "Node PID $($guardianNode.ProcessId) running" }
        }

        return [pscustomobject]@{ ok = $false; detail = "No discord-guardian node process detected" }
    } catch {
        return [pscustomobject]@{ ok = $false; detail = $_.Exception.Message }
    }
}

Start-Sleep -Seconds $StartupDelaySeconds

$deadline = (Get-Date).AddSeconds($MaxWaitSeconds)
$stableSince = $null
$serviceLogMap = Get-ServiceLogMap -StateFilePath $StateFile -FallbackLogDir $defaultLogDir
$serviceChecks = @(
    [pscustomobject]@{ id = "web"; service = "Web"; endpoint = "http://localhost:5173"; tester = { Test-Http -Url "http://localhost:5173" } },
    [pscustomobject]@{ id = "api"; service = "API"; endpoint = "http://localhost:3001/health"; tester = { Test-Http -Url "http://localhost:3001/health" } },
    [pscustomobject]@{ id = "bot"; service = "Bot"; endpoint = "localhost:3002"; tester = { Test-ListeningPort -Port 3002 } },
    [pscustomobject]@{ id = "guardian"; service = "Guardian"; endpoint = "console-only"; tester = { Test-GuardianProcess } },
    [pscustomobject]@{ id = "docs"; service = "Docs"; endpoint = "http://localhost:5174"; tester = { Test-Http -Url "http://localhost:5174" } }
)

if ($Mode -eq "localhost") {
    $serviceChecks = @(
        [pscustomobject]@{ id = "web"; service = "Web"; endpoint = "http://localhost:5173"; tester = { Test-Http -Url "http://localhost:5173" } },
        [pscustomobject]@{ id = "api"; service = "API"; endpoint = "http://localhost:3001/health"; tester = { Test-Http -Url "http://localhost:3001/health" } }
    )
}

$latestResults = @{}

while ((Get-Date) -lt $deadline) {
    $allPassNow = $true

    foreach ($serviceCheck in $serviceChecks) {
        $transportResult = & $serviceCheck.tester
        $logPath = $serviceLogMap[$serviceCheck.id]
        $consoleResult = Test-ServiceConsoleLog -ServiceName $serviceCheck.service -LogPath $logPath -TailLines $LogTailLines -Patterns $consoleErrorPatterns -IgnorePatterns $consoleIgnorePatterns

        $combined = [pscustomobject]@{
            ok = ($transportResult.ok -and $consoleResult.ok)
            detail = if ($consoleResult.ok) {
                $transportResult.detail
            } else {
                "{0} | {1}" -f $transportResult.detail, $consoleResult.detail
            }
        }

        $latestResults[$serviceCheck.service] = $combined
        if (-not $combined.ok) {
            $allPassNow = $false
        }
    }

    if ($allPassNow) {
        if (-not $stableSince) {
            $stableSince = Get-Date
        }

        $stableDuration = ((Get-Date) - $stableSince).TotalSeconds
        if ($stableDuration -ge $ObservationSeconds) {
            break
        }
    } else {
        $stableSince = $null
    }

    Start-Sleep -Seconds $PollIntervalSeconds
}

$results = foreach ($serviceCheck in $serviceChecks) {
    [pscustomobject]@{
        service = $serviceCheck.service
        endpoint = $serviceCheck.endpoint
        check = $latestResults[$serviceCheck.service]
    }
}

$allPass = $true
Write-Host "Coordination Manager Health"
Write-Host "---------------------------"
foreach ($result in $results) {
    $status = if ($result.check.ok) { "PASS" } else { "FAIL" }
    if (-not $result.check.ok) {
        $allPass = $false
    }

    Write-Host ("[{0}] {1} ({2}) - {3}" -f $status, $result.service, $result.endpoint, $result.check.detail)
}

if ($allPass) {
    Write-Host "Result: ALL SERVICES HEALTHY"
    exit 0
}

Write-Host "Result: FAILURES DETECTED"
exit 1
