import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NetworkRelationsPage from '../NetworkRelationsPage'
import { apiClient } from '../../lib/api-client'

const { showToast, auth } = vi.hoisted(() => ({ showToast: vi.fn(), auth: { roles: ['user'] } }))
vi.mock('../../lib/api-client', () => {
  const client = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
  return { apiClient: client, dedupedGet: client.get }
})
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner', roles: auth.roles }, isAuthenticated: true }) }))
vi.mock('../../components/Toast', () => ({ useToast: () => ({ showToast }) }))
const sourceKey = `source_${'a'.repeat(64)}`
const managedNetwork = {
  id: 'network-1', name: 'Display network', original_name: 'Original network', color: '#3B82F6', description: null,
  source_key: null, member_keys: [], can_rename: true, can_edit: true,
}
const data = {
  networks: [managedNetwork], mappings: [], rules: [], assignments: [],
  sources: [{ key: 'source_other', name: 'Other source', can_rename: true }],
  targets: [{ target_type: 'meeting', target_id: 'meeting-1', title: 'Owned meeting' }],
}
async function renderPage() {
  await act(async () => { render(<MemoryRouter><NetworkRelationsPage /></MemoryRouter>) })
}
beforeEach(() => {
  vi.clearAllMocks()
  auth.roles = ['user']
  vi.mocked(apiClient.get).mockImplementation(async url => ({ data: url === '/api/user-events/public' ? {
    events: [{ id: 'metta', title: 'MeTTa Coders', calendar_title: 'SingularityNET', start_time: '2026-06-11T12:00:00Z', end_time: '2026-06-11T13:00:00Z' }],
  } : data }))
  vi.mocked(apiClient.post).mockResolvedValue({ data: {} })
  vi.mocked(apiClient.put).mockResolvedValue({ data: {} })
  vi.mocked(apiClient.delete).mockReset().mockResolvedValue({ data: { success: true } })
})

