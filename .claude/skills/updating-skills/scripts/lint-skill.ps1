# lint-skill.ps1
# Deterministic lint for Agent Skills, per spec/skill-spec.md (Anthropic skill
# authoring best practices + library rules). Read-only and safe to re-run.
#
# Usage:
#   pwsh -File lint-skill.ps1 -Path <skill-dir>            # one skill
#   pwsh -File lint-skill.ps1 -Path <skills-root>          # every skill below it
#   pwsh -File lint-skill.ps1 -Path <dir> -Portable        # also enforce claude.ai/API key set
#   pwsh -File lint-skill.ps1 -Path <dir> -Json            # machine-readable findings
#
# Exit code = number of ERROR findings (0 = lint gate passes).

param(
    [Parameter(Mandatory = $true)][string]$Path,
    [switch]$Portable,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

# --- Limits (sources in spec/skill-spec.md) ---------------------------------
# 64 / 1024: hard frontmatter limits from the Agent Skills spec.
$MAX_NAME_CHARS = 64
$MAX_DESC_CHARS = 1024
# 500: Anthropic guidance for SKILL.md body; past this, split into references.
$MAX_BODY_LINES = 500
# 100: reference files longer than this need a table of contents so partial
# reads (head -100) still reveal the full scope of the file.
$TOC_REQUIRED_LINES = 100

# Keys accepted by claude.ai uploads and the Skills API (anything else = hard error there).
$PORTABLE_KEYS = @("name", "description", "license", "compatibility", "metadata", "allowed-tools")
# Extra keys Claude Code understands. Unknown keys are silently ignored by Claude Code,
# so a typo here means a setting that never takes effect -- worth a warning.
$CLAUDE_CODE_KEYS = @("when_to_use", "argument-hint", "arguments", "disable-model-invocation",
    "user-invocable", "disallowed-tools", "model", "effort", "context", "agent", "background",
    "hooks", "paths", "shell")
$VAGUE_NAMES = @("helper", "helpers", "utils", "util", "tools", "documents", "data", "files", "misc", "stuff")

$SECRET_PATTERNS = @(
    'sk-[A-Za-z0-9_-]{20,}',
    'ghp_[A-Za-z0-9]{30,}',
    'AKIA[0-9A-Z]{16}',
    'xox[abpr]-[A-Za-z0-9-]{10,}',
    '-----BEGIN [A-Z ]*PRIVATE KEY-----',
    '(?i)(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*["''][^"''\s]{12,}["'']'
)

function New-Finding($skill, $level, $code, $msg) {
    [pscustomobject]@{ skill = $skill; level = $level; code = $code; message = $msg }
}

function Read-Frontmatter([string[]]$lines) {
    # Minimal YAML reader: top-level "key: value" pairs, plus folded/literal
    # blocks (> or |) and quoted scalars. Enough for skill frontmatter.
    $result = [ordered]@{}
    if ($lines.Count -lt 2 -or $lines[0].Trim() -ne "---") { return $null }
    $end = -1
    for ($i = 1; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -eq "---") { $end = $i; break } }
    if ($end -lt 0) { return $null }
    $i = 1
    while ($i -lt $end) {
        $line = $lines[$i]
        if ($line -match '^([A-Za-z0-9_-]+):\s*(.*)$') {
            $key = $Matches[1]; $val = $Matches[2].Trim()
            if ($val -match '^[>|][+-]?$') {
                $parts = @(); $i++
                while ($i -lt $end -and ($lines[$i] -match '^\s+\S' -or $lines[$i].Trim() -eq "")) {
                    $parts += $lines[$i].Trim(); $i++
                }
                $result[$key] = ($parts -join " ").Trim()
                continue
            }
            if ($val -match '^"(.*)"$' -or $val -match "^'(.*)'$") { $val = $Matches[1] }
            $result[$key] = $val
        }
        $i++
    }
    return [pscustomobject]@{ map = $result; endLine = $end }
}

