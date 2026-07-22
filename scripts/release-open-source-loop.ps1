param(
  [switch]$SkipGitHubActionsCheck,
  [switch]$SkipLiveApiCheck,
  [string]$PrivateRemote = 'origin',
  [string]$PublicRemote = 'public',
  [string]$PublicRepo,
  [string]$Branch,
  [int]$LiveApiWaitSeconds = 180,
  [int]$CiWaitTimeoutMinutes = 20,
  [int]$CiPollSeconds = 20
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path (Join-Path $root 'package.json'))) {
  throw 'Repository root package.json not found. Run this script from the repository root tree.'
}

if (-not $Branch) {
  $Branch = (& git rev-parse --abbrev-ref HEAD).Trim()
}

if (-not $Branch) {
  throw 'Could not determine current git branch.'
}

$stageIndex = 0

function Write-Stage {
  param([string]$Name)
  $script:stageIndex += 1
  Write-Host ''
  Write-Host ('[{0}] {1}' -f $script:stageIndex, $Name) -ForegroundColor Cyan
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [string]$Command
  )

  Write-Stage $Name
  Write-Host ('> {0}' -f $Command)
  & powershell -NoProfile -ExecutionPolicy Bypass -Command $Command
  if ($LASTEXITCODE -ne 0) {
    throw ('Stage failed: {0} (exit code {1})' -f $Name, $LASTEXITCODE)
  }
}

function Assert-NoMatches {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [string]$Pattern,
    [switch]$Literal
  )

  $files = git ls-files
  if ($LASTEXITCODE -ne 0) {
    throw 'git ls-files failed while running readiness checks.'
  }

  $matchedFiles = @()
  if ($Literal) {
    foreach ($file in $files) {
      if ($file -eq $Pattern) {
        $matchedFiles += $file
      }
    }
  }
  else {
    $matchedFiles = @($files | Select-String -Pattern $Pattern | ForEach-Object { $_.Line })
  }

  if ($matchedFiles.Count -gt 0) {
    Write-Host ('Readiness check failed: {0}' -f $Name) -ForegroundColor Yellow
    $matchedFiles | Sort-Object -Unique | ForEach-Object { Write-Host ('- {0}' -f $_) }
    throw ('Readiness check failed: {0}' -f $Name)
  }

  Write-Host ('[PASS] {0}' -f $Name) -ForegroundColor Green
}

function Show-MatchesAsInfo {
  param(
    [Parameter(Mandatory = $true)] [string]$Name,
    [Parameter(Mandatory = $true)] [string]$Pattern
  )

  $files = git ls-files
  if ($LASTEXITCODE -ne 0) {
    throw 'git ls-files failed while running readiness checks.'
  }

  $matchedFiles = @($files | Select-String -Pattern $Pattern | ForEach-Object { $_.Line })
  if ($matchedFiles.Count -eq 0) {
    Write-Host ('[PASS] {0} (none tracked)' -f $Name) -ForegroundColor Green
    return
  }

  Write-Host ('[INFO] {0} (excluded during public sync):' -f $Name) -ForegroundColor Yellow
  $matchedFiles | Sort-Object -Unique | ForEach-Object { Write-Host ('- {0}' -f $_) }
}

function Invoke-OpenSourceReadinessChecks {
  Write-Stage 'Open-source readiness checks (open-source-pipeline + security-hardening)'

  $requiredFiles = @(
    'SECURITY.md',
    'LICENSE',
    '.github/workflows/ci.yml',
    '.github/workflows/codeql.yml',
    '.github/workflows/dependency-review.yml',
    '.github/workflows/gitleaks.yml',
    '.github/workflows/security-drift-weekly.yml'
  )

  foreach ($file in $requiredFiles) {
    if (-not (Test-Path (Join-Path $root $file))) {
      throw ('Missing required file for open-source readiness: {0}' -f $file)
    }
  }
  Write-Host '[PASS] Required governance and workflow files exist' -ForegroundColor Green

  # Safety checks mirrored from public-sync exclusions.
  Assert-NoMatches -Name 'No non-example env files tracked' -Pattern '(?i)(^|/)\.env($|\.((?!example$).+))'
  Assert-NoMatches -Name 'No VS Code MCP token file tracked' -Pattern '^\.vscode/mcp\.json$'

  # These may exist in private and are expected to be excluded during curated public sync.
  Show-MatchesAsInfo -Name 'Leading underscore API scripts' -Pattern '^Code/apps/api/_.*'
  Show-MatchesAsInfo -Name 'Private improvmx MCP tooling' -Pattern '^tools/improvmx-mcp/'
  Show-MatchesAsInfo -Name 'Private docs folder files' -Pattern '^docs/private/'
}

