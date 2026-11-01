# check-health.ps1 - Verify all dev services are responding
# Usage: .\check-health.ps1 [-StartupDelaySeconds 3] [-StateFile .cm-dev-state.json] [-Mode full|localhost]

[CmdletBinding()]
param(
    [int]$StartupDelaySeconds = 3,
    [int]$MaxWaitSeconds = 45,
    [int]$PollIntervalSeconds = 2,
    [int]$ObservationSeconds = 4,
    [ValidateRange(0, 2147483647)]
    [int]$LogTailLines = 0,
    [string]$StateFile = (Join-Path $(if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }) ".cm-dev-state.json"),
    [ValidateSet("full", "localhost")]
    [string]$Mode = "full"
)

$ErrorActionPreference = "Stop"
$rootDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
$defaultLogDir = Join-Path $rootDir ".cm-dev-logs"

$consoleErrorPatterns = @(
    '(?i)\bunhandled rejection\b',
    '(?i)\buncaught exception\b',
    '(?i)\bfatal\b',
    '(?i)\bvalidationerror\b',
    '(?i)\bfailed(?:\s+to)?\b',
    '(?i)\berror:\s',
    '(?i)\bexception:\s',
    '(?i)\berr\b'
)

$consoleWarningPatterns = @(
    '(?i)\bwarn(?:ing)?s?\b',
    '(?i)\bdeprecated\b',
    '(?i)PostCSS plugin did not pass'
)

$consoleIgnorePatterns = @(
    '(?i)\bfailed=0(?=\s|$|[,;])',
    '(?i)\b0\s+errors?\b',
    '(?i)\bno\s+errors?\b',
    '(?i)\bwithout\s+errors?\b',
    '(?i)\b0\s+warnings?\b',
    '(?i)\bno\s+warnings?\b',
    '(?i)\bwithout\s+warnings?\b'
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
            Write-Warning "Cannot read service state '$StateFilePath': $($_.Exception.Message). Using fallback log paths."
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
        [string[]]$WarningPatterns,
        [string[]]$IgnorePatterns
    )

    if (-not (Test-Path $LogPath)) {
        return [pscustomobject]@{ ok = $true; warning = $true; detail = "Console log missing; diagnostics unavailable: $LogPath" }
    }

    try {
        $readOptions = @{ LiteralPath = $LogPath; ErrorAction = 'Stop' }
        if ($TailLines -gt 0) { $readOptions.Tail = $TailLines }
        $lines = @(Get-Content @readOptions)
    } catch {
        return [pscustomobject]@{ ok = $false; warning = $false; detail = "Cannot read console log: $($_.Exception.Message)" }
    }

    if ($lines.Count -eq 0 -or [string]::IsNullOrWhiteSpace(($lines -join ''))) {
        return [pscustomobject]@{ ok = $true; warning = $true; detail = "Console log empty; diagnostics unavailable: $LogPath" }
    }

    $warnings = @()
    for ($idx = $lines.Count - 1; $idx -ge 0; $idx--) {
        $line = $lines[$idx] -replace '\x1b\[[0-?]*[ -/]*[@-~]', ''
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        $diagnosticText = $line
        foreach ($ignorePattern in $IgnorePatterns) {
            $diagnosticText = $diagnosticText -replace $ignorePattern, ''
        }
        $isError = Select-String -InputObject $diagnosticText -Pattern $Patterns
        $isWarning = Select-String -InputObject $diagnosticText -Pattern $WarningPatterns
        if (-not $isError -and -not $isWarning) { continue }

        $snippet = $line.Trim()
        if ($snippet.Length -gt 180) {
            $snippet = $snippet.Substring(0, 180) + '...'
        }

        if ($isError) {
            return [pscustomobject]@{ ok = $false; warning = $false; detail = "Console contains error text: $snippet" }
        }
        if ($warnings.Count -lt 3 -and $warnings -notcontains $snippet) {
            $warnings += $snippet
        }
    }

    if ($warnings.Count -gt 0) {
        return [pscustomobject]@{ ok = $true; warning = $true; detail = "Console warnings: $($warnings -join ' | ') (log: $LogPath)" }
    }
    return [pscustomobject]@{ ok = $true; warning = $false; detail = "No console errors or warnings" }
}

