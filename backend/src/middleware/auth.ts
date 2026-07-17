import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { unauthorized, forbidden } from '../utils/response.js'

export type UserRole = 'admin' | 'user'

export interface AuthUser {
  id: number
  username: string
  displayName: string
  role: UserRole
}

export type AuthVariables = { user: AuthUser }

const AUTH_SECRET = () => process.env.AUTH_SECRET || 'huobao-drama-dev-secret-change-me'

export function getAuthSecret() {
  return AUTH_SECRET()
}

export async function signUserToken(user: AuthUser) {
  const { sign } = await import('hono/jwt')
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 // 7 days
  return sign(
    { sub: String(user.id), username: user.username, role: user.role, display_name: user.displayName, exp },
    getAuthSecret(),
  )
}

function parseBearer(header?: string) {
  if (!header?.startsWith('Bearer ')) return null
  return header.slice(7).trim() || null
}

export type AuthResolveResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: 'invalid_token' | 'not_found' | 'frozen' }

export async function resolveAuthUserDetailed(token: string): Promise<AuthResolveResult> {
  try {
    const payload = await verify(token, getAuthSecret(), 'HS256')
    const userId = Number(payload.sub)
    if (!userId) return { ok: false, reason: 'invalid_token' }
    const [row] = db.select().from(schema.users).where(eq(schema.users.id, userId)).all()
    if (!row) return { ok: false, reason: 'not_found' }
    if (!row.isActive) return { ok: false, reason: 'frozen' }
    return {
      ok: true,
      user: {
        id: row.id,
        username: row.username,
        displayName: row.displayName || row.username,
        role: row.role as UserRole,
      },
    }
  } catch {
    return { ok: false, reason: 'invalid_token' }
  }
}

export async function resolveAuthUser(token: string): Promise<AuthUser | null> {
  const result = await resolveAuthUserDetailed(token)
  return result.ok ? result.user : null
}

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const path = c.req.path
  if (path === '/auth/login' || path.endsWith('/auth/login')) return next()

  const token = parseBearer(c.req.header('Authorization'))
  if (!token) return unauthorized(c, '请先登录')
  const result = await resolveAuthUserDetailed(token)
  if (!result.ok) {
    if (result.reason === 'frozen') return unauthorized(c, '账号已冻结，请联系管理员')
    return unauthorized(c, '登录已失效，请重新登录')
  }
  c.set('user', result.user)
  await next()
})

export const requireAdmin = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const user = c.get('user')
  if (user.role !== 'admin') return forbidden(c, '需要管理员权限')
  await next()
})

export function getAuthUser(c: Context): AuthUser {
  return (c as Context<{ Variables: AuthVariables }>).get('user')
}

export function denyUnlessAdmin(c: Context) {
  if (getAuthUser(c).role !== 'admin') return forbidden(c as Context<{ Variables: AuthVariables }>, '需要管理员权限')
  return null
}
