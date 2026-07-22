param(
  [switch]$SkipAudit,
  [switch]$SkipGitleaks,
  [switch]$SkipMonorepoTests,
  [switch]$InstallGitleaks,
  [switch]$GitleaksFullHistory,
  [string]$GitleaksSinceRef,
  [string]$GitleaksCheckpointFile = '.git\gitleaks-checkpoint.json'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$codeDir = Join-Path $root 'Code'
$workflowDir = Join-Path $root '.github\workflows'
$gitleaksCheckpointPath = if ([System.IO.Path]::IsPathRooted($GitleaksCheckpointFile)) {
  $GitleaksCheckpointFile
}
else {
  Join-Path $root $GitleaksCheckpointFile
}
$osvQueryBatchUrl = 'https://api.osv.dev/v1/querybatch'
$osvVulnUrlBase = 'https://api.osv.dev/v1/vulns/'
$osvBatchSize = 200

$failed = @()

function Run-Step {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [scriptblock]$Action
  )

  Write-Host "`n==> $Name" -ForegroundColor Cyan
  try {
    & $Action
    Write-Host "[PASS] $Name" -ForegroundColor Green
  }
  catch {
    Write-Host "[FAIL] $Name -- $($_.Exception.Message)" -ForegroundColor Red
    $script:failed += $Name
  }
}

function Require-Command {
  param([Parameter(Mandatory = $true)] [string]$CommandName)
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $CommandName"
  }
}

function Get-NodeJsonPackageInventory {
  $packagesJsonPath = Join-Path ([System.IO.Path]::GetTempPath()) ("cm-pnpm-list-" + [guid]::NewGuid().ToString() + '.json')
  $extractScriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ("cm-pnpm-list-extract-" + [guid]::NewGuid().ToString() + '.cjs')
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)

  try {
    $pnpmListOutput = (& pnpm --reporter silent list -r --depth Infinity --json) | Out-String
    if ($LASTEXITCODE -ne 0) {
      throw "pnpm list failed with exit code $LASTEXITCODE"
    }

    [System.IO.File]::WriteAllText($packagesJsonPath, $pnpmListOutput.Trim(), $utf8NoBom)

    $extractScriptContent = @'
const fs = require('fs')

const inputPath = process.argv[2]
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const packages = []
const seen = new Set()

function registerPackage(name, version) {
  if (typeof name !== 'string' || typeof version !== 'string') return
  const key = `${name}@${version}`
  if (seen.has(key)) return
  seen.add(key)
  packages.push({ name, version })
}

function visitDependencyMap(map) {
  if (!map || typeof map !== 'object') return

  for (const [dependencyName, dependencyNode] of Object.entries(map)) {
    if (dependencyNode && typeof dependencyNode === 'object' && typeof dependencyNode.version === 'string') {
      registerPackage(dependencyName, dependencyNode.version)
    }
    visit(dependencyNode)
  }
}

function visit(node) {
  if (!node) return

  if (Array.isArray(node)) {
    for (const entry of node) visit(entry)
    return
  }

  if (typeof node !== 'object') return

  if (typeof node.name === 'string' && typeof node.version === 'string') {
    registerPackage(node.name, node.version)
  }

  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'unsavedDependencies']) {
    if (node[key] && typeof node[key] === 'object') {
      visitDependencyMap(node[key])
    }
  }
}

