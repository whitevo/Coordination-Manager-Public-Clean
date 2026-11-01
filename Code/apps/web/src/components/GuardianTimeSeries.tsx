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
import { Loader2 } from 'lucide-react'

interface Bucket {
  time: string
  scanned: number
  flagged: number
  usersFlagged: number
}

type Mode = 'hourly' | 'multi-hour' | 'daily'

interface TimeSeriesData {
  mode: Mode
  buckets: Bucket[]
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
    // "2026-04-01" => "Apr 1"
    const d = new Date(time + 'T00:00:00')
    return formatDateInTimezone(d, tz).replace(/,? \d{4}$/, '')
  }
  // "2026-04-01T14:00" => "14:00" for hourly, "Apr 1 14:00" for multi-hour
  const d = new Date(time)
  if (mode === 'hourly') {
    return formatTimeInTimezone(d, tz)
  }
  return formatDateInTimezone(d, tz).replace(/,? \d{4}$/, '') +
    ' ' + formatTimeInTimezone(d, tz)
}

import React, { forwardRef, useImperativeHandle } from 'react'
export interface GuardianTimeSeriesRef {
  refresh: () => Promise<void>
}
const GuardianTimeSeries = forwardRef<GuardianTimeSeriesRef, Props>(
({ dateRange, filterSince, filterUntil, resolveDateBounds }, ref) => {
  const [data, setData] = useState<TimeSeriesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [chartSize, setChartSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  // Measure the chart container ourselves and pass numeric width/height to
  // recharts. This avoids the ResponsiveContainer "width(-1) and height(-1)"
  // warning that fires on its initial render before its internal observer
  // measures the parent.
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
      const res = await apiClient.get(`/api/guardian/timeseries?${params}`)
      setData(res.data)
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load timeseries')
    } finally {
      // Enforce min 1.5s loading
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

  const { mode, buckets } = data

  const chartData = buckets.map(b => ({
    ...b,
    label: formatLabel(b.time, mode),
  }))

  const maxScanned = Math.max(...buckets.map(b => b.scanned), 1)
  const maxFlagged = Math.max(...buckets.map(b => b.flagged), ...buckets.map(b => b.usersFlagged), 1)

  // If flagged values are tiny compared to scanned, show on separate scale
  const useDualAxis = maxScanned > maxFlagged * 10

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-2">
      <h3 className="text-sm font-medium text-foreground">Activity Over Time</h3>
      <div ref={chartContainerRef} className="h-64 w-full">
        {chartSize.width > 0 && chartSize.height > 0 && (
        <AreaChart width={chartSize.width} height={chartSize.height} data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <defs>
              <linearGradient id="gradScanned" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(217, 91%, 60%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradFlagged" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(0, 84%, 60%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(25, 95%, 53%)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(25, 95%, 53%)" stopOpacity={0} />
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
              yAxisId="left"
              tick={{ fontSize: 11 }}
              className="text-muted-foreground"
              width={40}
              allowDecimals={false}
            />
            {useDualAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                className="text-muted-foreground"
                width={40}
                allowDecimals={false}
              />
            )}
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
              yAxisId="left"
              type="monotone"
              dataKey="scanned"
              name="Messages Scanned"
              stroke="hsl(217, 91%, 60%)"
              fill="url(#gradScanned)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
            <Area
              yAxisId={useDualAxis ? 'right' : 'left'}
              type="monotone"
              dataKey="flagged"
              name="Flagged"
              stroke="hsl(0, 84%, 60%)"
              fill="url(#gradFlagged)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
            <Area
              yAxisId={useDualAxis ? 'right' : 'left'}
              type="monotone"
              dataKey="usersFlagged"
              name="Users Flagged"
              stroke="hsl(25, 95%, 53%)"
              fill="url(#gradUsers)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
        </AreaChart>
        )}
      </div>
    </div>
  )
})
GuardianTimeSeries.displayName = 'GuardianTimeSeries'
export default GuardianTimeSeries
