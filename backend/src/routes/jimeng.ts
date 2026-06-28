import { Hono } from 'hono'
import { requireAdmin, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { success, badRequest, notFound } from '../utils/response.js'
import {
  clearJimengWebSession,
  deleteJimengWebSession,
  getActiveJimengSessionId,
  getJimengWebSession,
  listJimengWebSessions,
  setActiveJimengWebSession,
  setJimengWebSession,
  extractSessionIdFromCookie,
  toPublicJimengSession,
} from '../services/jimeng-web-session.js'
import { validateJimengSession } from '../services/jimeng-web-client.js'
import { getJimengSessionStatus, listJimengSessionSummaries } from '../utils/jimeng-web-video-options.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAdmin)

async function validateSessionEntry(session: ReturnType<typeof getJimengWebSession>) {
  if (!session) return false
  return validateJimengSession(session)
}

// GET /jimeng/sessions — 全部 Session（不含 Cookie 明文）
app.get('/sessions', async (c) => {
  const items = await listJimengSessionSummaries()
  return success(c, {
    active_id: getActiveJimengSessionId(),
    items,
    configured: items.length > 0,
  })
})

// GET /jimeng/session — 当前启用的 Session 状态（兼容旧前端）
app.get('/session', async (c) => {
  const status = await getJimengSessionStatus()
  const items = await listJimengSessionSummaries()
  return success(c, {
    ...status,
    active_id: getActiveJimengSessionId(),
    sessions: items,
  })
})

// PUT /jimeng/session — 新增或更新 Session
app.put('/session', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const cookie = String(body.cookie || '').trim()
  const sessionId = String(body.session_id || body.sessionId || '').trim()
    || (cookie ? extractSessionIdFromCookie(cookie) || '' : '')

  if (!sessionId && !cookie) {
    return badRequest(c, '请提供 session_id 或 cookie')
  }

  try {
    const saved = setJimengWebSession({
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
      session_id_masked: saved.sessionId.slice(0, 4) + '…' + saved.sessionId.slice(-4),
      label: saved.label,
      updated_at: saved.updatedAt,
      is_active: saved.id === getActiveJimengSessionId(),
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// PUT /jimeng/session/:id/active — 设为当前启用
app.put('/session/:id/active', async (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return badRequest(c, 'id is required')
  try {
    const saved = setActiveJimengWebSession(id)
    const valid = await validateSessionEntry(saved)
    return success(c, {
      id: saved.id,
      valid,
      is_active: true,
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// DELETE /jimeng/session/:id — 删除单个
app.delete('/session/:id', (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return badRequest(c, 'id is required')
  const ok = deleteJimengWebSession(id)
  if (!ok) return notFound(c, 'Session 不存在')
  return success(c, {
    deleted: true,
    active_id: getActiveJimengSessionId(),
  })
})

// DELETE /jimeng/session — 清除全部（兼容旧前端）
app.delete('/session', (c) => {
  clearJimengWebSession()
  return success(c, { cleared: true })
})

// POST /jimeng/session/validate — 验证当前启用 Session
app.post('/session/validate', async (c) => {
  const session = getJimengWebSession()
  if (!session) return badRequest(c, '即梦 Session 未配置')
  const valid = await validateSessionEntry(session)
  return success(c, { valid, id: session.id, user: getAuthUser(c).username })
})

// POST /jimeng/session/:id/validate — 验证指定 Session
app.post('/session/:id/validate', async (c) => {
  const id = String(c.req.param('id') || '').trim()
  const session = getJimengWebSession(id)
  if (!session) return notFound(c, 'Session 不存在')
  const valid = await validateSessionEntry(session)
  return success(c, { valid, id: session.id, user: getAuthUser(c).username })
})

export default app