function Test-Http {
    param(
        [string]$Url,
        [int]$ExpectedStatusCode = 200,
        [string]$ExpectedContentType
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 6
        if ($ExpectedContentType -and (
            [string]$response.Headers['Content-Type'] -notlike "$ExpectedContentType*" -or
            [string]::IsNullOrWhiteSpace([string]$response.Content)
        )) {
            return [pscustomobject]@{
                ok = $false
                detail = "Expected nonempty $ExpectedContentType response from $Url; got HTTP $($response.StatusCode), Content-Type: $($response.Headers['Content-Type'])"
            }
        }
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

function Test-Frontend {
    param([string]$Url, [string]$CssUrl)

    $page = Test-Http -Url $Url
    if (-not $page.ok) { return $page }

    $css = Test-Http -Url $CssUrl -ExpectedContentType 'text/css'
    return [pscustomobject]@{
        ok = $css.ok
        detail = "Page: $($page.detail); CSS transform: $($css.detail)"
    }
}

function Get-ServiceHealthResult {
    param($TransportResult, $ConsoleResult)

    return [pscustomobject]@{
        ok = ($TransportResult.ok -and $ConsoleResult.ok)
        warning = $ConsoleResult.warning
        detail = if ($ConsoleResult.ok -and -not $ConsoleResult.warning) {
            $TransportResult.detail
        } else {
            "{0} | {1}" -f $TransportResult.detail, $ConsoleResult.detail
        }
    }
}

function Write-HealthSummary {
    param([object[]]$Results)

    $allPass = $true
    $hasWarnings = $false
    Write-Host "Coordination Manager Health"
    Write-Host "---------------------------"
    foreach ($result in $Results) {
        $status = if (-not $result.check.ok) { "FAIL" } elseif ($result.check.warning) { "WARN" } else { "PASS" }
        if (-not $result.check.ok) { $allPass = $false }
        if ($result.check.warning) { $hasWarnings = $true }
        Write-Host ("[{0}] {1} ({2}) - {3}" -f $status, $result.service, $result.endpoint, $result.check.detail)
    }

    if (-not $allPass) {
        Write-Host "Result: FAILURES DETECTED"
        return 1
    }
    if ($hasWarnings) {
        Write-Host "Result: SERVICES RESPONDING WITH WARNINGS - review diagnostics above"
    } else {
        Write-Host "Result: ALL SERVICES HEALTHY"
    }
    return 0
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
    [pscustomobject]@{ id = "web"; service = "Web"; endpoint = "http://localhost:5173"; tester = { Test-Frontend -Url "http://localhost:5173" -CssUrl "http://localhost:5173/src/index.css?direct" } },
    [pscustomobject]@{ id = "api"; service = "API"; endpoint = "http://localhost:3001/health"; tester = { Test-Http -Url "http://localhost:3001/health" } },
    [pscustomobject]@{ id = "bot"; service = "Bot"; endpoint = "localhost:3002"; tester = { Test-ListeningPort -Port 3002 } },
    [pscustomobject]@{ id = "guardian"; service = "Guardian"; endpoint = "console-only"; tester = { Test-GuardianProcess } },
    [pscustomobject]@{ id = "docs"; service = "Docs"; endpoint = "http://localhost:5174/docs/"; tester = { Test-Frontend -Url "http://localhost:5174/docs/" -CssUrl "http://localhost:5174/docs/src/index.css?direct" } }
)

if ($Mode -eq "localhost") {
    $serviceChecks = @($serviceChecks | Where-Object { $_.id -in @('web', 'api', 'docs') })
}

$latestResults = @{}

while ((Get-Date) -lt $deadline) {
    $allPassNow = $true

    foreach ($serviceCheck in $serviceChecks) {
        $transportResult = & $serviceCheck.tester
        $logPath = $serviceLogMap[$serviceCheck.id]
        $consoleResult = Test-ServiceConsoleLog -ServiceName $serviceCheck.service -LogPath $logPath -TailLines $LogTailLines -Patterns $consoleErrorPatterns -WarningPatterns $consoleWarningPatterns -IgnorePatterns $consoleIgnorePatterns
        $combined = Get-ServiceHealthResult -TransportResult $transportResult -ConsoleResult $consoleResult

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

exit (Write-HealthSummary -Results $results)