visit(input)
process.stdout.write(JSON.stringify(packages))
'@

    [System.IO.File]::WriteAllText($extractScriptPath, $extractScriptContent, $utf8NoBom)

    $inventoryJson = & node $extractScriptPath $packagesJsonPath
    if ($LASTEXITCODE -ne 0) {
      throw "node inventory extraction failed with exit code $LASTEXITCODE"
    }

    return $inventoryJson | ConvertFrom-Json
  }
  finally {
    if (Test-Path $packagesJsonPath) {
      Remove-Item $packagesJsonPath -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path $extractScriptPath) {
      Remove-Item $extractScriptPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Get-OsvSeverity {
  param([Parameter(Mandatory = $true)] $Vulnerability)

  $databaseSeverity = $Vulnerability.database_specific.severity
  if ($databaseSeverity) {
    return $databaseSeverity.ToString().ToUpperInvariant()
  }

  $severityEntries = @()
  if ($null -ne $Vulnerability.severity) {
    $severityEntries = @($Vulnerability.severity)
  }

  foreach ($entry in $severityEntries) {
    $score = $entry.score
    if (-not $score) {
      continue
    }

    if ($score -match '^(?<numeric>\d+(?:\.\d+)?)$') {
      $numericScore = [double]$Matches.numeric
      if ($numericScore -ge 9.0) { return 'CRITICAL' }
      if ($numericScore -ge 7.0) { return 'HIGH' }
      if ($numericScore -ge 4.0) { return 'MEDIUM' }
      return 'LOW'
    }
  }

  return 'UNKNOWN'
}

function Invoke-OsvHighCriticalAudit {
  $inventory = Get-NodeJsonPackageInventory
  if (-not $inventory -or $inventory.Count -eq 0) {
    throw 'No package inventory could be collected from pnpm list'
  }

  Write-Host "Collected $($inventory.Count) unique packages from pnpm workspace"

  $findings = New-Object System.Collections.Generic.List[object]
  for ($offset = 0; $offset -lt $inventory.Count; $offset += $osvBatchSize) {
    $upperBound = [Math]::Min($offset + $osvBatchSize - 1, $inventory.Count - 1)
    $chunk = @($inventory[$offset..$upperBound])
    $queries = @()

    foreach ($pkg in $chunk) {
      if (-not $pkg.name -or -not $pkg.version) {
        continue
      }

      $queries += @{
        package = @{
          ecosystem = 'npm'
          name = [string]$pkg.name
        }
        version = [string]$pkg.version
      }
    }

    if ($queries.Count -eq 0) {
      continue
    }

    $body = @{ queries = $queries } | ConvertTo-Json -Depth 8 -Compress
    $response = Invoke-RestMethod -Method Post -Uri $osvQueryBatchUrl -ContentType 'application/json' -Body $body

    for ($index = 0; $index -lt $queries.Count; $index++) {
      $result = $response.results[$index]
      if (-not $result -or -not $result.vulns) {
        continue
      }

      foreach ($vuln in $result.vulns) {
        $findings.Add([pscustomobject]@{
          packageName = $queries[$index].package.name
          packageVersion = $queries[$index].version
          vulnId = $vuln.id
        })
      }
    }
  }

  if ($findings.Count -eq 0) {
    Write-Host 'OSV audit returned no matched advisories.'
    return
  }

  $detailCache = @{}
  $highOrCritical = New-Object System.Collections.Generic.List[object]
  foreach ($finding in $findings) {
    if (-not $detailCache.ContainsKey($finding.vulnId)) {
      $detailCache[$finding.vulnId] = Invoke-RestMethod -Method Get -Uri ($osvVulnUrlBase + $finding.vulnId)
    }

    $detail = $detailCache[$finding.vulnId]
    $severity = Get-OsvSeverity -Vulnerability $detail
    if ($severity -ne 'HIGH' -and $severity -ne 'CRITICAL') {
      continue
    }

    $highOrCritical.Add([pscustomobject]@{
      packageName = $finding.packageName
      packageVersion = $finding.packageVersion
      vulnerabilityId = $finding.vulnId
      severity = $severity
      summary = $detail.summary
    })
  }

  if ($highOrCritical.Count -eq 0) {
    Write-Host 'OSV audit found no high or critical advisories.'
    return
  }

  Write-Host 'OSV audit found high or critical advisories:' -ForegroundColor Yellow
  $highOrCritical |
    Sort-Object severity, packageName, vulnerabilityId -Unique |
    ForEach-Object {
      Write-Host ("- [{0}] {1}@{2} -> {3} ({4})" -f $_.severity, $_.packageName, $_.packageVersion, $_.vulnerabilityId, $_.summary)
    }

  throw "OSV audit found $($highOrCritical.Count) high/critical advisory matches"
}

function Get-GitCommitHash {
  param([Parameter(Mandatory = $true)] [string]$RefName)

  $hashOutput = & git rev-parse --verify $RefName 2>$null
  $exitCode = $LASTEXITCODE
  $hash = ($hashOutput | Select-Object -First 1).Trim()
  if ($exitCode -ne 0 -or [string]::IsNullOrWhiteSpace($hash)) {
    throw "Unable to resolve git ref: $RefName"
  }

  return $hash
}

function Test-GitAncestor {
  param(
    [Parameter(Mandatory = $true)] [string]$Ancestor,
    [Parameter(Mandatory = $true)] [string]$Descendant
  )

  & git merge-base --is-ancestor $Ancestor $Descendant 2>$null
  return $LASTEXITCODE -eq 0
}

function Get-GitleaksCheckpoint {
  if (-not (Test-Path $gitleaksCheckpointPath)) {
    return $null
  }

  try {
    return Get-Content -Raw -Path $gitleaksCheckpointPath | ConvertFrom-Json
  }
  catch {
    throw "Unable to parse gitleaks checkpoint file: $gitleaksCheckpointPath"
  }
}

function Save-GitleaksCheckpoint {
  param(
    [Parameter(Mandatory = $true)] [string]$HeadCommit,
    [Parameter(Mandatory = $true)] [string]$ScanMode,
    [string]$ScanStartRef
  )

  $checkpointDir = Split-Path -Parent $gitleaksCheckpointPath
  if (-not (Test-Path $checkpointDir)) {
    New-Item -ItemType Directory -Path $checkpointDir -Force | Out-Null
  }

  $payload = [ordered]@{
    lastScannedCommit = $HeadCommit
    lastScannedAt = (Get-Date).ToString('o')
    scanMode = $ScanMode
  }

  if ($ScanStartRef) {
    $payload.scanStartRef = $ScanStartRef
  }

  $payload | ConvertTo-Json | Set-Content -Path $gitleaksCheckpointPath
}

function Get-GitleaksScanPlan {
  param([Parameter(Mandatory = $true)] [string]$HeadCommit)

  if ($GitleaksFullHistory) {
    return @{
      Mode = 'full-history'
      LogOpts = $null
      Skip = $false
      Description = 'full git history'
      ScanStartRef = $null
    }
  }

  if ($GitleaksSinceRef) {
    $sinceCommit = Get-GitCommitHash -RefName $GitleaksSinceRef
    if ($sinceCommit -eq $HeadCommit) {
      return @{
        Mode = 'explicit-ref'
        LogOpts = $null
        Skip = $true
        Description = "no commits after explicit ref $GitleaksSinceRef"
        ScanStartRef = $sinceCommit
      }
    }

    if (-not (Test-GitAncestor -Ancestor $sinceCommit -Descendant $HeadCommit)) {
      throw "Gitleaks since-ref is not an ancestor of HEAD: $GitleaksSinceRef"
    }

    return @{
      Mode = 'explicit-ref'
      LogOpts = "$sinceCommit..$HeadCommit"
      Skip = $false
      Description = "git delta from $GitleaksSinceRef"
      ScanStartRef = $sinceCommit
    }
  }

  $checkpoint = Get-GitleaksCheckpoint
  if ($null -eq $checkpoint -or [string]::IsNullOrWhiteSpace($checkpoint.lastScannedCommit)) {
    return @{
      Mode = 'full-history'
      LogOpts = $null
      Skip = $false
      Description = 'full git history (no checkpoint found)'
      ScanStartRef = $null
    }
  }

  $checkpointCommit = Get-GitCommitHash -RefName $checkpoint.lastScannedCommit
  if ($checkpointCommit -eq $HeadCommit) {
    return @{
      Mode = 'checkpoint'
      LogOpts = $null
      Skip = $true
      Description = 'no new commits since the last checkpoint'
      ScanStartRef = $checkpointCommit
    }
  }

  if (-not (Test-GitAncestor -Ancestor $checkpointCommit -Descendant $HeadCommit)) {
    throw "Checkpoint commit is not an ancestor of HEAD. Re-run with -GitleaksFullHistory or set -GitleaksSinceRef. Checkpoint: $checkpointCommit"
  }

  return @{
    Mode = 'checkpoint'
    LogOpts = "$checkpointCommit..$HeadCommit"
    Skip = $false
    Description = "git delta since checkpoint $checkpointCommit"
    ScanStartRef = $checkpointCommit
  }
}

Write-Host 'Coordination Manager security process check' -ForegroundColor Yellow
Write-Host "Repo root: $root"

Run-Step -Name 'Verify required commands (git, pnpm, node)' -Action {
  Require-Command -CommandName 'git'
  Require-Command -CommandName 'pnpm'
  Require-Command -CommandName 'node'
}

Run-Step -Name 'Verify governance files (SECURITY, LICENSE, CONTRIBUTING)' -Action {
  $requiredFiles = @('SECURITY.md', 'LICENSE', 'CONTRIBUTING.md')
  foreach ($file in $requiredFiles) {
    $path = Join-Path $root $file
    if (-not (Test-Path $path)) {
      throw "Missing required file: $file"
    }
  }
}

Run-Step -Name 'Verify CI workflow directory exists' -Action {
  if (-not (Test-Path $workflowDir)) {
    throw 'Missing .github/workflows directory'
  }
}

if (-not $SkipAudit) {
  Run-Step -Name 'Run dependency audit (high+critical)' -Action {
    Push-Location $codeDir
    try {
      Invoke-OsvHighCriticalAudit
    }
    finally {
      Pop-Location
    }
  }
}
else {
  Write-Host "`n[SKIP] Run dependency audit (high+critical)"
}

if (-not $SkipMonorepoTests) {
  Run-Step -Name 'Run monorepo test gate' -Action {
    Push-Location $codeDir
    try {
      & pnpm test
      if ($LASTEXITCODE -ne 0) {
        throw "pnpm test failed with exit code $LASTEXITCODE"
      }
    }
    finally {
      Pop-Location
    }
  }
}
else {
  Write-Host "`n[SKIP] Run monorepo test gate"
}

if ($InstallGitleaks -and -not (Get-Command gitleaks -ErrorAction SilentlyContinue)) {
  Run-Step -Name 'Install gitleaks using winget (official package)' -Action {
    Require-Command -CommandName 'winget'
    & winget install --id Gitleaks.Gitleaks --exact --source winget
    if ($LASTEXITCODE -ne 0) {
      throw "winget install failed with exit code $LASTEXITCODE"
    }
  }
}

if (-not $SkipGitleaks) {
  Run-Step -Name 'Run gitleaks on git history' -Action {
    if (-not (Get-Command gitleaks -ErrorAction SilentlyContinue)) {
      throw 'gitleaks not installed. Re-run with -InstallGitleaks or install manually from the official repo release (github.com/gitleaks/gitleaks). CLI is MIT-licensed; no org license required when invoking the CLI directly.'
    }

    Push-Location $root
    try {
      $headCommit = Get-GitCommitHash -RefName 'HEAD'
      $scanPlan = Get-GitleaksScanPlan -HeadCommit $headCommit
      Write-Host "Using gitleaks scan scope: $($scanPlan.Description)"

      if ($scanPlan.Skip) {
        Write-Host "Gitleaks skipped: $($scanPlan.Description)"
        return
      }

      $baselineFlag = @()
      if (Test-Path (Join-Path $root '.gitleaks-baseline.json')) {
        $baselineFlag = @('--baseline-path', (Join-Path $root '.gitleaks-baseline.json'))
      }

      $gitleaksArgs = @('detect', '--source', '.', '--verbose')
      if ($scanPlan.LogOpts) {
        $gitleaksArgs += @('--log-opts', $scanPlan.LogOpts)
      }
      $gitleaksArgs += $baselineFlag

      & gitleaks @gitleaksArgs
      if ($LASTEXITCODE -ne 0) {
        throw "gitleaks detect failed with exit code $LASTEXITCODE"
      }

      Save-GitleaksCheckpoint -HeadCommit $headCommit -ScanMode $scanPlan.Mode -ScanStartRef $scanPlan.ScanStartRef
      Write-Host "Updated gitleaks checkpoint: $headCommit"
    }
    finally {
      Pop-Location
    }
  }
}
else {
  Write-Host "`n[SKIP] Run gitleaks on git history"
}

Write-Host "`n=============================="
if ($failed.Count -eq 0) {
  Write-Host 'Security process check PASSED' -ForegroundColor Green
  exit 0
}

Write-Host 'Security process check FAILED' -ForegroundColor Red
Write-Host 'Failed steps:' -ForegroundColor Red
$failed | ForEach-Object { Write-Host "- $_" -ForegroundColor Red }
exit 1
