import { DEFAULT_DARK, DEFAULT_LIGHT, PRESET_THEMES, type ThemeColors } from '../../../web/src/lib/theme-types'

export interface CatalogPreviewTheme {
  id: string
  name: string
  dark: boolean
  colors?: ThemeColors
}

export const CATALOG_PREVIEW_THEMES: CatalogPreviewTheme[] = [
  { id: 'default-light', name: 'Light', dark: false, colors: DEFAULT_LIGHT },
  { id: 'default-dark', name: 'Dark', dark: true, colors: DEFAULT_DARK },
  ...PRESET_THEMES.map(theme => ({
    id: theme.id,
    name: theme.name,
    dark: true,
    colors: theme.colors,
  })),
]

interface ThemeComparisonChecklistProps {
  selectedThemeIds: Set<string>
  onToggleTheme: (themeId: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
}

export function ThemeComparisonChecklist({
  selectedThemeIds,
  onToggleTheme,
  onSelectAll,
  onDeselectAll,
}: ThemeComparisonChecklistProps) {
  return (
    <fieldset className="not-prose mb-5 rounded-lg border border-surface-700 bg-surface-800/40 px-3 py-2.5">
      <legend className="px-1 text-xs font-semibold text-gray-200">Preview themes</legend>
      <div className="mb-2 flex items-center gap-3 text-[11px]">
        <button type="button" onClick={onSelectAll} className="font-medium text-brand-400 hover:text-brand-300 hover:underline">
          Select all
        </button>
        <button type="button" onClick={onDeselectAll} className="font-medium text-gray-400 hover:text-gray-200 hover:underline">
          Deselect all
        </button>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {CATALOG_PREVIEW_THEMES.map(theme => (
          <label key={theme.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={selectedThemeIds.has(theme.id)}
              onChange={() => onToggleTheme(theme.id)}
              className="h-3.5 w-3.5 rounded border-surface-600 bg-surface-900 text-brand-500 focus:ring-2 focus:ring-brand-500/40"
            />
            {theme.name}
          </label>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-gray-500">
        Theme previews change primary and structural colors; semantic outcome colors remain fixed.
      </p>
    </fieldset>
  )
}