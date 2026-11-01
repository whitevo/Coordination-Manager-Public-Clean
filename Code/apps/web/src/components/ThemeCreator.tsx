import { useState, useCallback } from 'react'
import { Palette, Plus, Trash2, Save, RotateCcw, Check, Pencil } from 'lucide-react'
import { Button, Disclosure } from './ui'
import {
  type ColorTheme,
  type ThemeColors,
  PRESET_THEMES,
  COLOR_LABELS,
  COLOR_GROUPS,
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  hslToHex,
  hexToHsl,
  generateThemeId,
} from '../lib/theme-types'

const MAX_CUSTOM_THEMES = 3

interface ThemeCreatorProps {
  isDark: boolean
  activeThemeId: string | null
  customThemes: ColorTheme[]
  onApplyTheme: (themeId: string | null) => void
  onSaveCustomTheme: (theme: ColorTheme) => void
  onDeleteCustomTheme: (themeId: string) => void
}

export default function ThemeCreator({
  isDark,
  activeThemeId,
  customThemes,
  onApplyTheme,
  onSaveCustomTheme,
  onDeleteCustomTheme,
}: ThemeCreatorProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [editingTheme, setEditingTheme] = useState<ColorTheme | null>(null)
  const [expandedGroup, setExpandedGroup] = useState<string | null>('Accents')
  const [themeName, setThemeName] = useState('')
  const [editColors, setEditColors] = useState<ThemeColors>(isDark ? DEFAULT_DARK : DEFAULT_LIGHT)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const allThemes = [...PRESET_THEMES, ...customThemes]
  const activeTheme = allThemes.find(t => t.id === activeThemeId) || null

  // Build 3 slots — filled with saved themes or empty
  const slots = Array.from({ length: MAX_CUSTOM_THEMES }, (_, i) => customThemes[i] || null)
  const canCreateMore = customThemes.length < MAX_CUSTOM_THEMES

  // Start creating a new custom theme
  const startCreate = useCallback(() => {
    // Start from the active theme's colors or defaults
    const base = activeTheme?.colors || (isDark ? DEFAULT_DARK : DEFAULT_LIGHT)
    setEditColors({ ...base })
    setThemeName('')
    setEditingTheme(null)
    setIsCreating(true)
    setExpandedGroup('Accents')
  }, [activeTheme, isDark])

  // Start editing an existing custom theme
  const startEdit = useCallback((theme: ColorTheme) => {
    setEditColors({ ...theme.colors })
    setThemeName(theme.name)
    setEditingTheme(theme)
    setIsCreating(true)
    setExpandedGroup('Accents')
  }, [])

  // Update a single color in the editor
  const updateColor = useCallback((key: keyof ThemeColors, hex: string) => {
    setEditColors(prev => ({ ...prev, [key]: hexToHsl(hex) }))
  }, [])

  // Save the custom theme
  const handleSave = useCallback(() => {
    const name = themeName.trim() || `Custom Theme ${customThemes.length + 1}`
    const theme: ColorTheme = {
      id: editingTheme?.id || generateThemeId(),
      name,
      colors: { ...editColors },
      isPreset: false,
      createdAt: editingTheme?.createdAt || new Date().toISOString(),
    }
    onSaveCustomTheme(theme)
    onApplyTheme(theme.id)
    setIsCreating(false)
    setEditingTheme(null)
  }, [themeName, editColors, editingTheme, customThemes.length, onSaveCustomTheme, onApplyTheme])

  // Reset editor to defaults
  const handleReset = useCallback(() => {
    setEditColors(isDark ? DEFAULT_DARK : DEFAULT_LIGHT)
  }, [isDark])

  // Cancel editing
  const handleCancel = useCallback(() => {
    setIsCreating(false)
    setEditingTheme(null)
  }, [])

  // Find if a preset is based on a template to show the "Based on" text
  const startFromPreset = useCallback((preset: ColorTheme) => {
    setEditColors({ ...preset.colors })
    setThemeName(themeName || `${preset.name} Custom`)
  }, [themeName])

  return (
    <div className="space-y-4">
      {/* ── Preset Themes Grid ────────────────────────────────── */}
      <div>
        <p className="text-sm font-medium mb-2">Preset Color Overlays</p>
        <p className="text-xs text-muted-foreground mb-3">Click a preset to overlay it on {isDark ? 'dark' : 'light'} mode. Click again to remove. Switching modes uses that mode’s own overlay.</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {PRESET_THEMES.map(theme => {
            const isActive = activeThemeId === theme.id
            return (
              <button
                key={theme.id}
                onClick={() => onApplyTheme(isActive ? null : theme.id)}
                className={`relative flex flex-col items-center gap-1.5 p-2 rounded-lg border-2 transition-all ${
                  isActive
                    ? 'border-primary ring-2 ring-primary/30 bg-primary/5 scale-[1.02]'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                }`}
                title={isActive ? `Active: ${theme.name} — click to deselect` : `Apply ${theme.name}`}
              >
                {/* Color preview circles */}
                <div className="flex gap-1">
                  {theme.preview?.map((color, i) => (
                    <span
                      key={i}
                      className="w-4 h-4 rounded-full border border-border/50"
                      style={{ backgroundColor: `hsl(${color})` }}
                    />
                  )) || (
                    <>
                      <span className="w-4 h-4 rounded-full border border-border/50" style={{ backgroundColor: `hsl(${theme.colors.primary})` }} />
                      <span className="w-4 h-4 rounded-full border border-border/50" style={{ backgroundColor: `hsl(${theme.colors.accent})` }} />
                      <span className="w-4 h-4 rounded-full border border-border/50" style={{ backgroundColor: `hsl(${theme.colors.background})` }} />
                    </>
                  )}
                </div>
                <span className="text-xs font-medium truncate w-full text-center">{theme.name}</span>
                {isActive && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-xs">
                    <Check className="w-3 h-3" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Custom Theme Slots (always visible) ───────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Your Custom Overlays</p>
          <span className="text-xs text-muted-foreground">
            {customThemes.length} / {MAX_CUSTOM_THEMES} slots used
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Save up to {MAX_CUSTOM_THEMES} custom color palettes. Each overlay applies only to the currently active mode ({isDark ? 'dark' : 'light'}).
        </p>

        <div className="grid grid-cols-3 gap-3">
          {slots.map((theme, slotIndex) => {
            if (theme) {
              // ── Filled slot ──
              const isActive = activeThemeId === theme.id
              const isRenaming = renamingId === theme.id
              return (
                <div
                  key={theme.id}
                  className={`relative flex flex-col rounded-lg border-2 transition-all overflow-hidden ${
                    isActive
                      ? 'border-primary ring-2 ring-primary/30 scale-[1.02]'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  {/* Clickable preview */}
                  <button
                    onClick={() => onApplyTheme(isActive ? null : theme.id)}
                    className="flex flex-col items-center gap-2 p-3 w-full hover:bg-muted/30 transition-colors"
                    title={isActive ? `Active: ${theme.name} — click to deselect` : `Apply "${theme.name}"`}
                  >
                    {/* Color swatch bar */}
                    <div className="flex w-full h-6 rounded overflow-hidden border border-border/30">
                      <span className="flex-1" style={{ backgroundColor: `hsl(${theme.colors.background})` }} />
                      <span className="flex-1" style={{ backgroundColor: `hsl(${theme.colors.primary})` }} />
                      <span className="flex-1" style={{ backgroundColor: `hsl(${theme.colors.accent})` }} />
                      <span className="flex-1" style={{ backgroundColor: `hsl(${theme.colors.secondary})` }} />
                      <span className="flex-1" style={{ backgroundColor: `hsl(${theme.colors.border})` }} />
                    </div>
                    {/* Theme name */}
                    {isRenaming ? (
                      <input
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            onSaveCustomTheme({ ...theme, name: renameValue.trim() || theme.name })
                            setRenamingId(null)
                          }
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        onBlur={() => {
                          onSaveCustomTheme({ ...theme, name: renameValue.trim() || theme.name })
                          setRenamingId(null)
                        }}
                        onClick={e => e.stopPropagation()}
                        autoFocus
                        className="text-xs w-full text-center bg-transparent border-b border-primary outline-hidden py-0.5"
                      />
                    ) : (
                      <span className="text-xs font-medium truncate w-full text-center">{theme.name}</span>
                    )}
                  </button>
                  {/* Active badge */}
                  {isActive && (
                    <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-xs">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                  {/* Action buttons bar */}
                  <div className="flex border-t border-border divide-x divide-border">
                    <Button
                      emphasis="ghost"
                      size="compact"
                      onClick={() => startEdit(theme)}
                      className="flex-1"
                      title="Edit colors"
                      icon={<Pencil className="w-3 h-3" />}
                    >
                      Edit
                    </Button>
                    <Button
                      emphasis="ghost"
                      size="compact"
                      onClick={() => { setRenamingId(theme.id); setRenameValue(theme.name) }}
                      className="flex-1"
                      title="Rename"
                      icon={<span className="text-xs font-bold">A</span>}
                    >
                      Name
                    </Button>
                    <Button
                      emphasis="ghost"
                      intent="danger"
                      size="compact"
                      onClick={() => onDeleteCustomTheme(theme.id)}
                      className="flex-1"
                      title="Delete this theme to free up the slot"
                      icon={<Trash2 className="w-3 h-3" />}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )
            }

            // ── Empty slot ──
            return (
              <button
                key={`empty-${slotIndex}`}
                onClick={canCreateMore && !isCreating ? startCreate : undefined}
                disabled={isCreating}
                className={`flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed transition-all ${
                  isCreating
                    ? 'border-border/50 opacity-50 cursor-not-allowed'
                    : 'border-border hover:border-primary/50 hover:bg-muted/30 cursor-pointer'
                }`}
                title="Create a custom theme in this slot"
              >
                <Plus className="w-5 h-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Empty Slot</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Reset to Default ──────────────────────────────────── */}
      {activeThemeId && !isCreating && (
        <Button
          emphasis="outline"
          onClick={() => onApplyTheme(null)}
          icon={<RotateCcw className="w-4 h-4" />}
        >
          Reset to Default Colors ({isDark ? 'Dark' : 'Light'} mode)
        </Button>
      )}

      {/* ── Theme Editor ──────────────────────────────────────── */}
      {isCreating && (
        <div className="border-2 border-primary/30 rounded-lg p-4 bg-card space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-primary" />
              <h4 className="font-medium">{editingTheme ? `Editing: ${editingTheme.name}` : 'Create Custom Theme'}</h4>
            </div>
            <span className="text-xs text-muted-foreground px-2 py-1 bg-muted rounded">
              {editingTheme ? 'Updating existing' : `Slot ${customThemes.length + 1} of ${MAX_CUSTOM_THEMES}`}
            </span>
          </div>

          {/* Theme name */}
          <div>
            <label className="text-sm font-medium block mb-1">Theme Name</label>
            <input
              type="text"
              value={themeName}
              onChange={e => setThemeName(e.target.value)}
              placeholder={`Custom Theme ${customThemes.length + 1}`}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:ring-2 focus:ring-ring outline-hidden"
            />
          </div>

          {/* Start from preset */}
          {!editingTheme && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Start from a preset:</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_THEMES.map(p => (
                  <Button
                    key={p.id}
                    emphasis="outline"
                    size="micro"
                    onClick={() => startFromPreset(p)}
                    icon={<span className="w-3 h-3 rounded-full" style={{ backgroundColor: `hsl(${p.colors.primary})` }} />}
                  >
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Color groups (accordion) */}
          <div className="space-y-1">
            {COLOR_GROUPS.map(group => {
              const isExpanded = expandedGroup === group.label
              return (
                <Disclosure
                  key={group.label}
                  className="border border-border rounded-lg overflow-hidden"
                  title={group.label}
                  description={group.description}
                  expanded={isExpanded}
                  onToggle={next => setExpandedGroup(next ? group.label : null)}
                  panelClassName="px-3 py-3 space-y-3 bg-card"
                  trailing={
                    /* Mini preview of group colors */
                    <span className="flex gap-0.5 mr-2">
                      {group.keys.map(key => (
                        <span
                          key={key}
                          className="w-3 h-3 rounded-full border border-border/50"
                          style={{ backgroundColor: `hsl(${editColors[key]})` }}
                        />
                      ))}
                    </span>
                  }
                >
                      {group.keys.map(key => (
                        <div key={key} className="flex items-center gap-3">
                          <label
                            htmlFor={`color-${key}`}
                            className="text-sm text-muted-foreground w-32 shrink-0"
                          >
                            {COLOR_LABELS[key]}
                          </label>
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              id={`color-${key}`}
                              type="color"
                              value={hslToHex(editColors[key])}
                              onChange={e => updateColor(key, e.target.value)}
                              className="w-8 h-8 rounded cursor-pointer border border-border bg-transparent"
                            />
                            <span
                              className="w-8 h-8 rounded border border-border/50"
                              style={{ backgroundColor: `hsl(${editColors[key]})` }}
                            />
                            <input
                              type="text"
                              value={hslToHex(editColors[key])}
                              onChange={e => {
                                const v = e.target.value
                                if (/^#[0-9a-fA-F]{6}$/.test(v)) updateColor(key, v)
                              }}
                              className="w-24 px-2 py-1 text-xs font-mono border border-input rounded bg-background text-foreground"
                              placeholder="#000000"
                            />
                          </div>
                        </div>
                      ))}
                </Disclosure>
              )
            })}
          </div>

          {/* Live preview */}
          <div>
            <p className="text-sm font-medium mb-2">Preview</p>
            <div
              className="rounded-lg border overflow-hidden"
              style={{
                backgroundColor: `hsl(${editColors.background})`,
                borderColor: `hsl(${editColors.border})`,
                color: `hsl(${editColors.foreground})`,
              }}
            >
              <div
                className="px-4 py-2 text-sm font-medium flex items-center justify-between"
                style={{ borderBottom: `1px solid hsl(${editColors.border})` }}
              >
                <span>Preview Window</span>
                <span style={{ color: `hsl(${editColors.mutedForeground})` }} className="text-xs">
                  Muted text
                </span>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <button
                    className="px-3 py-1.5 rounded-lg text-sm font-medium"
                    style={{
                      backgroundColor: `hsl(${editColors.primary})`,
                      color: `hsl(${editColors.primaryForeground})`,
                    }}
                  >
                    Primary Button
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-lg text-sm font-medium"
                    style={{
                      backgroundColor: `hsl(${editColors.secondary})`,
                      color: `hsl(${editColors.secondaryForeground})`,
                    }}
                  >
                    Secondary
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-lg text-sm font-medium"
                    style={{
                      backgroundColor: `hsl(${editColors.accent})`,
                      color: `hsl(${editColors.accentForeground})`,
                    }}
                  >
                    Accent
                  </button>
                </div>
                <div
                  className="p-2 rounded text-sm"
                  style={{
                    backgroundColor: `hsl(${editColors.muted})`,
                    color: `hsl(${editColors.mutedForeground})`,
                  }}
                >
                  Muted background with muted text
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Palette className="w-4 h-4" style={{ color: `hsl(${editColors.icon})` }} />
                  <span style={{ color: `hsl(${editColors.icon})` }}>Icon color sample</span>
                  <span
                    className="ml-auto w-16 h-2 rounded-full"
                    style={{
                      backgroundColor: `hsl(${editColors.ring})`,
                    }}
                  />
                  <span className="text-xs" style={{ color: `hsl(${editColors.mutedForeground})` }}>Ring</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-2 border-t border-border">
            <Button intent="primary" onClick={handleSave} icon={<Save className="w-4 h-4" />}>
              {editingTheme ? 'Update Theme' : 'Save Theme'}
            </Button>
            <Button emphasis="outline" onClick={handleReset} icon={<RotateCcw className="w-4 h-4" />}>
              Reset to Defaults
            </Button>
            <Button emphasis="ghost" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
