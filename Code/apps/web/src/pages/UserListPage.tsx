import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../lib/api-client'
import { AdminMfaPrompt } from '../components/AdminMfaPrompt'
import { Button, Dialog, IconButton, ToggleButton } from '../components/ui'
import { isAdminMfaRequiredError } from '../lib/admin-mfa'
import { getPrimaryTimezone, formatDateInTimezone } from '../lib/timezone-data'
import {
  Users,
  Search,
  X,
  Shield,
  Eye,
  Globe,
  UserCircle,
  Mail,
  Wallet,
  VolumeX,
  Volume2,
  Loader2,
  AlertTriangle,
  CheckSquare,
  Square,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

interface UserRecord {
  id: string
  email: string | null
  display_name: string | null
  avatar_url: string | null
  roles: string[] | null
  account_type: string | null
  wallet_address: string | null
  stake_address: string | null
  traveler_name: string | null
  theme_preferences: { aiSettings?: { sentimentToolEnabled?: boolean } } | null
  is_silenced: boolean
  silenced_at: string | null
  silenced_by: string | null
  created_at: string
  last_login_at: string | null
  signup_source: string | null
}

type RoleValue = 'admin' | 'moderator' | 'user' | 'traveler' | 'oversight'
type StatusValue = 'active' | 'silenced'
type AccountValue = 'google' | 'cardano' | 'traveler' | 'linked'
type SourceValue = 'localhost' | 'production' | 'unknown'

export default function UserListPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, session } = useAuth()
  const [users, setUsers] = useState<UserRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adminMfaRequired, setAdminMfaRequired] = useState(false)
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '')
  const [roleFilters, setRoleFilters] = useState<Set<RoleValue>>(new Set())
  const [statusFilters, setStatusFilters] = useState<Set<StatusValue>>(new Set())
  const [accountFilters, setAccountFilters] = useState<Set<AccountValue>>(new Set())
  const [sourceFilters, setSourceFilters] = useState<Set<SourceValue>>(new Set(['production', 'unknown']))

  const toggleFilter = <T,>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) => {
    setter(prev => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const [actionLoading, setActionLoading] = useState(false)
  const [showSilenceConfirm, setShowSilenceConfirm] = useState(false)
  const [silenceAction, setSilenceAction] = useState<'silence' | 'unsilence'>('silence')
  const [moderatorToggling, setModeratorToggling] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 20

  const isAdmin = user?.roles?.includes('admin')

  // Redirect non-admins or if block power isn't active
  useEffect(() => {
    if (!isAdmin) {
      navigate('/settings?tab=profile')
      return
    }
    try {
      const stored = localStorage.getItem('adminPowers')
      if (!stored || !JSON.parse(stored).blockPower) {
        navigate('/settings?tab=profile')
      }
    } catch {
      navigate('/settings?tab=profile')
    }
  }, [isAdmin, navigate])

  const fetchUsers = useCallback(async () => {
    if (!session?.access_token) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiClient.get('/api/admin/users')
      setAdminMfaRequired(false)
      setUsers(res.data.users || [])
    } catch (err) {
      if (isAdminMfaRequiredError(err)) {
        setAdminMfaRequired(true)
        setError(null)
        return
      }
      setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [session?.access_token])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const getUserRoles = (u: UserRecord): string[] => {
    const rolesArr = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : ['user']
    const merged = new Set([...rolesArr])
    // Add oversight if user has sentimentToolEnabled in their AI settings
    if (u.theme_preferences?.aiSettings?.sentimentToolEnabled) {
      merged.add('oversight')
    }
    return Array.from(merged)
  }

  const getDisplayName = (u: UserRecord): string => {
    return u.display_name || u.traveler_name || u.email || u.id.slice(0, 8)
  }

  const hasLinkedWallet = (u: UserRecord): boolean => {
    return u.account_type === 'google' && !!u.wallet_address
  }

  const getAccountTypeLabel = (u: UserRecord): string => {
    if (hasLinkedWallet(u)) return 'Google + Cardano'
    if (u.account_type === 'traveler') return 'Traveler'
    if (u.account_type === 'cardano') return 'Cardano'
    if (u.account_type === 'google') return 'Google'
    return u.account_type || 'Unknown'
  }

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      // Search filter: match against display name, email, ID, traveler name
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const searchable = [
          u.display_name,
          u.email,
          u.id,
          u.traveler_name,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!searchable.includes(q)) return false
      }

      // Role filter (multi-select: user must have at least one of the selected roles)
      if (roleFilters.size > 0) {
        const roles = getUserRoles(u)
        if (!roles.some(r => roleFilters.has(r as RoleValue))) return false
      }

      // Account filter (multi-select: user must match at least one selected account type)
      if (accountFilters.size > 0) {
        const matchesAny = Array.from(accountFilters).some(f => {
          if (f === 'linked') return hasLinkedWallet(u)
          if (f === 'google') return u.account_type === 'google' && !hasLinkedWallet(u)
          return u.account_type === f
        })
        if (!matchesAny) return false
      }

      // Status filter (multi-select)
      if (statusFilters.size > 0) {
        const matchesAny = Array.from(statusFilters).some(f => {
          if (f === 'active') return !u.is_silenced
          if (f === 'silenced') return u.is_silenced
          return false
        })
        if (!matchesAny) return false
      }

      // Source filter (multi-select)
      if (sourceFilters.size > 0) {
        const src = u.signup_source || 'unknown'
        if (!sourceFilters.has(src as SourceValue)) return false
      }

      return true
    })
  }, [users, searchQuery, roleFilters, accountFilters, statusFilters, sourceFilters])

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, roleFilters, accountFilters, statusFilters, sourceFilters])

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE))
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredUsers.slice(start, start + PAGE_SIZE)
  }, [filteredUsers, currentPage])

  const toggleSelect = (userId: string) => {
    setSelectedUsers(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedUsers.size === paginatedUsers.length) {
      setSelectedUsers(new Set())
    } else {
      setSelectedUsers(new Set(paginatedUsers.map(u => u.id)))
    }
  }

  const handleSilenceAction = async () => {
    if (!session?.access_token || selectedUsers.size === 0) return
    setActionLoading(true)
    try {
      const endpoint = silenceAction === 'silence' ? '/api/admin/users/silence' : '/api/admin/users/unsilence'
      await apiClient.post(endpoint, {
        userIds: Array.from(selectedUsers),
      })
      setShowSilenceConfirm(false)
      setSelectedUsers(new Set())
      await fetchUsers()
    } catch (err) {
      alert((err as { response?: { data?: { error?: string } } }).response?.data?.error || `Failed to ${silenceAction} users`)
    } finally {
      setActionLoading(false)
    }
  }

  const selectedContainsAdmin = useMemo(() => {
    return users.some(u => selectedUsers.has(u.id) && getUserRoles(u).includes('admin'))
  }, [users, selectedUsers])

  if (adminMfaRequired) {
    return <AdminMfaPrompt onVerified={() => { setAdminMfaRequired(false); fetchUsers() }} onCancel={() => navigate('/settings?tab=profile')} />
  }

  const selectedContainsSelf = selectedUsers.has(user?.id || '')

  const toggleModeratorRole = async (targetUser: UserRecord) => {
    if (!session?.access_token) return
    setModeratorToggling(targetUser.id)
    try {
      const currentRoles = getUserRoles(targetUser)
      const hasMod = currentRoles.includes('moderator')
      await apiClient.post('/api/admin/users/moderator', {
        userId: targetUser.id,
        enabled: !hasMod,
      })
      await fetchUsers()
    } catch (err) {
      alert((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to update moderator role')
    } finally {
      setModeratorToggling(null)
    }
  }

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return 'Never'
    return formatDateInTimezone(dateStr, getPrimaryTimezone())
  }

  if (!isAdmin) return null

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-6">
        <Users className="h-7 w-7 text-danger" />
        <h1 className="text-2xl font-bold">User List</h1>
        <span className="text-sm text-muted-foreground">({users.length} total)</span>
      </div>

      {/* Search */}
      <div className="relative max-w-md mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, email, or user ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-8 py-2 border border-border rounded-lg bg-background text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/50"
        />
        {searchQuery && (
          <IconButton
            size="micro"
            label="Clear search"
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2"
            icon={<X />}
          />
        )}
      </div>

      {/* Quick Filters */}
      <div className="flex flex-col gap-3 mb-6">
        {/* Role Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-1">Role</span>
          <ToggleButton
            size="compact"
            pressed={roleFilters.size === 0}
            onPressedChange={() => setRoleFilters(new Set())}
          >
            All
          </ToggleButton>
          {([['admin', 'Admin'], ['moderator', 'Moderator'], ['oversight', 'Oversight'], ['user', 'User'], ['traveler', 'Traveler']] as [RoleValue, string][]).map(([value, label]) => (
            <ToggleButton
              key={value}
              size="compact"
              intent={value === 'admin' ? 'danger' : value === 'oversight' ? 'warning' : value === 'traveler' ? 'info' : 'primary'}
              pressed={roleFilters.has(value)}
              onPressedChange={() => toggleFilter(setRoleFilters, value)}
            >
              {value === 'admin' && <Shield className="w-3 h-3" />}
              {value === 'moderator' && <Shield className="w-3 h-3" />}
              {value === 'oversight' && <Eye className="w-3 h-3" />}
              {value === 'user' && <UserCircle className="w-3 h-3" />}
              {value === 'traveler' && <Globe className="w-3 h-3" />}
              {label}
            </ToggleButton>
          ))}
        </div>

        {/* Account Type Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-1">Account</span>
          <ToggleButton
            size="compact"
            pressed={accountFilters.size === 0}
            onPressedChange={() => setAccountFilters(new Set())}
          >
            All
          </ToggleButton>
          {([['google', 'Google'], ['linked', 'Google + Cardano'], ['cardano', 'Cardano'], ['traveler', 'Traveler']] as [AccountValue, string][]).map(([value, label]) => (
            <ToggleButton
              key={value}
              size="compact"
              pressed={accountFilters.has(value)}
              onPressedChange={() => toggleFilter(setAccountFilters, value)}
            >
              {value === 'google' && <Mail className="w-3 h-3" />}
              {value === 'linked' && <><Mail className="w-3 h-3" /><Wallet className="w-3 h-3" /></>}
              {value === 'cardano' && <Wallet className="w-3 h-3" />}
              {value === 'traveler' && <Globe className="w-3 h-3" />}
              {label}
            </ToggleButton>
          ))}
        </div>

        {/* Source Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-1">Source</span>
          <ToggleButton
            size="compact"
            pressed={sourceFilters.size === 0}
            onPressedChange={() => setSourceFilters(new Set())}
          >
            All
          </ToggleButton>
          {([['localhost', 'Localhost'], ['production', 'Production'], ['unknown', 'Unknown']] as [SourceValue, string][]).map(([value, label]) => (
            <ToggleButton
              key={value}
              size="compact"
              intent={value === 'localhost' ? 'warning' : value === 'production' ? 'success' : 'neutral'}
              pressed={sourceFilters.has(value)}
              onPressedChange={() => toggleFilter(setSourceFilters, value)}
            >
              {label}
            </ToggleButton>
          ))}
        </div>

        {/* Status Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider mr-1">Status</span>
          <ToggleButton
            size="compact"
            pressed={statusFilters.size === 0}
            onPressedChange={() => setStatusFilters(new Set())}
          >
            All
          </ToggleButton>
          {([['active', 'Active'], ['silenced', 'Silenced']] as [StatusValue, string][]).map(([value, label]) => (
            <ToggleButton
              key={value}
              size="compact"
              intent={value === 'silenced' ? 'danger' : 'primary'}
              pressed={statusFilters.has(value)}
              onPressedChange={() => toggleFilter(setStatusFilters, value)}
            >
              {value === 'silenced' && <VolumeX className="w-3 h-3" />}
              {label}
            </ToggleButton>
          ))}
        </div>
      </div>

      {/* Selection Actions */}
      {selectedUsers.size > 0 && (
        <div className="flex items-center gap-3 mb-4 p-3 bg-danger-subtle border border-danger-muted rounded-lg">
          <span className="text-sm font-medium text-danger">
            {selectedUsers.size} user{selectedUsers.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2 ml-auto">
            <Button
              intent="danger"
              size="compact"
              onClick={() => {
                setSilenceAction('silence')
                setShowSilenceConfirm(true)
              }}
              disabled={selectedContainsAdmin || selectedContainsSelf}
              title={selectedContainsAdmin ? 'Cannot silence admin accounts' : selectedContainsSelf ? 'Cannot silence yourself' : 'Silence selected users'}
              icon={<VolumeX className="w-3.5 h-3.5" />}
            >
              Silence
            </Button>
            <Button
              emphasis="outline"
              size="compact"
              onClick={() => {
                setSilenceAction('unsilence')
                setShowSilenceConfirm(true)
              }}
              icon={<Volume2 className="w-3.5 h-3.5" />}
            >
              Unsilence
            </Button>
            <Button
              emphasis="ghost"
              size="compact"
              onClick={() => setSelectedUsers(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 mb-4 bg-danger-subtle border border-danger-muted rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading users...</span>
        </div>
      )}

      {/* Results Summary */}
      {!loading && !error && (
        <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
          <Filter className="w-3.5 h-3.5" />
          Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filteredUsers.length)}-{Math.min(currentPage * PAGE_SIZE, filteredUsers.length)} of {filteredUsers.length} users
          {filteredUsers.length !== users.length && ` (${users.length} total)`}
        </div>
      )}

      {/* User Table */}
      {!loading && !error && filteredUsers.length > 0 && (
        <div className="border border-border rounded-lg overflow-clip">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/95 dark:bg-muted/95 backdrop-blur-xs border-b border-border">
                  <th className="px-3 py-3 text-left w-10">
                    <IconButton
                      size="micro"
                      label="Select all users on this page"
                      aria-pressed={selectedUsers.size === paginatedUsers.length && paginatedUsers.length > 0}
                      onClick={toggleSelectAll}
                      icon={selectedUsers.size === paginatedUsers.length && paginatedUsers.length > 0 ? (
                        <CheckSquare />
                      ) : (
                        <Square />
                      )}
                    />
                  </th>
                  <th className="px-3 py-3 text-left font-medium">User</th>
                  <th className="px-3 py-3 text-left font-medium hidden md:table-cell">Account</th>
                  <th className="px-3 py-3 text-left font-medium">Roles</th>
                  <th className="px-3 py-3 text-left font-medium hidden md:table-cell">Source</th>
                  <th className="px-3 py-3 text-left font-medium hidden lg:table-cell">Created</th>
                  <th className="px-3 py-3 text-left font-medium hidden lg:table-cell">Last Login</th>
                  <th className="px-3 py-3 text-left font-medium w-24">Status</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((u) => (
                  <tr
                    key={u.id}
                    className={`border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors ${
                      u.is_silenced ? 'bg-danger-subtle' : ''
                    } ${selectedUsers.has(u.id) ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-3 py-3">
                      <IconButton
                        size="micro"
                        label={`Select ${getDisplayName(u)}`}
                        aria-pressed={selectedUsers.has(u.id)}
                        onClick={() => toggleSelect(u.id)}
                        icon={selectedUsers.has(u.id) ? (
                          <CheckSquare className="text-primary" />
                        ) : (
                          <Square />
                        )}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-primary-foreground text-xs font-medium overflow-hidden shrink-0 bg-primary">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          ) : (
                            getDisplayName(u).charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">{getDisplayName(u)}</p>
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]" title={u.id}>{u.id.slice(0, 8)}...</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        {hasLinkedWallet(u) ? (
                          <><Mail className="w-3 h-3" /><Wallet className="w-3 h-3" /></>
                        ) : (
                          <>
                            {u.account_type === 'google' && <Mail className="w-3 h-3" />}
                            {u.account_type === 'traveler' && <Globe className="w-3 h-3" />}
                            {u.account_type === 'cardano' && <Wallet className="w-3 h-3" />}
                          </>
                        )}
                        {getAccountTypeLabel(u)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1 items-center">
                        {getUserRoles(u).map((r) => (
                          <span key={r} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            r === 'admin'
                              ? 'bg-danger-subtle text-danger'
                              : r === 'moderator'
                              ? 'bg-primary-subtle text-primary'
                              : r === 'oversight'
                              ? 'bg-warning-subtle text-warning'
                              : r === 'traveler'
                              ? 'bg-info-subtle text-info'
                              : 'bg-success-subtle text-success'
                          }`}>
                            {r === 'admin' && <Shield className="w-2.5 h-2.5" />}
                            {r === 'moderator' && <Shield className="w-2.5 h-2.5" />}
                            {r === 'oversight' && <Eye className="w-2.5 h-2.5" />}
                            {r === 'traveler' && <Globe className="w-2.5 h-2.5" />}
                            {r === 'user' && <UserCircle className="w-2.5 h-2.5" />}
                            {r}
                          </span>
                        ))}
                        {/* Moderator toggle button */}
                        {!getUserRoles(u).includes('admin') && (
                          <Button
                            emphasis="outline"
                            intent={getUserRoles(u).includes('moderator') ? 'primary' : 'neutral'}
                            size="micro"
                            onClick={() => toggleModeratorRole(u)}
                            disabled={moderatorToggling === u.id}
                            title={getUserRoles(u).includes('moderator') ? 'Remove moderator role' : 'Grant moderator role'}
                            icon={<Shield className="w-2.5 h-2.5" />}
                          >
                            {moderatorToggling === u.id ? '...' : getUserRoles(u).includes('moderator') ? 'Remove Mod' : '+ Mod'}
                          </Button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 hidden md:table-cell">
                      {u.signup_source === 'localhost' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-subtle text-warning">
                          Localhost
                        </span>
                      ) : u.signup_source === 'production' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success-subtle text-success">
                          Production
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          Unknown
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                      {formatDate(u.created_at)}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                      {formatDate(u.last_login_at)}
                    </td>
                    <td className="px-3 py-3">
                      {u.is_silenced ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-danger-subtle text-danger">
                          <VolumeX className="w-3 h-3" />
                          Silenced
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-subtle text-success">
                          Active
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              emphasis="outline"
              size="compact"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              First
            </Button>
            <IconButton
              emphasis="outline"
              label="Previous page"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              icon={<ChevronLeft />}
            />
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
              .reduce<(number | 'ellipsis')[]>((acc, p, i, arr) => {
                if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('ellipsis')
                acc.push(p)
                return acc
              }, [])
              .map((item, i) =>
                item === 'ellipsis' ? (
                  <span key={`e${i}`} className="px-1.5 text-muted-foreground">...</span>
                ) : (
                  <Button
                    key={item}
                    emphasis={currentPage === item ? 'solid' : 'outline'}
                    intent={currentPage === item ? 'primary' : 'neutral'}
                    size="compact"
                    aria-current={currentPage === item ? 'page' : undefined}
                    onClick={() => setCurrentPage(item as number)}
                  >
                    {item}
                  </Button>
                )
              )}
            <IconButton
              emphasis="outline"
              label="Next page"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              icon={<ChevronRight />}
            />
            <Button
              emphasis="outline"
              size="compact"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              Last
            </Button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredUsers.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No users match your filters.</p>
        </div>
      )}

      {/* Silence Confirmation Modal */}
      {showSilenceConfirm && (
        <Dialog
          open
          onClose={() => { if (!actionLoading) setShowSilenceConfirm(false) }}
          title={
            <span className="flex items-center gap-2">
              <AlertTriangle className={`w-5 h-5 shrink-0 ${silenceAction === 'silence' ? 'text-danger' : 'text-warning'}`} />
              {silenceAction === 'silence' ? 'Silence Users?' : 'Unsilence Users?'}
            </span>
          }
          size="md"
          closeOnScrimClick={false}
        >
            {silenceAction === 'silence' ? (
              <div className="text-sm text-muted-foreground space-y-2 mb-6">
                <p>
                  You are about to silence <strong>{selectedUsers.size}</strong> user{selectedUsers.size !== 1 ? 's' : ''}.
                </p>
                <p>Silenced users will:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Lose access to key platform features</li>
                  <li>Have all public calendars set to unlisted</li>
                  <li>Not be able to create new public content</li>
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-6">
                Restore access for <strong>{selectedUsers.size}</strong> user{selectedUsers.size !== 1 ? 's' : ''}?
                Their account restrictions will be removed.
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <Button
                emphasis="ghost"
                onClick={() => setShowSilenceConfirm(false)}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                intent={silenceAction === 'silence' ? 'danger' : 'primary'}
                onClick={handleSilenceAction}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  silenceAction === 'silence' ? 'Silence' : 'Unsilence'
                )}
              </Button>
            </div>
        </Dialog>
      )}
    </div>
  )
}
