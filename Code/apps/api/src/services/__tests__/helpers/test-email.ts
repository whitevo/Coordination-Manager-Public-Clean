/**
 * Single source for the live-test email recipient used by tests that send
 * real emails (email.test.ts, calendar-notifications.live.test.ts).
 *
 * Configure in apps/api/.env:
 *   EMAIL_TEST_RECIPIENT              - shared default test inbox
 *   CALENDAR_NOTIFICATIONS_TEST_EMAIL - optional per-suite override
 *
 * Read lazily (function, not module constant) so it works regardless of
 * when the calling test runs dotenv.config().
 */
export function getTestEmailRecipient(overrideEnvVar?: string): string {
  const override = overrideEnvVar ? process.env[overrideEnvVar] : undefined
  return override || process.env.EMAIL_TEST_RECIPIENT || 'recipient@example.com'
}
