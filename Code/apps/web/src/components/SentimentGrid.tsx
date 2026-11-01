import { useState, useRef, useCallback } from 'react'

interface SentimentGridProps {
  /** Y-axis value: 1 = Good, -1 = Bad */
  valence: number
  /** X-axis value: -1 = Untrust, 1 = Trust */
  trust: number
  onChange: (valence: number, trust: number) => void
  /** Size of the grid in pixels (default: 240) */
  size?: number
  disabled?: boolean
}

/**
 * A 5×5 sentiment analysis grid with a draggable pointer.
 *
 * - Y-axis: Good (top) → Bad (bottom) with "Unknown" at centre
 * - X-axis: Untrust (left) → Trust (right) with "Don't know" at centre
 */
export default function SentimentGrid({
  valence,
  trust,
  onChange,
  size = 240,
  disabled = false,
}: SentimentGridProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Convert normalised values (-1..1) to pixel position
  const toPixel = useCallback(
    (normX: number, normY: number) => ({
      x: ((normX + 1) / 2) * size,
      y: ((1 - normY) / 2) * size, // invert Y: +1 is top
    }),
    [size],
  )

  // Convert pixel position to normalised values (-1..1), snapping to grid
  const fromPixel = useCallback(
    (px: number, py: number) => {
      // Clamp
      const cx = Math.max(0, Math.min(size, px))
      const cy = Math.max(0, Math.min(size, py))

      // Convert to -1..1
      let normX = (cx / size) * 2 - 1
      let normY = 1 - (cy / size) * 2

      // Snap to nearest 0.5 step (gives us 5 positions per axis: -1, -0.5, 0, 0.5, 1)
      normX = Math.round(normX * 2) / 2
      normY = Math.round(normY * 2) / 2

      return { trust: normX, valence: normY }
    },
    [size],
  )

  const handlePointerEvent = useCallback(
    (clientX: number, clientY: number) => {
      if (disabled) return
      const rect = gridRef.current?.getBoundingClientRect()
      if (!rect) return

      const px = clientX - rect.left
      const py = clientY - rect.top
      const snapped = fromPixel(px, py)
      onChange(snapped.valence, snapped.trust)
    },
    [disabled, fromPixel, onChange],
  )

  // Mouse / touch handlers
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return
      e.preventDefault()
      setIsDragging(true)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      handlePointerEvent(e.clientX, e.clientY)
    },
    [disabled, handlePointerEvent],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return
      handlePointerEvent(e.clientX, e.clientY)
    },
    [isDragging, handlePointerEvent],
  )

  const onPointerUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Handle keyboard for accessibility
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return
      const step = 0.5
      let newValence = valence
      let newTrust = trust
      switch (e.key) {
        case 'ArrowUp':
          newValence = Math.min(1, valence + step)
          break
        case 'ArrowDown':
          newValence = Math.max(-1, valence - step)
          break
        case 'ArrowRight':
          newTrust = Math.min(1, trust + step)
          break
        case 'ArrowLeft':
          newTrust = Math.max(-1, trust - step)
          break
        default:
          return
      }
      e.preventDefault()
      onChange(newValence, newTrust)
    },
    [disabled, valence, trust, onChange],
  )

  const pos = toPixel(trust, valence)

  // Grid cell labels (5×5)
  const yLabels = ['Good', 'Positive', 'Unknown', 'Negative', 'Bad']
  const xLabels = ['Untrust', 'Doubt', "Don't know", 'Believe', 'Trust']

  // Colour for the grid background gradient based on position
  const getGridCellColor = (row: number, col: number) => {
    // row 0 = top (Good), row 4 = bottom (Bad)
    // col 0 = left (Untrust), col 4 = right (Trust)
    const valenceLevel = 1 - row / 4  // 1 to -1
    const trustLevel = col / 4 * 2 - 1 // -1 to 1
    
    // Red zone: bad + untrust (bottom-left)
    // Green zone: good + trust (top-right)
    // Neutral: centre
    const r = Math.round(200 - valenceLevel * 80 - trustLevel * 40)
    const g = Math.round(200 + valenceLevel * 80 + trustLevel * 40)
    const b = Math.round(200 - Math.abs(valenceLevel) * 30 - Math.abs(trustLevel) * 30)

    return `rgb(${Math.max(80, Math.min(255, r))}, ${Math.max(80, Math.min(255, g))}, ${Math.max(120, Math.min(255, b))})`
  }

  // Get a label for the current position
  const getPositionLabel = () => {
    const yIdx = Math.round((1 - valence) * 2) // 0-4
    const xIdx = Math.round((trust + 1) * 2)   // 0-4
    const y = yLabels[Math.max(0, Math.min(4, yIdx))]
    const x = xLabels[Math.max(0, Math.min(4, xIdx))]
    return `${y} · ${x}`
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Current value label */}
      <div className="text-xs font-medium text-muted-foreground">
        {getPositionLabel()}
      </div>

      <div className="flex items-stretch gap-1">
        {/* Y-axis label */}
        <div className="flex flex-col justify-between text-[10px] text-muted-foreground pr-1 py-0.5" style={{ height: size }}>
          <span className="text-success font-medium">Good</span>
          <span className="opacity-60">Positive</span>
          <span className="opacity-40">Unknown</span>
          <span className="opacity-60">Negative</span>
          <span className="text-danger font-medium">Bad</span>
        </div>

        {/* Grid */}
        <div
          ref={gridRef}
          className={`relative border border-border rounded-lg overflow-hidden select-none ${
            disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-crosshair'
          }`}
          style={{ width: size, height: size }}
          tabIndex={disabled ? -1 : 0}
          role="slider"
          aria-label="Sentiment grid"
          aria-valuetext={getPositionLabel()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {/* Background grid cells */}
          <div className="absolute inset-0 grid grid-cols-5 grid-rows-5">
            {Array.from({ length: 25 }, (_, i) => {
              const row = Math.floor(i / 5)
              const col = i % 5
              return (
                <div
                  key={i}
                  className="border border-border/20"
                  style={{ backgroundColor: getGridCellColor(row, col), opacity: 0.25 }}
                />
              )
            })}
          </div>

          {/* Centre crosshair */}
          <div
            className="absolute bg-border/40"
            style={{ left: size / 2 - 0.5, top: 0, width: 1, height: size }}
          />
          <div
            className="absolute bg-border/40"
            style={{ left: 0, top: size / 2 - 0.5, width: size, height: 1 }}
          />

          {/* Pointer */}
          <div
            className={`absolute w-5 h-5 rounded-full border-2 border-white shadow-lg transform -translate-x-1/2 -translate-y-1/2 transition-all ${
              isDragging ? 'scale-125 duration-0' : 'duration-150'
            }`}
            style={{
              left: pos.x,
              top: pos.y,
              backgroundColor: `hsl(${120 + valence * 60}, 70%, ${50 - trust * 10}%)`,
            }}
          />
        </div>
      </div>

      {/* X-axis label */}
      <div className="flex justify-between text-[10px] text-muted-foreground" style={{ width: size, marginLeft: 30 }}>
        <span className="text-danger font-medium">Untrust</span>
        <span className="opacity-60">Doubt</span>
        <span className="opacity-40">Don't know</span>
        <span className="opacity-60">Believe</span>
        <span className="text-success font-medium">Trust</span>
      </div>
    </div>
  )
}
