import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../lib/api-client'
import { getPrimaryTimezone, formatDateInTimezone } from '../lib/timezone-data'
import ConfirmDialog from '../components/ConfirmDialog'
import { Button, IconButton } from '../components/ui'
import {
  Users,
  Link2,
  Copy,
  Check,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  Search,
  Plus,
  Settings,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────

interface ConnectionInvite {
  id: string
  invite_code: string
  used_by_user_id: string | null
  used_by_display_name: string | null
  status: 'pending' | 'connected' | 'declined' | 'ignored'
  expires_at: string | null
  created_at: string
}

interface UserConnection {
  id: string
  user_id: string
  display_name: string
  email: string | null
  avatar_url: string | null
  status: 'connected' | 'disconnected'
  connected_via: 'invite' | 'calendar' | 'manual'
  created_at: string
}

// ─── Component ────────────────────────────────────────────────────────

export default function UserManagementPage() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  // Mark friend requests as seen when visiting this page
  useEffect(() => {
    localStorage.setItem('lastFriendSeenAt', new Date().toISOString())
  }, [])

  // Invites
  const [invites, setInvites] = useState<ConnectionInvite[]>([])
  const [loadingInvites, setLoadingInvites] = useState(true)
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [newInviteCode, setNewInviteCode] = useState<string | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)

  // Connections
  const [connections, setConnections] = useState<UserConnection[]>([])
  const [loadingConnections, setLoadingConnections] = useState(true)

  const [showEmails, setShowEmails] = useState(false)

  // Privacy settings (for invite gating)
  const [privacyContactsEnabled, setPrivacyContactsEnabled] = useState(false)
  const [contactsShowEmail, setContactsShowEmail] = useState(false)
  const [contactsShowPrefs, setContactsShowPrefs] = useState(false)
  const [contactsAllowConnections, setContactsAllowConnections] = useState(false)
  const [privacyLoaded, setPrivacyLoaded] = useState(false)

  // Sections
  const [activeSection, setActiveSection] = useState<'friends' | 'requests'>('friends')
  const [searchQuery, setSearchQuery] = useState('')

  // Remove friend confirmation
  const [removeFriend, setRemoveFriend] = useState<UserConnection | null>(null)

  // ─── Data Loading ──────────────────────────────────────────

  const fetchInvites = useCallback(async () => {
    setLoadingInvites(true)
    try {
      const res = await apiClient.get('/api/connections/invites')
      setInvites(res.data.invites || [])
    } catch (err) {
      console.error('Failed to load invites:', err)
    } finally {
      setLoadingInvites(false)
    }
  }, [])

  const fetchConnections = useCallback(async () => {
    setLoadingConnections(true)
    try {
      const res = await apiClient.get('/api/connections')
      setConnections(res.data.connections || [])
    } catch (err) {
      console.error('Failed to load connections:', err)
    } finally {
      setLoadingConnections(false)
    }
  }, [])

  const fetchPrivacySettings = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/privacy-settings')
      const s = res.data.settings
      if (s) {
        setPrivacyContactsEnabled(!!s.contacts_enabled)
        setContactsShowEmail(!!s.contacts_show_email)
        setContactsShowPrefs(!!s.contacts_show_preferences)
        setContactsAllowConnections(!!s.contacts_allow_connection_requests)
      }
    } catch (err) {
      console.error('Failed to load privacy settings:', err)
    } finally {
      setPrivacyLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      fetchInvites()
      fetchConnections()
      fetchPrivacySettings()
    }
  }, [isAuthenticated, fetchInvites, fetchConnections, fetchPrivacySettings])

  // ─── Actions ──────────────────────────────────────────────

  const generateInvite = async () => {
    setGeneratingInvite(true)
    setNewInviteCode(null)
    try {
      const res = await apiClient.post('/api/connections/invites')
      const invite = res.data.invite
      if (invite) {
        setNewInviteCode(invite.invite_code)
        setInvites(prev => [invite, ...prev])
      }
    } catch (err) {
      console.error('Failed to generate invite:', err)
    } finally {
      setGeneratingInvite(false)
    }
  }

  const copyInviteUrl = async (code: string) => {
    const url = `${window.location.origin}/join/invite/${encodeURIComponent(code)}`
    await navigator.clipboard.writeText(url)
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 2000)
  }

  const revokeInvite = async (inviteId: string) => {
    try {
      await apiClient.delete(`/api/connections/invites/${encodeURIComponent(inviteId)}`)
      setInvites(prev => prev.filter(i => i.id !== inviteId))
    } catch (err) {
      console.error('Failed to revoke invite:', err)
    }
  }

  const removeConnection = async (connectionId: string) => {
    try {
      await apiClient.delete(`/api/connections/${encodeURIComponent(connectionId)}`)
      setConnections(prev => prev.filter(c => c.id !== connectionId))
    } catch (err) {
      console.error('Failed to remove connection:', err)
    }
  }

  // ─── Login Required ────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Sign in Required</h2>
        <p className="text-muted-foreground">You need to be signed in to manage your friend list.</p>
      </div>
    )
  }

  // ─── Filter helpers ───────────────────────────────────────

  const filteredConnections = connections.filter(c => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return c.display_name.toLowerCase().includes(q) || (c.email && c.email.toLowerCase().includes(q))
  })

  // ─── Render ────────────────────────────────────────────────

  const sectionTabClass = (section: typeof activeSection) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
      activeSection === section
        ? 'bg-card border border-b-0 border-border text-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
    }`

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-sm text-muted-foreground">Manage your friend list, invites, and friend requests</p>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 border-b border-border">
        <button onClick={() => setActiveSection('friends')} className={sectionTabClass('friends')}>
          <div className="flex items-center gap-1.5"><Users className="w-4 h-4" /> Friend List</div>
        </button>
        <button onClick={() => setActiveSection('requests')} className={sectionTabClass('requests')}>
          <div className="flex items-center gap-1.5"><Link2 className="w-4 h-4" /> Invite Friends</div>
        </button>
      </div>

      <div className="bg-card border border-t-0 border-border rounded-b-lg p-6">

        {/* ═══════════════════════════════════════════════════════
            FRIEND LIST
            ═══════════════════════════════════════════════════════ */}
        {activeSection === 'friends' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Your friends -- people connected with you through invite codes or shared calendars.
              </p>
              <div className="flex items-center gap-3">
                <Button
                  emphasis="ghost"
                  size="micro"
                  onClick={() => setShowEmails(!showEmails)}
                  icon={showEmails ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                >
                  {showEmails ? 'Hide emails' : 'Show emails'}
                </Button>
                <Button
                  emphasis="ghost"
                  intent="primary"
                  size="micro"
                  onClick={fetchConnections}
                  disabled={loadingConnections}
                  icon={loadingConnections ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search friends..."
                className="w-full pl-10 pr-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-hidden"
              />
            </div>

            {loadingConnections ? (
              <div className="text-center py-8">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : filteredConnections.length === 0 ? (
              <div className="text-center py-8 border border-border rounded-lg">
                <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery ? 'No friends match your search' : 'No friends yet. Share an invite code to add friends.'}
                </p>
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="grid grid-cols-[1fr_1.5fr_100px_100px_40px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b border-border">
                  <div>Name</div>
                  <div>Email</div>
                  <div>Connected Via</div>
                  <div>Status</div>
                  <div></div>
                </div>
                <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                  {filteredConnections.map(conn => (
                    <div key={conn.id} className={`grid grid-cols-[1fr_1.5fr_100px_100px_40px] gap-2 px-3 py-2.5 items-center text-sm ${conn.status === 'disconnected' ? 'opacity-50' : ''}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {conn.avatar_url && <img src={conn.avatar_url} alt="" className="w-5 h-5 rounded-full shrink-0" />}
                        <span className="truncate text-xs font-medium">{conn.display_name}</span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {conn.email ? (showEmails ? conn.email : conn.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')) : '--'}
                        {conn.email && (
                          <IconButton
                            size="micro"
                            label={showEmails ? 'Hide emails' : 'Show emails'}
                            onClick={() => setShowEmails(!showEmails)}
                            className="ml-1 align-middle"
                            icon={showEmails ? <EyeOff /> : <Eye />}
                          />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground capitalize">{conn.connected_via}</div>
                      <div>
                        {conn.status === 'connected' ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-success font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Connected
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground font-medium">
                            <XCircle className="w-3 h-3" /> Disconnected
                          </span>
                        )}
                      </div>
                      <div className="flex justify-center">
                        <IconButton
                          size="micro"
                          intent="danger"
                          label="Remove friend"
                          onClick={() => setRemoveFriend(conn)}
                          icon={<Trash2 />}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
                  {connections.filter(c => c.status === 'connected').length} friends of {connections.length} total
                </div>
              </div>
            )}

          </div>
        )}

        {/* ═══════════════════════════════════════════════════════
            INVITE FRIENDS
            ═══════════════════════════════════════════════════════ */}
        {activeSection === 'requests' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Generate one-time invite codes to add friends. Each code can only be used once.
              </p>
              <Button
                emphasis="ghost"
                intent="primary"
                size="micro"
                onClick={fetchInvites}
                disabled={loadingInvites}
                icon={loadingInvites ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              >
                Refresh
              </Button>
            </div>

            {/* Generate invite */}
            <div className="border border-border rounded-lg p-4 space-y-3">
              {privacyLoaded && (!privacyContactsEnabled || (!contactsShowEmail && !contactsShowPrefs && !contactsAllowConnections)) && (
                <div className="p-3 rounded-lg bg-warning-subtle border border-warning-muted text-sm text-warning space-y-2">
                  <p>To generate invite codes, first enable the <strong>Friends</strong> visibility level in your privacy settings.</p>
                  <Button
                    intent="primary"
                    size="compact"
                    onClick={() => navigate('/settings?tab=privacy&section=visibility')}
                    icon={<Settings className="w-3.5 h-3.5" />}
                  >
                    Go to Profile Visibility
                  </Button>
                </div>
              )}

              {privacyLoaded && privacyContactsEnabled && (contactsShowEmail || contactsShowPrefs || contactsAllowConnections) && !newInviteCode && (
                <div className="space-y-2">
                  <Button
                    intent="primary"
                    onClick={generateInvite}
                    disabled={generatingInvite}
                    icon={generatingInvite ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  >
                    Generate Invite Code
                  </Button>
                  <p className="text-xs text-muted-foreground">Invite codes expire after 48 hours and are automatically deleted.</p>
                </div>
              )}

              {newInviteCode && (
                <div className="p-3 rounded-lg bg-success-subtle border border-success-muted space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="text-sm font-medium text-success">Invite code generated!</span>
                  </div>
                  <p className="text-xs text-success">
                    This code is shown only once. Copy it and share it with the people you want to connect with.
                  </p>
                  <div className="flex items-center gap-2 bg-card rounded-lg p-2 border border-border">
                    <code className="flex-1 text-xs font-mono break-all select-all">{`${window.location.origin}/join/invite/${newInviteCode}`}</code>
                    <IconButton
                      label={codeCopied ? 'Copied' : 'Copy invite link'}
                      onClick={() => copyInviteUrl(newInviteCode)}
                      icon={codeCopied ? <Check className="text-success" /> : <Copy />}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Invite history */}
            {loadingInvites ? (
              <div className="text-center py-6">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : invites.length === 0 ? (
              <div className="text-center py-6 border border-border rounded-lg">
                <Link2 className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No invites yet. Generate your first one above.</p>
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="grid grid-cols-[1fr_100px_120px_60px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b border-border">
                  <div>Invite</div>
                  <div>Status</div>
                  <div>Created</div>
                  <div></div>
                </div>
                <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
                  {invites.map(invite => {
                    const statusConfig = {
                      pending: { icon: Clock, color: 'text-warning', label: 'Pending' },
                      connected: { icon: CheckCircle2, color: 'text-success', label: 'Connected' },
                      declined: { icon: XCircle, color: 'text-danger', label: 'Declined' },
                      ignored: { icon: AlertTriangle, color: 'text-muted-foreground', label: 'Ignored' },
                    }[invite.status]
                    const StatusIcon = statusConfig.icon
                    return (
                      <div key={invite.id} className="grid grid-cols-[1fr_100px_120px_60px] gap-2 px-3 py-2.5 items-center text-sm">
                        <div className="text-xs text-muted-foreground truncate">
                          {invite.used_by_display_name ? (
                            <span className="font-medium text-foreground">{invite.used_by_display_name}</span>
                          ) : (
                            <span className="font-mono text-[10px]">{invite.invite_code.slice(0, 12)}...</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <StatusIcon className={`w-3.5 h-3.5 ${statusConfig.color}`} />
                          <span className={`text-xs ${statusConfig.color}`}>{statusConfig.label}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateInTimezone(invite.created_at, getPrimaryTimezone())}
                        </div>
                        <div className="flex justify-end">
                          {invite.status === 'pending' && (
                            <IconButton
                              size="micro"
                              intent="danger"
                              label="Revoke invite"
                              onClick={() => revokeInvite(invite.id)}
                              icon={<Trash2 />}
                            />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Remove friend confirmation dialog */}
      <ConfirmDialog
        open={!!removeFriend}
        title="Remove Friend"
        message={removeFriend ? `Remove ${removeFriend.display_name} from your friend list?` : ''}
        confirmText="Remove"
        cancelText="Cancel"
        onConfirm={() => { if (removeFriend) { removeConnection(removeFriend.id); setRemoveFriend(null) } }}
        onCancel={() => setRemoveFriend(null)}
      />
    </div>
  )
}
