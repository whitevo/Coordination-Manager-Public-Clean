export interface ResourceObservation {
  epoch: number
  generation: number
  startedAt: number
  requestId: number
  queryKey: string
}

export interface ResourceMutation {
  epoch: number
  operationId: number
  entityId: string
}

export interface ResourceRead<T> {
  observation: ResourceObservation
  data: T
}

export function rollbackResourcePatch<T extends { id: string }>(items: T[], before: T, applied: Partial<T>): T[] {
  return items.map(item => {
    if (item.id !== before.id) return item
    const next = { ...item }
    for (const key of Object.keys(applied)) {
      const field = key as keyof T
      if (field !== 'id' && JSON.stringify(item[field]) === JSON.stringify(applied[field])) {
        next[field] = before[field]
      }
    }
    return next
  })
}

export class ResourceReconciliationGuard {
  constructor(readonly scope = '') {}

  private epoch = 0
  private generation = 0
  private sequence = 0
  private changedAt = new Map<string, number>()
  private pending = new Map<string, Set<number>>()
  private acceptedQueries = new Map<string, number>()
  private acceptedEntities = new Map<string, number>()
  private reads = new Map<string, Promise<ResourceRead<unknown>>>()

  reset(): void {
    this.epoch += 1
    this.changedAt.clear()
    this.pending.clear()
    this.acceptedQueries.clear()
    this.acceptedEntities.clear()
    this.reads.clear()
  }

  beginObservation(queryKey: string): ResourceObservation {
    return { epoch: this.epoch, generation: this.generation, startedAt: Date.now(), requestId: ++this.sequence, queryKey }
  }

  isCurrent(observation: ResourceObservation): boolean {
    return observation.epoch === this.epoch
      && observation.requestId >= (this.acceptedQueries.get(observation.queryKey) ?? 0)
  }

  beginMutation(entityId: string): ResourceMutation {
    const operationId = ++this.sequence
    const operations = this.pending.get(entityId) ?? new Set<number>()
    operations.add(operationId)
    this.pending.set(entityId, operations)
    this.changedAt.set(entityId, ++this.generation)
    return { epoch: this.epoch, operationId, entityId }
  }

  endMutation(operation: ResourceMutation): void {
    if (operation.epoch !== this.epoch) return
    const operations = this.pending.get(operation.entityId)
    if (!operations?.delete(operation.operationId)) return
    if (operations.size === 0) this.pending.delete(operation.entityId)
    this.changedAt.set(operation.entityId, ++this.generation)
  }

  pendingEntityIds(): Set<string> {
    return new Set(this.pending.keys())
  }

  endEntityMutation(entityId: string): void {
    const operationId = this.pending.get(entityId)?.values().next().value
    if (operationId !== undefined) this.endMutation({ epoch: this.epoch, operationId, entityId })
  }

  read<T>(queryKey: string, load: () => Promise<T>, deduplicate = true): Promise<ResourceRead<T>> {
    const existing = deduplicate ? this.reads.get(queryKey) : undefined
    if (existing) return existing as Promise<ResourceRead<T>>
    const observation = this.beginObservation(queryKey)
    const request = load().then(data => ({ observation, data }))
    this.reads.set(queryKey, request)
    void request.finally(() => {
      if (this.reads.get(queryKey) === request) this.reads.delete(queryKey)
    }).catch(() => undefined)
    return request
  }

  reconcile<T extends { id: string }>(
    current: T[],
    incoming: T[],
    observation: ResourceObservation,
    coverage: 'partial' | 'complete'
  ): T[] {
    if (!this.isCurrent(observation)) return current
    this.acceptedQueries.set(observation.queryKey, observation.requestId)
    const currentById = new Map(current.map(item => [item.id, item]))
    const result = coverage === 'partial' ? new Map(currentById) : new Map<string, T>()
    const isProtected = (entityId: string) => this.pending.has(entityId)
      || (this.changedAt.get(entityId) ?? 0) > observation.generation
      || (this.acceptedEntities.get(entityId) ?? 0) > observation.requestId

    for (const item of incoming) {
      if (isProtected(item.id)) {
        const local = currentById.get(item.id)
        if (local) result.set(item.id, local)
      } else {
        result.set(item.id, item)
        this.acceptedEntities.set(item.id, observation.requestId)
      }
    }
    for (const item of current) {
      if (result.has(item.id)) continue
      if (coverage === 'partial' || isProtected(item.id)) result.set(item.id, item)
      else this.acceptedEntities.set(item.id, observation.requestId)
    }
    return Array.from(result.values())
  }
}