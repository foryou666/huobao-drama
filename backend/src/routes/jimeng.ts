import { Hono } from 'hono'
import { requireAdmin, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { success, badRequest } from '../utils/response.js'
import {
  clearJimengWebSession,
  getJimengWebSession,
  setJimengWebSession,
  extractSessionIdFromCookie,
} from '../services/jimeng-web-session.js'
import { validateJimengSession } from '../services/jimeng-web-client.js'
import { getJimengSessionStatus } from '../utils/jimeng-web-video-options.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAdmin)

// GET /jimeng/session
app.get('/session', async (c) => {
  const status = await getJimengSessionStatus()
  return success(c, status)
})

// PUT /jimeng/session — 保存 sessionid 或完整 Cookie
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
      session_id: sessionId,
      cookie: cookie || undefined,
      label: body.label ? String(body.label) : undefined,
    })
    const valid = await validateJimengSession(saved)
    return success(c, {
      configured: true,
      valid,
      session_id_masked: saved.sessionId.slice(0, 4) + '…' + saved.sessionId.slice(-4),
      label: saved.label,
      updated_at: saved.updatedAt,
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// DELETE /jimeng/session
app.delete('/session', (c) => {
  clearJimengWebSession()
  return success(c, { cleared: true })
})

// POST /jimeng/session/validate
app.post('/session/validate', async (c) => {
  const session = getJimengWebSession()
  if (!session) return badRequest(c, '即梦 Session 未配置')
  const valid = await validateJimengSession(session)
  return success(c, { valid, user: getAuthUser(c).username })
})

export default app
