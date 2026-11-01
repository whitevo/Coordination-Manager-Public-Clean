import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Filter, RefreshCw } from 'lucide-react'
import { apiClient, dedupedGet } from '@/lib/api-client'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Button, ToggleButton } from '@/components/ui'
import { formatLastBooted } from '@/lib/guardian-ban-time'

interface BanAccount {
  discord_user_id: string
  created_at: string
  boot_count: number
  last_booted_at: string | null
}
interface EnforcementFailure {
  guild_id: string
  discord_user_id: string
  last_error: string
  action: 'ban' | 'unban'
}
interface BanPreview {
  id: string
  status: 'pending' | 'processing' | 'ready' | 'confirming' | 'failed' | 'confirmed'
  confirmation_requested: boolean
  expired: boolean
  error: string | null
  checked: number
  checks_total: number
  servers: number
  rows: Array<{ discord_user_id: string; member_servers: number | null; already_registered: boolean }>
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = error.response
    if (typeof response === 'object' && response !== null && 'data' in response) {
      const data = response.data
      if (typeof data === 'object' && data !== null && 'message' in data && typeof data.message === 'string') return data.message
    }
  }
  return error instanceof Error ? error.message : 'Guardian ban registry request failed'
}

function inspectBanInput(input: string) {
  const values = input.split(/[\s,]+/).filter(Boolean)
  const ids = [...new Set(values)]
  const invalid = ids.filter(id => !/^\d{17,20}$/.test(id) || BigInt(id) > 18446744073709551615n || BigInt(id) === 0n)
  return { ids, invalid, duplicates: values.length - ids.length, tooMany: values.length > 1000 || input.length > 25_000 }
}

