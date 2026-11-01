import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'

const DEFAULT_PALETTE: string[] = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#2563eb',
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e',
  '#64748b', '#475569', '#1e293b', '#78716c', '#a16207', '#7c2d12',
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

interface ColorGridPickerProps {
  value: string
  onChange: (color: string) => void
  palette?: string[]
  allowCustom?: boolean
  swatchSize?: number
  className?: string
}

interface RGBColor {
  r: number
  g: number
  b: number
}

interface HSVColor {
  h: number
  s: number
  v: number
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const hexToRgb = (hex: string): RGBColor | null => {
  if (!HEX_RE.test(hex)) {
    return null
  }

  const clean = hex.slice(1)
  const r = Number.parseInt(clean.slice(0, 2), 16)
  const g = Number.parseInt(clean.slice(2, 4), 16)
  const b = Number.parseInt(clean.slice(4, 6), 16)

  return { r, g, b }
}

const rgbToHex = ({ r, g, b }: RGBColor): string => {
  const toHex = (channel: number): string => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const rgbToHsv = ({ r, g, b }: RGBColor): HSVColor => {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255

  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min

  let hue = 0
  if (delta !== 0) {
    if (max === rn) {
      hue = 60 * (((gn - bn) / delta) % 6)
    } else if (max === gn) {
      hue = 60 * ((bn - rn) / delta + 2)
    } else {
      hue = 60 * ((rn - gn) / delta + 4)
    }
  }

  if (hue < 0) {
    hue += 360
  }

  const saturation = max === 0 ? 0 : delta / max

  return {
    h: hue,
    s: saturation,
    v: max,
  }
}

const hsvToRgb = ({ h, s, v }: HSVColor): RGBColor => {
  const hue = ((h % 360) + 360) % 360
  const chroma = v * s
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const match = v - chroma

  let red = 0
  let green = 0
  let blue = 0

  if (hue < 60) {
    red = chroma
    green = x
  } else if (hue < 120) {
    red = x
    green = chroma
  } else if (hue < 180) {
    green = chroma
    blue = x
  } else if (hue < 240) {
    green = x
    blue = chroma
  } else if (hue < 300) {
    red = x
    blue = chroma
  } else {
    red = chroma
    blue = x
  }

  return {
    r: (red + match) * 255,
    g: (green + match) * 255,
    b: (blue + match) * 255,
  }
}

const hexToHsv = (hex: string): HSVColor | null => {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return null
  }
  return rgbToHsv(rgb)
}

export default function ColorGridPicker({
  value,
  onChange,
  palette = DEFAULT_PALETTE,
  allowCustom = true,
  swatchSize = 22,
  className = '',
}: ColorGridPickerProps) {
  const normalizedValue = value?.toLowerCase() || ''
  const initialHsv = useMemo<HSVColor>(() => {
    const fromValue = hexToHsv(normalizedValue)
    if (fromValue) {
      return fromValue
    }
    return {
      h: 0,
      s: 1,
      v: 1,
    }
  }, [normalizedValue])

  const [hue, setHue] = useState<number>(initialHsv.h)
  const [saturation, setSaturation] = useState<number>(initialHsv.s)
  const [brightness, setBrightness] = useState<number>(initialHsv.v)
  const [customHex, setCustomHex] = useState<string>(normalizedValue || '')
  const [customError, setCustomError] = useState<string | null>(null)
  const areaRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const fromValue = hexToHsv(normalizedValue)
    if (fromValue) {
      setHue(fromValue.h)
      setSaturation(fromValue.s)
      setBrightness(fromValue.v)
      setCustomHex(normalizedValue)
      setCustomError(null)
    }
  }, [normalizedValue])

  const commitColor = (nextHsv: HSVColor): void => {
    const nextHex = rgbToHex(hsvToRgb(nextHsv)).toLowerCase()
    setCustomHex(nextHex)
    setCustomError(null)
    onChange(nextHex)
  }

  const updateFromAreaPointer = (clientX: number, clientY: number): void => {
    if (!areaRef.current) {
      return
    }

    const rect = areaRef.current.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return
    }

    const nextSaturation = clamp((clientX - rect.left) / rect.width, 0, 1)
    const nextBrightness = clamp(1 - (clientY - rect.top) / rect.height, 0, 1)

    setSaturation(nextSaturation)
    setBrightness(nextBrightness)
    commitColor({ h: hue, s: nextSaturation, v: nextBrightness })
  }

  const handleAreaPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    updateFromAreaPointer(event.clientX, event.clientY)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateFromAreaPointer(moveEvent.clientX, moveEvent.clientY)
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
  }

  const handleHueChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextHue = clamp(Number(event.target.value), 0, 360)
    setHue(nextHue)
    commitColor({ h: nextHue, s: saturation, v: brightness })
  }

  const handleCustomChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value.trim().toLowerCase()
    setCustomHex(next)
    if (!next) {
      setCustomError(null)
      return
    }
    if (!HEX_RE.test(next)) {
      setCustomError('Use #RRGGBB format')
      return
    }
    setCustomError(null)
    const nextHsv = hexToHsv(next)
    if (nextHsv) {
      setHue(nextHsv.h)
      setSaturation(nextHsv.s)
      setBrightness(nextHsv.v)
    }
    onChange(next)
  }

  const selectorLeft = `${clamp(saturation * 100, 0, 100)}%`
  const selectorTop = `${clamp((1 - brightness) * 100, 0, 100)}%`
  const previewHex = normalizedValue || rgbToHex(hsvToRgb({ h: hue, s: saturation, v: brightness }))

  // Keep these props available for backwards compatibility even though the picker is now gradient-based.
  void palette
  void swatchSize

  return (
    <div className={`space-y-2 ${className}`}>
      <div
        ref={areaRef}
        role="presentation"
        onPointerDown={handleAreaPointerDown}
        className="relative h-32 cursor-crosshair overflow-hidden rounded-md border border-border"
        style={{ backgroundColor: `hsl(${Math.round(hue)} 100% 50%)` }}
        aria-label="Color saturation and brightness picker"
      >
        <div className="absolute inset-0 bg-linear-to-r from-white via-white/0 to-transparent" />
        <div className="absolute inset-0 bg-linear-to-t from-black via-black/0 to-transparent" />
        <span
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm"
          style={{
            left: selectorLeft,
            top: selectorTop,
            boxShadow: '0 0 0 1px rgba(15, 23, 42, 0.7)',
          }}
        />
      </div>

      <input
        type="range"
        min={0}
        max={360}
        value={Math.round(hue)}
        onChange={handleHueChange}
        className="h-2 w-full cursor-pointer appearance-none rounded-md border border-border"
        style={{
          background:
            'linear-gradient(90deg, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)',
        }}
        aria-label="Hue selector"
      />

      {allowCustom && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Custom:</span>
            <input
              type="text"
              value={customHex}
              onChange={handleCustomChange}
              placeholder="#1a2b3c"
              maxLength={7}
              className="w-24 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
              spellCheck={false}
            />
          </label>
          <span
            className="h-4 w-4 rounded border border-border"
            style={{ backgroundColor: previewHex }}
            aria-hidden="true"
          />
          {customError && <span className="text-[10px] text-danger">{customError}</span>}
        </div>
      )}
    </div>
  )
}
