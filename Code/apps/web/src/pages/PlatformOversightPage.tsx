import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../lib/api-client'
import { AdminMfaPrompt } from '../components/AdminMfaPrompt'
import { isAdminMfaRequiredError } from '../lib/admin-mfa'
import { Button, Disclosure, SegmentedControl, ToggleButton } from '../components/ui'
import { getPrimaryTimezone, formatDateInTimezone, formatTimeInTimezone } from '../lib/timezone-data'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  Activity,
  AlertTriangle,
  Calendar,
  Clock,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  Monitor,
  RefreshCw,
  Shield,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  Compass,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────

interface AccountRecord {
  id: string
  email: string | null
  display_name: string | null
  account_type: string | null
  roles: string[] | null
  traveler_name: string | null
  wallet_address: string | null
  signup_source: string | null
  created_at: string
}

interface DailyCounts {
  [date: string]: number
}

interface CaptchaStatus {
  required: boolean
  elevatedUntil: number | null
  manualOverride: boolean | null
  /** Added to the API response when captcha is unavailable on this server. */
  available?: boolean
  unavailableReason?: 'missing-keys' | 'disabled' | null
}

interface HealthSignals {
  calendars: { total: number; last24h: number; last7d: number; last30d: number }
  meetings: { total: number; last24h: number; last7d: number; last30d: number }
  availability: { total: number; last24h: number; last7d: number; last30d: number }
  users: { total: number; last24h: number; last7d: number; last30d: number }
  accountDeletions: { total: number; last24h: number; last7d: number; last30d: number }
  announcements: { total: number; last24h: number; last7d: number; last30d: number }
  feedback: { total: number; last24h: number; last7d: number; last30d: number }
}

interface TimeseriesPoint {
  date: string
  calendars: number
  meetings: number
  availability: number
  users: number
  announcements: number
  feedback: number
  account_deletions: number
}

interface TimeseriesApiPoint extends Partial<Omit<TimeseriesPoint, 'date'>> {
  date: string
}

type DateRange = '1d' | '7d' | '30d' | 'all'

// Maps the period filter to how many days of timeseries data to request/display.
// Backend clamps the "days" query param between 7 and 90, so 'all' uses the max allowed.
const RANGE_TO_DAYS: Record<DateRange, number> = { '1d': 1, '7d': 7, '30d': 30, all: 90 }

// ─── Access gate ──────────────────────────────────────────────────────

function AccessDenied() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-3">
        <Shield className="w-12 h-12 mx-auto text-muted-foreground" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground text-sm">Admin role with block power required.</p>
      </div>
    </div>
  )
}

// ─── Expandable section ───────────────────────────────────────────────

function ExpandableSection({ title, icon, children, defaultOpen = false, badge }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: React.ReactNode
}) {
  return (
    <Disclosure
      title={title}
      icon={icon}
      trailing={badge ? <span className="mr-2">{badge}</span> : undefined}
      defaultExpanded={defaultOpen}
      className="border border-border rounded-lg bg-card p-2"
      panelClassName="px-3 pb-3 pt-1"
    >
      {children}
    </Disclosure>
  )
}

// ─── Mini bar chart (pure CSS) ────────────────────────────────────────

