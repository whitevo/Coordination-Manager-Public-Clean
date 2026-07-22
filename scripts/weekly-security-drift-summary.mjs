import fs from 'node:fs'

const AUDIT_PATH = 'audit-moderate.json'
const OUTDATED_PATH = 'outdated.json'
const summaryFile = process.env.GITHUB_STEP_SUMMARY

function safeReadJson(path) {
  if (!fs.existsSync(path)) return null
  try {
    const content = fs.readFileSync(path, 'utf8').trim()
    if (!content) return null
    return JSON.parse(content)
  } catch {
    return null
  }
}

function getAuditCounts(auditJson) {
  const counts = {
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    unknown: 0,
  }

  if (!auditJson || typeof auditJson !== 'object') {
    return counts
  }

  const vulnerabilities = auditJson.vulnerabilities
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    return counts
  }

  for (const pkg of Object.values(vulnerabilities)) {
    const severity =
      pkg && typeof pkg === 'object' && typeof pkg.severity === 'string'
        ? pkg.severity.toLowerCase()
        : 'unknown'

    if (severity in counts) {
      counts[severity] += 1
    } else {
      counts.unknown += 1
    }
  }

  return counts
}

function countOutdatedPackages(outdatedJson) {
  if (!outdatedJson || typeof outdatedJson !== 'object') {
    return 0
  }

  let count = 0
  for (const workspace of Object.values(outdatedJson)) {
    if (workspace && typeof workspace === 'object') {
      count += Object.keys(workspace).length
    }
  }
  return count
}

function getDaysSinceHardening() {
  const value = process.env.LAST_SECURITY_HARDENING_DATE
  if (!value) return null

  const start = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(start.valueOf())) return null

  const now = new Date()
  const diffMs = now.valueOf() - start.valueOf()
  if (diffMs < 0) return 0
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

const auditJson = safeReadJson(AUDIT_PATH)
const outdatedJson = safeReadJson(OUTDATED_PATH)
const counts = getAuditCounts(auditJson)
const outdatedCount = countOutdatedPackages(outdatedJson)
const daysSinceHardening = getDaysSinceHardening()

const lines = [
  '# Weekly security drift report',
  '',
  `- Audit findings (moderate+ run): moderate=${counts.moderate}, high=${counts.high}, critical=${counts.critical}`,
  `- Additional audit context: low=${counts.low}, unknown=${counts.unknown}`,
  `- Outdated package entries across workspaces: ${outdatedCount}`,
]

if (daysSinceHardening != null) {
  lines.push(`- Days since last recorded hardening checkpoint (${process.env.LAST_SECURITY_HARDENING_DATE}): ${daysSinceHardening}`)
}

lines.push('')
lines.push('Interpretation note: this report is intentionally non-blocking and intended for drift monitoring.')

const output = `${lines.join('\n')}\n`

if (summaryFile) {
  fs.appendFileSync(summaryFile, output)
}

process.stdout.write(output)
