import { Router, Response } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { sanitizeString, sanitizeUUID, safeExternalErrorMessage } from '../middleware/validation.js'

const router: ReturnType<typeof Router> = Router()

router.use((req, res, next) => authMiddleware(req as AuthenticatedRequest, res, next))

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

const DEFAULT_MAIN_COLOR = '#2563eb'
const DEFAULT_MAIN_LABEL = 'Coordination Manager Main'
const DEFAULT_MODE_NAME = 'Main'
const DEFAULT_CATEGORY_FONT_COLOR = '#ffffff'
const DEFAULT_CATEGORY_BACKGROUND_OPACITY = 1
const DEFAULT_CATEGORY_ITEM_OPACITY = 1
const DEFAULT_CATEGORY_COLOR_DISPLAY_STYLE = 'horizontal'
const SORT_ORDER_MIN = -10000
const SORT_ORDER_MAX = 10000
const MAX_MODE_COUNT = 3
const TIME_MANAGER_STORAGE_UNAVAILABLE = 'Time Manager storage is temporarily unavailable. Please try again later.'

function timeManagerStorageError(error: unknown): string {
  return safeExternalErrorMessage(error, TIME_MANAGER_STORAGE_UNAVAILABLE)
}

type ExternalCalendarKind = 'google_oauth' | 'google_public_url'
type CategoryColorDisplayStyle = 'horizontal' | 'vertical_left' | 'vertical_right'

interface ModeSyncCalendar {
  id: string
  enabled: boolean
  sourceType?: 'external'
  externalKind?: ExternalCalendarKind
  displayName?: string
  secondaryLabel?: string
}

interface ModeTimeBackground {
  id: string
  label: string
  startMinute: number
  endMinute: number
  color: string
  opacity: number
}

interface ModeQuickTemplate {
  id: string
  quickName: string
  title: string
  notes: string
  categoryIds: string[]
  autoSaveEnabled?: boolean
  sourceItemId: string
  createdAt: string
}

interface ImportedCategory {
  label: string
  color: string
  fontColor: string
  sortOrder: number
}

interface ImportedModePayload {
  name: string
  mainColor: string
  slotMinutes: 15 | 30 | 60
  categoryColorDisplayStyle: CategoryColorDisplayStyle
  syncCalendars: ModeSyncCalendar[]
  timeBackgrounds: ModeTimeBackground[]
  collapsedBackgroundIds: string[]
  quickTemplates: ModeQuickTemplate[]
  showQuickTemplatesInMain: boolean
  categories: ImportedCategory[]
}

interface TimeManagementModeRow {
  id: string
  user_id: string
  name: string
  main_color: string
  slot_minutes: number
  category_color_display_style?: CategoryColorDisplayStyle
  sync_calendars: ModeSyncCalendar[]
  time_backgrounds: ModeTimeBackground[]
  collapsed_background_ids: string[]
  quick_templates: ModeQuickTemplate[]
  show_quick_templates_in_main: boolean
  created_at: string
  updated_at: string
}

function parseSortOrder(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return null
  if (parsed < SORT_ORDER_MIN || parsed > SORT_ORDER_MAX) return null
  return parsed
}

function sanitizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return HEX_COLOR_RE.test(trimmed) ? trimmed : fallback
}

function parseBackgroundOpacity(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed < 0 || parsed > 1) return null
  return parsed
}

function parseItemOpacity(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed < 0 || parsed > 1) return null
  return parsed
}

function isTimeWidth(value: unknown): value is 15 | 30 | 60 {
  return value === 15 || value === 30 || value === 60
}

function sanitizeModeName(value: unknown, fallback = DEFAULT_MODE_NAME): string {
  return sanitizeString(value, 80) || fallback
}

function parseMinute(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1440) return fallback
  return parsed
}

function parseOpacity(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0.18
  return Math.min(1, Math.max(0, parsed))
}

function normalizeCategoryColorDisplayStyle(value: unknown): CategoryColorDisplayStyle {
  if (value === 'vertical_left' || value === 'vertical_right') {
    return value
  }
  return DEFAULT_CATEGORY_COLOR_DISPLAY_STYLE
}

