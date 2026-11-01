/**
 * Shared ReDoS guard for user-authored regex patterns (guardian moderation
 * rules, network matching rules). Regex authoring is an intentional,
 * privileged feature; this guard rejects the textbook catastrophic
 * backtracking shapes before a pattern is stored or compiled.
 */

/**
 * Even non-pathological huge regexes burn CPU when run against every
 * message/title. 1KB is generous for any real rule.
 */
export const MAX_PATTERN_LENGTH = 1024

/**
 * Cheap structural heuristic for catastrophic-backtracking patterns.
 * Not a full safe-regex checker (which would require a dependency), but
 * catches the textbook ReDoS shapes:
 *   (a+)+         nested quantifier on a group
 *   (a|a)*        alternation of overlapping branches under a quantifier
 *   (.*)*         greedy wildcard under a quantifier
 * Returns null if the pattern looks safe, or a reason string if it doesn't.
 * Authors get an explicit error so they can rewrite the pattern.
 */
export function redosReason(pattern: string): string | null {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `Pattern too long (max ${MAX_PATTERN_LENGTH} chars)`
  }
  // Nested quantifier: ...(...[+*?]...)... followed by [+*?{]
  if (/\([^)]*[+*?][^)]*\)\s*[+*{]/.test(pattern)) {
    return 'Pattern has a nested quantifier (e.g. (a+)+) -- vulnerable to catastrophic backtracking'
  }
  // .* or .+ inside a group that is itself quantified
  if (/\([^)]*\.[+*][^)]*\)\s*[+*{]/.test(pattern)) {
    return 'Pattern has a greedy wildcard inside a quantified group -- vulnerable to catastrophic backtracking'
  }
  return null
}
