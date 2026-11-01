param(
  [string]$PostgresImage = 'postgres:16'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$migrationRoot = Join-Path $repoRoot 'Code\packages\database\migrations'
$assertionsPath = Join-Path $PSScriptRoot 'consolidation-smoke-assertions.sql'
$fingerprintPath = Join-Path $PSScriptRoot 'consolidation-catalog-fingerprint.sql'
$securityRegressionPath = Join-Path $PSScriptRoot 'user-calendar-access-security.sql'
$containerName = 'cm-sql-consolidation-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$containerStarted = $false

function Invoke-ContainerSqlText {
  param([string]$Database, [string]$Sql, [string]$Description)
  $output = $Sql | & docker exec -i $containerName psql -X -q -v ON_ERROR_STOP=1 -U postgres -d $Database 2>&1
  if ($LASTEXITCODE -ne 0) {
    $diagnostic = ($output | Select-Object -Last 20) -join "`n"
    throw "SQL failed in $Database while $Description (psql exit $LASTEXITCODE):`n$diagnostic"
  }
}

function Invoke-ContainerSqlFile {
  param([string]$Database, [string]$Path, [string]$Description)
  $contents = Get-Content -Raw -LiteralPath $Path
  Invoke-ContainerSqlText -Database $Database -Sql $contents -Description $Description
}

function Invoke-GitBaseline {
  param([string]$Database, [string]$Name)
  $relativePath = "Code/packages/database/migrations/$Name"
  $contents = & git -C $repoRoot show "HEAD:$relativePath"
  if ($LASTEXITCODE -ne 0) {
    throw "Cannot read historical baseline from HEAD: $relativePath"
  }
  Invoke-ContainerSqlText -Database $Database -Sql ($contents -join "`n") -Description "applying historical $Name"
}

function Get-CatalogFingerprint {
  param([string]$Database)
  $contents = Get-Content -Raw -LiteralPath $fingerprintPath
  try {
    $result = $contents | & docker exec -i $containerName psql -X -A -t -q -v ON_ERROR_STOP=1 -U postgres -d $Database 2>&1
  } catch {
    throw "Could not fingerprint ${Database}: $($_.Exception.Message)"
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Could not fingerprint $Database (psql exit $LASTEXITCODE)."
  }
  return ($result -join '').Trim()
}

function Assert-RerunStable {
  param([string]$Database, [scriptblock]$ApplyMigrations, [string]$Label)
  $before = Get-CatalogFingerprint -Database $Database
  & $ApplyMigrations
  $after = Get-CatalogFingerprint -Database $Database
  if (-not $before -or $before -ne $after) {
    throw "$Label changed the database catalog when reapplied. Before=$before After=$after"
  }
  Write-Host "PASS: $Label executes twice with a stable schema catalog ($after)"
}

function Assert-ArchiveUnchanged {
  $archivedUpgrades = Get-ChildItem -LiteralPath (Join-Path $migrationRoot 'archive') -Filter '*.sql' |
    Where-Object { $_.Name -match '^\d{3}_.+\.sql$' }
  if ($archivedUpgrades.Count -ne 41) {
    throw "Expected 41 archived historical SQL files; found $($archivedUpgrades.Count)."
  }
  foreach ($file in $archivedUpgrades) {
    $oldPath = "Code/packages/database/migrations/$($file.Name)"
    $expected = & git -C $repoRoot rev-parse "HEAD:$oldPath"
    if ($LASTEXITCODE -ne 0) { throw "Cannot find historical blob for $oldPath." }
    $actual = & git -C $repoRoot hash-object "--path=$oldPath" $file.FullName
    if ($LASTEXITCODE -ne 0 -or $actual -ne $expected) {
      throw "Archived historical SQL changed from its original Git blob: $($file.Name)"
    }
  }
  Write-Host 'PASS: all 41 archived SQL files match their original Git blobs (including both 039 files)'
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is unavailable. No database or container was started.'
}

try {
  & docker info --format '{{.ServerVersion}}' *> $null
  $dockerEngineReady = $LASTEXITCODE -eq 0
} catch {
  $dockerEngineReady = $false
}
if (-not $dockerEngineReady) {
  throw 'Docker Engine is unavailable. Start it only if that is safe for this host, then rerun; this script does not start Docker Desktop.'
}

Assert-ArchiveUnchanged

try {
  & docker run --detach --rm --pull=missing --network none --name $containerName `
    --env 'POSTGRES_PASSWORD=local-smoke-only' --env 'POSTGRES_DB=postgres' $PostgresImage
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not start the uniquely named isolated PostgreSQL container.'
  }
  $containerStarted = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    & docker exec $containerName pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'Disposable PostgreSQL container did not become ready within 60 seconds.'
  }

  Invoke-ContainerSqlText -Database 'postgres' -Description 'creating Supabase role shims' -Sql @'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
'@

  & docker exec $containerName createdb -U postgres cm_fresh_smoke
  if ($LASTEXITCODE -ne 0) { throw 'Could not create fresh baseline test database.' }
  & docker exec $containerName createdb -U postgres cm_upgrade_smoke
  if ($LASTEXITCODE -ne 0) { throw 'Could not create historical-upgrade test database.' }

  $supabaseShim = @'
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID
$$;
'@
  Invoke-ContainerSqlText -Database 'cm_fresh_smoke' -Sql $supabaseShim -Description 'installing isolated Supabase auth shims'
  Invoke-ContainerSqlText -Database 'cm_upgrade_smoke' -Sql $supabaseShim -Description 'installing isolated Supabase auth shims'

  $baselineOrder = @(
    '000_full_schema.sql',
    '000_feature-wallet-and-auth.sql',
    '000_feature-time-and-calendar.sql',
    '000_feature-announcements-and-comms.sql',
    '000_feature-feedback.sql',
    '000_feature-integrations.sql',
    '000_feature-mailbox.sql',
    '000_feature-network.sql',
    '000_feature-discord-guardian.sql',
    '000_feature-agent-platform.sql',
    '000_feature-misc.sql',
    '000_feature-maintenance-and-seeding.sql',
    '000_feature-security.sql'
  )

  $applyCurrentBaselines = {
    foreach ($name in $baselineOrder) {
      Invoke-ContainerSqlFile -Database 'cm_fresh_smoke' -Path (Join-Path $migrationRoot $name) -Description "applying $name"
    }
    Invoke-ContainerSqlFile -Database 'cm_fresh_smoke' -Path (Join-Path $migrationRoot '041_deny_direct_user_calendar_access.sql') -Description 'applying active 041 security upgrade'
  }
  & $applyCurrentBaselines
  Invoke-ContainerSqlFile -Database 'cm_fresh_smoke' -Path $assertionsPath -Description 'checking fresh baseline objects and invariants'
  Invoke-ContainerSqlFile -Database 'cm_fresh_smoke' -Path $securityRegressionPath -Description 'checking user/calendar access controls on the fresh baseline'
  Assert-RerunStable -Database 'cm_fresh_smoke' -ApplyMigrations $applyCurrentBaselines -Label 'Current fresh-install baselines'
  Invoke-ContainerSqlFile -Database 'cm_fresh_smoke' -Path $assertionsPath -Description 'checking repeated fresh baseline objects and invariants'
  Invoke-ContainerSqlFile -Database 'cm_fresh_smoke' -Path $securityRegressionPath -Description 'checking user/calendar access controls after baseline reapplication'

  foreach ($name in $baselineOrder) {
    Invoke-GitBaseline -Database 'cm_upgrade_smoke' -Name $name
  }

  $archivedUpgrades = Get-ChildItem -LiteralPath (Join-Path $migrationRoot 'archive') -Filter '*.sql' |
    Where-Object { $_.Name -match '^\d{3}_.+\.sql$' } |
    Sort-Object Name
  if ($archivedUpgrades.Count -ne 41) {
    throw "Expected 41 archived historical SQL files; found $($archivedUpgrades.Count)."
  }

  $applyArchivedUpgrades = {
    foreach ($file in $archivedUpgrades) {
      Invoke-ContainerSqlFile -Database 'cm_upgrade_smoke' -Path $file.FullName -Description "applying archived $($file.Name)"
    }
    Invoke-ContainerSqlFile -Database 'cm_upgrade_smoke' -Path (Join-Path $migrationRoot '041_deny_direct_user_calendar_access.sql') -Description 'applying active 041 security upgrade'
  }
  & $applyArchivedUpgrades
  Invoke-ContainerSqlFile -Database 'cm_upgrade_smoke' -Path $assertionsPath -Description 'checking upgraded baseline objects and invariants'
  Invoke-ContainerSqlFile -Database 'cm_upgrade_smoke' -Path $securityRegressionPath -Description 'checking user/calendar access controls after historical upgrades'
  Assert-RerunStable -Database 'cm_upgrade_smoke' -ApplyMigrations $applyArchivedUpgrades -Label 'Historical upgrades and active 041 security migration'
  Invoke-ContainerSqlFile -Database 'cm_upgrade_smoke' -Path $assertionsPath -Description 'checking repeated upgrade objects and invariants'
  Invoke-ContainerSqlFile -Database 'cm_upgrade_smoke' -Path $securityRegressionPath -Description 'checking user/calendar access controls after upgrade reapplication'
}
finally {
  if ($containerStarted) {
    & docker stop $containerName *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Could not stop disposable container $containerName; remove that exact container manually."
    }
  }
}
