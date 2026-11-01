import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEY, useTimezones } from '../use-timezones'

beforeEach(() => localStorage.clear())
afterEach(() => cleanup())

describe('timezone persistence', () => {
  it('keeps existing callers loading and saving their normal calendar preference', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ primary: 'Asia/Tokyo', additional: ['UTC'] })
    )
    const { result } = renderHook(() => useTimezones())
    expect(result.current.primary).toBe('Asia/Tokyo')
    expect(result.current.additional).toEqual(['UTC'])

    act(() => result.current.setPrimary('UTC'))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      primary: 'UTC',
      additional: [],
    })
    act(() => result.current.addTimezone('Europe/London'))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').additional).toEqual([
      'Europe/London',
    ])
    act(() => result.current.replaceTimezone(1, 'America/New_York'))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').additional).toEqual([
      'America/New_York',
    ])
    act(() => result.current.removeTimezone('America/New_York'))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').additional).toEqual([])
  })

  it('keeps guest timezone edits isolated, including add, replace and remove', () => {
    const preference = JSON.stringify({ primary: 'Asia/Tokyo', additional: ['Europe/London'] })
    localStorage.setItem(STORAGE_KEY, preference)
    const { result, unmount } = renderHook(() =>
      useTimezones(undefined, {
        initialState: { primary: 'UTC', additional: [] },
        persist: false,
      })
    )
    expect(result.current.all).toEqual(['UTC'])
    act(() => result.current.setPrimary('America/New_York'))
    act(() => result.current.addTimezone('Europe/London'))
    act(() => result.current.replaceTimezone(1, 'Asia/Tokyo'))
    expect(result.current.all).toEqual(['America/New_York', 'Asia/Tokyo'])
    act(() => result.current.removeTimezone('Asia/Tokyo'))
    expect(result.current.all).toEqual(['America/New_York'])
    expect(localStorage.getItem(STORAGE_KEY)).toBe(preference)
    unmount()
  })
})
