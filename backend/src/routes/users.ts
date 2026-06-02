import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, created, now, notFound } from '../utils/response.js'
import { hashPassword } from '../utils/password.js'
import { requireAuth, requireAdmin, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { getUserBalance } from '../services/credits.js'
import { addUserToTeam, getDefaultTeamId, ensureUserInDefaultTeam } from '../services/teams.js'
import { resolveActiveTeamId } from '../services/team-access.js'

const app = new Hono<{ Variables: AuthVariables }>()

app.use('*', requireAuth, requireAdmin)

// GET /users
app.get('/', async (c) => {
  const rows = db.select().from(schema.users).orderBy(desc(schema.users.id)).all()
  return success(c, {
    items: rows.map(r => ({
      id: r.id,
      username: r.username,
      display_name: r.displayName,
      role: r.role,
      is_active: Boolean(r.isActive),
      credits_balance: getUserBalance(r.id),
      last_login_at: r.lastLoginAt,
      created_at: r.createdAt,
    })),
  })
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

  const ts = now()
  const res = db.insert(schema.users).values({
    username,
    passwordHash: hashPassword(password),
    displayName,
    role,
    isActive: true,
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

  return created(c, {
    id: row.id,
    username: row.username,
    display_name: row.displayName,
    role: row.role,
  })
})

// PUT /users/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [row] = db.select().from(schema.users).where(eq(schema.users.id, id)).all()
  if (!row) return notFound(c, '用户不存在')

  const updates: Record<string, unknown> = { updatedAt: now() }
  if (body.display_name !== undefined) updates.displayName = String(body.display_name).trim()
  if (body.role === 'admin' || body.role === 'user') updates.role = body.role
  if (body.is_active !== undefined) updates.isActive = body.is_active ? 1 : 0
  if (body.password) {
    const pwd = String(body.password)
    if (pwd.length < 6) return badRequest(c, '密码至少 6 位')
    updates.passwordHash = hashPassword(pwd)
  }

  db.update(schema.users).set(updates).where(eq(schema.users.id, id)).run()
  logActivity(getAuthUser(c), {
    action: 'user.update',
    summary: `更新用户 ${row.username}`,
    resourceType: 'user',
    resourceId: id,
  })
  return success(c)
})

export default app