export default function GuardianBanList() {
  const [input, setInput] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [preview, setPreview] = useState<BanPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [entries, setEntries] = useState<BanAccount[]>([])
  const [failures, setFailures] = useState<EnforcementFailure[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const hasLoaded = useRef(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterDraft, setFilterDraft] = useState('')
  const [filterIds, setFilterIds] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [removeConfirmation, setRemoveConfirmation] = useState(false)
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entriesError, setEntriesError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState(false)
  const readVersion = useRef(0)
  const previewVersion = useRef(0)
  const invalidateEntries = useCallback(() => { ++readVersion.current }, [])
  const invalidatePreview = useCallback(() => { ++previewVersion.current }, [])
  const tokens = useMemo(() => inspectBanInput(input), [input])
  const newCount = preview?.rows.filter(row => !row.already_registered).length || 0
  const canConfirm = !busy && !previewError && preview?.status === 'ready' && !preview.expired && newCount > 0
  const previewTerminal = preview !== null && (preview.expired || ['confirmed', 'failed'].includes(preview.status))
  const confirmationPending = preview?.confirmation_requested === true && !previewTerminal
  const lastAutomaticRead = useRef(0)

  const loadEntries = useCallback(async () => {
    const version = ++readVersion.current
    if (!hasLoaded.current) setLoading(true)
    setRefreshing(true)
    try {
      const response = filterIds
        ? await apiClient.post<{ entries: BanAccount[]; total: number; failures: EnforcementFailure[] }>('/api/guardian/ban-list/search', {
          discord_ids: filterIds, offset: String(page * 100),
        })
        : await dedupedGet<{ entries: BanAccount[]; total: number; failures: EnforcementFailure[] }>(
          `/api/guardian/ban-list/entries?offset=${page * 100}`,
        )
      if (version !== readVersion.current) return
      setEntries(response.data.entries)
      setFailures(response.data.failures)
      setTotal(response.data.total)
      setEntriesError(null)
      hasLoaded.current = true
    } catch (failure) {
      if (version === readVersion.current) setEntriesError(errorMessage(failure))
    } finally {
      if (version === readVersion.current) { setLoading(false); setRefreshing(false) }
    }
  }, [page, filterIds])

  const loadPreview = useCallback(async () => {
    if (!previewId) return
    const version = ++previewVersion.current
    try {
      const response = await dedupedGet<BanPreview>(`/api/guardian/ban-list/preview/${previewId}`)
      if (version !== previewVersion.current) return
      setPreviewError(null)
      if (response.data.status === 'confirmed') {
        ++previewVersion.current
        setPreview(null)
        setPreviewId(null)
        setInput('')
        setNotice('Registry updated. Global bans queued for newly added IDs. Enforcement results appear in the global registry below.')
      } else {
        setPreview(response.data)
      }
    } catch (failure) {
      if (version === previewVersion.current) setPreviewError(errorMessage(failure))
    }
  }, [previewId])

  useEffect(() => {
    void loadEntries()
    lastAutomaticRead.current = Date.now()
    return invalidateEntries
  }, [loadEntries, invalidateEntries])
  useEffect(() => {
    void loadPreview()
    return invalidatePreview
  }, [loadPreview, previewId, invalidatePreview])
  useEffect(() => {
    const refreshIfDue = () => {
      if (document.visibilityState !== 'visible' || busy || Date.now() - lastAutomaticRead.current < 120_000) return
      lastAutomaticRead.current = Date.now()
      void (async () => {
        if (previewId && !previewTerminal) await loadPreview()
        await loadEntries()
      })()
    }
    const timer = setInterval(refreshIfDue, 120_000)
    document.addEventListener('visibilitychange', refreshIfDue)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refreshIfDue) }
  }, [loadEntries, loadPreview, previewId, previewTerminal, busy])
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 10_000)
    return () => clearTimeout(timer)
  }, [notice])

  const startPreview = async () => {
    if (busy || confirmationPending) return
    setBusy(true)
    setError(null)
    setNotice(null)
    ++previewVersion.current
    try {
      const response = await apiClient.post<{ preview_id: string }>('/api/guardian/ban-list/preview', { discord_ids: input })
      setPreview(null)
      setPreviewError(null)
      setPreviewId(response.data.preview_id)
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }

  const confirm = async () => {
    setConfirmation(false)
    if (!canConfirm || !previewId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await apiClient.post('/api/guardian/ban-list/confirm', {
        preview_id: previewId, confirmed: true,
      })
      setPreview(current => current ? { ...current, status: 'confirming', confirmation_requested: true, checked: 0, checks_total: current.servers } : current)
      await loadPreview()
      if (page !== 0) setPage(0)
      else await loadEntries()
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }

  const applyFilter = () => {
    const inspected = inspectBanInput(filterDraft)
    if (!inspected.ids.length || inspected.tooMany || inspected.invalid.length) {
      setError('Filter requires 1-1000 valid Discord IDs separated by spaces, commas, or newlines.')
      return
    }
    invalidateEntries()
    setError(null)
    setFilterIds(inspected.ids.join(' '))
    setPage(0)
    setSelected(new Set())
  }
  const selectMatching = async () => {
    if (!filterIds) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiClient.post<{ ids: string[] }>('/api/guardian/ban-list/matching-ids', { discord_ids: filterIds })
      setSelected(new Set(response.data.ids))
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }
  const removeSelected = async () => {
    setRemoveConfirmation(false)
    if (busy || !selected.size) return
    setBusy(true)
    setError(null)
    setNotice(null)
    invalidateEntries()
    invalidatePreview()
    try {
      const response = await apiClient.post<{ removed: number }>('/api/guardian/ban-list/remove', {
        discord_ids: [...selected].join(' '), confirmed: true,
      })
      setNotice(`${response.data.removed} IDs removed from Guardian enforcement. Discord unbans are queued across all connected servers; failures will be shown below.`)
      setSelected(new Set())
      await loadEntries()
      await loadPreview()
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground"><Ban className="h-5 w-5" />Ban List</h2>
          <p className="text-sm text-muted-foreground">Global protection across all existing and future Demon X servers.</p>
        </div>
        <Button emphasis="outline" disabled={busy || refreshing} onClick={() => {
          lastAutomaticRead.current = Date.now()
          void (async () => { await loadPreview(); await loadEntries() })()
        }}
          icon={<RefreshCw className="h-4 w-4" />}>
          Refresh
        </Button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-subtle p-3 text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-success-subtle p-3 text-success">{notice}</p>}
      <form onSubmit={event => { event.preventDefault(); void startPreview() }} className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold text-foreground">1. Enter Discord IDs</h3>
        <label className="block space-y-2 text-sm text-foreground">
          <span>Discord IDs</span>
          <textarea value={input} disabled={busy || confirmationPending} onChange={event => setInput(event.target.value)} rows={4}
            placeholder="Paste IDs separated by spaces, commas, or newlines"
            className="w-full rounded-lg border border-border bg-background p-3 font-mono" />
        </label>
        <p className="text-xs text-muted-foreground">{tokens.ids.length} unique IDs; {tokens.duplicates} duplicates removed. Maximum 1000 IDs.</p>
        {tokens.invalid.length > 0 && <p role="alert" className="break-words text-sm text-danger">Invalid IDs: {tokens.invalid.join(', ')}</p>}
        {tokens.tooMany && <p role="alert" className="text-sm text-danger">Use at most 1000 IDs and 25,000 characters.</p>}
        <Button type="submit" intent="primary" disabled={busy || confirmationPending || !tokens.ids.length || tokens.invalid.length > 0 || tokens.tooMany}>Submit for review</Button>
        <p className="text-xs text-muted-foreground">Review does not register or ban accounts. Requires your verified Discord link.</p>
      </form>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold text-foreground">2. Review and confirm</h3>
        {!previewId && <p className="text-sm text-muted-foreground">Submit IDs above to check membership and the global registry.</p>}
        {previewId && !preview && !previewError && <p role="status" className="text-sm text-muted-foreground">Loading working dashboard...</p>}
        {previewError && <p role="alert" className="text-danger">{previewError}</p>}
        {preview && <>
          <p role="status" className="text-sm text-muted-foreground">
            {preview.expired ? 'Preview expired.' : preview.status === 'failed' ? 'Review failed.' :
              preview.confirmation_requested ? 'Rechecking all server permissions before registry update.' : preview.status === 'ready' ? 'Review complete.' : 'Membership review in progress.'}
            {' '}{preview.checked} / {preview.checks_total} checks across {preview.servers} servers.
          </p>
          {preview.error && <p role="alert" className="text-danger">{preview.error}</p>}
          {preview.expired && <p role="alert" className="text-danger">Preview expired. Submit the IDs again.</p>}
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Submitted IDs membership and registry review</caption>
              <thead><tr className="text-muted-foreground"><th scope="col" className="p-2">Discord ID</th><th scope="col" className="p-2">Member of servers</th><th scope="col" className="p-2">In ban registry</th></tr></thead>
              <tbody>{preview.rows.map(row => <tr key={row.discord_user_id} className="border-t border-border text-foreground">
                <td className="p-2 font-mono">{row.discord_user_id}</td>
                <td className="p-2">{row.member_servers === null ? 'Not yet verified' : row.member_servers}</td>
                <td className="p-2">{row.already_registered ? 'Yes' : 'No'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{newCount} new IDs. Existing IDs will not be requeued. Membership counts are a preview snapshot.</p>
          <Button intent="danger" disabled={!canConfirm} onClick={() => setConfirmation(true)}>Update Ban Registry and execute bans</Button>
          <p className="text-xs text-muted-foreground">Applies everywhere, even when an account is absent. No message history is deleted. Missing bot permissions block confirmation.</p>
        </>}
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold text-foreground">3. Global ban registry ({total})</h3>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleButton disabled={busy} pressed={filterOpen} onPressedChange={setFilterOpen}
            icon={<Filter className="h-4 w-4" />}>Filter IDs</ToggleButton>
          <Button emphasis="outline" intent="danger" disabled={busy || !selected.size || !!entriesError} onClick={() => setRemoveConfirmation(true)}>Remove and unban selected ({selected.size})</Button>
          <Button emphasis="outline" disabled={busy || refreshing || !entries.length || !!entriesError} onClick={() => {
            const next = new Set([...selected, ...entries.map(entry => entry.discord_user_id)])
            if (next.size > 1000) { setError('Select at most 1000 IDs per removal.'); return }
            setSelected(next)
          }}>Select page</Button>
          {filterIds && <Button emphasis="outline" disabled={busy || !!entriesError} onClick={() => { void selectMatching() }}>Select all matching</Button>}
          <Button emphasis="outline" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
        {filterOpen && <div className="space-y-2">
          <label className="block space-y-1 text-sm text-foreground"><span>Filter Discord IDs</span>
            <textarea value={filterDraft} disabled={busy} onChange={event => setFilterDraft(event.target.value)} rows={3}
              className="w-full rounded border border-border bg-background p-2 font-mono" /></label>
          <div className="flex gap-2">
            <Button emphasis="outline" disabled={busy} onClick={applyFilter}>Apply ID filter</Button>
            <Button emphasis="outline" disabled={busy} onClick={() => { invalidateEntries(); setFilterIds(''); setPage(0); setSelected(new Set()) }}>Clear ID filter</Button>
          </div>
        </div>}
        {filterIds && <p className="text-xs text-muted-foreground">Showing matching IDs only. Select all matching includes every matching page.</p>}
        <p className="text-xs text-muted-foreground">Times booted counts confirmed removals of present members only, not pre-bans or retries. Historical removal totals are not reconstructed.</p>
        {entriesError && <p role="alert" className="text-danger">{entriesError}</p>}
        {loading && <p role="status" className="text-sm text-muted-foreground">Loading global registry...</p>}
        {failures.length > 0 && <div role="alert" className="space-y-1 rounded-lg bg-danger-subtle p-3 text-sm text-danger">
          <p>Ban enforcement failures (up to 20 shown):</p>
          {failures.map(failure => <p key={`${failure.guild_id}:${failure.discord_user_id}`}>{failure.action === 'unban' ? 'Unban' : 'Ban'}: {failure.discord_user_id} / server {failure.guild_id}: {failure.last_error}</p>)}
        </div>}
        {!loading && !entriesError && entries.length === 0 && <p className="text-sm text-muted-foreground">No global registry entries on this page.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">All registered Discord IDs</caption>
            <thead><tr className="text-muted-foreground"><th scope="col" className="p-2">Select</th><th scope="col" className="p-2">Discord ID</th><th scope="col" className="p-2">Date added (UTC)</th><th scope="col" className="p-2">Times booted</th><th scope="col" className="p-2">Last booted</th></tr></thead>
            <tbody>{entries.map(entry => <tr key={entry.discord_user_id} className="border-t border-border text-foreground">
              <td className="p-2"><input type="checkbox" aria-label={`Select ${entry.discord_user_id}`} disabled={busy || refreshing || !!entriesError}
                checked={selected.has(entry.discord_user_id)} onChange={event => {
                  const checked = event.target.checked
                  if (checked && selected.size >= 1000) { setError('Select at most 1000 IDs per removal.'); return }
                  setSelected(previous => { const next = new Set(previous); if (checked) next.add(entry.discord_user_id); else next.delete(entry.discord_user_id); return next })
                }} /></td>
              <td className="p-2 font-mono">{entry.discord_user_id}</td>
              <td className="p-2"><time dateTime={entry.created_at}>{new Date(entry.created_at).toISOString().replace('T', ' ').slice(0, 19)}</time></td>
              <td className="p-2">{entry.boot_count}</td>
              <td className="p-2" title={entry.last_booted_at || undefined}>{formatLastBooted(entry.last_booted_at, now)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {total > 100 && <nav aria-label="Global registry pages" className="flex items-center gap-3 text-sm text-foreground">
          <Button emphasis="outline" size="compact" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</Button>
          Page {page + 1} of {Math.ceil(total / 100)}
          <Button emphasis="outline" size="compact" disabled={(page + 1) * 100 >= total} onClick={() => setPage(value => value + 1)}>Next</Button>
        </nav>}
      </div>
      <ConfirmDialog open={confirmation} title="Confirm global bans"
        message={`Add ${newCount} new IDs and queue bans across all ${preview?.servers || 0} current Demon X servers, plus future servers and member joins. Existing registry IDs are unchanged. Message history will not be deleted.`}
        confirmText="Confirm global bans" affectedCount={newCount} intent="danger"
        onConfirm={() => { void confirm() }} onCancel={() => setConfirmation(false)} />
      <ConfirmDialog open={removeConfirmation} title="Remove IDs and unban everywhere"
        message={`Stop Guardian enforcement and queue Discord unbans across all connected servers for these ${selected.size} IDs: ${[...selected].join(', ')}. Audit history is retained. Unbans can fail if Demon X lacks permission.`}
        confirmText="Remove and unban" affectedCount={selected.size} intent="danger"
        onConfirm={() => { void removeSelected() }} onCancel={() => setRemoveConfirmation(false)} />
    </section>
  )
}
