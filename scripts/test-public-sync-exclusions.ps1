# Read-only regression checks: parse source/policy, never invoke the release loop.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot 'release-open-source-loop.ps1'
$policyPath = Join-Path $root '.claude\skills\open-source-pipeline\references\public-sync-exclusions.md'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) {
  throw ($parseErrors | Out-String)
}
Write-Host '[PASS] Release script PowerShell syntax'

$assignments = @($ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
    $node.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
    $node.Left.VariablePath.UserPath -eq 'publicSyncExclusionPatterns'
}, $true))
if ($assignments.Count -ne 1) {
  throw 'Expected one shared publicSyncExclusionPatterns assignment.'
}
$patterns = @($assignments[0].Right.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.StringConstantExpressionAst]
}, $true) | ForEach-Object { $_.Value })
if ($patterns.Count -eq 0) {
  throw 'No literal exclusion patterns found.'
}

$syncFunction = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Invoke-PublicSyncPrCreation'
}, $true)
$removal = $syncFunction.Body.Find({
  param($node)
  $node -is [System.Management.Automation.Language.CommandAst] -and
    $node.GetCommandName() -eq 'Remove-TrackedFilesMatchingPatterns'
}, $true)
if ($removal.Extent.Text -notmatch '-Patterns \$publicSyncExclusionPatterns$') {
  throw 'Public sync removal must consume the shared patterns.'
}
$assertionLoop = $syncFunction.Body.Find({
  param($node)
  $node -is [System.Management.Automation.Language.ForEachStatementAst] -and
    $node.Condition.Extent.Text -eq '$publicSyncExclusionPatterns'
}, $true)
if (-not $assertionLoop -or $assertionLoop.Body.Extent.Text -notmatch 'Assert-NoMatches .* -Pattern \$pattern') {
  throw 'Public sync must assert every shared exclusion pattern.'
}
$stageCommand = $syncFunction.Body.Find({
  param($node)
  $node -is [System.Management.Automation.Language.CommandAst] -and
    $node.Extent.Text -eq '& git add -A'
}, $true)
if ($removal.Extent.StartOffset -ge $assertionLoop.Extent.StartOffset -or
    $assertionLoop.Extent.EndOffset -ge $stageCommand.Extent.StartOffset) {
  throw 'Exclusion assertions must follow removal and precede staging/publication.'
}
Write-Host '[PASS] Removal and every post-removal assertion share the same patterns'

$readinessFunction = $ast.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Invoke-OpenSourceReadinessChecks'
}, $true)
$readinessLoop = $readinessFunction.Body.Find({
  param($node)
  $node -is [System.Management.Automation.Language.ForEachStatementAst] -and
    $node.Condition.Extent.Text -eq '$publicSyncExclusionPatterns'
}, $true)
if (-not $readinessLoop -or $readinessLoop.Body.Extent.Text -notmatch 'Show-MatchesAsInfo .* -Pattern \$pattern') {
  throw 'Private readiness reporting must cover every shared exclusion pattern.'
}
Write-Host '[PASS] Private readiness reports all policy patterns without rejecting private-only files'

$policy = Get-Content -LiteralPath $policyPath -Raw
$policyPatterns = @()
foreach ($block in [regex]::Matches($policy, '(?ms)^```powershell\r?\n(?<code>.*?)^```')) {
  $policyAst = [System.Management.Automation.Language.Parser]::ParseInput(
    $block.Groups['code'].Value, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count -gt 0) {
    throw ($parseErrors | Out-String)
  }
  $checks = $policyAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
      $node.GetCommandName() -eq 'Select-String'
  }, $true)
  foreach ($check in $checks) {
    $policyPatterns += $check.CommandElements[-1].Value
  }
}
if ($policyPatterns.Count -ne 7) {
  throw 'Expected seven documented safety checks covering all policy categories.'
}

$excludedPaths = @(
  '.env',
  '.env.production',
  'Code/apps/api/.env.local',
  'Code/apps/web/.env.example.local',
  '.vscode/mcp.json',
  '.vscode/settings.json',
  '.idea/workspace.xml',
  'workspace.code-workspace',
  '.claude/settings.local.json',
  '.claude/session/notes.md',
  'memories/user/notes.md',
  'tools/improvmx-mcp/index.js',
  '.mcp.json',
  'tools/test-runner-mcp/src/index.ts',
  'docs/private/notes.md',
  'Code/apps/api/_query.cjs',
  'Code/apps/api/_test.js',
  '_test.js',
  '_test_wrap.txt',
  '_sync-report-2026-10-10.md',
  'CHANGELOG_2026-10.md',
  'docs/CHANGELOG_2026-10.md',
  'keys/client.pem',
  'keys/client.KEY',
  'serviceAccount-prod.json',
  'keys/serviceAccount-dev.json',
  'docs/feature-REVIEW.md',
  'feature-INTERNAL.md',
  'Code/apps/web/playwright-report/index.html',
  'Code/apps/web/playwright-report/data/result.zip',
  'Code/apps/web/test-results/.last-run.json',
  'Code/apps/web/test-results/project/trace.zip'
)
$preservedPaths = @(
  '.env.example',
  'Code/apps/api/.env.example',
  'Code/apps/web/.env.example',
  '.claude/settings.json',
  '.claude/skills/open-source-pipeline/SKILL.md',
  '.claude/skills/open-source-pipeline/references/public-sync-ledger.md',
  'tools/public-tool/index.ts',
  'tools/test-runner-mcp-public/index.ts',
  'CHANGELOG.md',
  'docs/public/PRIVACY_POLICY.md',
  'Code/apps/api/query.js',
  'Code/apps/api/_notes.md',
  'docs/memories-guide.md',
  'docs/session/guide.md',
  'serviceAccount-docs/schema.json',
  'LICENSE',
  'NOTICE',
  'CONTRIBUTING.md',
  'GOVERNANCE.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/workflows/ci.yml'
)
foreach ($path in ($excludedPaths + $preservedPaths)) {
  $expected = $excludedPaths -contains $path
  $scriptMatch = @($patterns | Where-Object { $path -match $_ }).Count -gt 0
  $policyMatch = @($policyPatterns | Where-Object { $path -match $_ }).Count -gt 0
  if ($scriptMatch -ne $expected -or $policyMatch -ne $expected) {
    throw ('Exclusion regression: {0} (expected={1}, script={2}, policy={3})' -f
      $path, $expected, $scriptMatch, $policyMatch)
  }
}
Write-Host ('[PASS] {0} excluded and {1} preserved synthetic paths match script and documented checks' -f
  $excludedPaths.Count, $preservedPaths.Count)
Write-Host '[PASS] Read-only validation complete; release loop was not executed'
