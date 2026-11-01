// In-memory Supabase fake supporting the query-builder subset used by
// services/calendar-notifications.ts. Shared by the mocked and live suites.

export type Row = Record<string, unknown>
export const db: Record<string, Row[]> = {}
let idCounter = 0

export function resetDb() {
  for (const key of Object.keys(db)) delete db[key]
  idCounter = 0
}

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private payload: Row | Row[] | null = null
  private mode: 'many' | 'maybeSingle' = 'many'
  private sortKey: string | null = null
  private ascending = true
  private max = Infinity
  private returning = false

  constructor(private table: string) {
    db[table] ??= []
  }

  select() { this.returning = true; return this }
  insert(payload: Row | Row[]) { this.op = 'insert'; this.payload = payload; this.returning = false; return this }
  update(payload: Row) { this.op = 'update'; this.payload = payload; this.returning = false; return this }
  upsert(payload: Row) { this.op = 'upsert'; this.payload = payload; return this }
  eq(col: string, val: unknown) { this.filters.push(r => r[col] === val); return this }
  in(col: string, vals: unknown[]) { this.filters.push(r => vals.includes(r[col])); return this }
  is(col: string, val: unknown) { this.filters.push(r => (r[col] ?? null) === val); return this }
  lt(col: string, val: number) { this.filters.push(r => Number(r[col]) < val); return this }
  order(col: string, opts?: { ascending?: boolean }) { this.sortKey = col; this.ascending = opts?.ascending !== false; return this }
  limit(n: number) { this.max = n; return this }
  maybeSingle() { this.mode = 'maybeSingle'; return this }

  private run(): unknown {
    const rows = db[this.table]
    if (this.op === 'insert') {
      const items = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      for (const item of items) rows.push({ id: `evt-${++idCounter}`, sent_at: null, attempts: 0, last_error: null, ...item })
      return null
    }
    if (this.op === 'upsert') {
      rows.push({ ...(this.payload as Row) })
      return null
    }
    const matched = rows.filter(r => this.filters.every(f => f(r)))
    if (this.op === 'update') {
      for (const row of matched) Object.assign(row, this.payload)
      return this.returning ? matched.map(r => ({ ...r })) : null
    }
    let result = [...matched]
    if (this.sortKey) {
      const key = this.sortKey
      result.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (this.ascending ? 1 : -1))
    }
    result = result.slice(0, this.max)
    if (this.mode === 'maybeSingle') return result[0] ? { ...result[0] } : null
    return result.map(r => ({ ...r }))
  }

  then<T1 = { data: unknown; error: null }, T2 = never>(
    onFulfilled?: ((value: { data: unknown; error: null }) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve({ data: this.run(), error: null }).then(onFulfilled, onRejected)
  }
}

export const fakeSupabaseAdmin = { from: (table: string) => new Query(table) }