function normalizeModeSyncCalendars(value: unknown): ModeSyncCalendar[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const normalized: ModeSyncCalendar[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    normalized.push({
      id,
      enabled: candidate.enabled !== false,
      sourceType: candidate.sourceType === 'external' ? 'external' : undefined,
      externalKind: candidate.externalKind === 'google_oauth' || candidate.externalKind === 'google_public_url'
        ? candidate.externalKind
        : undefined,
      displayName: sanitizeString(candidate.displayName, 120) || undefined,
      secondaryLabel: sanitizeString(candidate.secondaryLabel, 160) || undefined,
    })
    if (normalized.length >= 50) break
  }
  return normalized
}

function normalizeModeTimeBackgrounds(value: unknown): ModeTimeBackground[] {
  if (!Array.isArray(value)) return []

  const normalized: ModeTimeBackground[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : ''
    if (!id) continue
    normalized.push({
      id,
      label: sanitizeString(candidate.label, 120) || '',
      startMinute: parseMinute(candidate.startMinute, 12 * 60),
      endMinute: parseMinute(candidate.endMinute, 20 * 60),
      color: sanitizeHexColor(candidate.color, '#0ea5e9'),
      opacity: parseOpacity(candidate.opacity),
    })
    if (normalized.length >= 50) break
  }
  return normalized
}

function normalizeCollapsedBackgroundIds(value: unknown, backgrounds: ModeTimeBackground[]): string[] {
  if (!Array.isArray(value)) return []
  const validIds = new Set(backgrounds.map((background) => background.id))
  const collapsed = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed || !validIds.has(trimmed)) continue
    collapsed.add(trimmed)
  }
  return Array.from(collapsed)
}

function normalizeCategoryIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  for (const entry of value) {
    const id = sanitizeUUID(entry)
    if (id) ids.add(id)
    if (ids.size >= 20) break
  }
  return Array.from(ids)
}

function sanitizeTemplateQuickNamePreserveWhitespace(value: unknown): string {
  if (typeof value !== 'string') return 'Quick template'
  const sliced = value.slice(0, 80)
  return sliced.length > 0 ? sliced : 'Quick template'
}

function normalizeQuickTemplates(value: unknown): ModeQuickTemplate[] {
  if (!Array.isArray(value)) return []

  const normalized: ModeQuickTemplate[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : ''
    if (!id) continue
    normalized.push({
      id,
      quickName: sanitizeTemplateQuickNamePreserveWhitespace(candidate.quickName),
      title: sanitizeString(candidate.title, 200) || 'Untitled item',
      notes: sanitizeString(candidate.notes, 5000) || '',
      categoryIds: normalizeCategoryIdArray(candidate.categoryIds),
      autoSaveEnabled: candidate.autoSaveEnabled === true,
      sourceItemId: sanitizeString(candidate.sourceItemId, 80) || '',
      createdAt: typeof candidate.createdAt === 'string' && candidate.createdAt.trim() ? candidate.createdAt.trim() : new Date().toISOString(),
    })
    if (normalized.length >= 100) break
  }
  return normalized
}

function normalizeImportedCategories(value: unknown): ImportedCategory[] {
  if (!Array.isArray(value)) return []

  const seenLabels = new Set<string>()
  const categories: ImportedCategory[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const label = sanitizeString(candidate.label, 80)
    if (!label) continue
    const key = label.toLowerCase()
    if (seenLabels.has(key)) continue
    seenLabels.add(key)
    const fontColorRaw = candidate.fontColor !== undefined ? candidate.fontColor : candidate.font_color
    const sortOrderRaw = candidate.sortOrder !== undefined ? candidate.sortOrder : candidate.sort_order
    categories.push({
      label,
      color: sanitizeHexColor(candidate.color, DEFAULT_MAIN_COLOR),
      fontColor: sanitizeHexColor(fontColorRaw, DEFAULT_CATEGORY_FONT_COLOR),
      sortOrder: parseSortOrder(sortOrderRaw) ?? 0,
    })
    if (categories.length >= 100) break
  }
  return categories
}

