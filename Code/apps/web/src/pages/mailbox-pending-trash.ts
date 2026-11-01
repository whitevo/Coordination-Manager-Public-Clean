// Keeps locally applied trash/restore state authoritative while the server write is in flight.
//
// The trash endpoint only persists `provider_trashed` after the provider round-trip, which can take
// seconds. Any inbox/thread read that runs in that window returns the old flag, and merging it back
// would make trashed rows reappear and then animate out a second time once the write lands.
//
// Reads are sequenced: an entry stays in force for every read that started before its mutation
// settled, and is pruned once a read that started after the settle has completed.

export interface PendingTrashOverlay {
  /** Call right before issuing a server read; pass the returned seq to `apply`/`completeRead`. */
  beginRead(): number
  /** Pins the given ids to `trashed` until settled and observed by a fresh read. */
  register(ids: string[], trashed: boolean): void
  /** Marks the mutation for these ids as finished on the server. */
  settle(ids: string[]): void
  /** Drops the pin immediately (e.g. the request failed and the optimistic state was rolled back). */
  discard(ids: string[]): void
  apply<T extends { id: string; is_provider_trashed: boolean }>(items: T[], readSeq: number): T[]
  completeRead(readSeq: number): void
  has(id: string): boolean
}

interface PendingTrashEntry {
  trashed: boolean
  settledAtSeq: number | null
}

export function createPendingTrashOverlay(): PendingTrashOverlay {
  const entries = new Map<string, PendingTrashEntry>()
  let readSeq = 0

  const appliesTo = (entry: PendingTrashEntry, seq: number) =>
    entry.settledAtSeq === null || seq <= entry.settledAtSeq

  return {
    beginRead() {
      readSeq += 1
      return readSeq
    },
    register(ids, trashed) {
      for (const id of ids) entries.set(id, { trashed, settledAtSeq: null })
    },
    settle(ids) {
      for (const id of ids) {
        const entry = entries.get(id)
        if (entry && entry.settledAtSeq === null) entry.settledAtSeq = readSeq
      }
    },
    discard(ids) {
      for (const id of ids) entries.delete(id)
    },
    apply(items, seq) {
      if (entries.size === 0) return items
      let changed = false
      const next = items.map((item) => {
        const entry = entries.get(item.id)
        if (!entry || !appliesTo(entry, seq) || item.is_provider_trashed === entry.trashed)
          return item
        changed = true
        return { ...item, is_provider_trashed: entry.trashed }
      })
      return changed ? next : items
    },
    completeRead(seq) {
      for (const [id, entry] of entries) {
        if (entry.settledAtSeq !== null && seq > entry.settledAtSeq) entries.delete(id)
      }
    },
    has(id) {
      return entries.has(id)
    },
  }
}
