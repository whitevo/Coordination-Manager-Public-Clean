param(
  [string]$Target = "src/pages/__tests__"
)

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

try {
  if ([string]::IsNullOrWhiteSpace($Target)) {
    pnpm --dir "./Code/apps/web" vitest run
  } else {
    pnpm --dir "./Code/apps/web" vitest run $Target
  }

  exit $LASTEXITCODE
} finally {
  Pop-Location
}