function Test-Skill([string]$dir) {
    $findings = @()
    $skillName = Split-Path $dir -Leaf
    # Experiment variants live in .../{skill}/v{N}/ and archives in .../{skill}-v{N}/;
    # the skill's real name is the parent folder or the archive prefix.
    if ($skillName -match '^v\d+$') { $skillName = Split-Path (Split-Path $dir -Parent) -Leaf }
    elseif ($skillName -match '^(.+)-v\d+$') { $skillName = $Matches[1] }
    $skillMd = Join-Path $dir "SKILL.md"
    if (-not (Test-Path $skillMd)) {
        return , @(New-Finding $skillName "ERROR" "missing-skill-md" "SKILL.md not found in $dir")
    }
    $lines = @(Get-Content $skillMd -Encoding utf8)
    $fm = Read-Frontmatter $lines
    if ($null -eq $fm) {
        return , @(New-Finding $skillName "ERROR" "frontmatter" "YAML frontmatter missing or not closed with ---")
    }
    $map = $fm.map
    $body = @($lines | Select-Object -Skip ($fm.endLine + 1))

    # --- YAML safety: an unquoted value with ': ' or ' #' (or a leading YAML indicator) does not parse ---
    foreach ($fl in @($lines[1..([math]::Max(1, $fm.endLine - 1))])) {
        if ($fl -match '^([A-Za-z_-]+):\s+(.+)$') {
            $key = $Matches[1]; $val = $Matches[2].Trim()
            if ($val -match '^["'']' -or $val -match '^[|>]\s*$') { continue }
            if ($val -match ': ' -or $val -match ' #' -or $val -match '^[\[\]{}&*!%@`]') {
                $findings += New-Finding $skillName "ERROR" "yaml-unquoted" "frontmatter '$key' is not valid YAML as written (contains ': ', ' #', or starts with a YAML indicator); reword (for example ' - ') or wrap the value in double quotes"
            }
        }
    }

    # --- name ---
    $name = $map["name"]
    if ([string]::IsNullOrWhiteSpace($name)) {
        $findings += New-Finding $skillName "ERROR" "name-missing" "name is required in this library (must equal the directory name)"
    } else {
        if ($name -ne $skillName) { $findings += New-Finding $skillName "ERROR" "name-mismatch" "name '$name' differs from directory '$skillName'" }
        if ($name.Length -gt $MAX_NAME_CHARS) { $findings += New-Finding $skillName "ERROR" "name-length" "name is $($name.Length) chars (max $MAX_NAME_CHARS)" }
        if ($name -notmatch '^[a-z0-9]+(-[a-z0-9]+)*$') { $findings += New-Finding $skillName "ERROR" "name-charset" "name must be lowercase letters, numbers, single hyphens" }
        if ($name -match 'anthropic|claude') { $findings += New-Finding $skillName "ERROR" "name-reserved" "name contains reserved word 'anthropic' or 'claude'" }
        if ($VAGUE_NAMES -contains $name) { $findings += New-Finding $skillName "WARN" "name-vague" "name '$name' is too generic to route on" }
    }

    # --- description ---
    $desc = $map["description"]
    if ([string]::IsNullOrWhiteSpace($desc)) {
        $findings += New-Finding $skillName "ERROR" "desc-missing" "description is required"
    } else {
        if ($desc.Length -gt $MAX_DESC_CHARS) { $findings += New-Finding $skillName "ERROR" "desc-length" "description is $($desc.Length) chars (max $MAX_DESC_CHARS)" }
        if ($desc -match '<[A-Za-z/!?][^>]*>') { $findings += New-Finding $skillName "ERROR" "desc-xml" "description must not contain XML tags" }
        elseif ($desc -match '[<>]') { $findings += New-Finding $skillName "WARN" "desc-angle" "description has '<' or '>'; some upload validators reject angle brackets (write 'to' instead of '->')" }
        if ($desc -notmatch '(?i)\bwhen\b|\bwhenever\b|\bif the user\b') {
            $findings += New-Finding $skillName "WARN" "desc-no-trigger" "description says what, not when (add 'Use when ...' with concrete triggers)"
        }
        if ($desc -match '(?i)(^|[^A-Za-z])(I|I''m|I can|you|your|we|our)([^A-Za-z]|$)') {
            $findings += New-Finding $skillName "WARN" "desc-person" "description should be third person ('Generates...', not 'I/you/we')"
        }
        if ($desc.Length -lt 60) { $findings += New-Finding $skillName "WARN" "desc-short" "description is $($desc.Length) chars; likely too vague to route on among 100+ skills" }
    }

    # --- frontmatter keys ---
    foreach ($k in $map.Keys) {
        $known = ($PORTABLE_KEYS -contains $k) -or ($CLAUDE_CODE_KEYS -contains $k)
        if (-not $known) {
            $level = if ($k -in @("globs", "alwaysApply")) { "ERROR" } else { "WARN" }
            $findings += New-Finding $skillName $level "fm-unknown-key" "frontmatter key '$k' is not recognized (ignored by Claude Code)"
        } elseif ($Portable -and -not ($PORTABLE_KEYS -contains $k)) {
            $findings += New-Finding $skillName "ERROR" "fm-not-portable" "key '$k' is Claude Code only; claude.ai/API uploads reject it"
        }
    }

    # --- body ---
    if ($body.Count -gt $MAX_BODY_LINES) {
        $findings += New-Finding $skillName "ERROR" "body-length" "SKILL.md body is $($body.Count) lines (max $MAX_BODY_LINES); move detail to reference files"
    }
    if ($body | Select-String -Pattern '^##\s+When to Use' -Quiet) {
        $findings += New-Finding $skillName "WARN" "body-when-to-use" "'When to Use' in the body is read only after triggering; move triggers into description"
    }

    # --- all markdown files in the skill ---
    $mdFiles = @(Get-ChildItem $dir -Recurse -File -Include *.md)
    $refFiles = @($mdFiles | Where-Object { $_.Name -ne "SKILL.md" })
    $skillText = ($lines -join "`n")
    foreach ($f in $mdFiles) {
        $rel = [IO.Path]::GetRelativePath($dir, $f.FullName) -replace '\\', '/'
        $fl = @(Get-Content $f.FullName -Encoding utf8)

        $nonAscii = @($fl | Select-String -Pattern '[^\x00-\x7F]')
        if ($nonAscii.Count -gt 0) {
            $findings += New-Finding $skillName "ERROR" "non-ascii" "$rel has non-ASCII on lines $(($nonAscii.LineNumber | Select-Object -First 8) -join ', ')"
        }
        foreach ($p in $SECRET_PATTERNS) {
            $hit = @($fl | Select-String -Pattern $p)
            if ($hit.Count -gt 0) { $findings += New-Finding $skillName "ERROR" "secret" "$rel line $($hit[0].LineNumber) matches a credential pattern" }
        }
        $abs = @($fl | Select-String -Pattern '(^|[\s(`"''])([A-Za-z]:[\\/]|/home/|/Users/)')
        if ($abs.Count -gt 0) { $findings += New-Finding $skillName "ERROR" "abs-path" "$rel has machine-specific absolute paths on lines $(($abs.LineNumber | Select-Object -First 5) -join ', ')" }
        $bs = @($fl | Select-String -Pattern '[A-Za-z0-9_.-]+\\[A-Za-z0-9_.-]+\.(md|py|ps1|sh|js|ts|json|txt)\b')
        if ($bs.Count -gt 0) { $findings += New-Finding $skillName "ERROR" "backslash-path" "$rel uses Windows-style paths on lines $(($bs.LineNumber | Select-Object -First 5) -join ', ') (use forward slashes)" }
        $dated = @($fl | Select-String -Pattern '(?i)\b(before|after|until|as of|starting)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+20\d\d')
        if ($dated.Count -gt 0) { $findings += New-Finding $skillName "WARN" "time-sensitive" "$rel line $($dated[0].LineNumber) is time-sensitive; move to an 'Old patterns' section" }

        # Local markdown links must resolve.
        foreach ($m in [regex]::Matches(($fl -join "`n"), '\]\(([^)#\s]+)(#[^)]*)?\)')) {
            $target = $m.Groups[1].Value
            if ($target -match '^(https?:|mailto:|\$\{)') { continue }
            $resolved = Join-Path $f.DirectoryName $target
            if (-not (Test-Path $resolved)) { $findings += New-Finding $skillName "ERROR" "broken-link" "$rel links to missing file '$target'" }
        }

        if ($f.Name -ne "SKILL.md") {
            # One level deep: reference files should not send Claude to further reference files.
            foreach ($other in $refFiles) {
                if ($other.FullName -eq $f.FullName) { continue }
                if (($fl -join "`n") -match [regex]::Escape($other.Name)) {
                    $findings += New-Finding $skillName "WARN" "nested-ref" "$rel points to $($other.Name); link it from SKILL.md instead (keep references one level deep)"
                }
            }
            if ($fl.Count -gt $TOC_REQUIRED_LINES -and -not ($fl | Select-String -Pattern '^#{1,3}\s+(Table of )?Contents' -Quiet)) {
                $findings += New-Finding $skillName "WARN" "ref-no-toc" "$rel is $($fl.Count) lines with no '## Contents' section"
            }
            if ($skillText -notmatch [regex]::Escape($f.Name)) {
                $findings += New-Finding $skillName "WARN" "ref-orphan" "$rel is never mentioned in SKILL.md, so Claude will not know to read it"
            }
        }
    }

    # Scripts are referenced too, or Claude never runs them.
    foreach ($s in @(Get-ChildItem $dir -Recurse -File -Include *.ps1, *.py, *.sh, *.js -ErrorAction SilentlyContinue)) {
        if ($skillText -notmatch [regex]::Escape($s.Name)) {
            $findings += New-Finding $skillName "WARN" "script-orphan" "scripts/$($s.Name) is never mentioned in SKILL.md"
        }
    }

    $words = (($body -join " ") -split '\s+' | Where-Object { $_ }).Count
    # ~1.3 tokens per English word is a rough, model-agnostic estimate.
    $findings += New-Finding $skillName "INFO" "size" "body $($body.Count) lines, $words words (~$([int]($words * 1.3)) tokens); description $($desc.Length) chars"
    return , $findings
}