describe('Network Relations owner controls', () => {
  it('expands untouched source panels without writing and preserves non-admin configuration gates', async () => {
    await renderPage()
    const list = screen.getByRole('region', { name: 'Source networks' })
    fireEvent.click(within(list).getByText('Other source'))
    expect(within(list).getByText('Direct Mappings')).toBeInTheDocument()
    expect(within(list).getByText('Auto-Match Rules')).toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: 'Add mapping' })).not.toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: /Delete source network/ })).not.toBeInTheDocument()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it.each(['mapping', 'rule'] as const)('saves a first source %s without renaming or creating a custom row', async kind => {
    auth.roles = ['admin']
    const alias = { ...managedNetwork, id: 'source-alias', name: 'Other source', original_name: 'Other source', source_key: 'source_other' }
    let saved = false
    vi.mocked(apiClient.get).mockResolvedValue({ data: { ...data, networks: [managedNetwork] } })
    vi.mocked(apiClient.post).mockImplementation(async url => {
      if (url === '/api/network-relations/networks') {
        vi.mocked(apiClient.get).mockImplementation(async () => ({ data: {
          ...data, networks: [managedNetwork, alias],
          mappings: saved && kind === 'mapping' ? [{ id: 'new-mapping', network_id: alias.id, source_type: 'meeting_title', source_string: 'Extra meeting' }] : [],
          rules: saved && kind === 'rule' ? [{ id: 'new-rule', network_id: alias.id, pattern: 'Extra meeting', match_type: 'contains', match_field: 'calendar_title', priority: 0, is_active: true }] : [],
        } }))
        return { data: { network: alias } }
      }
      saved = true
      return { data: {} }
    })
    await renderPage()
    const list = screen.getByRole('region', { name: 'Source networks' })
    fireEvent.click(within(list).getByText('Other source'))
    fireEvent.click(within(list).getByRole('button', { name: `Add ${kind}` }))
    fireEvent.change(within(list).getByRole('textbox', { name: kind === 'mapping' ? 'Exact mapping text' : 'Rule pattern' }), { target: { value: 'Extra meeting' } })
    expect(apiClient.post).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(within(list).getByRole('button', { name: kind === 'mapping' ? 'Add' : 'Add Rule' })) })
    expect(apiClient.post).toHaveBeenNthCalledWith(1, '/api/network-relations/networks', { name: 'Other source', source_key: 'source_other' })
    expect(apiClient.post).toHaveBeenNthCalledWith(2, `/api/network-relations/${kind === 'mapping' ? 'mappings' : 'rules'}`, expect.objectContaining({ network_id: 'source-alias' }))
    expect(within(list).getByText('Extra meeting')).toBeInTheDocument()
    expect(within(list).getByText('Other source')).toBeInTheDocument()
    expect(screen.getAllByText('Other source')).toHaveLength(1)
    expect(apiClient.put).not.toHaveBeenCalled()
  })

  it('retains a first mapping draft after a failed save and reuses the saved source identity on retry', async () => {
    auth.roles = ['admin']
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { network: {
      ...managedNetwork, id: 'source-alias', name: 'Other source', original_name: 'Other source', source_key: 'source_other',
    } } }).mockRejectedValueOnce({ isAxiosError: true, response: { data: { message: 'Mapping save failed' } } })
    await renderPage()
    const list = screen.getByRole('region', { name: 'Source networks' })
    fireEvent.click(within(list).getByText('Other source'))
    fireEvent.click(within(list).getByRole('button', { name: 'Add mapping' }))
    fireEvent.change(within(list).getByRole('textbox', { name: 'Exact mapping text' }), { target: { value: 'Retry meeting' } })
    await act(async () => { fireEvent.click(within(list).getByRole('button', { name: 'Add' })) })
    expect(showToast).toHaveBeenCalledWith('Mapping save failed', 'error')
    expect(within(list).getByRole('textbox', { name: 'Exact mapping text' })).toHaveValue('Retry meeting')
    await act(async () => { fireEvent.click(within(list).getByRole('button', { name: 'Add' })) })
    expect(apiClient.post).toHaveBeenCalledTimes(3)
    expect(apiClient.post).toHaveBeenLastCalledWith('/api/network-relations/mappings', {
      network_id: 'source-alias', source_string: 'Retry meeting', source_type: 'meeting_title',
    })
  })

  it('saves a first mapping against a source joined to an existing same-name tag', async () => {
    auth.roles = ['admin']
    const alias = { ...managedNetwork, id: 'source-alias', source_key: 'source_other', merged_into: managedNetwork.id }
    vi.mocked(apiClient.get).mockResolvedValue({ data: { ...data, sources: [
      { key: 'source_other', name: managedNetwork.name, can_rename: true },
    ] } })
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: { network: alias, joined: true } })
    await renderPage()
    const list = screen.getByRole('region', { name: 'Source networks' })
    fireEvent.click(within(list).getByText(managedNetwork.name))
    fireEvent.click(within(list).getByRole('button', { name: 'Add mapping' }))
    fireEvent.change(within(list).getByRole('textbox', { name: 'Exact mapping text' }), { target: { value: 'Extra meeting' } })
    await act(async () => { fireEvent.click(within(list).getByRole('button', { name: 'Add' })) })
    expect(apiClient.post).toHaveBeenNthCalledWith(1, '/api/network-relations/networks', { name: managedNetwork.name, source_key: 'source_other' })
    expect(apiClient.post).toHaveBeenLastCalledWith('/api/network-relations/mappings', {
      network_id: 'source-alias', source_string: 'Extra meeting', source_type: 'meeting_title',
    })
    expect(apiClient.put).not.toHaveBeenCalled()
  })

  it('saves a first source combination without changing the original source name', async () => {
    auth.roles = ['admin']
    vi.mocked(apiClient.post).mockResolvedValue({ data: { network: {
      ...managedNetwork, id: 'source-alias', name: 'Other source', original_name: 'Other source', source_key: 'source_other',
    } } })
    await renderPage()
    const list = screen.getByRole('region', { name: 'Source networks' })
    fireEvent.click(within(list).getByText('Other source'))
    fireEvent.click(within(list).getByRole('button', { name: 'Add network' }))
    fireEvent.click(within(list).getByRole('checkbox', { name: managedNetwork.name }))
    await act(async () => { fireEvent.click(within(list).getByRole('button', { name: 'Save combined networks' })) })
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/api/network-relations/networks', { name: 'Other source', source_key: 'source_other' })
    expect(apiClient.put).toHaveBeenCalledExactlyOnceWith('/api/network-relations/networks/source-alias', {
      name: 'Other source', member_keys: [managedNetwork.id],
    })
  })
  it('warns about joined-network cascade and does not delete when cancelled', async () => {
    auth.roles = ['admin']
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('all networks joined into it, including chained joins')
    expect(dialog).toHaveTextContent('Meetings and provider calendars will not be deleted')
    expect(dialog).toHaveTextContent('removed automatically')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    expect(apiClient.delete).not.toHaveBeenCalled()
  })

  it('deletes the selected tag once and refreshes away joined records after confirmation', async () => {
    auth.roles = ['admin']
    let deleted = false
    const originalGet = vi.mocked(apiClient.get).getMockImplementation()
    if (!originalGet) throw new Error('Missing API fixture')
    vi.mocked(apiClient.get).mockImplementation(async url => {
      if (url !== '/api/network-relations/manage') return originalGet(url)
      return { data: { ...data, networks: deleted ? [] : [managedNetwork, {
        ...managedNetwork, id: 'joined-tag', name: 'Joined source', original_name: 'Joined source',
        source_key: null, merged_into: managedNetwork.id,
      }] } }
    })
    vi.mocked(apiClient.delete).mockImplementation(async () => {
      deleted = true
      return { data: { success: true } }
    })
    await renderPage()
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })) })
    expect(apiClient.delete).toHaveBeenCalledExactlyOnceWith('/api/network-relations/networks/network-1')
    expect(screen.queryByText('Joined source')).not.toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith('Network deleted')
  })

  it('preserves network content and reports a failed cascade instead of success', async () => {
    auth.roles = ['admin']
    vi.mocked(apiClient.delete).mockRejectedValue({ isAxiosError: true, response: { data: { message: 'Apply migration 040' } } })
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })) })
    expect(screen.getByText('Display network')).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith('Apply migration 040', 'error')
    expect(showToast).not.toHaveBeenCalledWith('Network deleted')
  })
  it('reports an existing-name rename as a live join rather than a duplicate-name error', async () => {
    vi.mocked(apiClient.put).mockResolvedValue({ data: { joined: true } })
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Display network' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name for Display network' }), { target: { value: 'Existing network' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(apiClient.put).toHaveBeenCalledWith('/api/network-relations/networks/network-1', { name: 'Existing network' })
    expect(showToast).toHaveBeenCalledWith('Network joined the existing network. Its meetings are included automatically.')
  })

  it('previews the exact selected field, suggests meeting title, and persists a corrected mapping', async () => {
    auth.roles = ['admin']
    let mappingType: 'calendar_title' | 'meeting_title' = 'calendar_title'
    const originalGet = vi.mocked(apiClient.get).getMockImplementation()
    if (!originalGet) throw new Error('Missing API fixture')
    vi.mocked(apiClient.get).mockImplementation(async url => {
      if (url !== '/api/network-relations/manage') return originalGet(url)
      return { data: { ...data, mappings: [{ id: 'mapping-1', network_id: 'network-1', source_string: 'MeTTa Coders', source_type: mappingType }] } }
    })
    vi.mocked(apiClient.put).mockImplementation(async () => {
      mappingType = 'meeting_title'
      return { data: {} }
    })
    await renderPage()
    fireEvent.click(screen.getByText('Display network'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit mapping MeTTa Coders' }))
    expect(screen.getByText('0 matching published events')).toBeInTheDocument()
    expect(screen.getByText(/This text matches meeting title instead/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Mapping field' }), { target: { value: 'meeting_title' } })
    expect(screen.getByText('1 matching published events')).toBeInTheDocument()
    expect(screen.getByText('MeTTa Coders - Calendar: SingularityNET')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save mapping' })) })
    expect(apiClient.put).toHaveBeenCalledWith('/api/network-relations/mappings/mapping-1', { source_string: 'MeTTa Coders', source_type: 'meeting_title' })
    expect(screen.getByText('1 matches')).toBeInTheDocument()
    expect(showToast).toHaveBeenCalledWith('Mapping updated')
  })
  it('edits only the custom network name without metadata or combination changes', async () => {
    await renderPage()
    expect(screen.getByText('Original network')).toHaveClass('text-[11px]')
    expect(screen.getByText('Display network').compareDocumentPosition(screen.getByText('Original network')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit Display network' })) })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name for Display network' }), { target: { value: 'Renamed network' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(apiClient.put).toHaveBeenCalledWith('/api/network-relations/networks/network-1', { name: 'Renamed network' })
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add mapping' })).not.toBeInTheDocument()
  })

  it('lets users create a live union of canonical and source networks', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'New Network' }))
    fireEvent.change(screen.getByPlaceholderText('e.g. Cardano Governance'), { target: { value: 'Combined network' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Display network' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other source' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })) })
    expect(apiClient.post).toHaveBeenCalledWith('/api/network-relations/networks', expect.objectContaining({
      name: 'Combined network', member_keys: ['network-1', 'source_other'],
    }))
  })

  it('creates a source alias while preserving the original name and identity', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByText('Original source: Other source')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), { target: { value: 'New source label' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save name' })) })
    expect(apiClient.post).toHaveBeenCalledWith('/api/network-relations/networks', { name: 'New source label', source_key: 'source_other' })
  })

  it('removes assigned meeting controls and edits combinations independently of the name', async () => {
    await renderPage()
    fireEvent.click(screen.getByText('Display network'))
    expect(screen.queryByText('Assigned meetings')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add network' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other source' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save combined networks' })) })
    expect(apiClient.put).toHaveBeenCalledWith('/api/network-relations/networks/network-1', { name: 'Display network', member_keys: ['source_other'] })
    expect(screen.queryByRole('textbox', { name: 'Name for Display network' })).not.toBeInTheDocument()
  })

  it('keeps renamed source aliases in a collapsible source list and renames them in place', async () => {
    const originalGet = vi.mocked(apiClient.get).getMockImplementation()
    if (!originalGet) throw new Error('Missing API fixture')
    const sourceAlias = { ...managedNetwork, source_key: sourceKey, can_edit: false }
    vi.mocked(apiClient.get).mockImplementation(async url => {
      if (url !== '/api/network-relations/manage') return originalGet(url)
      return { data: { ...data, networks: [sourceAlias], sources: [{ key: sourceKey, name: 'Original network', can_rename: true }] } }
    })
    await renderPage()
    const list = screen.getByRole('region', { name: 'Source networks' })
    expect(within(list).getByText('Display network')).toBeInTheDocument()
    expect(within(list).getByText('Original network')).toHaveClass('text-[11px]')
    expect(screen.queryByRole('button', { name: 'Edit Display network' })).not.toBeInTheDocument()
    fireEvent.click(within(list).getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), { target: { value: 'Updated label' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save name' })) })
    expect(apiClient.put).toHaveBeenCalledWith('/api/network-relations/networks/network-1', { name: 'Updated label' })
    expect(apiClient.post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Source networks' }))
    expect(screen.queryByRole('region', { name: 'Source networks' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Source networks' }))
    expect(screen.getByRole('region', { name: 'Source networks' })).toBeInTheDocument()
  })

  it('keeps existing source mappings and rules accessible even when the source is absent from inventory', async () => {
    auth.roles = ['admin']
    vi.mocked(apiClient.get).mockResolvedValue({ data: {
      ...data, sources: [], networks: [{ ...managedNetwork, source_key: sourceKey }],
      mappings: [{ id: 'source-mapping', network_id: 'network-1', source_type: 'meeting_title', source_string: 'Source meeting' }],
      rules: [{ id: 'source-rule', network_id: 'network-1', pattern: 'Source pattern', match_type: 'contains', match_field: 'meeting_title', priority: 0, is_active: true }],
    } })
    await renderPage()
    const list = screen.getByRole('region', { name: 'Source networks' })
    fireEvent.click(within(list).getByText('Display network'))
    expect(within(list).getByText('Source meeting')).toBeInTheDocument()
    expect(within(list).getByText('Source pattern')).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Edit mapping Source meeting' })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: 'Add rule' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Display network' })).not.toBeInTheDocument()
  })
})
