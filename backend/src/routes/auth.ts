import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, unauthorized, now } from '../utils/response.js'
import { verifyPassword } from '../utils/password.js'
import { signUserToken, requireAuth, type AuthVariables } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { getUserBalance, ensureUserCredits } from '../services/credits.js'
import { getUserTeams, ensureUserInDefaultTeam } from '../services/teams.js'

function userPayload(row: typeof schema.users.$inferSelect) {
  ensureUserCredits(row.id)
  ensureUserInDefaultTeam(row.id)
  const teams = getUserTeams(row.id)
  return {
    id: row.id,
    username: row.username,
    display_name: row.displayName || row.username,
    role: row.role as 'admin' | 'user',
    credits_balance: getUserBalance(row.id),
    teams,
    active_team_id: teams[0]?.id ?? null,
  }
}

const app = new Hono<{ Variables: AuthVariables }>()

// POST /auth/login
app.post('/login', async (c) => {
  const body = await c.req.json()
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!username || !password) return badRequest(c, '请输入用户名和密码')

  const [row] = db.select().from(schema.users).where(eq(schema.users.username, username)).all()
  if (!row || !verifyPassword(password, row.passwordHash)) {
    return unauthorized(c, '用户名或密码错误')
  }
  if (!row.isActive) {
    // 不暴露冻结状态，避免被探测账号是否存在/可用
    return unauthorized(c, '密码错误')
  }

  const ts = now()
  db.update(schema.users).set({ lastLoginAt: ts, updatedAt: ts }).where(eq(schema.users.id, row.id)).run()

  const user = {
    id: row.id,
    username: row.username,
    displayName: row.displayName || row.username,
    role: row.role as 'admin' | 'user',
  }
  const token = await signUserToken(user)
  logActivity(user, { action: 'auth.login', summary: '用户登录' })

  return success(c, {
    token,
    user: userPayload(row),
  })
})

// GET /auth/me
app.get('/me', requireAuth, async (c) => {
  const authUser = c.get('user')
  const [row] = db.select().from(schema.users).where(eq(schema.users.id, authUser.id)).all()
  if (!row) return unauthorized(c, '用户不存在')
  return success(c, userPayload(row))
})

export default app