function Wait-ForGitHubActionsSuccess {
  if ($SkipGitHubActionsCheck) {
    Write-Stage 'GitHub Actions check skipped'
    return
  }

  Write-Stage 'GitHub Actions status gate (github-workflow)'

  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'gh CLI is required for GitHub Actions status checks. Install gh or use -SkipGitHubActionsCheck.'
  }

  $deadline = (Get-Date).AddMinutes($CiWaitTimeoutMinutes)

  while ((Get-Date) -lt $deadline) {
    $runJson = & gh run list --branch $Branch --limit 1 --json status,conclusion,url,workflowName,displayTitle,headBranch 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runJson)) {
      throw 'Unable to query GitHub Actions runs for this branch. Ensure gh auth is configured.'
    }

    $runs = $runJson | ConvertFrom-Json
    if (-not $runs -or $runs.Count -eq 0) {
      throw ('No GitHub Actions runs found for branch {0}.' -f $Branch)
    }

    $latest = $runs[0]
    Write-Host ('Latest run: {0} | status={1} | conclusion={2}' -f $latest.workflowName, $latest.status, $latest.conclusion)
    Write-Host ('Run URL: {0}' -f $latest.url)

    if ($latest.status -eq 'completed') {
      if ($latest.conclusion -eq 'success') {
        Write-Host '[PASS] Latest GitHub Actions run completed successfully' -ForegroundColor Green
        return
      }

      throw ('Latest GitHub Actions run did not pass (conclusion: {0}).' -f $latest.conclusion)
    }

    Write-Host ('Run still in progress. Waiting {0} seconds...' -f $CiPollSeconds)
    Start-Sleep -Seconds $CiPollSeconds
  }

  throw ('Timed out waiting for GitHub Actions success after {0} minutes.' -f $CiWaitTimeoutMinutes)
}

function Invoke-LiveApiCheck {
  if ($SkipLiveApiCheck) {
    Write-Stage 'Live API smoke check skipped'
    return
  }

  Write-Stage 'Live API smoke check (testing-strategy)'
  Write-Host ('Waiting {0} seconds for deployment propagation...' -f $LiveApiWaitSeconds)
  Start-Sleep -Seconds $LiveApiWaitSeconds

  & powershell -NoProfile -ExecutionPolicy Bypass -Command 'pnpm --dir Code/apps/api test:public'
  if ($LASTEXITCODE -ne 0) {
    throw ('Live API smoke tests failed (exit code {0}).' -f $LASTEXITCODE)
  }

  Write-Host '[PASS] Live API smoke tests passed' -ForegroundColor Green
}

function Get-GitHubRepoSlugFromRemote {
  param([Parameter(Mandatory = $true)] [string]$RemoteName)

  $remoteUrl = (& git remote get-url $RemoteName 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $remoteUrl) {
    throw ('Git remote "{0}" is not configured.' -f $RemoteName)
  }

  if ($remoteUrl -match 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)(\.git)?$') {
    return ('{0}/{1}' -f $Matches.owner, $Matches.repo)
  }

  throw ('Could not parse GitHub owner/repo slug from remote URL: {0}' -f $remoteUrl)
}

function Remove-TrackedFilesMatchingPatterns {
  param(
    [Parameter(Mandatory = $true)] [string[]]$Patterns
  )

  $files = @(& git ls-files)
  if ($LASTEXITCODE -ne 0) {
    throw 'git ls-files failed while applying public sync exclusions.'
  }

  $toRemove = New-Object 'System.Collections.Generic.List[string]'
  foreach ($file in $files) {
    foreach ($pattern in $Patterns) {
      if ($file -match $pattern) {
        $toRemove.Add($file)
        break
      }
    }
  }

  $uniqueFiles = @($toRemove | Sort-Object -Unique)
  if ($uniqueFiles.Count -eq 0) {
    Write-Host '[PASS] No tracked files matched public sync exclusions.' -ForegroundColor Green
    return
  }

  Write-Host ('Removing {0} excluded tracked file(s) from public sync branch...' -f $uniqueFiles.Count)
  foreach ($file in $uniqueFiles) {
    & git rm -f -- $file 1>$null
    if ($LASTEXITCODE -ne 0) {
      throw ('Failed to remove excluded file from sync branch: {0}' -f $file)
    }
  }
}

