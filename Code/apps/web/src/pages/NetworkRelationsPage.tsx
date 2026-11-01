import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Edit2, Save, X, Loader2, Network, Sparkles, Palette } from 'lucide-react'
import { apiClient, dedupedGet } from '../lib/api-client'
import { useToast } from '../components/Toast'
import { Button, IconButton, ToggleButton, Disclosure } from '../components/ui'
import { Dialog } from '@/components/ui/Dialog'
import { useAuth } from '@/contexts/AuthContext'
import { networkFilterKey, resolveNetworkFilterKey, getNetworkOriginalNames, type EventNetwork, type EventNetworkCatalog } from '@/lib/event-network-relations'
import type { PublicEvent } from '@/lib/recurrence'
import { isAxiosError } from 'axios'
import ConfirmDialog from '@/components/ConfirmDialog'

// ─── Types ──────────────────────────────────────────────────

interface NetworkDef extends EventNetwork {
  can_edit: boolean
  can_rename: boolean
}

interface NetworkSource {
  key: string
  name: string
  can_rename: boolean
}

interface NetworkTarget {
  target_type: 'user_event' | 'meeting'
  target_id: string
  title: string
}

interface NetworkManagementData extends EventNetworkCatalog {
  networks: NetworkDef[]
  sources: NetworkSource[]
  targets: NetworkTarget[]
}

function networkErrorMessage(error: unknown, fallback: string): string {
  if (!isAxiosError<{ message?: string; error?: string }>(error)) return error instanceof Error ? error.message : fallback
  return error.response?.data?.message || error.response?.data?.error || fallback
}