function normalizeImportedModePayload(value: unknown, fallbackName?: string): ImportedModePayload | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const pick = (camel: string, snake: string): unknown =>
    candidate[camel] !== undefined ? candidate[camel] : candidate[snake]
  const timeBackgrounds = normalizeModeTimeBackgrounds(pick('timeBackgrounds', 'time_backgrounds'))
  const showQuickTemplatesInMainRaw = pick('showQuickTemplatesInMain', 'show_quick_templates_in_main')
  return {
    name: sanitizeModeName(candidate.name, fallbackName || DEFAULT_MODE_NAME),
    mainColor: sanitizeHexColor(pick('mainColor', 'main_color'), DEFAULT_MAIN_COLOR),
    slotMinutes: isTimeWidth(pick('slotMinutes', 'slot_minutes')) ? (pick('slotMinutes', 'slot_minutes') as 15 | 30 | 60) : 30,
    categoryColorDisplayStyle: normalizeCategoryColorDisplayStyle(
      pick('categoryColorDisplayStyle', 'category_color_display_style')
    ),
    syncCalendars: normalizeModeSyncCalendars(pick('syncCalendars', 'sync_calendars')),
    timeBackgrounds,
    collapsedBackgroundIds: normalizeCollapsedBackgroundIds(pick('collapsedBackgroundIds', 'collapsed_background_ids'), timeBackgrounds),
    quickTemplates: normalizeQuickTemplates(pick('quickTemplates', 'quick_templates')),
    showQuickTemplatesInMain: showQuickTemplatesInMainRaw === true,
    categories: normalizeImportedCategories(candidate.categories),
  }
}