function MiniBarChart({ data, label }: { data: { date: string; count: number }[]; label: string }) {
  const max = Math.max(...data.map(d => d.count), 1)
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      <div className="flex items-end gap-[2px] h-20">
        {data.map(d => {
          const pct = (d.count / max) * 100
          const isHot = d.count >= 5
          return (
            <div key={d.date} className="flex-1 group relative flex flex-col items-center justify-end h-full">
              <div
                className={`w-full min-h-[2px] rounded-t transition-all ${
                  isHot
                    ? 'bg-danger'
                    : d.count > 0
                      ? 'bg-info'
                      : 'bg-muted'
                }`}
                style={{ height: `${Math.max(pct, 3)}%` }}
              />
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded shadow-sm border border-border whitespace-nowrap z-10">
                {d.date}: {d.count}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────

function StatCard({ icon, label, total, sub }: {
  icon: React.ReactNode
  label: string
  total: number
  sub: { label: string; value: number }[]
}) {
  return (
    <div className="border border-border rounded-lg bg-card p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-bold">{total.toLocaleString()}</p>
      <div className="flex flex-wrap gap-3">
        {sub.map(s => (
          <span key={s.label} className="text-xs text-muted-foreground">
            {s.label}: <span className="font-medium text-foreground">{s.value.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Interaction timeseries chart ─────────────────────────────────────

const SERIES_CONFIG = [
  { key: 'users', label: 'Users', color: '#3b82f6' },
  { key: 'calendars', label: 'Calendars', color: '#a855f7' },
  { key: 'meetings', label: 'Participations', color: '#14b8a6' },
  { key: 'availability', label: 'Availability', color: '#f97316' },
  { key: 'announcements', label: 'Announcements', color: '#ec4899' },
  { key: 'feedback', label: 'Feedback', color: '#eab308' },
  { key: 'account_deletions', label: 'Account Deletions', color: '#ef4444' },
] as const

function InteractionTimeseries({ data }: { data: TimeseriesPoint[] }) {
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())

  const toggleSeries = (key: string) => {
    setHiddenSeries(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Compute total interactions per day for the combined line
  const enrichedData = useMemo(() =>
    data.map(d => ({
      ...d,
      total: d.calendars + d.meetings + d.availability + d.users + d.announcements + d.feedback + d.account_deletions,
    })),
    [data],
  )

  return (
    <div className="space-y-3">
      {/* Toggle buttons */}
      <div className="flex flex-wrap gap-1.5">
        {SERIES_CONFIG.map(s => (
          <ToggleButton
            key={s.key}
            size="micro"
            intent="neutral"
            pressed={!hiddenSeries.has(s.key)}
            onPressedChange={() => toggleSeries(s.key)}
            icon={
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: hiddenSeries.has(s.key) ? 'transparent' : s.color, border: `1.5px solid ${s.color}` }}
              />
            }
          >
            {s.label}
          </ToggleButton>
        ))}
      </div>

      {/* Chart */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={enrichedData} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
            <defs>
              {SERIES_CONFIG.map(s => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(v: string) => v.slice(5)}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              allowDecimals={false}
              className="text-muted-foreground"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                borderColor: 'hsl(var(--border))',
                borderRadius: '0.5rem',
                fontSize: '12px',
              }}
              labelFormatter={(label) => String(label)}
            />
            {SERIES_CONFIG.map(s =>
              !hiddenSeries.has(s.key) ? (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  fill={`url(#grad-${s.key})`}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              ) : null,
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── Account type badge ───────────────────────────────────────────────

function AccountBadge({ account }: { account: AccountRecord }) {
  const roles = Array.isArray(account.roles) ? account.roles : []
  const type = account.account_type || (account.wallet_address ? 'cardano' : roles.includes('traveler') ? 'traveler' : 'google')
  switch (type) {
    case 'cardano':
    case 'linked':
      return (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-info-subtle text-info">
          <Wallet className="w-3 h-3" />{type === 'linked' ? 'Linked' : 'Cardano'}
        </span>
      )
    case 'traveler':
      return (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-warning-subtle text-warning">
          <Compass className="w-3 h-3" />Traveler
        </span>
      )
    default:
      return (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-success-subtle text-success">
          <Mail className="w-3 h-3" />Google
        </span>
      )
  }
}

// ─── Source badge ─────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string | null }) {
  switch (source) {
    case 'production':
      return (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-success-subtle text-success">
          <Globe className="w-3 h-3" />Prod
        </span>
      )
    case 'localhost':
      return (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-warning-subtle text-warning">
          <Monitor className="w-3 h-3" />Local
        </span>
      )
    default:
      return (
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">?</span>
      )
  }
}

// ─── Main page ────────────────────────────────────────────────────────

export default function PlatformOversightPage() {
  const navigate = useNavigate()
  const { user, session } = useAuth()
  const isAdmin = user?.roles?.includes('admin')

  // Access gate
  useEffect(() => {
    if (!isAdmin) { navigate('/settings?tab=profile'); return }
    try {
      const stored = localStorage.getItem('adminPowers')
      if (!stored || !JSON.parse(stored).blockPower) navigate('/settings?tab=profile')
    } catch { navigate('/settings?tab=profile') }
  }, [isAdmin, navigate])

  // ─── State ────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adminMfaRequired, setAdminMfaRequired] = useState(false)

  // Account log
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [dailyCounts, setDailyCounts] = useState<DailyCounts>({})
  const [accountSearch, setAccountSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')

  // PII visibility
  const [showPII, setShowPII] = useState(false)

  // Captcha
  const [captcha, setCaptcha] = useState<CaptchaStatus>({ required: false, elevatedUntil: null, manualOverride: null })
  const [captchaLoading, setCaptchaLoading] = useState(false)

  // Health
  const [health, setHealth] = useState<HealthSignals | null>(null)

  // Timeseries
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([])
  const [excludeLocalhostData, setExcludeLocalhostData] = useState(true)

  // Date range filter (default: 1 week)
  const [dateRange, setDateRange] = useState<DateRange>('7d')

  // ─── Fetch all data ───────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    if (!session?.access_token) return
    setLoading(true)
    setError(null)
    try {
      const [accountRes, captchaRes, healthRes] = await Promise.all([
        apiClient.get('/api/admin/oversight/account-log', {
          params: { excludeLocalhost: excludeLocalhostData ? 'true' : 'false' },
        }),
        apiClient.get('/api/admin/oversight/captcha'),
        apiClient.get('/api/admin/oversight/health-signals', {
          params: { excludeLocalhost: excludeLocalhostData ? 'true' : 'false' },
        }),
      ])
      setAdminMfaRequired(false)
      setAccounts(accountRes.data.accounts || [])
      setDailyCounts(accountRes.data.dailyCounts || {})
      setCaptcha(captchaRes.data)
      setHealth(healthRes.data)
    } catch (err: unknown) {
      if (isAdminMfaRequiredError(err)) {
        setAdminMfaRequired(true)
        setError(null)
        return
      }
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        || (err as { message?: string })?.message || 'Failed to load oversight data'
      setError(msg)
    } finally {
      setLoading(false)
    }

    // Fetch timeseries separately -- gracefully degrades if endpoint not yet deployed
    try {
      const requestedDays = RANGE_TO_DAYS[dateRange]
      const tsRes = await apiClient.get('/api/admin/oversight/interaction-timeseries', {
        params: {
          days: Math.max(7, requestedDays),
          excludeLocalhost: excludeLocalhostData ? 'true' : 'false',
        },
      })
      const rawSeries: TimeseriesApiPoint[] = Array.isArray(tsRes.data?.series) ? tsRes.data.series : []
      const mapped = rawSeries.map((point) => ({
        date: point.date,
        calendars: point.calendars ?? 0,
        meetings: point.meetings ?? 0,
        availability: point.availability ?? 0,
        users: point.users ?? 0,
        announcements: point.announcements ?? 0,
        feedback: point.feedback ?? 0,
        account_deletions: point.account_deletions ?? 0,
      }))
      // Backend enforces a minimum of 7 days, so trim to the requested window client-side
      setTimeseries(requestedDays < mapped.length ? mapped.slice(-requestedDays) : mapped)
    } catch {
      // Endpoint may not exist on production yet -- silently skip
    }
  }, [excludeLocalhostData, dateRange, session?.access_token])

  useEffect(() => { fetchAll() }, [fetchAll])

  if (adminMfaRequired) {
    return <AdminMfaPrompt onVerified={() => { setAdminMfaRequired(false); fetchAll() }} onCancel={() => navigate('/settings?tab=profile')} />
  }

  // ─── Captcha toggle ───────────────────────────────────────────────
  const setCaptchaMode = async (mode: 'on' | 'off' | 'auto') => {
    setCaptchaLoading(true)
    try {
      const res = await apiClient.post('/api/admin/oversight/captcha', { mode })
      setCaptcha(res.data)
    } catch { /* ignore */ }
    finally { setCaptchaLoading(false) }
  }

  if (!isAdmin) return <AccessDenied />

  // ─── Date range helper ────────────────────────────────────────────
  const getValueForRange = (bucket: { total: number; last24h: number; last7d: number; last30d: number }) => {
    switch (dateRange) {
      case '1d': return bucket.last24h
      case '7d': return bucket.last7d
      case '30d': return bucket.last30d
      case 'all': return bucket.total
    }
  }
  const dateRangeLabel: Record<DateRange, string> = { '1d': '24h', '7d': '7 days', '30d': '30 days', 'all': 'all time' }

  // ─── Prepare chart data ───────────────────────────────────────────
  const chartData = Object.entries(dailyCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  const totalToday = dailyCounts[new Date().toISOString().slice(0, 10)] ?? 0

  // Filter accounts
  const sourceFiltered = sourceFilter === 'all'
    ? accounts
    : accounts.filter(a => (a.signup_source || 'unknown') === sourceFilter)

  const filteredAccounts = accountSearch
    ? sourceFiltered.filter(a => {
        const q = accountSearch.toLowerCase()
        return (
          (a.display_name || '').toLowerCase().includes(q) ||
          (a.email || '').toLowerCase().includes(q) ||
          (a.traveler_name || '').toLowerCase().includes(q) ||
          (a.account_type || '').toLowerCase().includes(q)
        )
      })
    : sourceFiltered

  // Count by source for the filter buttons
  const sourceCounts = accounts.reduce<Record<string, number>>((acc, a) => {
    const src = a.signup_source || 'unknown'
    acc[src] = (acc[src] || 0) + 1
    return acc
  }, {})

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Eye className="w-6 h-6 text-feature-ai" />
          <div>
            <h1 className="text-xl font-bold">Platform Oversight</h1>
            <p className="text-xs text-muted-foreground">Admin dashboards, logs, and health signals</p>
          </div>
        </div>
        <Button
          emphasis="outline"
          size="compact"
          onClick={fetchAll}
          disabled={loading}
          icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !health ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* ═══ Date Range Filter ════════════════════════════════════ */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Period:</span>
            <SegmentedControl<DateRange>
              label="Period"
              size="compact"
              value={dateRange}
              onChange={setDateRange}
              options={[
                { value: '1d', label: '1 Day' },
                { value: '7d', label: '1 Week' },
                { value: '30d', label: '1 Month' },
                { value: 'all', label: 'All' },
              ]}
            />
            <ToggleButton
              size="compact"
              intent="success"
              pressed={excludeLocalhostData}
              onPressedChange={() => setExcludeLocalhostData(v => !v)}
              className="ml-1"
              title="Exclude localhost-sourced account events from oversight metrics"
            >
              {excludeLocalhostData ? 'Excluding Localhost' : 'Include Localhost'}
            </ToggleButton>
          </div>

          {/* ═══ 1. Health / Liveliness Signals ═══════════════════════ */}
          {health && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard
                icon={<Users className="w-4 h-4 text-muted-foreground" />}
                label="Users"
                total={getValueForRange(health.users)}
                sub={[
                  { label: dateRangeLabel[dateRange], value: getValueForRange(health.users) },
                  { label: 'total', value: health.users.total },
                ]}
              />
              <StatCard
                icon={<AlertTriangle className="w-4 h-4 text-danger" />}
                label="Account Deletions"
                total={getValueForRange(health.accountDeletions)}
                sub={[
                  { label: dateRangeLabel[dateRange], value: getValueForRange(health.accountDeletions) },
                  { label: 'total', value: health.accountDeletions.total },
                ]}
              />
              <StatCard
                icon={<Calendar className="w-4 h-4 text-muted-foreground" />}
                label="Calendars Created"
                total={getValueForRange(health.calendars)}
                sub={[
                  { label: dateRangeLabel[dateRange], value: getValueForRange(health.calendars) },
                  { label: 'total', value: health.calendars.total },
                ]}
              />
              <StatCard
                icon={<UserPlus className="w-4 h-4 text-muted-foreground" />}
                label="Participations"
                total={getValueForRange(health.meetings)}
                sub={[
                  { label: dateRangeLabel[dateRange], value: getValueForRange(health.meetings) },
                  { label: 'total', value: health.meetings.total },
                ]}
              />
              <StatCard
                icon={<Clock className="w-4 h-4 text-muted-foreground" />}
                label="Availability Responses"
                total={getValueForRange(health.availability)}
                sub={[
                  { label: dateRangeLabel[dateRange], value: getValueForRange(health.availability) },
                  { label: 'total', value: health.availability.total },
                ]}
              />
              <StatCard
                icon={<Megaphone className="w-4 h-4 text-muted-foreground" />}
                label="Announcements"
                total={getValueForRange(health.announcements)}
                sub={[
                  { label: dateRangeLabel[dateRange], value: getValueForRange(health.announcements) },
                  { label: 'total', value: health.announcements.total },
                ]}
              />
              <StatCard
                icon={<MessageSquare className="w-4 h-4 text-warning" />}
                label="Feedback"
                total={getValueForRange(health.feedback)}
                sub={[
                  { label: dateRangeLabel[dateRange], value: getValueForRange(health.feedback) },
                  { label: 'total', value: health.feedback.total },
                ]}
              />
            </div>
          )}

          {/* ═══ Interaction Timeseries ═══════════════════════════ */}
          {timeseries.length > 0 && (
            <ExpandableSection
              title="User Interactions Over Time"
              icon={<Activity className="w-4 h-4 text-muted-foreground" />}
              defaultOpen={true}
            >
              <InteractionTimeseries data={timeseries} />
            </ExpandableSection>
          )}

          {/* ═══ 2. Account Creation Log ══════════════════════════════ */}
          <ExpandableSection
            title="Account Creation Log"
            icon={<TrendingUp className="w-4 h-4 text-primary" />}
            defaultOpen={false}
            badge={
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                totalToday >= 5
                  ? 'bg-danger-subtle text-danger'
                  : totalToday > 0
                    ? 'bg-info-subtle text-info'
                    : 'bg-muted text-muted-foreground'
              }`}>
                {totalToday} today
              </span>
            }
          >
            <div className="space-y-4">
              {/* PII visibility toggle */}
              <div className="flex items-center justify-end">
                <ToggleButton
                  size="micro"
                  intent="neutral"
                  pressed={showPII}
                  onPressedChange={() => setShowPII(v => !v)}
                  title={showPII ? 'Hide names & emails' : 'Show names & emails'}
                  icon={showPII ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                >
                  {showPII ? 'Visible' : 'Hidden'}
                </ToggleButton>
              </div>

              {/* 30-day bar chart */}
              {chartData.length > 0 && (
                <MiniBarChart data={chartData} label="Account creations - last 30 days (red = 5+ in a day)" />
              )}

              {/* Search + source filter */}
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={accountSearch}
                  onChange={e => setAccountSearch(e.target.value)}
                  placeholder="Search accounts by name, email, type..."
                  className="flex-1 px-3 py-2 text-sm rounded-md border border-border bg-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
                />
                <SegmentedControl
                  label="Account source"
                  size="compact"
                  className="shrink-0 self-start"
                  value={sourceFilter}
                  onChange={setSourceFilter}
                  options={[
                    { key: 'all', label: 'All', icon: undefined },
                    { key: 'production', label: 'Prod', icon: <Globe className="w-3 h-3" /> },
                    { key: 'localhost', label: 'Local', icon: <Monitor className="w-3 h-3" /> },
                    { key: 'unknown', label: '?', icon: undefined },
                  ].flatMap(f => {
                    const count = f.key === 'all' ? accounts.length : (sourceCounts[f.key] || 0)
                    if (f.key !== 'all' && count === 0) return []
                    return [{ value: f.key, label: `${f.label} ${count}`, icon: f.icon }]
                  })}
                />
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Created</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Name</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Email</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Type</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredAccounts.slice(0, 100).map(a => {
                      const createdDate = new Date(a.created_at)
                      const ageMs = Date.now() - createdDate.getTime()
                      const isRecent = ageMs < 60 * 60 * 1000 // < 1 hour
                      const isToday = ageMs < 24 * 60 * 60 * 1000
                      return (
                        <tr
                          key={a.id}
                          className={`hover:bg-accent/30 transition-colors ${
                            isRecent
                              ? 'bg-danger-subtle'
                              : isToday
                                ? 'bg-info-subtle'
                                : ''
                          }`}
                        >
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {isRecent && <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />}
                              <span className={`text-xs ${isRecent ? 'font-semibold text-danger' : 'text-muted-foreground'}`}>
                                {formatDateInTimezone(createdDate, getPrimaryTimezone()).replace(/,? \d{4}$/, '')} {formatTimeInTimezone(createdDate, getPrimaryTimezone())}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 font-medium text-xs">
                            {showPII
                              ? (a.display_name || a.traveler_name || <span className="text-muted-foreground italic">unnamed</span>)
                              : <span className="text-muted-foreground select-none">{'\u2022'.repeat(6)}</span>
                            }
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px]">
                            {showPII
                              ? (a.email || '-')
                              : <span className="select-none">{'\u2022'.repeat(8)}</span>
                            }
                          </td>
                          <td className="px-3 py-2">
                            <AccountBadge account={a} />
                          </td>
                          <td className="px-3 py-2">
                            <SourceBadge source={a.signup_source} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filteredAccounts.length === 0 && (
                  <div className="text-center py-6 text-sm text-muted-foreground">No accounts found</div>
                )}
                {filteredAccounts.length > 100 && (
                  <div className="text-center py-2 text-xs text-muted-foreground border-t border-border">
                    Showing 100 of {filteredAccounts.length} results
                  </div>
                )}
              </div>
            </div>
          </ExpandableSection>

          {/* ═══ 3. Captcha Control ═══════════════════════════════════ */}
          <ExpandableSection
            title="Captcha Mode Control"
            icon={<Shield className="w-4 h-4 text-danger" />}
            defaultOpen={false}
            badge={
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                captcha.available === false
                  ? 'bg-muted text-muted-foreground'
                  : captcha.required
                  ? 'bg-danger-subtle text-danger'
                  : 'bg-success-subtle text-success'
              }`}>
                {captcha.available === false ? 'Unavailable' : captcha.required ? 'Active' : 'Inactive'}
              </span>
            }
          >
            <div className="space-y-4">
              {/* Unavailable notice */}
              {captcha.available === false && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warning-subtle border border-warning-muted text-xs text-foreground">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    {captcha.unavailableReason === 'disabled' ? (
                      <>
                        Captcha is <strong>disabled on this machine</strong> via the Setup page,
                        so it is always off regardless of mode.{' '}
                        <Link to="/setup#captcha" className="underline underline-offset-2">
                          Re-enable in Setup
                        </Link>.
                      </>
                    ) : (
                      <>
                        Captcha keys are <strong>not configured</strong> on this server, so it is
                        always off regardless of mode.{' '}
                        <Link to="/setup#captcha" className="underline underline-offset-2">
                          Configure in Setup
                        </Link>.
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Status */}
              <div className="flex items-center gap-3 text-sm">
                <span className={`w-3 h-3 rounded-full ${captcha.required ? 'bg-danger animate-pulse' : 'bg-success'}`} />
                <span>
                  Captcha is <span className="font-semibold">{captcha.required ? 'required' : 'not required'}</span>
                  {captcha.manualOverride !== null && (
                    <span className="ml-1 text-warning">(manual override: {captcha.manualOverride ? 'forced on' : 'forced off'})</span>
                  )}
                </span>
              </div>

              {captcha.elevatedUntil && (
                <p className="text-xs text-muted-foreground">
                  Auto-elevated until: {formatDateInTimezone(new Date(captcha.elevatedUntil), getPrimaryTimezone())} {formatTimeInTimezone(new Date(captcha.elevatedUntil), getPrimaryTimezone())}
                </p>
              )}

              {/* Controls */}
              <div className="flex flex-wrap gap-2">
                <SegmentedControl<'on' | 'off' | 'auto' | 'none'>
                  label="Captcha mode"
                  size="compact"
                  value={
                    captcha.manualOverride === false
                      ? 'off'
                      : captcha.available === false
                        ? 'none'
                        : captcha.manualOverride === true
                          ? 'on'
                          : 'auto'
                  }
                  onChange={mode => {
                    if (mode !== 'none') setCaptchaMode(mode)
                  }}
                  options={[
                    {
                      value: 'on',
                      label: 'Force ON',
                      icon: <ToggleRight className="w-3.5 h-3.5" />,
                      disabled: captchaLoading || captcha.available === false,
                      title: captcha.available === false ? 'Captcha is unavailable -- cannot force on.' : undefined,
                    },
                    {
                      value: 'off',
                      label: 'Force OFF',
                      icon: <ToggleLeft className="w-3.5 h-3.5" />,
                      disabled: captchaLoading,
                    },
                    {
                      value: 'auto',
                      label: 'Auto (spike detection)',
                      icon: <Activity className="w-3.5 h-3.5" />,
                      disabled: captchaLoading || captcha.available === false,
                      title: captcha.available === false ? 'Captcha is unavailable -- auto detection has nothing to enable.' : undefined,
                    },
                  ]}
                />
                {captchaLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground self-center" />}
              </div>

              <p className="text-xs text-muted-foreground">
                <strong>Force ON</strong> requires Turnstile captcha for all new Traveler signups. <strong>Force OFF</strong> disables captcha regardless of spike detection. <strong>Auto</strong> enables captcha only when signup rate exceeds 10/minute.
              </p>
            </div>
          </ExpandableSection>
        </>
      )}
    </div>
  )
}
