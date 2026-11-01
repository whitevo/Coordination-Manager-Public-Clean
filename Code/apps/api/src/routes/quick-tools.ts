import { Router, Response } from 'express'
import type { Router as RouterType } from 'express'
import { supabaseAdmin } from '../supabaseClient.js'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { safeErrorMessage } from '../middleware/validation.js'

const router: RouterType = Router()

const MAX_QUICK_TOOLS = 32
const DEFAULT_QUICK_TOOLS = ['events-calendar', 'calendars', 'time-management']

router.use(authMiddleware)

function parseToolKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const keys: string[] = []
  for (const valueItem of value) {
    if (typeof valueItem !== 'string') continue
    const key = valueItem.trim()
    if (!key || key.length > 64 || keys.includes(key)) continue
    keys.push(key)
    if (keys.length === MAX_QUICK_TOOLS) break
  }
  return keys
}

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('quick_tool_preferences')
      .select('tool_keys')
      .eq('user_id', req.userId!)
      .maybeSingle()

    if (error) throw error

    if (!data) {
      const { data: created, error: createError } = await supabaseAdmin
        .from('quick_tool_preferences')
        .upsert({ user_id: req.userId, tool_keys: DEFAULT_QUICK_TOOLS }, { onConflict: 'user_id' })
        .select('tool_keys')
        .single()

      if (createError) throw createError
      res.json({ toolKeys: parseToolKeys(created.tool_keys) })
      return
    }

    res.json({ toolKeys: parseToolKeys(data.tool_keys) })
  } catch (error) {
    res.status(500).json({ error: safeErrorMessage(error) })
  }
})

router.put('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const toolKeys = parseToolKeys(req.body?.toolKeys)
    const { data, error } = await supabaseAdmin
      .from('quick_tool_preferences')
      .upsert(
        {
          user_id: req.userId,
          tool_keys: toolKeys,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select('tool_keys')
      .single()

    if (error) throw error

    res.json({ toolKeys: parseToolKeys(data.tool_keys) })
  } catch (error) {
    res.status(500).json({ error: safeErrorMessage(error) })
  }
})

export default router