function Invoke-PublicSyncPrCreation {
  Write-Stage 'Create public sync PR (open-source-pipeline + github-workflow)'

  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'gh CLI is required for public PR creation.'
  }

  $publicRepoSlug = $PublicRepo
  if (-not $publicRepoSlug) {
    $publicRepoSlug = Get-GitHubRepoSlugFromRemote -RemoteName $PublicRemote
  }

  $privateSourceBranch = $Branch
  $privateSourceShaShort = (& git rev-parse --short $privateSourceBranch).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $privateSourceShaShort) {
    throw ('Could not resolve private source SHA for branch {0}.' -f $privateSourceBranch)
  }

  $dateStamp = Get-Date -Format 'yyyy-MM-dd'
  $monthStamp = Get-Date -Format 'yyyy-MM'
  $syncBranch = ('sync/public-{0}' -f (Get-Date -Format 'yyyy-MM-dd-HHmmss'))
  $reportFileName = ('_sync-report-{0}.md' -f $dateStamp)
  $reportPath = Join-Path $root $reportFileName
  $originalBranch = (& git rev-parse --abbrev-ref HEAD).Trim()
  $publicPrUrl = $null
  $exclusionPatterns = @(
    '(?i)(^|/)\.env($|\.((?!example$).+))',
    '^\.vscode/',
    '^\.idea/',
    '^workspace\.code-workspace$',
    '^tools/improvmx-mcp/',
    '^docs/private/',
    '^Code/apps/api/_.*\.(cjs|js)$',
    '^_test\.js$',
    '^_test_wrap\.txt$',
    '(?i)\.pem$',
    '(?i)\.key$',
    '(?i)serviceAccount.*\.json$',
    '(^|/).*-REVIEW\.md$',
    '(^|/).*-INTERNAL\.md$'
  )

  try {
    & git fetch $PublicRemote
    if ($LASTEXITCODE -ne 0) {
      throw ('Failed to fetch remote {0}.' -f $PublicRemote)
    }

    & git checkout -B $syncBranch "$PublicRemote/main"
    if ($LASTEXITCODE -ne 0) {
      throw ('Failed to create/reset sync branch from {0}/main.' -f $PublicRemote)
    }

    # Start from a clean sync-branch tree, then snapshot private source branch.
    & git rm -r -f --ignore-unmatch . 1>$null
    if ($LASTEXITCODE -ne 0) {
      throw 'Failed to clear existing sync branch tree before snapshot.'
    }

    & git checkout $privateSourceBranch -- .
    if ($LASTEXITCODE -ne 0) {
      throw ('Failed to snapshot private branch {0} into sync branch.' -f $privateSourceBranch)
    }

    Remove-TrackedFilesMatchingPatterns -Patterns $exclusionPatterns

    Assert-NoMatches -Name 'No non-example env files tracked in sync branch' -Pattern '(?i)(^|/)\.env($|\.((?!example$).+))'
    Assert-NoMatches -Name 'No VS Code MCP token file tracked in sync branch' -Pattern '^\.vscode/mcp\.json$'
    Assert-NoMatches -Name 'No leading underscore API scripts tracked in sync branch' -Pattern '^Code/apps/api/_.*'
    Assert-NoMatches -Name 'No private improvmx MCP tooling tracked in sync branch' -Pattern '^tools/improvmx-mcp/'
    Assert-NoMatches -Name 'No private docs tracked in sync branch' -Pattern '^docs/private/'

    & git add -A
    if ($LASTEXITCODE -ne 0) {
      throw 'git add failed while preparing public sync commit.'
    }

    $syncStatus = @(& git status --porcelain)
    if ($LASTEXITCODE -ne 0) {
      throw 'git status failed while preparing public sync commit.'
    }

    if ($syncStatus.Count -eq 0) {
      throw 'No public sync diff detected against public/main. Nothing to commit or PR.'
    }

    $commitMessage = ('sync: bring public up to private @{0}' -f $privateSourceShaShort)
    & git commit -m $commitMessage
    if ($LASTEXITCODE -ne 0) {
      throw 'git commit failed while creating public sync commit.'
    }

    $stats = (& git diff --shortstat "$PublicRemote/main..HEAD").Trim()
    if ($LASTEXITCODE -ne 0) {
      throw 'Failed to compute public sync diff stats.'
    }

    $reportLines = @(
      '# Public Sync Report',
      '',
      ('- Date: {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')),
      ('- Private source branch: {0}' -f $privateSourceBranch),
      ('- Private source SHA: {0}' -f $privateSourceShaShort),
      ('- Public target remote: {0}' -f $PublicRemote),
      ('- Public repo: {0}' -f $publicRepoSlug),
      ('- Sync branch: {0}' -f $syncBranch),
      ('- Diff summary: {0}' -f $stats),
      '',
      'Safety checks passed for configured exclusions before push.'
    )
    Set-Content -Path $reportPath -Value $reportLines -Encoding ASCII

    & git push $PublicRemote $syncBranch
    if ($LASTEXITCODE -ne 0) {
      throw ('Failed to push sync branch {0} to {1}.' -f $syncBranch, $PublicRemote)
    }

    $prTitle = ('Public sync {0}' -f $monthStamp)
    $publicPrUrl = (& gh pr create --repo $publicRepoSlug --base main --head $syncBranch --title $prTitle --body-file $reportPath).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $publicPrUrl) {
      throw 'gh pr create failed for public sync branch.'
    }

    Write-Host ('[PASS] Public sync PR created: {0}' -f $publicPrUrl) -ForegroundColor Green
  }
  finally {
    if (($originalBranch) -and ((& git rev-parse --abbrev-ref HEAD).Trim() -ne $originalBranch)) {
      & git checkout $originalBranch 1>$null
    }

    if (Test-Path $reportPath) {
      Remove-Item -Path $reportPath -Force
    }
  }

  if (-not $publicPrUrl) {
    throw 'Public sync PR creation did not return a PR URL.'
  }
}