async function ensureDefaultMode(userId: string): Promise<{ modes: TimeManagementModeRow[]; activeModeId: string }> {
  const { data: existingModes, error: modeError } = await supabaseAdmin
    .from('time_management_modes')
    .select('id, user_id, name, main_color, slot_minutes, category_color_display_style, sync_calendars, time_backgrounds, collapsed_background_ids, quick_templates, show_quick_templates_in_main, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (modeError) throw modeError

  let modes = (existingModes || []) as TimeManagementModeRow[]

  if (modes.length === 0) {
    const { data: prefs, error: prefsError } = await supabaseAdmin
      .from('time_management_prefs')
      .select('main_color, main_label, active_mode_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (prefsError) throw prefsError

    const defaultName = prefs?.main_label && prefs.main_label !== DEFAULT_MAIN_LABEL
      ? prefs.main_label
      : DEFAULT_MODE_NAME

    const { data: createdMode, error: createError } = await supabaseAdmin
      .from('time_management_modes')
      .insert({
        user_id: userId,
        name: sanitizeModeName(defaultName, DEFAULT_MODE_NAME),
        main_color: sanitizeHexColor(prefs?.main_color, DEFAULT_MAIN_COLOR),
        slot_minutes: 30,
        category_color_display_style: DEFAULT_CATEGORY_COLOR_DISPLAY_STYLE,
        sync_calendars: [],
        time_backgrounds: [],
        collapsed_background_ids: [],
        quick_templates: [],
        show_quick_templates_in_main: false,
      })
      .select('id, user_id, name, main_color, slot_minutes, category_color_display_style, sync_calendars, time_backgrounds, collapsed_background_ids, quick_templates, show_quick_templates_in_main, created_at, updated_at')
      .single()

    if (createError) throw createError

    modes = createdMode ? [createdMode as TimeManagementModeRow] : []

    await supabaseAdmin
      .from('user_events')
      .update({ source_id: createdMode.id, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('source_type', 'manual')
      .or('source_id.is.null,source_id.eq.')
  }

  if (modes.length === 0) {
    throw new Error('Failed to ensure a default time-management mode')
  }

  const { data: prefs, error: activePrefError } = await supabaseAdmin
    .from('time_management_prefs')
    .select('active_mode_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (activePrefError) throw activePrefError

  const activeModeId = typeof prefs?.active_mode_id === 'string' && modes.some((mode) => mode.id === prefs.active_mode_id)
    ? prefs.active_mode_id
    : modes[0].id

  if (prefs?.active_mode_id !== activeModeId) {
    const { error: upsertError } = await supabaseAdmin
      .from('time_management_prefs')
      .upsert({ user_id: userId, active_mode_id: activeModeId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (upsertError) throw upsertError
  }

  return { modes, activeModeId }
}

async function resolveActiveModeId(userId: string): Promise<string> {
  const { activeModeId } = await ensureDefaultMode(userId)
  return activeModeId
}

async function attachImportedCategories(userId: string, modeId: string, categories: ImportedCategory[]): Promise<number> {
  if (categories.length === 0) return 0

  const { data: existingCategories, error: existingError } = await supabaseAdmin
    .from('time_management_categories')
    .select('label')
    .eq('user_id', userId)
    .eq('mode_id', modeId)

  if (existingError) throw existingError

  const existingLabels = new Set((existingCategories || []).map((category) => String(category.label).toLowerCase()))
  const rowsToInsert = categories
    .filter((category) => !existingLabels.has(category.label.toLowerCase()))
    .map((category) => ({
      user_id: userId,
      mode_id: modeId,
      label: category.label,
      color: category.color,
      font_color: category.fontColor,
      sort_order: category.sortOrder,
    }))

  if (rowsToInsert.length === 0) return 0

  const { error: insertError } = await supabaseAdmin
    .from('time_management_categories')
    .insert(rowsToInsert)

  if (insertError) throw insertError
  return rowsToInsert.length
}

function buildManualEventSignature(event: {
  title: string | null
  description: string | null
  meeting_link: string | null
  location: string | null
  start_time: string
  end_time: string
  category_ids: string[] | null
}): string {
  const categoryIds = Array.isArray(event.category_ids) ? [...event.category_ids].sort() : []
  return JSON.stringify({
    title: event.title || '',
    description: event.description || '',
    meetingLink: event.meeting_link || '',
    location: event.location || '',
    startTime: event.start_time,
    endTime: event.end_time,
    categoryIds,
  })
}

async function insertModeWithUniqueName(
  userId: string,
  payload: ImportedModePayload
): Promise<{ data: TimeManagementModeRow | null; error: { code?: string; message: string } | null }> {
  const baseName = sanitizeModeName(payload.name, DEFAULT_MODE_NAME)
  const MAX_SUFFIX_ATTEMPTS = 50

  for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const candidateName = attempt === 0 ? baseName : sanitizeModeName(`${baseName} (${attempt + 1})`, baseName)
    const { data, error } = await supabaseAdmin
      .from('time_management_modes')
      .insert({
        user_id: userId,
        name: candidateName,
        main_color: payload.mainColor,
        slot_minutes: payload.slotMinutes,
        category_color_display_style: payload.categoryColorDisplayStyle,
        sync_calendars: payload.syncCalendars,
        time_backgrounds: payload.timeBackgrounds,
        collapsed_background_ids: payload.collapsedBackgroundIds,
        quick_templates: payload.quickTemplates,
        show_quick_templates_in_main: payload.showQuickTemplatesInMain,
      })
      .select('id, user_id, name, main_color, slot_minutes, category_color_display_style, sync_calendars, time_backgrounds, collapsed_background_ids, quick_templates, show_quick_templates_in_main, created_at, updated_at')
      .single()

    if (!error) {
      return { data: data as TimeManagementModeRow, error: null }
    }
    if (error.code !== '23505') {
      return { data: null, error }
    }
  }

  return { data: null, error: { code: '23505', message: 'A mode with this name already exists' } }
}

// ─── Modes ─────────────────────────────────────────────────

router.get('/modes', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })
    const result = await ensureDefaultMode(req.userId)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

router.post('/modes', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })
    const { modes } = await ensureDefaultMode(req.userId)
    if (modes.length >= MAX_MODE_COUNT) {
      return res.status(400).json({ error: `You can create up to ${MAX_MODE_COUNT} modes.` })
    }

    const imported = normalizeImportedModePayload(req.body?.importMode, req.body?.name)
    const nextName = sanitizeModeName(req.body?.name, `Mode ${modes.length + 1}`)
    const payload = imported || {
      name: nextName,
      mainColor: DEFAULT_MAIN_COLOR,
      slotMinutes: 30 as const,
      categoryColorDisplayStyle: DEFAULT_CATEGORY_COLOR_DISPLAY_STYLE,
      syncCalendars: [],
      timeBackgrounds: [],
      collapsedBackgroundIds: [],
      quickTemplates: [],
      showQuickTemplatesInMain: false,
      categories: [],
    }

    const { data: createdMode, error: createError } = await insertModeWithUniqueName(req.userId, payload)

    if (createError || !createdMode) {
      if (createError?.code === '23505') {
        return res.status(409).json({ error: 'A mode with this name already exists' })
      }
      return res.status(400).json({ error: createError ? timeManagerStorageError(createError) : 'Failed to create mode' })
    }

    const createdCategories = await attachImportedCategories(req.userId, createdMode.id, payload.categories)

    const { error: prefError } = await supabaseAdmin
      .from('time_management_prefs')
      .upsert({ user_id: req.userId, active_mode_id: createdMode.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

    if (prefError) return res.status(400).json({ error: timeManagerStorageError(prefError) })

    res.status(201).json({ mode: createdMode, activeModeId: createdMode.id, createdCategories })
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

router.put('/modes/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = sanitizeUUID(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid mode id' })

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (req.body?.name !== undefined) {
      const name = sanitizeString(req.body.name, 80)
      if (!name) return res.status(400).json({ error: 'name must be 1-80 chars' })
      updates.name = name
    }
    if (req.body?.main_color !== undefined) {
      if (typeof req.body.main_color !== 'string' || !HEX_COLOR_RE.test(req.body.main_color.trim())) {
        return res.status(400).json({ error: 'main_color must be a #RRGGBB hex string' })
      }
      updates.main_color = req.body.main_color.trim()
    }
    if (req.body?.slot_minutes !== undefined) {
      if (!isTimeWidth(req.body.slot_minutes)) {
        return res.status(400).json({ error: 'slot_minutes must be 15, 30, or 60' })
      }
      updates.slot_minutes = req.body.slot_minutes
    }
    if (req.body?.sync_calendars !== undefined) {
      updates.sync_calendars = normalizeModeSyncCalendars(req.body.sync_calendars)
    }
    if (req.body?.time_backgrounds !== undefined) {
      const timeBackgrounds = normalizeModeTimeBackgrounds(req.body.time_backgrounds)
      if (timeBackgrounds.length === 0) {
        const { data: currentMode, error: currentModeError } = await supabaseAdmin
          .from('time_management_modes')
          .select('time_backgrounds')
          .eq('id', id)
          .eq('user_id', req.userId)
          .maybeSingle()
        if (currentModeError) return res.status(400).json({ error: timeManagerStorageError(currentModeError) })
        const hasCurrentBackgrounds = normalizeModeTimeBackgrounds(currentMode?.time_backgrounds).length > 0
        const allowEmptyBackgrounds = req.body?.clear_time_backgrounds === true
        if (hasCurrentBackgrounds && !allowEmptyBackgrounds) {
          return res.status(400).json({ error: 'Refusing to clear time_backgrounds without clear_time_backgrounds=true' })
        }
      }
      updates.time_backgrounds = timeBackgrounds
      updates.collapsed_background_ids = normalizeCollapsedBackgroundIds(req.body.collapsed_background_ids, timeBackgrounds)
    } else if (req.body?.collapsed_background_ids !== undefined) {
      const { data: currentMode, error: currentModeError } = await supabaseAdmin
        .from('time_management_modes')
        .select('time_backgrounds')
        .eq('id', id)
        .eq('user_id', req.userId)
        .maybeSingle()
      if (currentModeError) return res.status(400).json({ error: timeManagerStorageError(currentModeError) })
      const timeBackgrounds = normalizeModeTimeBackgrounds(currentMode?.time_backgrounds)
      updates.collapsed_background_ids = normalizeCollapsedBackgroundIds(req.body.collapsed_background_ids, timeBackgrounds)
    }
    if (req.body?.quick_templates !== undefined) {
      const quickTemplates = normalizeQuickTemplates(req.body.quick_templates)
      if (quickTemplates.length === 0) {
        const { data: currentMode, error: currentModeError } = await supabaseAdmin
          .from('time_management_modes')
          .select('quick_templates')
          .eq('id', id)
          .eq('user_id', req.userId)
          .maybeSingle()
        if (currentModeError) return res.status(400).json({ error: timeManagerStorageError(currentModeError) })
        const hasCurrentQuickTemplates = normalizeQuickTemplates(currentMode?.quick_templates).length > 0
        const allowEmptyQuickTemplates = req.body?.clear_quick_templates === true
        if (hasCurrentQuickTemplates && !allowEmptyQuickTemplates) {
          return res.status(400).json({ error: 'Refusing to clear quick_templates without clear_quick_templates=true' })
        }
      }
      updates.quick_templates = quickTemplates
    }
    if (req.body?.show_quick_templates_in_main !== undefined) {
      updates.show_quick_templates_in_main = req.body.show_quick_templates_in_main !== false
    }
    if (req.body?.category_color_display_style !== undefined) {
      updates.category_color_display_style = normalizeCategoryColorDisplayStyle(req.body.category_color_display_style)
    }

    const { data, error } = await supabaseAdmin
      .from('time_management_modes')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select('id, user_id, name, main_color, slot_minutes, category_color_display_style, sync_calendars, time_backgrounds, collapsed_background_ids, quick_templates, show_quick_templates_in_main, created_at, updated_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A mode with this name already exists' })
      }
      return res.status(400).json({ error: timeManagerStorageError(error) })
    }
    if (!data) return res.status(404).json({ error: 'Mode not found' })
    res.json({ mode: data })
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

router.post('/modes/:id/activate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = sanitizeUUID(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid mode id' })

    const { data: mode, error: modeError } = await supabaseAdmin
      .from('time_management_modes')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.userId)
      .maybeSingle()

    if (modeError) return res.status(400).json({ error: timeManagerStorageError(modeError) })
    if (!mode) return res.status(404).json({ error: 'Mode not found' })

    const { error } = await supabaseAdmin
      .from('time_management_prefs')
      .upsert({ user_id: req.userId, active_mode_id: id, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

    if (error) return res.status(400).json({ error: timeManagerStorageError(error) })
    res.json({ activeModeId: id })
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

router.delete('/modes/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })
    const id = sanitizeUUID(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid mode id' })

    const { modes, activeModeId } = await ensureDefaultMode(req.userId)
    if (modes.length <= 1) {
      return res.status(400).json({ error: 'At least one mode must remain.' })
    }

    const sourceMode = modes.find((mode) => mode.id === id)
    if (!sourceMode) return res.status(404).json({ error: 'Mode not found' })

    const transferToModeId = sanitizeUUID(req.body?.transfer_to_mode_id)
    const deleteItems = req.body?.delete_items === true
    if (transferToModeId && transferToModeId === id) {
      return res.status(400).json({ error: 'Cannot transfer items into the same mode.' })
    }

    const { data: sourceEvents, error: sourceEventsError } = await supabaseAdmin
      .from('user_events')
      .select('id, title, description, meeting_link, location, start_time, end_time, category_ids')
      .eq('user_id', req.userId)
      .eq('source_type', 'manual')
      .eq('source_id', id)

    if (sourceEventsError) return res.status(400).json({ error: timeManagerStorageError(sourceEventsError) })

    const manualEvents = sourceEvents || []
    if (manualEvents.length > 0 && !transferToModeId && !deleteItems) {
      return res.status(409).json({ error: 'Mode still has manual items', itemCount: manualEvents.length })
    }

    let transferredItems = 0
    let deletedItems = 0
    let skippedDuplicates = 0

    if (transferToModeId) {
      const targetMode = modes.find((mode) => mode.id === transferToModeId)
      if (!targetMode) return res.status(404).json({ error: 'Transfer target mode not found' })

      const { data: targetEvents, error: targetEventsError } = await supabaseAdmin
        .from('user_events')
        .select('id, title, description, meeting_link, location, start_time, end_time, category_ids')
        .eq('user_id', req.userId)
        .eq('source_type', 'manual')
        .eq('source_id', transferToModeId)

      if (targetEventsError) return res.status(400).json({ error: timeManagerStorageError(targetEventsError) })

      const targetSignatures = new Set((targetEvents || []).map(buildManualEventSignature))
      for (const event of manualEvents) {
        const signature = buildManualEventSignature(event)
        if (targetSignatures.has(signature)) {
          skippedDuplicates += 1
          continue
        }

        const { error: updateError } = await supabaseAdmin
          .from('user_events')
          .update({ source_id: transferToModeId, updated_at: new Date().toISOString() })
          .eq('id', event.id)
          .eq('user_id', req.userId)

        if (updateError) return res.status(400).json({ error: timeManagerStorageError(updateError) })
        targetSignatures.add(signature)
        transferredItems += 1
      }
    } else if (deleteItems && manualEvents.length > 0) {
      const { data: deletedRows, error: deleteItemsError } = await supabaseAdmin
        .from('user_events')
        .delete()
        .eq('user_id', req.userId)
        .eq('source_type', 'manual')
        .eq('source_id', id)
        .select('id')

      if (deleteItemsError) return res.status(400).json({ error: timeManagerStorageError(deleteItemsError) })
      deletedItems = deletedRows?.length || 0
    }

    const { error: deleteModeError } = await supabaseAdmin
      .from('time_management_modes')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId)

    if (deleteModeError) return res.status(400).json({ error: timeManagerStorageError(deleteModeError) })

    const nextActiveModeId = activeModeId === id
      ? transferToModeId || modes.find((mode) => mode.id !== id)?.id || null
      : activeModeId

    if (nextActiveModeId) {
      const { error: prefError } = await supabaseAdmin
        .from('time_management_prefs')
        .upsert({ user_id: req.userId, active_mode_id: nextActiveModeId, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (prefError) return res.status(400).json({ error: timeManagerStorageError(prefError) })
    }

    res.json({
      deletedModeId: id,
      activeModeId: nextActiveModeId,
      transferredItems,
      deletedItems,
      skippedDuplicates,
    })
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

// ─── Categories ─────────────────────────────────────────────

router.get('/categories', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })

    let query = supabaseAdmin
      .from('time_management_categories')
      .select('id, mode_id, label, color, font_color, background_opacity, item_opacity, sort_order, created_at, updated_at')
      .eq('user_id', req.userId)

    if (req.query.all_modes === 'true' || req.query.all_modes === '1') {
      // Fetch categories across all modes
    } else if (req.query.mode_id) {
      query = query.eq('mode_id', String(req.query.mode_id))
    } else {
      const activeModeId = await resolveActiveModeId(req.userId)
      query = query.eq('mode_id', activeModeId)
    }

    const { data, error } = await query
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) return res.status(400).json({ error: timeManagerStorageError(error) })
    res.json({ categories: data || [] })
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

router.post('/categories', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })
    const activeModeId = await resolveActiveModeId(req.userId)

    const label = sanitizeString(req.body?.label, 80)
    if (!label) {
      return res.status(400).json({ error: 'label is required (1-80 chars)' })
    }
    const color = sanitizeHexColor(req.body?.color, DEFAULT_MAIN_COLOR)
    const fontColor = sanitizeHexColor(req.body?.font_color, DEFAULT_CATEGORY_FONT_COLOR)
    const backgroundOpacity = req.body?.background_opacity === undefined
      ? DEFAULT_CATEGORY_BACKGROUND_OPACITY
      : parseBackgroundOpacity(req.body.background_opacity)
    if (backgroundOpacity === null) {
      return res.status(400).json({ error: 'background_opacity must be a number between 0 and 1' })
    }
    const itemOpacity = req.body?.item_opacity === undefined
      ? DEFAULT_CATEGORY_ITEM_OPACITY
      : parseItemOpacity(req.body.item_opacity)
    if (itemOpacity === null) {
      return res.status(400).json({ error: 'item_opacity must be a number between 0 and 1' })
    }
    const sortOrder =
      req.body?.sort_order === undefined ? 0 : parseSortOrder(req.body.sort_order)
    if (sortOrder === null) {
      return res.status(400).json({
        error: `sort_order must be an integer between ${SORT_ORDER_MIN} and ${SORT_ORDER_MAX}`,
      })
    }

    const { data, error } = await supabaseAdmin
      .from('time_management_categories')
      .insert({
        user_id: req.userId,
        mode_id: activeModeId,
        label,
        color,
        font_color: fontColor,
        background_opacity: backgroundOpacity,
        item_opacity: itemOpacity,
        sort_order: sortOrder,
      })
      .select('id, label, color, font_color, background_opacity, item_opacity, sort_order, created_at, updated_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A category with this label already exists' })
      }
      return res.status(400).json({ error: timeManagerStorageError(error) })
    }
    res.status(201).json({ category: data })
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

