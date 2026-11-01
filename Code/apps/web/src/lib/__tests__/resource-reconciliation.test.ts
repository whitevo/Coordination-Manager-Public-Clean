import { describe, expect, it } from 'vitest'
import { ESLint } from 'eslint'
import { ResourceReconciliationGuard, rollbackResourcePatch } from '../resource-reconciliation'

interface TestItem {
  id: string
  value: string
}

describe('ResourceReconciliationGuard Tier 1 contract', () => {
  it('enforces the primitive transport/cache boundary for imports and re-exports', async () => {
    const eslint = new ESLint()
    for (const source of [
      "import { apiClient } from '@/lib/api-client'; void apiClient;",
      "export { setSessionCacheValue } from '../lib/session-data-cache';",
    ]) {
      const results = await eslint.lintText(source, { filePath: 'src/hooks/use-list-presence.ts' })
      expect(results[0].messages.some(message => message.ruleId === 'no-restricted-imports')).toBe(true)
    }
  })

  it('rebases a failed patch without restoring unrelated entities or newer fields', () => {
    const before = { id: 'a', value: 'old', title: 'Old title' }
    const applied = { value: 'failed value', title: 'Failed title' }
    expect(rollbackResourcePatch([
      { id: 'a', value: 'failed value', title: 'Newer title' },
      { id: 'b', value: 'saved independently', title: 'B' },
    ], before, applied)).toEqual([
      { id: 'a', value: 'old', title: 'Newer title' },
      { id: 'b', value: 'saved independently', title: 'B' },
    ])
  })

  it('shares the transport observation rather than recapturing metadata for later callers', async () => {
    const guard = new ResourceReconciliationGuard()
    let resolveRead: (items: TestItem[]) => void = () => undefined
    const transport = new Promise<TestItem[]>(resolve => { resolveRead = resolve })
    const first = guard.read('items', () => transport)
    guard.endMutation(guard.beginMutation('a'))
    const second = guard.read('items', () => Promise.reject(new Error('Must not create another read')))
    expect(second).toBe(first)
    resolveRead([{ id: 'a', value: 'old' }])
    const response = await second
    expect(guard.reconcile([{ id: 'a', value: 'new' }], response.data, response.observation, 'complete'))
      .toEqual([{ id: 'a', value: 'new' }])
  })

  it('does not let an older read overwrite a local change or resurrect a deletion', () => {
    const guard = new ResourceReconciliationGuard()
    const observation = guard.beginObservation('items')
    const update = guard.beginMutation('a')
    const deletion = guard.beginMutation('b')
    guard.endMutation(update)
    guard.endMutation(deletion)

    expect(guard.reconcile<TestItem>(
      [{ id: 'a', value: 'new' }],
      [{ id: 'a', value: 'old' }, { id: 'b', value: 'deleted' }],
      observation,
      'complete'
    )).toEqual([{ id: 'a', value: 'new' }])
  })

  it('keeps protection until every overlapping operation on the same entity ends', () => {
    const guard = new ResourceReconciliationGuard()
    const first = guard.beginMutation('a')
    const second = guard.beginMutation('a')
    guard.endMutation(first)
    const observation = guard.beginObservation('items')

    expect(guard.pendingEntityIds()).toEqual(new Set(['a']))
    expect(guard.reconcile<TestItem>(
      [{ id: 'a', value: 'latest' }], [{ id: 'a', value: 'old' }], observation, 'complete'
    )).toEqual([{ id: 'a', value: 'latest' }])
    guard.endMutation(second)
    guard.endMutation(second)
    expect(guard.pendingEntityIds().size).toBe(0)
  })

  it('retains missing entities on partial observations but reconciles complete membership', () => {
    const guard = new ResourceReconciliationGuard()
    const current = [{ id: 'a', value: 'outside top-N' }]
    expect(guard.reconcile(current, [], guard.beginObservation('top-N'), 'partial')).toEqual(current)
    expect(guard.reconcile(current, [], guard.beginObservation('all-items'), 'complete')).toEqual([])
  })

  it('rejects reversed responses for the same query without blocking other queries', () => {
    const guard = new ResourceReconciliationGuard()
    const older = guard.beginObservation('items')
    const newer = guard.beginObservation('items')
    const current = guard.reconcile<TestItem>([], [{ id: 'a', value: 'new' }], newer, 'complete')
    expect(guard.reconcile(current, [{ id: 'a', value: 'old' }], older, 'complete')).toEqual(current)
    expect(guard.reconcile(current, [{ id: 'b', value: 'detail' }], guard.beginObservation('detail:b'), 'partial'))
      .toEqual([...current, { id: 'b', value: 'detail' }])
  })

  it('ignores responses and operation completions from a previous identity epoch', () => {
    const guard = new ResourceReconciliationGuard()
    const older = guard.beginObservation('items')
    const operation = guard.beginMutation('a')
    guard.reset()
    const nextOperation = guard.beginMutation('a')
    guard.endMutation(operation)
    expect(guard.pendingEntityIds()).toEqual(new Set(['a']))
    expect(guard.reconcile<TestItem>([], [{ id: 'a', value: 'other user' }], older, 'partial')).toEqual([])
    guard.endMutation(nextOperation)
  })

  it('does not mistake a later remote change for a stale pre-mutation read', () => {
    const guard = new ResourceReconciliationGuard()
    guard.endMutation(guard.beginMutation('a'))
    expect(guard.reconcile<TestItem>(
      [{ id: 'a', value: 'local' }], [], guard.beginObservation('items'), 'complete'
    )).toEqual([])
  })
})