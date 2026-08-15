import { Hono } from 'hono'
import { requireAdmin, type AuthVariables } from '../middleware/auth.js'
import { success, badRequest, notFound } from '../utils/response.js'
import {
  clearFunshionWebSession,
  deleteFunshionWebSession,
  getActiveFunshionSessionId,
  getFunshionWebSession,
  listFunshionWebSessions,
  setActiveFunshionWebSession,
  setFunshionWebSession,
  toPublicFunshionSession,
} from '../services/funshion-web-session.js'
import { validateFunshionSession } from '../services/funshion-web-client.js'
import { getFunshionSessionStatus, listFunshionSessionSummaries } from '../utils/funshion-web-video-options.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAdmin)

async function validateSessionEntry(session: ReturnType<typeof getFunshionWebSession>) {
  if (!session) return false
  return validateFunshionSession(session)
}

app.get('/sessions', async (c) => {
  const items = await listFunshionSessionSummaries()
  return success(c, {
    active_id: getActiveFunshionSessionId(),
    items,
    configured: items.length > 0,
  })
})

app.get('/session', async (c) => {
  const status = await getFunshionSessionStatus()
  const items = await listFunshionSessionSummaries()
  return success(c, {
    ...status,
    active_id: getActiveFunshionSessionId(),
    sessions: items,
  })
})

app.put('/session', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const id = body.id ? String(body.id) : undefined
  const token = String(body.token || body.authorization || body.api_key || body.apiKey || '').trim()
  if (!id && !token) {
    return badRequest(c, '请粘贴视频页 Network 的 Authorization，或 Application → Local Storage → token')
  }
  try {
    const saved = setFunshionWebSession({
      id,
      token: token || undefined,
      base_url: body.base_url != null ? String(body.base_url) : (body.baseUrl != null ? String(body.baseUrl) : undefined),
      project_id: body.project_id != null ? String(body.project_id) : (body.projectId != null ? String(body.projectId) : undefined),
      app_id: body.app_id != null ? String(body.app_id) : (body.appId != null ? String(body.appId) : undefined),
      label: body.label != null ? String(body.label) : undefined,
      set_active: body.set_active !== false && body.set_active !== 0 && body.set_active !== '0',
    })
    const valid = await validateSessionEntry(saved)
    return success(c, {
      configured: true,
      valid,
      ...toPublicFunshionSession(saved, getActiveFunshionSessionId()),
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.put('/session/:id/active', async (c) => {
  const id = c.req.param('id')
  try {
    const saved = setActiveFunshionWebSession(id)
    return success(c, toPublicFunshionSession(saved, id))
  } catch (err: any) {
    return notFound(c, err.message)
  }
})

app.post('/session/validate', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const id = body.id ? String(body.id) : undefined
  const session = getFunshionWebSession(id)
  if (!session) return badRequest(c, 'Session 不存在')
  const valid = await validateSessionEntry(session)
  return success(c, { valid, ...toPublicFunshionSession(session, getActiveFunshionSessionId()) })
})

app.post('/session/:id/validate', async (c) => {
  const session = getFunshionWebSession(c.req.param('id'))
  if (!session) return notFound(c, 'Session 不存在')
  const valid = await validateSessionEntry(session)
  return success(c, { valid, ...toPublicFunshionSession(session, getActiveFunshionSessionId()) })
})

app.delete('/session/:id', async (c) => {
  const ok = deleteFunshionWebSession(c.req.param('id'))
  if (!ok) return notFound(c, 'Session 不存在')
  return success(c, { deleted: true, active_id: getActiveFunshionSessionId(), total: listFunshionWebSessions().length })
})

app.delete('/session', async (c) => {
  clearFunshionWebSession()
  return success(c, { cleared: true })
})

export default app