router.put('/categories/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })
    const activeModeId = await resolveActiveModeId(req.userId)

    const id = sanitizeUUID(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid category id' })

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (req.body?.label !== undefined) {
      const label = sanitizeString(req.body.label, 80)
      if (!label) return res.status(400).json({ error: 'label must be 1-80 chars' })
      updates.label = label
    }
    if (req.body?.color !== undefined) {
      if (typeof req.body.color !== 'string' || !HEX_COLOR_RE.test(req.body.color.trim())) {
        return res.status(400).json({ error: 'color must be a #RRGGBB hex string' })
      }
      updates.color = req.body.color.trim()
    }
    if (req.body?.font_color !== undefined) {
      if (typeof req.body.font_color !== 'string' || !HEX_COLOR_RE.test(req.body.font_color.trim())) {
        return res.status(400).json({ error: 'font_color must be a #RRGGBB hex string' })
      }
      updates.font_color = req.body.font_color.trim()
    }
    if (req.body?.background_opacity !== undefined) {
      const opacity = parseBackgroundOpacity(req.body.background_opacity)
      if (opacity === null) {
        return res.status(400).json({ error: 'background_opacity must be a number between 0 and 1' })
      }
      updates.background_opacity = opacity
    }
    if (req.body?.item_opacity !== undefined) {
      const opacity = parseItemOpacity(req.body.item_opacity)
      if (opacity === null) {
        return res.status(400).json({ error: 'item_opacity must be a number between 0 and 1' })
      }
      updates.item_opacity = opacity
    }
    if (req.body?.sort_order !== undefined) {
      const n = parseSortOrder(req.body.sort_order)
      if (n === null) {
        return res.status(400).json({
          error: `sort_order must be an integer between ${SORT_ORDER_MIN} and ${SORT_ORDER_MAX}`,
        })
      }
      updates.sort_order = n
    }

    const { data, error } = await supabaseAdmin
      .from('time_management_categories')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.userId)
      .eq('mode_id', activeModeId)
      .select('id, label, color, font_color, background_opacity, item_opacity, sort_order, created_at, updated_at')
      .single()

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A category with this label already exists' })
      }
      return res.status(400).json({ error: timeManagerStorageError(error) })
    }
    if (!data) return res.status(404).json({ error: 'Category not found' })
    res.json({ category: data })
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

