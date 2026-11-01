/**
 * Re-export of the canonical date + time detector.
 *
 * The implementation lives in the API service (which owns its regression test
 * suite) and is browser-safe with no imports, so the web app bundles the same
 * source directly instead of maintaining a byte-for-byte duplicate.
 */
export * from '../../../api/src/services/date-time-detection'