# --- Resolve targets --------------------------------------------------------
if (-not (Test-Path $Path)) { Write-Error "Path not found: $Path"; exit 1 }
$targets = if (Test-Path (Join-Path $Path "SKILL.md")) { @((Resolve-Path $Path).Path) }
           else { @(Get-ChildItem $Path -Directory | Where-Object { Test-Path (Join-Path $_.FullName "SKILL.md") } | ForEach-Object FullName) }
if ($targets.Count -eq 0) { Write-Error "No SKILL.md found at $Path or in its immediate subfolders"; exit 1 }

$all = @()
foreach ($t in $targets) { $all += Test-Skill $t }

if ($Json) { $all | ConvertTo-Json -Depth 4; exit (@($all | Where-Object level -eq "ERROR").Count) }

foreach ($group in ($all | Group-Object skill)) {
    $e = @($group.Group | Where-Object level -eq "ERROR").Count
    $w = @($group.Group | Where-Object level -eq "WARN").Count
    $status = if ($e -gt 0) { "FAIL" } elseif ($w -gt 0) { "PASS (warnings)" } else { "PASS" }
    Write-Host "=== $($group.Name): $status  [$e errors, $w warnings]"
    foreach ($f in $group.Group) { Write-Host ("  {0,-5} {1,-18} {2}" -f $f.level, $f.code, $f.message) }
}
$errors = @($all | Where-Object level -eq "ERROR").Count
$failed = @($all | Where-Object level -eq "ERROR" | Select-Object -ExpandProperty skill -Unique).Count
Write-Host ""
Write-Host "Lint summary: $($targets.Count) skills, $failed failing, $errors errors, $(@($all | Where-Object level -eq 'WARN').Count) warnings"
exit $errors
