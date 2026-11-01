import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import {
  installDefaultApiMocks,
  installEditorDomPolyfills,
  mockUseAuth,
} from './time-management-test-harness'
import TimeManagementPage from '../TimeManagementPage'

// The grid keys days by UTC date of the local week labels; just after local midnight on a
// Monday, "now" can still be the previous UTC week. Noon UTC on today's local date is always visible.
const VISIBLE_WEEK_ITEM_START = (() => {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0))
})()

const UNSYNCED_QUEUE_STORAGE_KEY = 'time-management-unsynced-v1'

describe('TimeManagement unsynced write queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mockUseAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      isTraveler: false,
    })
    installDefaultApiMocks()
    installEditorDomPolyfills()
  })

  it('restores a queued manual item when the initial server response is stale or empty', async () => {
    const snapshot = {
      id: 'pending-offline-event',
      title: 'Offline focus block',
      description: 'Do not lose this work',
      meeting_link: null,
      location: null,
      start_time: VISIBLE_WEEK_ITEM_START.toISOString(),
      end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      source_type: 'manual',
      source_id: 'mode-main',
      category_ids: [],
      recurrence_rule: null,
    }
    localStorage.setItem(UNSYNCED_QUEUE_STORAGE_KEY, JSON.stringify({
      [snapshot.id]: {
        eventId: snapshot.id,
        kind: 'create',
        method: 'post',
        endpoint: '/api/user-events',
        payload: {},
        snapshot,
        attempts: 1,
        firstFailedAt: Date.now() - 30_000,
        lastAttemptAt: Date.now() - 5_000,
        lastError: 'Network Error',
      },
    }))

    render(
      <MemoryRouter>
        <TimeManagementPage />
      </MemoryRouter>
    )

    expect((await screen.findAllByText('Offline focus block')).length).toBeGreaterThan(0)
  })
})