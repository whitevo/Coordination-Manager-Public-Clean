import { describe, expect, it } from 'vitest'
import { collapseDuplicateInvitations } from '../mailbox-page-helpers'

interface TestInvitation {
  id: string
  summary: string | null
  organizer: string | null
  starts_at: string | null
  ends_at: string | null
  status: string
  uid: string
  source_received_at?: string | null
}

function makeInvite(overrides: Partial<TestInvitation> & { id: string }): TestInvitation {
  return {
    summary: 'Workshop',
    organizer: 'organizer@example.com',
    starts_at: '2026-09-20T15:00:00.000Z',
    ends_at: '2026-09-20T16:00:00.000Z',
    status: 'proposed',
    uid: overrides.id,
    ...overrides,
  }
}

describe('collapseDuplicateInvitations', () => {
  it('collapses re-announcements from the same organizer at the same start time using the latest title', () => {
    const first = makeInvite({
      id: 'a',
      summary: 'STARTS IN TWO WEEKS: Workshop',
      source_received_at: '2026-09-06T10:00:00.000Z',
    })
    const second = makeInvite({
      id: 'b',
      summary: 'STARTS IN ONE WEEK: Workshop',
      source_received_at: '2026-09-13T10:00:00.000Z',
    })

    const groups = collapseDuplicateInvitations([first, second])

    expect(groups).toHaveLength(1)
    expect(groups[0].invite.id).toBe('b')
    expect(groups[0].invite.summary).toBe('STARTS IN ONE WEEK: Workshop')
    expect(groups[0].mergedCount).toBe(2)
  })

  it('keeps the first invitation when it was received more recently than a later row', () => {
    const latest = makeInvite({
      id: 'a',
      summary: 'Newest title',
      source_received_at: '2026-09-13T10:00:00.000Z',
    })
    const older = makeInvite({
      id: 'b',
      summary: 'Older title',
      source_received_at: '2026-09-06T10:00:00.000Z',
    })

    const groups = collapseDuplicateInvitations([latest, older])

    expect(groups).toHaveLength(1)
    expect(groups[0].invite.id).toBe('a')
    expect(groups[0].mergedCount).toBe(2)
  })

  it('matches organizers case-insensitively and keeps the first when receive times are unknown', () => {
    const first = makeInvite({ id: 'a', organizer: ' Organizer@Example.com ' })
    const second = makeInvite({ id: 'b', organizer: 'organizer@example.com' })

    const groups = collapseDuplicateInvitations([first, second])

    expect(groups).toHaveLength(1)
    expect(groups[0].invite.id).toBe('a')
    expect(groups[0].mergedCount).toBe(2)
  })

  it('does not collapse invitations from different organizers', () => {
    const first = makeInvite({ id: 'a', organizer: 'one@example.com' })
    const second = makeInvite({ id: 'b', organizer: 'two@example.com' })

    const groups = collapseDuplicateInvitations([first, second])

    expect(groups).toHaveLength(2)
    expect(groups.every((group) => group.mergedCount === 1)).toBe(true)
  })

  it('does not collapse invitations with different start times', () => {
    const first = makeInvite({ id: 'a' })
    const second = makeInvite({ id: 'b', starts_at: '2026-09-21T15:00:00.000Z' })

    expect(collapseDuplicateInvitations([first, second])).toHaveLength(2)
  })

  it('never collapses rows missing an organizer or a valid start time', () => {
    const noOrganizer = makeInvite({ id: 'a', organizer: null })
    const noStart = makeInvite({ id: 'b', starts_at: null })
    const invalidStart = makeInvite({ id: 'c', starts_at: 'not-a-date' })
    const valid = makeInvite({ id: 'd' })

    expect(collapseDuplicateInvitations([noOrganizer, noStart, invalidStart, valid])).toHaveLength(4)
  })

  it('collapses three or more announcements into a single group', () => {
    const invites = [
      makeInvite({ id: 'a', source_received_at: '2026-09-01T10:00:00.000Z' }),
      makeInvite({ id: 'b', source_received_at: '2026-09-08T10:00:00.000Z' }),
      makeInvite({
        id: 'c',
        summary: 'Final title',
        source_received_at: '2026-09-15T10:00:00.000Z',
      }),
    ]

    const groups = collapseDuplicateInvitations(invites)

    expect(groups).toHaveLength(1)
    expect(groups[0].invite.id).toBe('c')
    expect(groups[0].mergedCount).toBe(3)
  })
})
