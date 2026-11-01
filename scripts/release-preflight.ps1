param()

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$codeDir = Join-Path $root 'Code'

function Invoke-ReleaseCheck {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [scriptblock]$Action
  )

  Write-Host "`n==> $Name" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
  Write-Host "[PASS] $Name" -ForegroundColor Green
}

Set-Location $root

try {
  Write-Host 'Production release preflight started.' -ForegroundColor Cyan

  Invoke-ReleaseCheck -Name 'Install locked dependencies and approved build scripts' -Action {
    pnpm --dir $codeDir install --frozen-lockfile
  }
  Invoke-ReleaseCheck -Name 'Typecheck workspace' -Action {
    pnpm --dir $codeDir typecheck
  }
  Invoke-ReleaseCheck -Name 'Lint workspace' -Action {
    pnpm --dir $codeDir lint
  }
  Invoke-ReleaseCheck -Name 'Run workspace tests' -Action {
    pnpm --dir $codeDir test
  }
  Invoke-ReleaseCheck -Name 'Audit dependencies and scan committed history' -Action {
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\security-check.ps1') -SkipMonorepoTests
  }
  Invoke-ReleaseCheck -Name 'Build all workspace packages' -Action {
    pnpm --dir $codeDir build
  }
  Invoke-ReleaseCheck -Name 'Build Vercel frontend and docs artifact' -Action {
    pnpm --dir (Join-Path $codeDir 'apps\web') run build:with-docs
  }

  Write-Host "`nProduction release preflight passed." -ForegroundColor Green
}
catch {
  Write-Host "`n[FAILED] $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}