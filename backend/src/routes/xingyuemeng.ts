import { Hono } from 'hono'
import { requireAdmin, type AuthVariables } from '../middleware/auth.js'
import { success, badRequest, notFound } from '../utils/response.js'
import {
  clearXingyuemengWebSession,
  deleteXingyuemengWebSession,
  getActiveXingyuemengSessionId,
  getXingyuemengWebSession,
  listXingyuemengWebSessions,
  setActiveXingyuemengWebSession,
  setXingyuemengWebSession,
  toPublicXingyuemengSession,
} from '../services/xingyuemeng-web-session.js'
import { validateXingyuemengSession } from '../services/xingyuemeng-web-client.js'
import { getXingyuemengSessionStatus, listXingyuemengSessionSummaries } from '../utils/xingyuemeng-web-video-options.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAdmin)

async function validateSessionEntry(session: ReturnType<typeof getXingyuemengWebSession>) {
  if (!session) return false
  return validateXingyuemengSession(session)
}

app.get('/sessions', async (c) => {
  const items = await listXingyuemengSessionSummaries()
  return success(c, {
    active_id: getActiveXingyuemengSessionId(),
    items,
    configured: items.length > 0,
  })
})

app.get('/session', async (c) => {
  const status = await getXingyuemengSessionStatus()
  const items = await listXingyuemengSessionSummaries()
  return success(c, {
    ...status,
    active_id: getActiveXingyuemengSessionId(),
    sessions: items,
  })
})

app.put('/session', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const id = body.id ? String(body.id) : undefined
  const token = String(body.token || body.authorization || body.api_key || body.apiKey || '').trim()
  if (!id && !token) {
    return badRequest(c, '请粘贴星月梦 localStorage.xymai_token')
  }
  try {
    const saved = setXingyuemengWebSession({
      id,
      token: token || undefined,
      base_url: body.base_url != null ? String(body.base_url) : (body.baseUrl != null ? String(body.baseUrl) : undefined),
      team_id: body.team_id != null ? String(body.team_id) : (body.teamId != null ? String(body.teamId) : undefined),
      project_id: body.project_id != null ? String(body.project_id) : (body.projectId != null ? String(body.projectId) : undefined),
      episode_id: body.episode_id != null ? String(body.episode_id) : (body.episodeId != null ? String(body.episodeId) : undefined),
      label: body.label != null ? String(body.label) : undefined,
      set_active: body.set_active !== false && body.set_active !== 0 && body.set_active !== '0',
    })
    const valid = await validateSessionEntry(saved)
    return success(c, {
      configured: true,
      valid,
      ...toPublicXingyuemengSession(saved, getActiveXingyuemengSessionId()),
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.put('/session/:id/active', async (c) => {
  const id = c.req.param('id')
  try {
    const saved = setActiveXingyuemengWebSession(id)
    return success(c, toPublicXingyuemengSession(saved, id))
  } catch (err: any) {
    return notFound(c, err.message)
  }
})

app.post('/session/validate', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const id = body.id ? String(body.id) : undefined
  const session = getXingyuemengWebSession(id)
  if (!session) return badRequest(c, 'Session 不存在')
  const valid = await validateSessionEntry(session)
  return success(c, { valid, ...toPublicXingyuemengSession(session, getActiveXingyuemengSessionId()) })
})

app.post('/session/:id/validate', async (c) => {
  const session = getXingyuemengWebSession(c.req.param('id'))
  if (!session) return notFound(c, 'Session 不存在')
  const valid = await validateSessionEntry(session)
  return success(c, { valid, ...toPublicXingyuemengSession(session, getActiveXingyuemengSessionId()) })
})

app.delete('/session/:id', async (c) => {
  const ok = deleteXingyuemengWebSession(c.req.param('id'))
  if (!ok) return notFound(c, 'Session 不存在')
  return success(c, { deleted: true, active_id: getActiveXingyuemengSessionId(), total: listXingyuemengWebSessions().length })
})

app.delete('/session', async (c) => {
  clearXingyuemengWebSession()
  return success(c, { cleared: true })
})

export default app
