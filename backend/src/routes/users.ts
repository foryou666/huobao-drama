import { Hono } from 'hono'
import { eq, desc, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, created, now, notFound } from '../utils/response.js'
import { hashPassword } from '../utils/password.js'
import { requireAuth, requireAdmin, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { getUserBalance } from '../services/credits.js'
import { addUserToTeam, getDefaultTeamId, ensureUserInDefaultTeam } from '../services/teams.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import {
  deserializeAllowedIps,
  parseAllowedIpsInput,
  serializeAllowedIps,
  listTeamMemberUserIds,
} from '../utils/login-ip.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAuth, requireAdmin)

function userItem(r: typeof schema.users.$inferSelect) {
  return {
    id: r.id,
    username: r.username,
    display_name: r.displayName,
    role: r.role,
    is_active: Boolean(r.isActive),
    credits_balance: getUserBalance(r.id),
    allowed_ips: deserializeAllowedIps(r.allowedIps),
    last_login_at: r.lastLoginAt,
    last_login_ip: r.lastLoginIp || null,
    created_at: r.createdAt,
  }
}

// GET /users
app.get('/', async (c) => {
  const rows = db.select().from(schema.users).orderBy(desc(schema.users.id)).all()
  return success(c, { items: rows.map(userItem) })
})

// POST /users
app.post('/', async (c) => {
  const body = await c.req.json()
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const displayName = String(body.display_name || body.displayName || username).trim()
  const role = body.role === 'admin' ? 'admin' : 'user'
  if (!username || username.length < 2) return badRequest(c, '用户名至少 2 个字符')
  if (!password || password.length < 6) return badRequest(c, '密码至少 6 位')

  const existing = db.select().from(schema.users).where(eq(schema.users.username, username)).all()
  if (existing.length) return badRequest(c, '用户名已存在')

  const allowedIps = body.allowed_ips !== undefined
    ? serializeAllowedIps(parseAllowedIpsInput(body.allowed_ips))
    : null

  const ts = now()
  const res = db.insert(schema.users).values({
    username,
    passwordHash: hashPassword(password),
    displayName,
    role,
    isActive: true,
    allowedIps,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const [row] = db.select().from(schema.users).where(eq(schema.users.id, Number(res.lastInsertRowid))).all()
  const admin = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, admin) ?? getDefaultTeamId() ?? ensureUserInDefaultTeam(admin.id)
  addUserToTeam(teamId, row.id, 'member')
  logActivity(admin, {
    action: 'user.create',
    summary: `创建用户 ${username}`,
    resourceType: 'user',
    resourceId: row.id,
    metadata: { role },
  })

  return created(c, userItem(row))
})

// POST /users/bulk-login-ips — 按团队批量写入成员个人 IP 白名单
app.post('/bulk-login-ips', async (c) => {
  const body = await c.req.json()
  const teamId = Number(body.team_id)
  if (!Number.isFinite(teamId) || teamId <= 0) return badRequest(c, '请选择团队')

  const [team] = db.select().from(schema.teams).where(eq(schema.teams.id, teamId)).all()
  if (!team) return notFound(c, '团队不存在')

  const allowedIps = serializeAllowedIps(parseAllowedIpsInput(body.allowed_ips))
  const mode = body.mode === 'merge' ? 'merge' : 'set'
  const alsoSetTeam = body.also_set_team !== false

  const memberIds = listTeamMemberUserIds(teamId)
  const ts = now()
  let updated = 0

  if (alsoSetTeam) {
    db.update(schema.teams).set({ allowedIps, updatedAt: ts }).where(eq(schema.teams.id, teamId)).run()
  }

  if (memberIds.length) {
    if (mode === 'set') {
      db.update(schema.users)
        .set({ allowedIps, updatedAt: ts })
        .where(inArray(schema.users.id, memberIds))
        .run()
      updated = memberIds.length
    } else {
      const rows = db.select().from(schema.users).where(inArray(schema.users.id, memberIds)).all()
      const incoming = deserializeAllowedIps(allowedIps)
      for (const row of rows) {
        const merged = serializeAllowedIps([
          ...deserializeAllowedIps(row.allowedIps),
          ...incoming,
        ])
        db.update(schema.users)
          .set({ allowedIps: merged, updatedAt: ts })
          .where(eq(schema.users.id, row.id))
          .run()
        updated += 1
      }
    }
  }

  const admin = getAuthUser(c)
  logActivity(admin, {
    action: 'user.bulk_login_ips',
    summary: `按团队「${team.name}」批量设置登录 IP（${updated} 人）`,
    resourceType: 'team',
    resourceId: teamId,
    metadata: {
      mode,
      also_set_team: alsoSetTeam,
      allowed_ips: deserializeAllowedIps(allowedIps),
      updated,
    },
  })

  return success(c, {
    team_id: teamId,
    team_name: team.name,
    updated,
    team_allowed_ips: alsoSetTeam ? deserializeAllowedIps(allowedIps) : deserializeAllowedIps(team.allowedIps),
    allowed_ips: deserializeAllowedIps(allowedIps),
  })
})

// PUT /users/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [row] = db.select().from(schema.users).where(eq(schema.users.id, id)).all()
  if (!row) return notFound(c, '用户不存在')

  const admin = getAuthUser(c)
  const updates: Record<string, unknown> = { updatedAt: now() }
  let freezeAction: 'user.freeze' | 'user.unfreeze' | null = null

  if (body.display_name !== undefined) updates.displayName = String(body.display_name).trim()
  if (body.role === 'admin' || body.role === 'user') updates.role = body.role
  if (body.is_active !== undefined) {
    const nextActive = Boolean(body.is_active)
    if (!nextActive && id === admin.id) return badRequest(c, '不能冻结当前登录账号')
    if (Boolean(row.isActive) !== nextActive) {
      freezeAction = nextActive ? 'user.unfreeze' : 'user.freeze'
    }
    updates.isActive = nextActive ? 1 : 0
  }
  if (body.password) {
    const pwd = String(body.password)
    if (pwd.length < 6) return badRequest(c, '密码至少 6 位')
    updates.passwordHash = hashPassword(pwd)
  }
  if (body.allowed_ips !== undefined) {
    updates.allowedIps = serializeAllowedIps(parseAllowedIpsInput(body.allowed_ips))
  }

  db.update(schema.users).set(updates).where(eq(schema.users.id, id)).run()
  if (freezeAction) {
    logActivity(admin, {
      action: freezeAction,
      summary: `${freezeAction === 'user.freeze' ? '冻结' : '解冻'}用户 ${row.username}`,
      resourceType: 'user',
      resourceId: id,
    })
  } else {
    logActivity(admin, {
      action: 'user.update',
      summary: `更新用户 ${row.username}`,
      resourceType: 'user',
      resourceId: id,
      metadata: body.allowed_ips !== undefined
        ? { allowed_ips: deserializeAllowedIps(updates.allowedIps as string | null) }
        : undefined,
    })
  }
  return success(c)
})

export default app
