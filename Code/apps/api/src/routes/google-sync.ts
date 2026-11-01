import { Router, Response } from 'express'
import type { Router as RouterType } from 'express'
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js'
import { safeErrorMessage, sanitizeUUID } from '../middleware/validation.js'
import {
  GoogleSyncError,
  exportUserEventToGoogle,
  getUserEventGoogleStatus,
  pushUserEventToGoogle,
  setGoogleKeepInSync,
} from '../services/google-event-sync.js'

// Outbound Google Calendar sync for Time Management items (user_events).
const router: RouterType = Router()
router.use(authMiddleware)

function sendSyncError(res: Response, err: unknown, fallback: string) {
  if (err instanceof GoogleSyncError) {
    return res.status(err.statusCode).json({ error: 'GOOGLE_SYNC_FAILED', message: err.message, statusCode: err.statusCode })
  }
  return res.status(502).json({ error: 'GOOGLE_SYNC_FAILED', message: safeErrorMessage(err) || fallback, statusCode: 502 })
}

// POST /api/google-sync/user-events/:id/export  Body: { sourceId, keepInSync? }
router.post('/user-events/:id/export', async (req: AuthenticatedRequest, res: Response) => {
  const eventId = sanitizeUUID(req.params.id)
  const sourceId = sanitizeUUID(req.body?.sourceId)
  if (!req.userId || !eventId || !sourceId) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid event id and sourceId are required', statusCode: 400 })
  }
  try {
    const result = await exportUserEventToGoogle({ userId: req.userId, eventId, sourceId, keepInSync: req.body?.keepInSync === true })
    res.json(result)
  } catch (err) {
    sendSyncError(res, err, 'Failed to export to Google Calendar')
  }
})

// POST /api/google-sync/user-events/:id/push  -- push current state to linked Google copies
router.post('/user-events/:id/push', async (req: AuthenticatedRequest, res: Response) => {
  const eventId = sanitizeUUID(req.params.id)
  if (!req.userId || !eventId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid event id', statusCode: 400 })
  try {
    const pushed = await pushUserEventToGoogle(req.userId, eventId)
    res.json({ pushed, ...(await getUserEventGoogleStatus(req.userId, eventId)) })
  } catch (err) {
    sendSyncError(res, err, 'Failed to update Google Calendar')
  }
})

// GET /api/google-sync/user-events/:id/status  -- compare local, last pushed, and Google state
router.get('/user-events/:id/status', async (req: AuthenticatedRequest, res: Response) => {
  const eventId = sanitizeUUID(req.params.id)
  if (!req.userId || !eventId) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Invalid event id', statusCode: 400 })
  try {
    res.json(await getUserEventGoogleStatus(req.userId, eventId))
  } catch (err) {
    sendSyncError(res, err, 'Failed to check Google Calendar')
  }
})

// PUT /api/google-sync/user-events/:id/keep-in-sync  Body: { keepInSync: boolean }
router.put('/user-events/:id/keep-in-sync', async (req: AuthenticatedRequest, res: Response) => {
  const eventId = sanitizeUUID(req.params.id)
  if (!req.userId || !eventId || typeof req.body?.keepInSync !== 'boolean') {
    return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Valid event id and keepInSync boolean are required', statusCode: 400 })
  }
  const updated = await setGoogleKeepInSync(req.userId, eventId, req.body.keepInSync)
  if (updated === 0) return res.status(404).json({ error: 'NOT_FOUND', message: 'Item is not exported to Google', statusCode: 404 })
  res.json({ updated })
})

export default router