function Commit-WorkingTreeIfNeeded {
  Write-Stage 'Commit local working changes (github-workflow)'

  $statusLines = @(& git status --porcelain)
  if ($LASTEXITCODE -ne 0) {
    throw 'git status failed while checking for local changes.'
  }

  if ($statusLines.Count -eq 0) {
    Write-Host '[PASS] Working tree is clean -- no local commit needed.' -ForegroundColor Green
    return
  }

  Write-Host ('Detected {0} local change(s). Creating release checkpoint commit...' -f $statusLines.Count)
  & git add -A
  if ($LASTEXITCODE -ne 0) {
    throw 'git add failed while staging local changes.'
  }

  $commitTimestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $commitMessage = "chore(release): checkpoint before live API tests ($commitTimestamp)"
  & git commit -m $commitMessage
  if ($LASTEXITCODE -ne 0) {
    throw 'git commit failed while creating release checkpoint commit.'
  }

  Write-Host '[PASS] Local working changes committed for private push.' -ForegroundColor Green
}

try {
  Write-Host 'Open-source release loop started.' -ForegroundColor Cyan
  Write-Host ('Branch: {0}' -f $Branch)

  Invoke-CheckedCommand -Name 'Test existing version (testing-strategy)' -Command 'pnpm test'
  Invoke-CheckedCommand -Name 'Build deployment artifacts (monorepo-conventions)' -Command 'pnpm build'
  Invoke-CheckedCommand -Name 'Security gate and hardening checks (security-hardening)' -Command 'pnpm security:check'

  Invoke-OpenSourceReadinessChecks

  Commit-WorkingTreeIfNeeded

  Write-Stage 'Push private branch (github-workflow)'
  $aheadCount = (& git rev-list "$PrivateRemote/$Branch..HEAD" --count 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $aheadCount) {
    Write-Host "Could not determine ahead count; pushing to be safe."
    & git push $PrivateRemote $Branch
    if ($LASTEXITCODE -ne 0) { throw "git push failed." }
  }
  elseif ([int]$aheadCount -gt 0) {
    Write-Host ("Pushing {0} commit(s) ahead of {1}/{2}..." -f $aheadCount, $PrivateRemote, $Branch)
    & git push $PrivateRemote $Branch
    if ($LASTEXITCODE -ne 0) { throw "git push failed." }
    Write-Host ('[PASS] Pushed to {0}/{1}' -f $PrivateRemote, $Branch) -ForegroundColor Green
  }
  else {
    Write-Host ('[PASS] Already up to date with {0}/{1} -- no push needed.' -f $PrivateRemote, $Branch) -ForegroundColor Green
  }

  Wait-ForGitHubActionsSuccess
  Invoke-LiveApiCheck
  Invoke-PublicSyncPrCreation

  Write-Stage 'Release loop complete (open-source-pipeline)'
  Write-Host 'All automated gates passed and public sync PR was created.' -ForegroundColor Green
  Write-Host 'If any later manual step fails, fix and rerun this script from stage 1.' -ForegroundColor Yellow
}
catch {
  Write-Host ''
  Write-Host ('[FAILED] {0}' -f $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Apply fixes, then rerun the loop from stage 1 to preserve release confidence.' -ForegroundColor Yellow
  exit 1
}
