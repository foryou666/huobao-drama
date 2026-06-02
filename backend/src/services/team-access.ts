import type { Context } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { forbidden, notFound } from '../utils/response.js'
import { getAuthUser, type AuthUser, type AuthVariables } from '../middleware/auth.js'
import {
  getUserTeams,
  userHasTeamAccess,
  ensureUserInDefaultTeam,
} from './teams.js'
import {
  userCanAccessDrama,
  userCanManageDrama,
} from './drama-shares.js'

export function resolveActiveTeamId(c: Context, user: AuthUser): number | null {
  const header = c.req.header('X-Team-Id')
  if (header) {
    const id = Number(header)
    if (id > 0) {
      if (user.role === 'admin' || userHasTeamAccess(user.id, id)) return id
    }
  }

  if (user.role === 'admin') return null

  const teams = getUserTeams(user.id)
  if (teams.length) return teams[0].id
  return ensureUserInDefaultTeam(user.id)
}

export function assertDramaTeamAccess(
  c: Context,
  drama: { id: number; teamId: number | null },
  user?: AuthUser,
) {
  const authUser = user || getAuthUser(c)
  if (userCanAccessDrama(drama, authUser)) return null
  return forbidden(c as Context<{ Variables: AuthVariables }>, '无权访问该团队项目')
}

/** 归属团队管理员（或平台管理员）才可执行的项目结构类操作 */
export function assertDramaAdminAccess(
  c: Context,
  drama: { teamId: number | null },
  user?: AuthUser,
) {
  const authUser = user || getAuthUser(c)
  if (userCanManageDrama(drama, authUser)) return null
  return forbidden(c as Context<{ Variables: AuthVariables }>, '需要团队管理员权限')
}

export const assertDramaOwnerAccess = assertDramaAdminAccess

export function loadDramaById(id: number) {
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  return drama ?? null
}

export function loadEpisodeById(id: number) {
  const [episode] = db.select().from(schema.episodes).where(eq(schema.episodes.id, id)).all()
  return episode ?? null
}

export function assertDramaAccess(c: Context, dramaId: number, user?: AuthUser) {
  const drama = loadDramaById(dramaId)
  if (!drama) return { drama: null, error: null }
  const err = assertDramaTeamAccess(c, drama, user)
  return { drama, error: err }
}

export function assertEpisodeTeamAccess(c: Context, episodeId: number, user?: AuthUser) {
  const episode = loadEpisodeById(episodeId)
  if (!episode || episode.deletedAt) {
    return { episode: null, drama: null, error: notFound(c as Context<{ Variables: AuthVariables }>, '集不存在') }
  }
  const drama = loadDramaById(episode.dramaId)
  if (!drama) {
    return { episode, drama: null, error: notFound(c as Context<{ Variables: AuthVariables }>, '剧本不存在') }
  }
  const err = assertDramaTeamAccess(c, drama, user)
  return { episode, drama, error: err }
}

export function assertEpisodeAdminAccess(c: Context, episodeId: number, user?: AuthUser) {
  const result = assertEpisodeTeamAccess(c, episodeId, user)
  if (result.error) return result
  const err = assertDramaAdminAccess(c, result.drama!, user)
  return { ...result, error: err }
}
