import { useState, useEffect, useCallback, useRef } from 'react'
import { endOfDay, parseISO } from 'date-fns'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { apiClient } from '../lib/api-client'
import { getPrimaryTimezone, formatDateInTimezone, formatTimeInTimezone } from '../lib/timezone-data'
import { Loader2, Trash2, MicOff, Ban } from 'lucide-react'

interface ActionBucket {
  time: string
  delete: number
  mute: number
  ban: number
  failed: number
}

type Mode = 'hourly' | 'multi-hour' | 'daily'

interface ActionTimeSeriesData {
  mode: Mode
  buckets: ActionBucket[]
  totals: { delete: number; mute: number; ban: number; failed: number }
}

interface Props {
  dateRange: '1d' | '7d' | '30d' | 'all' | 'custom'
  filterSince?: string
  filterUntil?: string
  resolveDateBounds?: () => { since: string; until: string }
}

function formatLabel(time: string, mode: Mode): string {
  const tz = getPrimaryTimezone()
  if (mode === 'daily') {
    const d = new Date(time + 'T00:00:00')
    return formatDateInTimezone(d, tz).replace(/,? \d{4}$/, '')
  }
  const d = new Date(time)
  if (mode === 'hourly') return formatTimeInTimezone(d, tz)
  return formatDateInTimezone(d, tz).replace(/,? \d{4}$/, '') + ' ' + formatTimeInTimezone(d, tz)
}

/**
 * Activity Over Time chart -- breaks down moderation actions
 * (delete / mute / ban) into time buckets. Powered by
 * /api/guardian/actions-timeseries which reads guardian_action_log.
 */
import React, { forwardRef, useImperativeHandle } from 'react'
export interface GuardianActionTimeSeriesRef {
  refresh: () => Promise<void>
}
const GuardianActionTimeSeries = forwardRef<GuardianActionTimeSeriesRef, Props>(
({ dateRange, filterSince, filterUntil, resolveDateBounds }, ref) => {
  const [data, setData] = useState<ActionTimeSeriesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [chartSize, setChartSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  const chartContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    if (!node) return
    const apply = (w: number, h: number) => {
      if (w > 0 && h > 0) {
        setChartSize(prev => (prev.width === w && prev.height === h ? prev : { width: w, height: h }))
      }
    }
    const rect = node.getBoundingClientRect()
    apply(Math.floor(rect.width), Math.floor(rect.height))
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        apply(Math.floor(entry.contentRect.width), Math.floor(entry.contentRect.height))
      }
    })
    observer.observe(node)
    observerRef.current = observer
  }, [])

  const fetchTimeseries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      const bounds = resolveDateBounds?.() ?? {
        since: filterSince ? parseISO(filterSince).toISOString() : '',
        until: filterUntil ? endOfDay(parseISO(filterUntil)).toISOString() : '',
      }
      if (bounds.since && bounds.until) {
        params.set('since', bounds.since)
        params.set('until', bounds.until)
      } else if (dateRange !== 'all') {
        params.set('range', dateRange)
      } else {
        params.set('range', '30d')
      }
      const res = await apiClient.get(`/api/guardian/actions-timeseries?${params}`)
      setData(res.data)
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load actions timeseries')
    } finally {
      await new Promise(res => setTimeout(res, 1500))
      setLoading(false)
    }
  }, [dateRange, filterSince, filterUntil, resolveDateBounds])

  useImperativeHandle(ref, () => ({ refresh: fetchTimeseries }), [fetchTimeseries])
  useEffect(() => { fetchTimeseries() }, [fetchTimeseries])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        {error || 'No data'}
      </div>
    )
  }

  const { mode, buckets, totals } = data
  const chartData = buckets.map(b => ({ ...b, label: formatLabel(b.time, mode) }))
  const noActions = totals.delete + totals.mute + totals.ban === 0

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-medium text-foreground">Moderation Actions Over Time</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Trash2 className="h-3.5 w-3.5 text-warning" /> Deletes: <strong className="text-foreground">{totals.delete}</strong>
          </span>
          <span className="inline-flex items-center gap-1">
            <MicOff className="h-3.5 w-3.5 text-warning" /> Mutes: <strong className="text-foreground">{totals.mute}</strong>
          </span>
          <span className="inline-flex items-center gap-1">
            <Ban className="h-3.5 w-3.5 text-danger" /> Bans: <strong className="text-foreground">{totals.ban}</strong>
          </span>
        </div>
      </div>

      {noActions ? (
        <div className="text-center py-8 text-xs text-muted-foreground">
          No moderation actions in the selected window.
        </div>
      ) : (
        <div ref={chartContainerRef} className="h-64 w-full">
          {chartSize.width > 0 && chartSize.height > 0 && (
            <AreaChart width={chartSize.width} height={chartSize.height} data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="gradDelete" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="hsl(38, 92%, 50%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradMute" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(48, 96%, 53%)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="hsl(48, 96%, 53%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradBan" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                interval={mode === 'daily' && buckets.length > 15 ? 2 : mode === 'multi-hour' ? 3 : 'preserveStartEnd'}
                angle={mode === 'multi-hour' ? -30 : 0}
                textAnchor={mode === 'multi-hour' ? 'end' : 'middle'}
                height={mode === 'multi-hour' ? 50 : 30}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                width={40}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid hsl(var(--border))',
                  backgroundColor: 'hsl(var(--card))',
                  fontSize: '12px',
                }}
                labelStyle={{ fontWeight: 600, marginBottom: 4 }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Area
                type="monotone"
                dataKey="delete"
                name="Deletes"
                stroke="hsl(38, 92%, 50%)"
                fill="url(#gradDelete)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
              <Area
                type="monotone"
                dataKey="mute"
                name="Mutes"
                stroke="hsl(48, 96%, 53%)"
                fill="url(#gradMute)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
              <Area
                type="monotone"
                dataKey="ban"
                name="Bans"
                stroke="hsl(0, 84%, 60%)"
                fill="url(#gradBan)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </AreaChart>
          )}
        </div>
      )}
    </div>
  )
})
GuardianActionTimeSeries.displayName = 'GuardianActionTimeSeries'
export default GuardianActionTimeSeries
