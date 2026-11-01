<#
.SYNOPSIS
  Build locally and deploy to Vercel production using zero build minutes.

.DESCRIPTION
  Uses 'vercel build --prod' to generate a local .vercel/output directory,
  then 'vercel deploy --prebuilt --prod' to upload it. This avoids consuming
  Vercel's free-tier build minutes.

  Runs from the repo root (the parent of this scripts folder), where the
  .vercel project link resides.

.PARAMETER SkipBuild
  Skip the build step and deploy existing .vercel/output (useful for retrying
  a failed upload without rebuilding).

.PARAMETER Preview
  Deploy as a preview instead of production.

.EXAMPLE
  .\scripts\deploy-vercel.ps1
  .\scripts\deploy-vercel.ps1 -SkipBuild
  .\scripts\deploy-vercel.ps1 -Preview
#>
param(
  [switch]$SkipBuild,
  [switch]$Preview
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

# Ensure we are in the repo root
Set-Location $repoRoot

# Verify .vercel project link exists
if (-not (Test-Path ".vercel\project.json")) {
  Write-Host "ERROR: No .vercel project link found. Run: vercel link --project coordination-manager" -ForegroundColor Red
  exit 1
}

# Verify Vercel CLI
$vercelVersion = vercel --version 2>$null
if (-not $vercelVersion) {
  Write-Host "ERROR: Vercel CLI not installed. Run: pnpm add -g vercel" -ForegroundColor Red
  exit 1
}
Write-Host "Vercel CLI v$vercelVersion" -ForegroundColor Cyan

# Build step
if (-not $SkipBuild) {
  Write-Host "`n--- Building locally (production) ---" -ForegroundColor Yellow
  vercel build --prod
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Build failed." -ForegroundColor Red
    exit 1
  }
} else {
  if (-not (Test-Path ".vercel\output")) {
    Write-Host "ERROR: No prebuilt output found. Remove -SkipBuild flag." -ForegroundColor Red
    exit 1
  }
  Write-Host "Skipping build, using existing .vercel\output" -ForegroundColor Yellow
}

# Deploy step
$deployArgs = @("deploy", "--prebuilt")
if (-not $Preview) {
  $deployArgs += "--prod"
  Write-Host "`n--- Deploying to PRODUCTION ---" -ForegroundColor Yellow
} else {
  Write-Host "`n--- Deploying PREVIEW ---" -ForegroundColor Yellow
}

& vercel @deployArgs
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: Deploy failed." -ForegroundColor Red
  exit 1
}

Write-Host "`nDeploy complete." -ForegroundColor Green
