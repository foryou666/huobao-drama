import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { forbidden } from '../utils/response.js'
import type { AuthUser, AuthVariables } from '../middleware/auth.js'
import { resolveActiveTeamId } from './team-access.js'
import { getTeamMemberRole, userHasTeamAccess } from './teams.js'

export function getTeamMemberUserIds(teamId: number): number[] {
  return db.select().from(schema.teamMembers)
    .where(eq(schema.teamMembers.teamId, teamId))
    .all()
    .map(m => m.userId)
}

export function canViewTeamAudit(user: AuthUser, teamId: number): boolean {
  if (user.role === 'admin') return true
  if (!userHasTeamAccess(user.id, teamId)) return false
  const role = getTeamMemberRole(user.id, teamId)
  return role === 'owner' || role === 'admin'
}

export type AuditScopeMode = 'self' | 'team' | 'all'

export interface AuditScope {
  mode: AuditScopeMode
  userIds?: number[]
  teamId?: number
}

type AuditScopeResult =
  | { ok: true; scope: AuditScope }
  | { ok: false; response: Response }

export function resolveAuditScope(
  c: Context<{ Variables: AuthVariables }>,
  user: AuthUser,
  opts: {
    all?: boolean
    team?: boolean
    teamId?: number
    userId?: number
  },
): AuditScopeResult {
  const teamIdParam = opts.teamId
  const activeTeamId = resolveActiveTeamId(c, user)
  const teamId = teamIdParam || (opts.team ? activeTeamId : null)

  if (opts.all) {
    if (user.role !== 'admin') {
      return { ok: false, response: forbidden(c, '需要管理员权限') }
    }
    if (opts.userId) return { ok: true, scope: { mode: 'all', userIds: [opts.userId] } }
    return { ok: true, scope: { mode: 'all' } }
  }

  if (teamId) {
    if (!canViewTeamAudit(user, teamId)) {
      return { ok: false, response: forbidden(c, '需要团队管理员权限') }
    }
    const memberIds = getTeamMemberUserIds(teamId)
    if (opts.userId) {
      if (!memberIds.includes(opts.userId)) {
        return { ok: false, response: forbidden(c, '该用户不在当前团队') }
      }
      return { ok: true, scope: { mode: 'team', userIds: [opts.userId], teamId } }
    }
    return { ok: true, scope: { mode: 'team', userIds: memberIds, teamId } }
  }

  if (opts.userId) {
    if (user.role === 'admin') return { ok: true, scope: { mode: 'all', userIds: [opts.userId] } }
    return { ok: false, response: forbidden(c, '需要管理员权限') }
  }

  return { ok: true, scope: { mode: 'self', userIds: [user.id] } }
}
