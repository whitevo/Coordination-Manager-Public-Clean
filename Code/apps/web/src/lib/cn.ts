/**
 * Joins conditional class names. No merge/dedupe: two classes that set the same
 * property (h-8 and h-10) both apply and the winner is decided by stylesheet
 * order, not by argument order. Callers of UI primitives therefore pass
 * layout-only classes (margin, flex, width, grid placement); visual changes go
 * through the primitive's props.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
