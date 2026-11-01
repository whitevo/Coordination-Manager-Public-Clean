$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$healthPath = Join-Path $root 'check-health.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($healthPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }

# Load the real functions and classification rules without running the live polling loop.
foreach ($node in $ast.EndBlock.Statements) {
    if ($node -is [System.Management.Automation.Language.FunctionDefinitionAst] -or (
        $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -in @('$consoleErrorPatterns', '$consoleWarningPatterns', '$consoleIgnorePatterns')
    )) {
        . ([scriptblock]::Create($node.Extent.Text))
    }
}

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
    Write-Host "[PASS] $Message"
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("cm-health-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempDir | Out-Null
$logPath = Join-Path $tempDir 'web.log'
$scanOptions = @{
    ServiceName = 'Web'
    LogPath = $logPath
    TailLines = 0
    Patterns = $consoleErrorPatterns
    WarningPatterns = $consoleWarningPatterns
    IgnorePatterns = $consoleIgnorePatterns
}

try {
    $result = Test-ServiceConsoleLog @scanOptions
    Assert-True ($result.ok -and $result.warning) 'Missing log is visible as WARN, not an unqualified PASS'
    Set-Content -LiteralPath $logPath -Value ''
    $result = Test-ServiceConsoleLog @scanOptions
    Assert-True ($result.ok -and $result.warning) 'Empty log is visible as WARN'

    Set-Content -LiteralPath $logPath -Value @('VITE ready', '0 errors', 'No warnings', 'Completed without errors')
    $result = Test-ServiceConsoleLog @scanOptions
    Assert-True ($result.ok -and -not $result.warning) 'Clean logs and negative error/warning counts pass'

    Set-Content -LiteralPath $logPath -Value '[mailbox:auto-sync] synced=3 failed=0'
    $result = Test-ServiceConsoleLog @scanOptions
    Assert-True ($result.ok -and -not $result.warning) 'Successful sync with failed=0 passes'
    foreach ($line in @(
        '[mailbox:auto-sync] synced=3 failed=1',
        '[mailbox:auto-sync] synced=3 failed=01',
        '[mailbox:auto-sync] failed=0; ERROR: connection lost'
    )) {
        Set-Content -LiteralPath $logPath -Value $line
        Assert-True (-not (Test-ServiceConsoleLog @scanOptions).ok) "Actual failure is not masked: $line"
    }

    $warning = 'A PostCSS plugin did not pass the `from` option to `postcss.parse`. This may cause imported assets to be incorrectly transformed.'
    Set-Content -LiteralPath $logPath -Value (@($warning) + @(1..150 | ForEach-Object { "Request $_ completed" }))
    $result = Test-ServiceConsoleLog @scanOptions
    Assert-True ($result.ok -and $result.warning -and $result.detail.Contains('PostCSS')) 'PostCSS warning survives more than 120 subsequent log lines'

    Set-Content -LiteralPath $logPath -Value @('WARNING: failed to load stylesheet', 'WARNING: newer dependency available')
    $result = Test-ServiceConsoleLog @scanOptions
    Assert-True (-not $result.ok) 'Error text is not masked by a warning prefix or later warning'
    Set-Content -LiteralPath $logPath -Value '0 warnings; ERROR: CSS compilation failed'
    Assert-True (-not (Test-ServiceConsoleLog @scanOptions).ok) 'A zero-warning count cannot mask an actual error'
    Set-Content -LiteralPath $logPath -Value "$([char]27)[33mWARNING$([char]27)[0m: outdated plugin"
    $result = Test-ServiceConsoleLog @scanOptions
    Assert-True ($result.ok -and $result.warning) 'ANSI-colored warning is classified'
    Set-Content -LiteralPath $logPath -Value 'This API is deprecated'
    Assert-True (Test-ServiceConsoleLog @scanOptions).warning 'Deprecations are surfaced'

    $healthyTransport = [pscustomobject]@{ ok = $true; detail = 'HTTP 200' }
    $warningConsole = [pscustomobject]@{ ok = $true; warning = $true; detail = $warning }
    $combined = Get-ServiceHealthResult -TransportResult $healthyTransport -ConsoleResult $warningConsole
    $summary = @(Write-HealthSummary -Results @([pscustomobject]@{ service = 'Web'; endpoint = 'test'; check = $combined }) 6>&1)
    $summaryText = $summary -join "`n"
    Assert-True ($summary[-1] -eq 0 -and $summaryText.Contains('[WARN]') -and -not $summaryText.Contains('ALL SERVICES HEALTHY')) 'HTTP 200 plus warning yields degraded summary and exit 0'
    $combined = Get-ServiceHealthResult -TransportResult ([pscustomobject]@{ ok = $false; detail = 'HTTP 500' }) -ConsoleResult $warningConsole
    $summary = @(Write-HealthSummary -Results @([pscustomobject]@{ service = 'Web'; endpoint = 'test'; check = $combined }) 6>&1)
    Assert-True ($summary[-1] -eq 1 -and ($summary -join "`n").Contains('[FAIL]')) 'Transport failure still fails even with console warnings'
    $combined = Get-ServiceHealthResult -TransportResult $healthyTransport -ConsoleResult ([pscustomobject]@{ ok = $true; warning = $false; detail = 'Clean' })
    $summary = @(Write-HealthSummary -Results @([pscustomobject]@{ service = 'Web'; endpoint = 'test'; check = $combined }) 6>&1)
    Assert-True ($summary[-1] -eq 0 -and ($summary -join "`n").Contains('ALL SERVICES HEALTHY')) 'Clean health retains the success summary'

    $script:requests = @()
    $script:cssContentType = 'text/css'
    $script:cssContent = 'body { color: red }'
    function Invoke-WebRequest {
        param($Uri, [switch]$UseBasicParsing, $TimeoutSec)
        $script:requests += $Uri
        if ($Uri -like '*?direct') {
            return [pscustomobject]@{ StatusCode = 200; Headers = @{ 'Content-Type' = $script:cssContentType }; Content = $script:cssContent }
        }
        return [pscustomobject]@{ StatusCode = 200; Headers = @{ 'Content-Type' = 'text/html' }; Content = '<html></html>' }
    }
    $result = Test-Frontend -Url 'http://test/docs/' -CssUrl 'http://test/docs/src/index.css?direct'
    Assert-True ($result.ok -and $script:requests.Count -eq 2 -and $script:requests[-1] -eq 'http://test/docs/src/index.css?direct') 'Frontend probe exercises CSS with docs base path'
    $script:cssContentType = 'text/html'
    Assert-True (-not (Test-Frontend -Url 'http://test/' -CssUrl 'http://test/src/index.css?direct').ok) 'SPA HTML fallback is not accepted as a CSS transform'
    $script:cssContentType = 'text/css'
    $script:cssContent = ''
    Assert-True (-not (Test-Frontend -Url 'http://test/' -CssUrl 'http://test/src/index.css?direct').ok) 'Empty CSS response fails health'
    Remove-Item Function:\Invoke-WebRequest

    $runner = Join-Path $root 'run-dev-service.ps1'
    [void][System.Management.Automation.Language.Parser]::ParseFile($runner, [ref]$tokens, [ref]$parseErrors)
    Assert-True ($parseErrors.Count -eq 0) 'Service runner PowerShell syntax is valid'
    $shell = (Get-Process -Id $PID).Path
    $serviceName = 'health-test-' + [guid]::NewGuid().ToString('N')
    $markerDir = Join-Path $root '.cm-stop-markers'
    New-Item -ItemType Directory -Path $markerDir -Force | Out-Null
    $marker = Join-Path $markerDir "$serviceName.requested"
    Set-Content -LiteralPath $marker -Value 'test'
    $runnerLog = Join-Path $tempDir 'runner.log'
    try {
        $serviceCommand = "node -e `"console.log('native stdout captured'); console.error('WARNING: native stderr captured'); process.exitCode = 7`""
        $invocation = "& '{0}' -ServiceName '{1}' -Title '[CM] Health Test' -CodeDir '{2}' -LogPath '{3}' -ServiceCommand '{4}'" -f (
            $runner.Replace("'", "''"), $serviceName, $root.Replace("'", "''"),
            $runnerLog.Replace("'", "''"), $serviceCommand.Replace("'", "''")
        )
        $encodedInvocation = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($invocation))
        & $shell -NoProfile -OutputFormat Text -EncodedCommand $encodedInvocation
        Assert-True ($LASTEXITCODE -eq 0) 'Service runner test process exits normally after requested stop'
        $logged = Get-Content -LiteralPath $runnerLog -Raw
        Assert-True ($logged.Contains('native stdout captured') -and $logged.Contains('WARNING: native stderr captured')) 'Actual service runner persists both native output streams'
        Assert-True ($logged.Contains('exited with code 7')) 'Actual service runner records nonzero native exit'
    } finally {
        if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker }
    }
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force
}

Write-Host 'All dev health regression checks passed.'
