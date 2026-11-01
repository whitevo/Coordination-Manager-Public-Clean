# build-skill-listing.ps1
# Prints "name: description" for every skill in a directory -- the same metadata
# Claude sees when choosing a skill. Feed it to the Router subagent for trigger evals.
#
# Usage:
#   pwsh -File build-skill-listing.ps1 -SkillsDir <dir> [-SkillsDir <dir2>] [-Swap <skill>=<variant-dir>]
#
# -Swap replaces one skill's metadata with an experiment variant's, so the
# Router sees the variant description in the context of all its neighbors.

param(
    [Parameter(Mandatory = $true)][string[]]$SkillsDir,
    [string[]]$Swap = @()
)

$ErrorActionPreference = "Stop"

function Get-Meta([string]$skillMd) {
    $lines = @(Get-Content $skillMd -Encoding utf8)
    $name = Split-Path (Split-Path $skillMd -Parent) -Leaf
    $desc = ""
    if ($lines.Count -gt 0 -and $lines[0].Trim() -eq "---") {
        for ($i = 1; $i -lt $lines.Count -and $lines[$i].Trim() -ne "---"; $i++) {
            if ($lines[$i] -match '^name:\s*(.+)$') { $name = $Matches[1].Trim('"', "'", ' ') }
            elseif ($lines[$i] -match '^(description|when_to_use):\s*(.*)$') {
                $val = $Matches[2].Trim()
                if ($val -match '^[>|][+-]?$') {
                    $parts = @()
                    while ($i + 1 -lt $lines.Count -and $lines[$i + 1] -match '^\s+\S') { $i++; $parts += $lines[$i].Trim() }
                    $val = $parts -join " "
                }
                $desc = ("$desc " + $val.Trim('"', "'")).Trim()
            }
        }
    }
    [pscustomobject]@{ name = $name; description = $desc }
}

$swapMap = @{}
foreach ($s in $Swap) {
    $k, $v = $s -split '=', 2
    if (-not (Test-Path (Join-Path $v "SKILL.md"))) { Write-Error "Swap target has no SKILL.md: $v"; exit 1 }
    $swapMap[$k] = Join-Path $v "SKILL.md"
}

$seen = @{}
foreach ($dir in $SkillsDir) {
    if (-not (Test-Path $dir)) { Write-Error "Skills dir not found: $dir"; exit 1 }
    foreach ($d in Get-ChildItem $dir -Directory | Sort-Object Name) {
        $md = Join-Path $d.FullName "SKILL.md"
        if (-not (Test-Path $md)) { continue }
        if ($swapMap.ContainsKey($d.Name)) { $md = $swapMap[$d.Name] }
        $m = Get-Meta $md
        if ($seen.ContainsKey($m.name)) { continue }   # first directory wins, like skill precedence
        $seen[$m.name] = $true
        "- $($m.name): $($m.description)"
    }
}
