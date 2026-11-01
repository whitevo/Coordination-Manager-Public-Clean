import { describe, it, expect, vi } from 'vitest'
import { describeOptOutStatus, undoOptOuts } from '../optout-flow.js'
import type { OptOutDeps } from '../optout-flow.js'

// ─── Mock factories ───────────────────────────────────────────────────

function makeDeps(rows: unknown[] | null, opts: { selectError?: unknown; deleteError?: unknown } = {}) {
  const deleteEq = vi.fn().mockResolvedValue({ error: opts.deleteError ?? null })
  const del = vi.fn(() => ({ eq: deleteEq }))
  const selectEq = vi.fn().mockResolvedValue({ data: rows, error: opts.selectError ?? null })
  const select = vi.fn(() => ({ eq: selectEq }))
  const from = vi.fn(() => ({ select, delete: del }))
  const deps = { supabase: { from } as unknown as OptOutDeps['supabase'] } satisfies OptOutDeps
  return { deps, del, deleteEq, selectEq }
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('describeOptOutStatus', () => {
  it('reports no opt-outs', async () => {
    const { deps } = makeDeps([])
    expect(await describeOptOutStatus(deps, 'u1')).toMatch(/You receive DMs/)
  })

  it('reports a global block and per-sender blocks', async () => {
    const { deps, selectEq } = makeDeps([
      { sender_user_id: null, reason: 'dm_keyword' },
      { sender_user_id: 's1', reason: 'button_opt_out' },
      { sender_user_id: 's2', reason: 'button_opt_out' },
    ])
    const text = await describeOptOutStatus(deps, 'u1')
    expect(selectEq).toHaveBeenCalledWith('recipient_discord_id', 'u1')
    expect(text).toMatch(/All DMs .* are blocked/)
    expect(text).toMatch(/2 sender\(s\)/)
    expect(text).toMatch(/optout undo/)
  })

  it('reports a read failure', async () => {
    const { deps } = makeDeps(null, { selectError: { message: 'boom' } })
    expect(await describeOptOutStatus(deps, 'u1')).toMatch(/went wrong/)
  })
})

describe('undoOptOuts', () => {
  it('deletes every opt-out row for the recipient', async () => {
    const { deps, del, deleteEq } = makeDeps([
      { sender_user_id: null, reason: 'dm_keyword' },
      { sender_user_id: 's1', reason: 'button_opt_out' },
    ])
    const text = await undoOptOuts(deps, 'u1')
    expect(del).toHaveBeenCalled()
    expect(deleteEq).toHaveBeenCalledWith('recipient_discord_id', 'u1')
    expect(text).toMatch(/Removed 2 opt-out/)
  })

  it('does nothing when there are no opt-outs', async () => {
    const { deps, del } = makeDeps([])
    expect(await undoOptOuts(deps, 'u1')).toMatch(/no DM opt-outs/)
    expect(del).not.toHaveBeenCalled()
  })

  it('reports a delete failure', async () => {
    const { deps } = makeDeps([{ sender_user_id: null, reason: 'dm_keyword' }], { deleteError: { message: 'boom' } })
    expect(await undoOptOuts(deps, 'u1')).toMatch(/went wrong removing/)
  })
})
