import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, unauthorized, now } from '../utils/response.js'
import { verifyPassword } from '../utils/password.js'
import { signUserToken, requireAuth, type AuthVariables } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { getUserBalance, ensureUserCredits } from '../services/credits.js'
import { getUserTeams, ensureUserInDefaultTeam } from '../services/teams.js'
import { getClientIp } from '../utils/client-ip.js'
import { evaluateLoginIpAccess } from '../utils/login-ip.js'

function userPayload(row: typeof schema.users.$inferSelect) {
  ensureUserCredits(row.id)
  ensureUserInDefaultTeam(row.id)
  const teams = getUserTeams(row.id)
  const payload = {
    id: row.id,
    username: row.username,
    display_name: row.displayName || row.username,
    role: row.role as 'admin' | 'user',
    credits_balance: getUserBalance(row.id),
    teams,
    active_team_id: teams[0]?.id ?? null,
    can_use_funshion: true,
  }
  return payload
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

  const clientIp = getClientIp(c)
  const ipDecision = evaluateLoginIpAccess({
    userId: row.id,
    role: row.role,
    userAllowedIpsRaw: row.allowedIps,
    clientIp,
  })
  if (!ipDecision.allowed) {
    logActivity(
      { id: row.id, username: row.username, displayName: row.displayName || row.username, role: row.role as 'admin' | 'user' },
      {
        action: 'auth.login_denied_ip',
        summary: `登录被拒：IP ${ipDecision.clientIp || '未知'}`,
        metadata: { client_ip: ipDecision.clientIp, reason: ipDecision.reason },
      },
    )
    return unauthorized(c, ipDecision.reason || '当前网络环境不允许登录')
  }

  const ts = now()
  db.update(schema.users).set({
    lastLoginAt: ts,
    lastLoginIp: clientIp || null,
    updatedAt: ts,
  }).where(eq(schema.users.id, row.id)).run()

  const user = {
    id: row.id,
    username: row.username,
    displayName: row.displayName || row.username,
    role: row.role as 'admin' | 'user',
  }
  const token = await signUserToken(user)
  logActivity(user, {
    action: 'auth.login',
    summary: clientIp ? `用户登录（${clientIp}）` : '用户登录',
    metadata: clientIp ? { client_ip: clientIp } : undefined,
  })

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
