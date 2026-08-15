import { Hono } from 'hono'
import { requireAdmin, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { success, badRequest, notFound } from '../utils/response.js'
import {
  clearCozeWebSession,
  deleteCozeWebSession,
  getActiveCozeSessionId,
  getCozeWebSession,
  listCozeWebSessions,
  setActiveCozeWebSession,
  setCozeWebSession,
  toPublicCozeSession,
} from '../services/coze-web-session.js'
import { validateCozeSession } from '../services/coze-web-client.js'
import { getCozeSessionStatus, listCozeSessionSummaries } from '../utils/coze-web-video-options.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAdmin)

async function validateSessionEntry(session: ReturnType<typeof getCozeWebSession>) {
  if (!session) return false
  return validateCozeSession(session)
}

app.get('/sessions', async (c) => {
  const items = await listCozeSessionSummaries()
  return success(c, {
    active_id: getActiveCozeSessionId(),
    items,
    configured: items.length > 0,
  })
})

app.get('/session', async (c) => {
  const status = await getCozeSessionStatus()
  const items = await listCozeSessionSummaries()
  return success(c, {
    ...status,
    active_id: getActiveCozeSessionId(),
    sessions: items,
  })
})

app.put('/session', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const id = body.id ? String(body.id) : undefined
  const hasCookieField = Object.prototype.hasOwnProperty.call(body, 'cookie')
  const hasApiKeyField = Object.prototype.hasOwnProperty.call(body, 'api_key')
    || Object.prototype.hasOwnProperty.call(body, 'apiKey')
    || Object.prototype.hasOwnProperty.call(body, 'pat')
  const hasBaseUrlField = Object.prototype.hasOwnProperty.call(body, 'base_url')
    || Object.prototype.hasOwnProperty.call(body, 'baseUrl')
  const apiKey = String(body.api_key || body.apiKey || body.pat || '').trim()
  const cookie = hasCookieField ? (body.cookie == null ? null : String(body.cookie)) : undefined

  if (!id && !apiKey && !(cookie && String(cookie).trim())) {
    return badRequest(c, '请提供 Cookie 或 Personal Access Token（PAT）')
  }

  try {
    const saved = setCozeWebSession({
      id,
      cookie,
      api_key: hasApiKeyField ? apiKey : undefined,
      base_url: hasBaseUrlField
        ? (body.base_url != null ? String(body.base_url) : (body.baseUrl != null ? String(body.baseUrl) : null))
        : undefined,
      label: body.label != null ? String(body.label) : undefined,
      set_active: body.set_active !== false && body.set_active !== 0 && body.set_active !== '0',
    })
    const valid = await validateSessionEntry(saved)
    return success(c, {
      configured: true,
      valid,
      ...toPublicCozeSession(saved, getActiveCozeSessionId()),
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.put('/session/:id/active', async (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return badRequest(c, 'id is required')
  try {
    const saved = setActiveCozeWebSession(id)
    const valid = await validateSessionEntry(saved)
    return success(c, { id: saved.id, valid, is_active: true })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.delete('/session/:id', (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return badRequest(c, 'id is required')
  const ok = deleteCozeWebSession(id)
  if (!ok) return notFound(c, 'Session 不存在')
  return success(c, {
    deleted: true,
    active_id: getActiveCozeSessionId(),
  })
})

app.delete('/session', (c) => {
  clearCozeWebSession()
  return success(c, { cleared: true })
})

app.post('/session/validate', async (c) => {
  const session = getCozeWebSession()
  if (!session) return badRequest(c, '扣子 Session 未配置')
  const valid = await validateSessionEntry(session)
  return success(c, { valid, id: session.id, user: getAuthUser(c).username })
})

app.post('/session/:id/validate', async (c) => {
  const id = String(c.req.param('id') || '').trim()
  const session = getCozeWebSession(id)
  if (!session) return notFound(c, 'Session 不存在')
  const valid = await validateSessionEntry(session)
  return success(c, { valid, id: session.id, user: getAuthUser(c).username })
})

app.get('/sessions/count', (c) => {
  return success(c, { count: listCozeWebSessions().length })
})

export default app
