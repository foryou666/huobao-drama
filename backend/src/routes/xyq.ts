import { Hono } from 'hono'
import { requireAdmin, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { success, badRequest, notFound } from '../utils/response.js'
import {
  clearXyqWebSession,
  deleteXyqWebSession,
  getActiveXyqSessionId,
  getXyqWebSession,
  listXyqWebSessions,
  setActiveXyqWebSession,
  setXyqWebSession,
  toPublicXyqSession,
} from '../services/xyq-web-session.js'
import { validateXyqSession } from '../services/xyq-web-client.js'
import { getXyqSessionStatus, listXyqSessionSummaries } from '../utils/xyq-web-video-options.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAdmin)

async function validateSessionEntry(session: ReturnType<typeof getXyqWebSession>) {
  if (!session) return false
  return validateXyqSession(session)
}

app.get('/sessions', async (c) => {
  const items = await listXyqSessionSummaries()
  return success(c, {
    active_id: getActiveXyqSessionId(),
    items,
    configured: items.length > 0,
  })
})

app.get('/session', async (c) => {
  const status = await getXyqSessionStatus()
  const items = await listXyqSessionSummaries()
  return success(c, {
    ...status,
    active_id: getActiveXyqSessionId(),
    sessions: items,
  })
})

app.put('/session', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const accessKey = String(body.access_key || body.accessKey || body.api_key || body.apiKey || body.key || '').trim()
  const id = body.id ? String(body.id) : undefined
  const hasCookieField = Object.prototype.hasOwnProperty.call(body, 'cookie')
  if (!accessKey && !id) return badRequest(c, '请提供 access_key')

  try {
    const saved = setXyqWebSession({
      id,
      access_key: accessKey || undefined,
      cookie: hasCookieField ? (body.cookie == null ? null : String(body.cookie)) : undefined,
      label: body.label != null ? String(body.label) : undefined,
      set_active: body.set_active !== false && body.set_active !== 0 && body.set_active !== '0',
    })
    const valid = await validateSessionEntry(saved)
    return success(c, {
      configured: true,
      valid,
      ...toPublicXyqSession(saved, getActiveXyqSessionId()),
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.put('/session/:id/active', async (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return badRequest(c, 'id is required')
  try {
    const saved = setActiveXyqWebSession(id)
    const valid = await validateSessionEntry(saved)
    return success(c, { id: saved.id, valid, is_active: true })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.delete('/session/:id', (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return badRequest(c, 'id is required')
  const ok = deleteXyqWebSession(id)
  if (!ok) return notFound(c, 'Access Key 不存在')
  return success(c, {
    deleted: true,
    active_id: getActiveXyqSessionId(),
  })
})

app.delete('/session', (c) => {
  clearXyqWebSession()
  return success(c, { cleared: true })
})

app.post('/session/validate', async (c) => {
  const session = getXyqWebSession()
  if (!session) return badRequest(c, '小云雀 Access Key 未配置')
  const valid = await validateSessionEntry(session)
  return success(c, { valid, id: session.id, user: getAuthUser(c).username })
})

app.post('/session/:id/validate', async (c) => {
  const id = String(c.req.param('id') || '').trim()
  const session = getXyqWebSession(id)
  if (!session) return notFound(c, 'Access Key 不存在')
  const valid = await validateSessionEntry(session)
  return success(c, { valid, id: session.id, user: getAuthUser(c).username })
})

app.get('/sessions/count', (c) => {
  return success(c, { count: listXyqWebSessions().length })
})

export default app
