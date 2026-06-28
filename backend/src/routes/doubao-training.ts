import { Hono } from 'hono'
import { requireAdmin, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { success, badRequest, notFound } from '../utils/response.js'
import {
  clearDoubaoTrainingSessions,
  deleteDoubaoTrainingSession,
  extractSessionIdFromCookie,
  getActiveDoubaoTrainingSessionId,
  getDoubaoTrainingSession,
  setActiveDoubaoTrainingSession,
  setDoubaoTrainingSession,
} from '../services/doubao-training-session.js'
import { validateDoubaoTrainingSession } from '../services/doubao-training-client.js'
import { listDoubaoTrainingSessionSummaries } from '../utils/doubao-training-video-options.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAdmin)

async function validateSessionEntry(session: ReturnType<typeof getDoubaoTrainingSession>) {
  if (!session) return false
  return validateDoubaoTrainingSession(session)
}

app.get('/sessions', async (c) => {
  const items = await listDoubaoTrainingSessionSummaries()
  return success(c, {
    active_id: getActiveDoubaoTrainingSessionId(),
    items,
    configured: items.length > 0,
  })
})

app.put('/session', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const cookie = String(body.cookie || '').trim()
  const sessionId = String(body.session_id || body.sessionId || '').trim()
    || (cookie ? extractSessionIdFromCookie(cookie) || '' : '')
  if (!sessionId && !cookie) return badRequest(c, '请提供 session_id 或 cookie')

  try {
    const saved = setDoubaoTrainingSession({
      id: body.id ? String(body.id) : undefined,
      session_id: sessionId,
      cookie: cookie || undefined,
      label: body.label != null ? String(body.label) : undefined,
      set_active: body.set_active !== false && body.set_active !== 0 && body.set_active !== '0',
    })
    const valid = await validateSessionEntry(saved)
    return success(c, {
      configured: true,
      valid,
      id: saved.id,
      label: saved.label,
      updated_at: saved.updatedAt,
      is_active: saved.id === getActiveDoubaoTrainingSessionId(),
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.put('/session/:id/active', async (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return badRequest(c, 'id is required')
  try {
    const saved = setActiveDoubaoTrainingSession(id)
    const valid = await validateSessionEntry(saved)
    return success(c, { id: saved.id, valid, is_active: true })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.delete('/session/:id', (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return badRequest(c, 'id is required')
  const ok = deleteDoubaoTrainingSession(id)
  if (!ok) return notFound(c, 'Session 不存在')
  return success(c, { deleted: true, active_id: getActiveDoubaoTrainingSessionId() })
})

app.delete('/session', (c) => {
  clearDoubaoTrainingSessions()
  return success(c, { cleared: true })
})

app.post('/session/validate', async (c) => {
  const session = getDoubaoTrainingSession()
  if (!session) return badRequest(c, '豆包培训 Session 未配置')
  const valid = await validateDoubaoTrainingSession(session)
  return success(c, { valid })
})

app.post('/session/:id/validate', async (c) => {
  const id = String(c.req.param('id') || '').trim()
  const session = getDoubaoTrainingSession(id)
  if (!session) return notFound(c, 'Session 不存在')
  const valid = await validateDoubaoTrainingSession(session)
  return success(c, { id: session.id, valid })
})

export default app
