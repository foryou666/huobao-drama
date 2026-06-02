import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  success,
  badRequest,
  notFound,
  created,
  now,
  forbidden,
} from '../utils/response.js'
import { getAuthUser, type AuthVariables } from '../middleware/auth.js'
import {
  getUserTeams,
  createTeam,
  updateTeamName,
  listTeamMembers,
  addUserToTeam,
  removeTeamMember,
  updateTeamMemberRole,
  canManageTeamMembers,
  userHasTeamAccess,
  type TeamRole,
} from '../services/teams.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { logActivity } from '../services/activity.js'
import { listAllTeamsDirectory } from '../services/drama-shares.js'
import { canViewTeamAudit } from '../services/team-audit.js'
import { getTeamStats } from '../services/team-stats.js'

const app = new Hono<{ Variables: AuthVariables }>()

// GET /teams
app.get('/', async (c) => {
  const user = getAuthUser(c)
  const teams = getUserTeams(user.id)
  const activeTeamId = resolveActiveTeamId(c, user)
  return success(c, { items: teams, active_team_id: activeTeamId })
})

// POST /teams
app.post('/', async (c) => {
  const user = getAuthUser(c)
  const body = await c.req.json()
  const name = String(body.name || '').trim()
  if (!name) return badRequest(c, '请输入团队名称')
  const teamId = createTeam(name, user.id)
  logActivity(user, {
    action: 'team.create',
    summary: `创建团队「${name}」`,
    resourceType: 'team',
    resourceId: teamId,
  })
  return created(c, { id: teamId, name, role: 'owner' as TeamRole })
})

// GET /teams/directory — all teams for share picker
app.get('/directory', async (c) => {
  const user = getAuthUser(c)
  if (user.role !== 'admin') {
    const teams = getUserTeams(user.id)
    const canManageAny = teams.some(t => t.role === 'owner' || t.role === 'admin')
    if (!canManageAny) return forbidden(c, '无权查看团队目录')
  }
  return success(c, { items: listAllTeamsDirectory() })
})

// GET /teams/:id/stats — 成员消耗、工作量、进度（团队管理员看全员，成员仅看自己）
app.get('/:id/stats', async (c) => {
  const user = getAuthUser(c)
  const teamId = Number(c.req.param('id'))
  if (!userHasTeamAccess(user.id, teamId) && user.role !== 'admin') {
    return forbidden(c, '无权查看该团队统计')
  }

  const canViewAll = canViewTeamAudit(user, teamId)
  const userIdParam = c.req.query('user_id') ? Number(c.req.query('user_id')) : undefined
  let filterUserId = userIdParam

  if (!canViewAll && user.role !== 'admin') {
    filterUserId = user.id
  } else if (filterUserId && !canViewAll && user.role !== 'admin') {
    return forbidden(c, '需要团队管理员权限')
  } else if (filterUserId) {
    const memberIds = db.select().from(schema.teamMembers)
      .where(eq(schema.teamMembers.teamId, teamId)).all().map(m => m.userId)
    if (!memberIds.includes(filterUserId)) {
      return forbidden(c, '该用户不在当前团队')
    }
  }

  const stats = getTeamStats({
    teamId,
    dateFrom: c.req.query('date_from') || undefined,
    dateTo: c.req.query('date_to') || undefined,
    userId: filterUserId,
  })
  return success(c, stats)
})

// PUT /teams/:id — rename team (owner/admin)
app.put('/:id', async (c) => {
  const user = getAuthUser(c)
  const teamId = Number(c.req.param('id'))
  if (!userHasTeamAccess(user.id, teamId) && user.role !== 'admin') {
    return forbidden(c, '无权修改该团队')
  }
  if (!canManageTeamMembers(user.id, teamId) && user.role !== 'admin') {
    return forbidden(c, '需要团队管理员权限')
  }
  const body = await c.req.json()
  const name = String(body.name || '').trim()
  if (!name) return badRequest(c, '请输入团队名称')
  const ok = updateTeamName(teamId, name)
  if (!ok) return notFound(c, '团队不存在')
  logActivity(user, {
    action: 'team.update',
    summary: `重命名团队为「${name}」`,
    resourceType: 'team',
    resourceId: teamId,
  })
  return success(c, { id: teamId, name })
})

// GET /teams/:id/members
app.get('/:id/members', async (c) => {
  const user = getAuthUser(c)
  const teamId = Number(c.req.param('id'))
  if (!userHasTeamAccess(user.id, teamId) && user.role !== 'admin') {
    return forbidden(c, '无权查看该团队成员')
  }
  return success(c, { items: listTeamMembers(teamId) })
})

// POST /teams/:id/members
app.post('/:id/members', async (c) => {
  const user = getAuthUser(c)
  const teamId = Number(c.req.param('id'))
  if (!canManageTeamMembers(user.id, teamId) && user.role !== 'admin') {
    return forbidden(c, '无权管理该团队成员')
  }

  const body = await c.req.json()
  const username = String(body.username || '').trim()
  const role = (['owner', 'admin', 'member'].includes(body.role) ? body.role : 'member') as TeamRole
  if (!username) return badRequest(c, '请输入用户名')

  const [target] = db.select().from(schema.users).where(eq(schema.users.username, username)).all()
  if (!target) return notFound(c, '用户不存在')
  if (userHasTeamAccess(target.id, teamId)) return badRequest(c, '用户已在团队中')

  addUserToTeam(teamId, target.id, role === 'owner' ? 'admin' : role)
  logActivity(user, {
    action: 'team.member.add',
    summary: `将 ${username} 加入团队`,
    resourceType: 'team',
    resourceId: teamId,
    metadata: { user_id: target.id, role },
  })
  return created(c, { user_id: target.id, username, role: role === 'owner' ? 'admin' : role })
})

// PUT /teams/:id/members/:userId
app.put('/:id/members/:userId', async (c) => {
  const user = getAuthUser(c)
  const teamId = Number(c.req.param('id'))
  const targetUserId = Number(c.req.param('userId'))
  if (!canManageTeamMembers(user.id, teamId) && user.role !== 'admin') {
    return forbidden(c, '无权管理该团队成员')
  }

  const body = await c.req.json()
  const role = body.role as TeamRole
  if (!['owner', 'admin', 'member'].includes(role)) return badRequest(c, '无效的角色')
  if (!userHasTeamAccess(targetUserId, teamId)) return notFound(c, '成员不存在')

  updateTeamMemberRole(teamId, targetUserId, role)
  return success(c)
})

// DELETE /teams/:id/members/:userId
app.delete('/:id/members/:userId', async (c) => {
  const user = getAuthUser(c)
  const teamId = Number(c.req.param('id'))
  const targetUserId = Number(c.req.param('userId'))
  if (!canManageTeamMembers(user.id, teamId) && user.role !== 'admin') {
    return forbidden(c, '无权管理该团队成员')
  }
  if (targetUserId === user.id) return badRequest(c, '不能移除自己')
  if (!userHasTeamAccess(targetUserId, teamId)) return notFound(c, '成员不存在')

  removeTeamMember(teamId, targetUserId)
  logActivity(user, {
    action: 'team.member.remove',
    summary: `从团队移除成员 #${targetUserId}`,
    resourceType: 'team',
    resourceId: teamId,
    metadata: { user_id: targetUserId },
  })
  return success(c)
})

export default app