function MemberPicker({ options, selected, onChange, disabled }: {
  options: Array<{ key: string; name: string }>
  selected: string[]
  onChange: (keys: string[]) => void
  disabled?: boolean
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-muted-foreground mb-1">Combine networks (live union, optional)</legend>
      <p className="text-xs text-muted-foreground">Includes current and future meetings from any selected network. Original networks remain available.</p>
      <div className="grid gap-2 sm:grid-cols-2 max-h-48 overflow-auto">
        {options.map(option => (
          <label key={option.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={disabled} checked={selected.includes(option.key)} onChange={event =>
              onChange(event.target.checked ? [...selected, option.key] : selected.filter(key => key !== option.key))} />
            {option.name}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

interface NetworkMapping {
  id: string
  network_id: string
  source_string: string
  source_type: 'calendar_title' | 'meeting_title' | 'description'
}

interface NetworkRule {
  id: string
  network_id: string
  pattern: string
  match_type: 'contains' | 'starts_with' | 'exact' | 'regex'
  match_field: 'calendar_title' | 'meeting_title' | 'description'
  priority: number
  is_active: boolean
}

const COLOR_PRESETS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#14B8A6',
  '#6366F1', '#D946EF', '#0EA5E9', '#22C55E', '#A855F7',
]

// ─── Component ──────────────────────────────────────────────

export default function NetworkRelationsPage() {
  const { user } = useAuth()
  const isAdmin = Boolean(user?.roles?.includes('admin'))
  const { showToast } = useToast()
  const [networks, setNetworks] = useState<NetworkDef[]>([])
  const [mappings, setMappings] = useState<NetworkMapping[]>([])
  const [rules, setRules] = useState<NetworkRule[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sources, setSources] = useState<NetworkSource[]>([])
  const [newMembers, setNewMembers] = useState<string[]>([])
  const [editMembers, setEditMembers] = useState<string[]>([])
  const [renameSource, setRenameSource] = useState<NetworkSource | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [combiningId, setCombiningId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteRequest, setDeleteRequest] = useState<NetworkDef | null>(null)
  const [previewEvents, setPreviewEvents] = useState<PublicEvent[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null)
  const activeNetworks = networks.filter(network => !network.merged_into)
  const customNetworks = networks.filter(network => !network.source_key)
  const sourceRows = [
    ...sources,
    ...networks.flatMap(network => network.source_key && !sources.some(source => source.key === network.source_key)
      ? [{ key: network.source_key, name: network.original_name || network.name, can_rename: network.can_rename }] : []),
  ]
  const memberOptions = [
    ...activeNetworks.map(network => ({ key: networkFilterKey(network), name: network.name })),
    ...sources.filter(source => !networks.some(network => network.source_key === source.key))
      .map(source => ({ key: source.key, name: source.name })),
  ]

  // New network form
  const [showNewNetwork, setShowNewNetwork] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3B82F6')
  const [newDesc, setNewDesc] = useState('')

  // Edit network
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  // New mapping form
  const [showNewMapping, setShowNewMapping] = useState<string | null>(null) // network_id
  const [newMappingString, setNewMappingString] = useState('')
  const [newMappingType, setNewMappingType] = useState<'calendar_title' | 'meeting_title' | 'description'>('meeting_title')
  const previewMatches = (field: NetworkMapping['source_type'], text: string) => previewEvents
    .filter(event => (field === 'meeting_title' ? event.title : event[field]) === text.trim())

  // New rule form
  const [showNewRule, setShowNewRule] = useState<string | null>(null) // network_id
  const [newRulePattern, setNewRulePattern] = useState('')
  const [newRuleMatchType, setNewRuleMatchType] = useState<'contains' | 'starts_with' | 'exact' | 'regex'>('contains')
  const [newRuleMatchField, setNewRuleMatchField] = useState<'calendar_title' | 'meeting_title' | 'description'>('calendar_title')
  const [newRulePriority, setNewRulePriority] = useState(0)

  // Expanded network sections
  const [expandedNetworks, setExpandedNetworks] = useState<Set<string>>(new Set())

  const fetchAll = useCallback(async () => {
    try {
      const { data } = await dedupedGet<NetworkManagementData>('/api/network-relations/manage')
      setNetworks(data.networks)
      setMappings(data.mappings)
      setRules(data.rules)
      setSources(data.sources)
      setLoadError(null)
    } catch (err) {
      console.error('Failed to fetch network data:', err)
      showToast('Failed to load network data', 'error')
      setLoadError('Failed to load network data. Try again.')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => {
    const loadPreview = async () => {
      try {
        const { data } = await dedupedGet<{ events: PublicEvent[] }>('/api/user-events/public')
        if (!Array.isArray(data.events)) throw new Error('Invalid published-event preview response')
        setPreviewEvents(data.events)
        setPreviewError(null)
      } catch (error) {
        console.error('Failed to load mapping preview:', error)
        setPreviewError('Matching-event preview could not be loaded.')
      }
    }
    void loadPreview()
  }, [])

  const toggleExpand = (id: string) => {
    setExpandedNetworks(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ─── Network CRUD ──────────────────────────────────────

  const createNetwork = async () => {
    if (!newName.trim()) return showToast('Name is required', 'error')
    setSaving(true)
    try {
      await apiClient.post('/api/network-relations/networks', {
        name: newName.trim(),
        color: newColor,
        description: newDesc.trim() || null,
        member_keys: newMembers,
      })
      showToast('Network created')
      setShowNewNetwork(false)
      setNewName('')
      setNewColor('#3B82F6')
      setNewDesc('')
      setNewMembers([])
      await fetchAll()
    } catch (err: unknown) {
      showToast(networkErrorMessage(err, 'Failed to create network'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (net: NetworkDef) => {
    setEditingId(net.id)
    setEditName(net.name)
  }

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return showToast('Name is required', 'error')
    const network = networks.find(net => net.id === editingId)
    if (!network) return showToast('Network no longer exists', 'error')
    setSaving(true)
    try {
      const { data } = await apiClient.put<{ joined?: boolean }>(`/api/network-relations/networks/${editingId}`, {
        name: editName.trim(),
      })
      showToast(data.joined ? 'Network joined the existing network. Its meetings are included automatically.' : 'Network updated')
      setEditingId(null)
      await fetchAll()
    } catch (err: unknown) {
      showToast(networkErrorMessage(err, 'Failed to update network'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveSourceRename = async () => {
    if (!renameSource || !sourceName.trim()) return showToast('Name is required', 'error')
    setSaving(true)
    try {
      const existing = networks.find(network => network.source_key === renameSource.key)
      const { data } = existing
        ? await apiClient.put<{ joined?: boolean }>(`/api/network-relations/networks/${existing.id}`, { name: sourceName.trim() })
        : await apiClient.post<{ joined?: boolean }>('/api/network-relations/networks', { name: sourceName.trim(), source_key: renameSource.key })
      setRenameSource(null)
      showToast(data.joined ? 'Source joined the existing network. The original name is preserved.' : 'Network renamed. The original source name is preserved.')
      await fetchAll()
    } catch (error) {
      showToast(networkErrorMessage(error, 'Failed to rename source network'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const saveCombination = async () => {
    if (!combiningId) return showToast('Network no longer exists', 'error')
    setSaving(true)
    try {
      const network = await ensureSourceNetwork(combiningId)
      const destinationKey = network.merged_into ? resolveNetworkFilterKey(network.merged_into, networks) : null
      const destination = destinationKey ? networks.find(candidate =>
        networkFilterKey(candidate) === destinationKey) : network
      if (!destination) throw new Error('Combined-network destination is unavailable. Reload and try again.')
      const members = network.merged_into
        ? [...new Set([...(destination.member_keys || []), ...editMembers])] : editMembers
      await apiClient.put(`/api/network-relations/networks/${destination.id}`, { name: destination.name, member_keys: members })
      setCombiningId(null)
      showToast('Combined networks updated')
      await fetchAll()
    } catch (error) {
      showToast(networkErrorMessage(error, 'Failed to update combined networks'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const ensureSourceNetwork = async (id: string): Promise<EventNetwork> => {
    const existing = networks.find(network => network.id === id)
    if (existing) return existing
    const source = sourceRows.find(row => row.key === id)
    if (!source) throw new Error('Source network is unavailable. Reload and try again.')
    const { data } = await apiClient.post<{ network: EventNetwork }>('/api/network-relations/networks', {
      name: source.name, source_key: source.key,
    })
    if (!data.network?.id) throw new Error('Source configuration could not be loaded. Reload and try again.')
    const network: NetworkDef = { ...data.network, can_edit: isAdmin, can_rename: source.can_rename }
    setNetworks(previous => [...previous.filter(row => row.source_key !== source.key), network])
    setShowNewMapping(previous => previous === id ? network.id : previous)
    setShowNewRule(previous => previous === id ? network.id : previous)
    setCombiningId(previous => previous === id ? network.id : previous)
    return network
  }

  const deleteNetwork = async (id: string) => {
    setSaving(true)
    try {
      await apiClient.delete(`/api/network-relations/networks/${id}`)
      showToast('Network deleted')
      await fetchAll()
    } catch (error) {
      showToast(networkErrorMessage(error, 'Failed to delete network'), 'error')
    } finally {
      setSaving(false)
    }
  }

  // ─── Mapping CRUD ──────────────────────────────────────

  const createMapping = async (networkId: string) => {
    if (!newMappingString.trim()) return showToast('Source string is required', 'error')
    setSaving(true)
    try {
      const values = {
        source_string: newMappingString.trim(),
        source_type: newMappingType,
      }
      if (editingMappingId) {
        await apiClient.put(`/api/network-relations/mappings/${editingMappingId}`, values)
      } else {
        const network = await ensureSourceNetwork(networkId)
        await apiClient.post('/api/network-relations/mappings', {
          network_id: network.id,
          ...values,
        })
      }
      showToast(editingMappingId ? 'Mapping updated' : 'Mapping added')
      setShowNewMapping(null)
      setEditingMappingId(null)
      setNewMappingString('')
      await fetchAll()
    } catch (err: unknown) {
      showToast(networkErrorMessage(err, 'Failed to save mapping'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const deleteMapping = async (id: string) => {
    try {
      await apiClient.delete(`/api/network-relations/mappings/${id}`)
      showToast('Mapping deleted')
      fetchAll()
    } catch {
      showToast('Failed to delete mapping', 'error')
    }
  }

  // ─── Rule CRUD ─────────────────────────────────────────

  const createRule = async (networkId: string) => {
    if (!newRulePattern.trim()) return showToast('Pattern is required', 'error')
    setSaving(true)
    try {
      const network = await ensureSourceNetwork(networkId)
      await apiClient.post('/api/network-relations/rules', {
        network_id: network.id,
        pattern: newRulePattern.trim(),
        match_type: newRuleMatchType,
        match_field: newRuleMatchField,
        priority: newRulePriority,
      })
      showToast('Rule added')
      setShowNewRule(null)
      setNewRulePattern('')
      setNewRulePriority(0)
      await fetchAll()
    } catch (err: unknown) {
      showToast(networkErrorMessage(err, 'Failed to create rule'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const deleteRule = async (id: string) => {
    try {
      await apiClient.delete(`/api/network-relations/rules/${id}`)
      showToast('Rule deleted')
      fetchAll()
    } catch {
      showToast('Failed to delete rule', 'error')
    }
  }

  const toggleRuleActive = async (rule: NetworkRule) => {
    try {
      await apiClient.put(`/api/network-relations/rules/${rule.id}`, {
        is_active: !rule.is_active,
      })
      fetchAll()
    } catch {
      showToast('Failed to toggle rule', 'error')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/events-calendar" className="p-1.5 rounded-md hover:bg-accent/50 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
              <Network className="w-5 h-5 text-info" />
              Network Relations
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Rename and combine networks, or tag meetings with mappings and rules for Events Calendar filters only. Upstream sources are unchanged.
            </p>
            <p className="text-xs text-muted-foreground mt-1">Renaming to an existing name joins that network as a live relationship.</p>
          </div>
        </div>
        <Button
          disabled={saving}
          onClick={() => setShowNewNetwork(true)}
          icon={<Plus className="w-4 h-4" />}
        >
          New Network
        </Button>
      </div>

      {loadError && (
        <div role="alert" className="mb-4 flex items-center gap-2 text-sm text-danger">
          {loadError}<Button emphasis="outline" size="compact" onClick={fetchAll}>Try again</Button>
        </div>
      )}
      {sourceRows.length > 0 && (
        <section className="mb-6 p-4 border border-border rounded-lg bg-card">
          <Disclosure title="Source networks" defaultExpanded headingLevel={2}>
          <p className="text-xs text-muted-foreground mb-3">Renaming changes only the filter label. The source name remains visible in details.</p>
          <div className="space-y-2">
            {sourceRows.map(source => {
              const alias = networks.find(network => network.source_key === source.key)
              return <div key={source.key}>{renderNetworks([alias || {
                id: source.key, name: source.name, original_name: source.name,
                source_key: source.key, color: '#3B82F6', description: null,
                member_keys: [], can_rename: source.can_rename, can_edit: isAdmin,
              }])}</div>
            })}
          </div>
          </Disclosure>
        </section>
      )}
      <Dialog open={Boolean(renameSource)} onClose={() => { if (!saving) setRenameSource(null) }} title="Rename source network" size="sm" showCloseButton>
        <p className="text-xs text-muted-foreground mb-3">Original source: {renameSource?.name}</p>
        <label className="block text-sm mb-2">
          Display name
          <input disabled={saving} value={sourceName} onChange={event => setSourceName(event.target.value)} className="w-full px-3 py-2 border border-border rounded-md bg-background" />
        </label>
        <Button intent="primary" disabled={saving} onClick={saveSourceRename}>Save name</Button>
      </Dialog>
      {deleteRequest && (
        <ConfirmDialog
          open
          title="Delete network"
          message={`Delete "${deleteRequest.name}" and all networks joined into it, including chained joins? Their mappings, rules, meeting assignments and combined-network references will be removed automatically. Meetings and provider calendars will not be deleted. Source calendars may still appear as automatic tags.`}
          onCancel={() => setDeleteRequest(null)}
          onConfirm={() => {
            const id = deleteRequest.id
            setDeleteRequest(null)
            void deleteNetwork(id)
          }}
        />
      )}

      {/* New Network Form */}
      {showNewNetwork && (
        <div className="mb-6 p-4 border border-border rounded-lg bg-card">
          <h3 className="text-sm font-semibold mb-3">Create Network</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
              <input
                disabled={saving}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Cardano Governance"
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Color</label>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c}
                    disabled={saving}
                    onClick={() => setNewColor(c)}
                    className="w-7 h-7 rounded-full border-2 transition-all"
                    style={{
                      backgroundColor: c,
                      borderColor: newColor === c ? 'var(--foreground)' : 'transparent',
                      transform: newColor === c ? 'scale(1.15)' : 'scale(1)',
                    }}
                  />
                ))}
                <input
                  type="color"
                  disabled={saving}
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-7 h-7 rounded cursor-pointer border-0 p-0"
                  title="Custom color"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Description (optional)</label>
              <input
                value={newDesc}
                disabled={saving}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Optional description"
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background"
              />
            </div>
            <div className="flex gap-2">
              <Button intent="primary" disabled={saving} onClick={createNetwork}>
                Create
              </Button>
              <Button disabled={saving} emphasis="ghost" onClick={() => setShowNewNetwork(false)}>
                Cancel
              </Button>
            </div>
            <MemberPicker disabled={saving} options={memberOptions} selected={newMembers} onChange={setNewMembers} />
          </div>
        </div>
      )}

      {/* Networks List */}
      {customNetworks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Network className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No networks defined yet</p>
          <p className="text-xs mt-1">Create a network to start grouping calendars and meetings.</p>
        </div>
      ) : (
        renderNetworks(customNetworks)
      )}
    </div>
  )

  function renderNetworks(rows: NetworkDef[]) {
    return (
        <div className="space-y-3">
          {rows.map(net => {
            const panelKey = networkFilterKey(net)
            const isExpanded = expandedNetworks.has(panelKey)
            const isStored = networks.some(network => network.id === net.id)
            const netMappings = mappings.filter(m => m.network_id === net.id)
            const netRules = rules.filter(r => r.network_id === net.id)
            const isEditing = editingId === net.id
            const destinationKey = resolveNetworkFilterKey(networkFilterKey(net), networks)
            const destination = networks.find(candidate => networkFilterKey(candidate) === destinationKey)
            const displayName = destination?.name || net.name
            const originals = net.merged_into ? [net.original_name || net.name] : getNetworkOriginalNames(net, networks)

            return (
              <div key={net.id} className="border border-border rounded-lg bg-card overflow-hidden">
                {/* Network header */}
                <div
                  className="flex flex-wrap items-center justify-between gap-2 p-3 cursor-pointer hover:bg-accent/30 transition-colors"
                  onClick={() => toggleExpand(panelKey)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: net.color }} />
                    {isEditing ? (
                      <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          aria-label={`Name for ${net.name}`}
                          disabled={saving}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="px-2 py-1 text-sm border border-border rounded bg-background w-40"
                          autoFocus
                        />
                        <IconButton intent="primary" disabled={saving} label="Save" onClick={saveEdit} icon={<Save />} />
                        <IconButton disabled={saving} label="Cancel edit" onClick={() => setEditingId(null)} icon={<X />} />
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-sm">{displayName}</span>
                          {originals.length > 0 && <>
                            <ArrowLeft className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                            <span className="text-[11px] text-muted-foreground">{originals.join(', ')}</span>
                          </>}
                        </span>
                        {net.description && (
                          <span className="text-xs text-muted-foreground ml-2">{net.description}</span>
                        )}
                        {net.merged_into && <p className="text-xs text-muted-foreground">Joined network - retained for source details and old links.</p>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-muted-foreground">
                      {netMappings.length} mapping{netMappings.length !== 1 ? 's' : ''} &middot; {netRules.length} rule{netRules.length !== 1 ? 's' : ''}
                    </span>
                    {net.can_rename && !net.merged_into && (net.source_key ? (
                      <Button disabled={saving} emphasis="outline" size="compact" onClick={() => {
                        const source = sourceRows.find(row => row.key === net.source_key)
                        if (!source) {
                          showToast('Source network is unavailable. Reload and try again.', 'error')
                          return
                        }
                        setRenameSource(source)
                        setSourceName(displayName)
                      }}>Rename</Button>
                    ) : <IconButton disabled={saving} size="micro" label={`Edit ${net.name}`} onClick={() => { startEdit(net); setExpandedNetworks(previous => new Set(previous).add(net.id)) }} icon={<Edit2 />} />)}
                    {isAdmin && isStored && <IconButton disabled={saving} size="micro" intent="danger" label={net.source_key ? `Delete source network ${displayName}` : 'Delete'} onClick={() => setDeleteRequest(net)} icon={<Trash2 />} />}
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-border p-3 space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-muted-foreground">Combined networks</h4>
                        {net.can_edit && !net.merged_into && <Button disabled={saving} emphasis="ghost" intent="primary" size="micro" icon={<Plus />} onClick={() => {
                          setCombiningId(net.id); setEditMembers(net.member_keys || [])
                        }}>Add network</Button>}
                      </div>
                      {combiningId === net.id ? (
                        <div className="space-y-2">
                        <MemberPicker disabled={saving} options={[
                          ...memberOptions.filter(option => option.key !== networkFilterKey(net)),
                          ...(net.member_keys || []).filter(key => !memberOptions.some(option => option.key === key))
                            .map(key => ({ key, name: 'Unavailable source' })),
                        ]} selected={editMembers} onChange={setEditMembers} />
                        <div className="flex gap-2">
                          <Button disabled={saving} emphasis="outline" onClick={saveCombination}>Save combined networks</Button>
                          <Button disabled={saving} emphasis="ghost" onClick={() => setCombiningId(null)}>Cancel combination</Button>
                        </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {net.member_keys?.length ? net.member_keys.map(key => memberOptions.find(option => option.key === key)?.name || 'Unavailable source').join(', ') : 'No combined networks.'}
                        </p>
                      )}
                    </div>
                    {/* Mappings section */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                          <Palette className="w-3.5 h-3.5" />
                          Direct Mappings
                        </h4>
                        {isAdmin && <Button
                          emphasis="ghost"
                          intent="primary"
                          size="micro"
                          onClick={() => { setShowNewMapping(net.id); setEditingMappingId(null); setNewMappingString(''); setNewMappingType('meeting_title') }}
                          icon={<Plus className="w-3 h-3" />}
                        >
                          Add mapping
                        </Button>}
                      </div>

                      {netMappings.length === 0 && !showNewMapping ? (
                        <p className="text-xs text-muted-foreground italic">No direct mappings yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {netMappings.map(m => (
                            <div key={m.id} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-accent/20">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted">{m.source_type.replace('_', ' ')}</span>
                                <span className="truncate font-mono">{m.source_string}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                {!previewError && <span className="text-muted-foreground">{previewMatches(m.source_type, m.source_string).length} matches</span>}
                                {isAdmin && <IconButton size="micro" label={`Edit mapping ${m.source_string}`} icon={<Edit2 />} onClick={() => {
                                  setShowNewMapping(net.id); setEditingMappingId(m.id); setNewMappingString(m.source_string); setNewMappingType(m.source_type)
                                }} />}
                                {isAdmin && <IconButton size="micro" intent="danger" label="Delete mapping" onClick={() => deleteMapping(m.id)} icon={<Trash2 />} />}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {showNewMapping === net.id && (
                        <div className="mt-2 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label="Mapping field"
                            disabled={saving}
                            value={newMappingType}
                            onChange={(e) => setNewMappingType(e.target.value as typeof newMappingType)}
                            className="px-2 py-1.5 text-xs border border-border rounded bg-background"
                          >
                            <option value="calendar_title">Calendar title</option>
                            <option value="meeting_title">Meeting title</option>
                            <option value="description">Description</option>
                          </select>
                          <input
                            aria-label="Exact mapping text"
                            disabled={saving}
                            value={newMappingString}
                            onChange={(e) => setNewMappingString(e.target.value)}
                            placeholder="Exact source string..."
                            className="flex-1 px-2 py-1.5 text-xs border border-border rounded bg-background"
                            autoFocus
                          />
                          <Button disabled={saving} emphasis="outline" intent="primary" size="compact" onClick={() => createMapping(net.id)}>
                            {editingMappingId ? 'Save mapping' : 'Add'}
                          </Button>
                          <IconButton disabled={saving} label="Cancel" onClick={() => { setShowNewMapping(null); setEditingMappingId(null) }} icon={<X />} />
                          </div>
                          {previewError ? <p role="alert" className="text-xs text-danger">{previewError}</p> : (
                            <div className="text-xs text-muted-foreground" aria-live="polite">
                              <p>{previewMatches(newMappingType, newMappingString).length} matching published events</p>
                              {previewMatches(newMappingType, newMappingString).slice(0, 3).map(event =>
                                <p key={event.id}>{event.title} - Calendar: {event.calendar_title || 'No calendar title'}</p>)}
                              {newMappingString.trim() && !previewMatches(newMappingType, newMappingString).length
                                && (['meeting_title', 'calendar_title', 'description'] as const).filter(field => field !== newMappingType && previewMatches(field, newMappingString).length > 0).map(field =>
                                  <p key={field}>This text matches {field.replace('_', ' ')} instead. Select that field to match those events.</p>)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Rules section */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5" />
                          Auto-Match Rules
                        </h4>
                        {isAdmin && <Button
                          emphasis="ghost"
                          intent="primary"
                          size="micro"
                          onClick={() => { setShowNewRule(net.id); setNewRulePattern(''); setNewRuleMatchType('contains'); setNewRuleMatchField('calendar_title'); setNewRulePriority(0) }}
                          icon={<Plus className="w-3 h-3" />}
                        >
                          Add rule
                        </Button>}
                      </div>

                      {netRules.length === 0 && !showNewRule ? (
                        <p className="text-xs text-muted-foreground italic">No auto-match rules yet.</p>
                      ) : (
                        <div className="space-y-1">
                          {netRules.map(r => (
                            <div key={r.id} className={`flex flex-wrap items-center justify-between gap-2 text-xs py-1 px-2 rounded ${r.is_active ? 'bg-accent/20' : 'bg-muted/30 opacity-60'}`}>
                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted">{r.match_type}</span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted">{r.match_field.replace('_', ' ')}</span>
                                <span className="break-all font-mono">{r.pattern}</span>
                                <span className="text-muted-foreground">p:{r.priority}</span>
                              </div>
                              {isAdmin && <div className="flex items-center gap-1 shrink-0">
                                <ToggleButton
                                  size="micro"
                                  intent="success"
                                  pressed={Boolean(r.is_active)}
                                  onPressedChange={() => toggleRuleActive(r)}
                                >
                                  {r.is_active ? 'Active' : 'Inactive'}
                                </ToggleButton>
                                <IconButton size="micro" intent="danger" label="Delete rule" onClick={() => deleteRule(r.id)} icon={<Trash2 />} />
                              </div>}
                            </div>
                          ))}
                        </div>
                      )}

                      {showNewRule === net.id && (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <select
                              aria-label="Rule match type"
                              disabled={saving}
                              value={newRuleMatchType}
                              onChange={(e) => setNewRuleMatchType(e.target.value as typeof newRuleMatchType)}
                              className="px-2 py-1.5 text-xs border border-border rounded bg-background"
                            >
                              <option value="contains">Contains</option>
                              <option value="starts_with">Starts with</option>
                              <option value="exact">Exact match</option>
                              <option value="regex">Regex</option>
                            </select>
                            <select
                              aria-label="Rule field"
                              disabled={saving}
                              value={newRuleMatchField}
                              onChange={(e) => setNewRuleMatchField(e.target.value as typeof newRuleMatchField)}
                              className="px-2 py-1.5 text-xs border border-border rounded bg-background"
                            >
                              <option value="calendar_title">Calendar title</option>
                              <option value="meeting_title">Meeting title</option>
                              <option value="description">Description</option>
                            </select>
                            <input
                              aria-label="Rule pattern"
                              disabled={saving}
                              value={newRulePattern}
                              onChange={(e) => setNewRulePattern(e.target.value)}
                              placeholder="Pattern..."
                              className="flex-1 min-w-[120px] px-2 py-1.5 text-xs border border-border rounded bg-background"
                              autoFocus
                            />
                            <input
                              disabled={saving}
                              type="number"
                              value={newRulePriority}
                              onChange={(e) => setNewRulePriority(parseInt(e.target.value) || 0)}
                              className="w-16 px-2 py-1.5 text-xs border border-border rounded bg-background"
                              placeholder="Priority"
                              title="Priority (higher = checked first)"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button disabled={saving} emphasis="outline" intent="primary" size="compact" onClick={() => createRule(net.id)}>
                              Add Rule
                            </Button>
                            <Button disabled={saving} emphasis="ghost" size="compact" onClick={() => setShowNewRule(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
    )
  }
}
