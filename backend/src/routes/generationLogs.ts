import { Hono } from 'hono'
import { requireAuth, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { success } from '../utils/response.js'
import { resolveAuditScope } from '../services/team-audit.js'
import { listGenerationLogs, type GenerationLogKind } from '../services/generation-logs.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAuth)

// GET /generation-logs — 生图/生视频统一日志（状态、失败原因、积分）
app.get('/', async (c) => {
  const user = getAuthUser(c)
  const all = c.req.query('all') === '1'
  const team = c.req.query('team') === '1'
  const teamId = c.req.query('team_id') ? Number(c.req.query('team_id')) : undefined
  const userIdParam = c.req.query('user_id') ? Number(c.req.query('user_id')) : undefined
  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)
  const kindRaw = String(c.req.query('kind') || 'all').trim().toLowerCase()
  const kind = (kindRaw === 'image' || kindRaw === 'video' ? kindRaw : 'all') as GenerationLogKind | 'all'
  const status = String(c.req.query('status') || 'all').trim() || 'all'
  const keyword = String(c.req.query('keyword') || '').trim()

  const resolved = resolveAuditScope(c, user, { all, team, teamId, userId: userIdParam })
  if (!resolved.ok) return resolved.response

  const result = listGenerationLogs({
    scope: resolved.scope,
    kind,
    status,
    keyword,
    limit,
    offset,
  })
  return success(c, result)
})

export default app
