param(
  [switch]$SkipCodeqlStatus,
  [switch]$SkipGitleaks,
  [switch]$SkipAudit
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$securityCheckScript = Join-Path $root 'scripts\security-check.ps1'

Write-Host 'Pre-merge security check (local, non-destructive)' -ForegroundColor Yellow

$securityArgs = @('-ExecutionPolicy', 'Bypass', '-File', $securityCheckScript, '-SkipMonorepoTests')
if ($SkipGitleaks) {
  $securityArgs += '-SkipGitleaks'
}
if ($SkipAudit) {
  $securityArgs += '-SkipAudit'
}

& powershell @securityArgs
if ($LASTEXITCODE -ne 0) {
  throw "security-check.ps1 failed with exit code $LASTEXITCODE"
}

if ($SkipCodeqlStatus) {
  Write-Host '[SKIP] CodeQL workflow status lookup'
  exit 0
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host 'WARNING: gh CLI not found. Skipping CodeQL workflow status lookup.' -ForegroundColor Yellow
  Write-Host 'Install GitHub CLI to query latest CodeQL run before merge.' -ForegroundColor Yellow
  exit 0
}

Push-Location $root
try {
  $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
  if (-not $branch) {
    Write-Host 'WARNING: Unable to detect current branch. Skipping CodeQL workflow status lookup.' -ForegroundColor Yellow
    exit 0
  }

  $runJson = & gh run list --workflow codeql.yml --branch $branch --limit 1 --json conclusion,status,url,headSha,displayTitle 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runJson)) {
    Write-Host 'WARNING: Could not query CodeQL workflow runs. Ensure gh auth is configured.' -ForegroundColor Yellow
    exit 0
  }

  $runs = $runJson | ConvertFrom-Json
  if (-not $runs -or $runs.Count -eq 0) {
    Write-Host "WARNING: No CodeQL runs found for branch '$branch'." -ForegroundColor Yellow
    exit 0
  }

  $latest = $runs[0]
  Write-Host ''
  Write-Host 'Latest CodeQL run for this branch:' -ForegroundColor Cyan
  Write-Host "- Title: $($latest.displayTitle)"
  Write-Host "- Status: $($latest.status)"
  Write-Host "- Conclusion: $($latest.conclusion)"
  Write-Host "- URL: $($latest.url)"

  if ($latest.conclusion -ne 'success') {
    Write-Host 'NOTE: CodeQL is configured as non-blocking by design. Review this run before merge.' -ForegroundColor Yellow
  }
}
finally {
  Pop-Location
}