router.delete('/categories/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' })
    const activeModeId = await resolveActiveModeId(req.userId)

    const id = sanitizeUUID(req.params.id)
    if (!id) return res.status(400).json({ error: 'Invalid category id' })

    // Strip the category id from any user_events that reference it, so we
    // do not leave dangling references after the delete.
    const { data: affected } = await supabaseAdmin
      .from('user_events')
      .select('id, category_ids')
      .eq('user_id', req.userId)
      .eq('source_type', 'manual')
      .eq('source_id', activeModeId)
      .contains('category_ids', [id])

    if (Array.isArray(affected) && affected.length > 0) {
      for (const row of affected) {
        const next = (row.category_ids as string[] | null || []).filter((cid) => cid !== id)
        const { error: updateError } = await supabaseAdmin
          .from('user_events')
          .update({ category_ids: next, updated_at: new Date().toISOString() })
          .eq('id', row.id)
          .eq('user_id', req.userId)
        if (updateError) {
          return res.status(400).json({ error: timeManagerStorageError(updateError) })
        }
      }
    }

    const { data, error } = await supabaseAdmin
      .from('time_management_categories')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId)
      .eq('mode_id', activeModeId)
      .select()
      .single()

    if (error) return res.status(400).json({ error: timeManagerStorageError(error) })
    if (!data) return res.status(404).json({ error: 'Category not found' })
    res.json({ message: 'Category deleted' })
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

