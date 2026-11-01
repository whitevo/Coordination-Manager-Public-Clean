import { describe, expect, it } from 'vitest'
import { eventTimestampKey, eventTimestampsEqual } from '../event-sync-timestamps.js'

describe('event sync timestamps', () => {
  it.each([
    '2026-10-02T06:00:00Z',
    '2026-10-02T06:00:00.000Z',
    '2026-10-02T06:00:00.000000+00:00',
    '2026-10-02T09:00:00+03:00',
    '2026-10-02T01:00:00-05:00',
  ])('recognizes equivalent timestamp representation %s', (timestamp) => {
    expect(eventTimestampsEqual('2026-10-02T06:00:00+00:00', timestamp)).toBe(true)
  })

  it('preserves microsecond changes instead of truncating them to milliseconds', () => {
    expect(eventTimestampsEqual('2026-10-02T06:00:00.123456Z', '2026-10-02T09:00:00.123456+03:00')).toBe(true)
    expect(eventTimestampsEqual('2026-10-02T06:00:00.123456Z', '2026-10-02T06:00:00.123457Z')).toBe(false)
    expect(eventTimestampsEqual('2026-10-02T06:00:00.123Z', '2026-10-02T06:00:00.123001Z')).toBe(false)
  })

  it('recognizes genuinely changed instants', () => {
    expect(eventTimestampsEqual('2026-10-02T06:00:00Z', '2026-10-02T06:00:01Z')).toBe(false)
    expect(eventTimestampsEqual('2026-10-02T06:00:00+00:00', '2026-10-02T06:00:00+03:00')).toBe(false)
  })

  it.each([
    '',
    'invalid',
    '2026-10-02T06:00:00',
    '2026-13-02T06:00:00Z',
    '2026-02-30T06:00:00Z',
    '2026-10-02T24:00:00Z',
    '2026-10-02T06:00:00.1234567Z',
  ])('rejects invalid or unsupported timestamp %s explicitly', (timestamp) => {
    expect(() => eventTimestampKey(timestamp)).toThrow('Imported event timestamps must be valid ISO timestamps with a timezone')
  })
})
