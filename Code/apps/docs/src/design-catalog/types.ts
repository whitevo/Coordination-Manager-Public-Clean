import type { ReactNode } from 'react'

/** Top-level grouping in the catalog. */
export type CatalogCategory =
  | 'Buttons'
  | 'Cards'
  | 'Status'
  | 'Category'
  | 'Count'
  | 'Score'
  | 'Inputs'
  | 'Overlays'
  | 'Panels'
  | 'Disclosure'
  | 'Feedback'
  | 'Data'
  | 'Motion'

/** Legacy input shape accepted while the registry normalizes old badge rows. */
export type LegacyCatalogCategory = CatalogCategory | 'Badges'

/**
 * Where a variant sits relative to the design system:
 * - default: the version to reach for on new work
 * - alt: a legitimate alternative for a specific situation
 * - drift: an inconsistent one-off that should converge to the default
 */
export type CatalogStatus = 'default' | 'alt' | 'drift'

/** Color namespace used by this pattern; motion-only entries use `structural`. */
export type CatalogNamespace = 'structural' | 'semantic' | 'feature' | 'data'

/** Whether the preview mounts the web primitive or is a recipe snapshot. */
export type CatalogPreviewSource = 'primitive' | 'recipe snapshot' | 'target only'

export interface CatalogEntry {
  /** Stable unique id, e.g. 'button.primary-token'. */
  id: string
  /** Logical concept slug shared by all variants, e.g. 'primary-button'. */
  concept: string
  /** Human label for the concept, e.g. 'Primary Button'. */
  conceptLabel: string
  category: CatalogCategory
  /** Variant name, e.g. 'Token primary'. */
  name: string
  status: CatalogStatus
  namespace: CatalogNamespace
  previewSource: CatalogPreviewSource
  /** What should replace a drifted recipe. */
  migration?: string
  /** Signature color meaning, e.g. 'blue', 'purple', or null if token-neutral. */
  color?: string
  /** The class recipe shown as code (display only). */
  recipe: string
  /** Real pages/components that use this variant. */
  usedOn: string[]
  /** Free-text tags for search. */
  tags: string[]
  /** One-line note about when to use / why it drifts. */
  note?: string
  /** Live, interactive render of the variant. */
  render: () => ReactNode
}
