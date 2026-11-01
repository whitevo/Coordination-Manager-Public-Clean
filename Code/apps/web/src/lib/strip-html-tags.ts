/**
 * Remove HTML tags repeatedly until the result is stable, so split tags like
 * `<scr<script>ipt>` cannot survive a single pass. Callers render the result
 * through React text nodes (auto-escaped); the fixpoint keeps the displayed
 * text clean even for adversarial input.
 */
export function stripHtmlTags(text: string): string {
  let current = text
  for (;;) {
    const next = current.replace(/<[^>]*>/g, '')
    if (next === current) return next
    current = next
  }
}
