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
import {
  clearJimengForceSessionId,
  resolveLiveJimengForceSessionId,
  setJimengForceSessionId,
} from '../services/jimeng-session-binding.js'
import {
  listJimengAccessSettingsForAdmin,
  setJimengAccessSettings,
  type JimengTeamAccessRule,
} from '../utils/jimeng-access-settings.js'
import { logActivity } from '../services/activity.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAdmin)

async function validateSessionEntry(session: ReturnType<typeof getJimengWebSession>) {
  if (!session) return false
  return validateJimengSession(session)
}

function withForceFlags<T extends { id: string }>(items: T[]) {
  const forceId = resolveLiveJimengForceSessionId()
  return {
    force_session_id: forceId,
    items: items.map(item => ({
      ...item,
      is_force: !!forceId && item.id === forceId,
    })),
  }
}

// GET /jimeng/sessions — 全部 Session（不含 Cookie 明文）
app.get('/sessions', async (c) => {
  const items = await listJimengSessionSummaries()
  const withForce = withForceFlags(items)
  return success(c, {
    active_id: getActiveJimengSessionId(),
    force_session_id: withForce.force_session_id,
    items: withForce.items,
    configured: items.length > 0,
  })
})

// GET /jimeng/session — 当前启用的 Session 状态（兼容旧前端）
app.get('/session', async (c) => {
  const status = await getJimengSessionStatus()
  const items = await listJimengSessionSummaries()
  const withForce = withForceFlags(items)
  return success(c, {
    ...status,
    active_id: getActiveJimengSessionId(),
    force_session_id: withForce.force_session_id,
    sessions: withForce.items,
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

// PUT /jimeng/session/:id/force — 强制全员发布使用此 Session
app.put('/session/:id/force', (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return badRequest(c, 'id is required')
  try {
    const forceId = setJimengForceSessionId(id)
    return success(c, {
      force_session_id: forceId,
      forced: true,
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// DELETE /jimeng/force-session — 取消强制，恢复按用户+项目分配
app.delete('/force-session', (c) => {
  clearJimengForceSessionId()
  return success(c, {
    force_session_id: null,
    forced: false,
  })
})

// DELETE /jimeng/session/:id — 删除单个
app.delete('/session/:id', (c) => {
  const id = String(c.req.param('id') || '').trim()
  if (!id) return badRequest(c, 'id is required')
  const ok = deleteJimengWebSession(id)
  if (!ok) return notFound(c, 'Session 不存在')
  // 强制号被删时 resolveLive 会自动清除 meta
  return success(c, {
    deleted: true,
    active_id: getActiveJimengSessionId(),
    force_session_id: resolveLiveJimengForceSessionId(),
  })
})

// DELETE /jimeng/session — 清除全部（兼容旧前端）
app.delete('/session', (c) => {
  clearJimengWebSession()
  clearJimengForceSessionId()
  return success(c, { cleared: true, force_session_id: null })
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

// GET /jimeng/access-settings — 通道4 团队提交成功率
app.get('/access-settings', (c) => success(c, listJimengAccessSettingsForAdmin()))

// PUT /jimeng/access-settings — 保存通道4 团队提交成功率
app.put('/access-settings', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const teamsInput = Array.isArray(body.teams) ? body.teams : []
  const teams: JimengTeamAccessRule[] = teamsInput.map((item: any) => ({
    team_id: Number(item?.team_id ?? item?.teamId),
    success_rate: Number(item?.success_rate ?? item?.successRate),
  })).filter((item: JimengTeamAccessRule) => Number.isFinite(item.team_id) && item.team_id > 0)

  const saved = setJimengAccessSettings({
    enabled: body.enabled !== false && body.enabled !== 0 && body.enabled !== '0',
    default_success_rate: Number(body.default_success_rate ?? body.defaultSuccessRate),
    teams,
  })

  logActivity(getAuthUser(c), {
    action: 'jimeng.access_settings.update',
    summary: `更新通道4团队提交成功率（默认 ${saved.default_success_rate}% · ${saved.teams.length} 条团队规则）`,
    metadata: {
      enabled: saved.enabled,
      default_success_rate: saved.default_success_rate,
      teams: saved.teams,
    },
  })

  return success(c, listJimengAccessSettingsForAdmin())
})

export default app
