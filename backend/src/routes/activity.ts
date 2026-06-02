import { Hono } from 'hono'
import { requireAuth, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { success } from '../utils/response.js'
import { listActivityLogs } from '../services/activity.js'
import { resolveAuditScope } from '../services/team-audit.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAuth)

// GET /activity-logs — 普通用户仅自己；团队管理员 ?team=1；平台管理员 ?all=1
app.get('/', async (c) => {
  const user = getAuthUser(c)
  const all = c.req.query('all') === '1'
  const team = c.req.query('team') === '1'
  const teamId = c.req.query('team_id') ? Number(c.req.query('team_id')) : undefined
  const userIdParam = c.req.query('user_id') ? Number(c.req.query('user_id')) : undefined
  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)

  const resolved = resolveAuditScope(c, user, { all, team, teamId, userId: userIdParam })
  if (!resolved.ok) return resolved.response
  const { scope } = resolved

  const result = listActivityLogs({ userIds: scope.userIds, limit, offset })
  return success(c, { ...result, scope: scope.mode, team_id: scope.teamId ?? null })
})

export default app