// ─── Preferences ────────────────────────────────────────────

router.get('/prefs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('time_management_prefs')
      .select('main_color, main_label, active_mode_id, updated_at')
      .eq('user_id', req.userId)
      .maybeSingle()

    if (error) return res.status(400).json({ error: timeManagerStorageError(error) })

    res.json({
      prefs: data || {
        main_color: DEFAULT_MAIN_COLOR,
        main_label: DEFAULT_MAIN_LABEL,
        active_mode_id: null,
        updated_at: null,
      },
    })
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

router.put('/prefs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const updates: Record<string, unknown> = {
      user_id: req.userId,
      updated_at: new Date().toISOString(),
    }
    if (req.body?.main_color !== undefined) {
      if (typeof req.body.main_color !== 'string' || !HEX_COLOR_RE.test(req.body.main_color.trim())) {
        return res.status(400).json({ error: 'main_color must be a #RRGGBB hex string' })
      }
      updates.main_color = req.body.main_color.trim()
    }
    if (req.body?.main_label !== undefined) {
      const label = sanitizeString(req.body.main_label, 80)
      if (!label) return res.status(400).json({ error: 'main_label must be 1-80 chars' })
      updates.main_label = label
    }
    if (req.body?.active_mode_id !== undefined) {
      if (req.body.active_mode_id !== null) {
        const activeModeId = sanitizeUUID(req.body.active_mode_id)
        if (!activeModeId) {
          return res.status(400).json({ error: 'active_mode_id must be a UUID or null' })
        }
        const { data: activeMode, error: activeModeError } = await supabaseAdmin
          .from('time_management_modes')
          .select('id')
          .eq('id', activeModeId)
          .eq('user_id', req.userId)
          .maybeSingle()
        if (activeModeError) return res.status(400).json({ error: timeManagerStorageError(activeModeError) })
        if (!activeMode) return res.status(400).json({ error: 'active_mode_id does not belong to the user' })
        updates.active_mode_id = activeModeId
      } else {
        updates.active_mode_id = null
      }
    }

    const { data, error } = await supabaseAdmin
      .from('time_management_prefs')
      .upsert(updates, { onConflict: 'user_id' })
      .select('main_color, main_label, active_mode_id, updated_at')
      .single()

    if (error) return res.status(400).json({ error: timeManagerStorageError(error) })
    res.json({ prefs: data })
  } catch (err) {
    res.status(500).json({ error: timeManagerStorageError(err) })
  }
})

export default router
