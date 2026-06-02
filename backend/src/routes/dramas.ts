import { Hono } from 'hono'
import { eq, isNull, like, desc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now, forbidden } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { normalizeDirectorStyle } from '../prompts/director-styles.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { resolveActiveTeamId, assertDramaTeamAccess, assertDramaAdminAccess } from '../services/team-access.js'
import { ensureUserInDefaultTeam } from '../services/teams.js'
import {
  dramaVisibleToTeam,
  getSharedDramaIdsByTeam,
  getSharesByDramaId,
  getOwnerTeamName,
  shareDramaWithTeam,
  unshareDramaFromTeam,
  userCanManageDramaShares,
  userCanManageDrama,
} from '../services/drama-shares.js'
import { assessDramaDeletion, assessEpisodeDeletion, toDeletionInfo } from '../services/deletion-guards.js'

const app = new Hono()

// GET /dramas - List dramas
app.get('/', async (c) => {
  const user = getAuthUser(c)
  const activeTeamId = resolveActiveTeamId(c, user)
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('page_size') || 20)
  const status = c.req.query('status')
  const keyword = c.req.query('keyword')
  const includeArchived = c.req.query('include_archived') === '1'

  let query = db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt))

  const allRows = await query.orderBy(desc(schema.dramas.updatedAt))
  let filtered = allRows

  if (!includeArchived) {
    filtered = filtered.filter(d => d.status !== 'archived')
  }

  if (activeTeamId != null) {
    const sharedIds = getSharedDramaIdsByTeam(activeTeamId)
    filtered = filtered.filter(d => dramaVisibleToTeam(d, activeTeamId, sharedIds))
  }

  if (status) filtered = filtered.filter(d => d.status === status)
  if (keyword) filtered = filtered.filter(d => d.title.includes(keyword))

  const total = filtered.length
  const items = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Attach episode/character/scene counts
  const enriched = await Promise.all(items.map(async (drama) => {
    const eps = await db.select().from(schema.episodes)
      .where(eq(schema.episodes.dramaId, drama.id))
    const activeEps = eps.filter(e => !e.deletedAt)
    const chars = await db.select().from(schema.characters)
      .where(eq(schema.characters.dramaId, drama.id))
    const scns = await db.select().from(schema.scenes)
      .where(eq(schema.scenes.dramaId, drama.id))
    const sharedTeams = getSharesByDramaId(drama.id)
    const deletion = toDeletionInfo(assessDramaDeletion(drama.id))
    return {
      ...toSnakeCase(drama),
      tags: drama.tags ? JSON.parse(drama.tags) : [],
      total_episodes: activeEps.length,
      episodes: toSnakeCaseArray(activeEps),
      characters: toSnakeCaseArray(chars.filter(ch => !ch.deletedAt)),
      scenes: toSnakeCaseArray(scns.filter(s => !s.deletedAt)),
      shared_teams: sharedTeams,
      is_shared_project: activeTeamId != null && drama.teamId !== activeTeamId,
      owner_team_name: getOwnerTeamName(drama.teamId),
      can_manage_drama: userCanManageDrama(drama, user),
      is_archived: drama.status === 'archived',
      ...deletion,
    }
  }))

  return success(c, {
    items: enriched,
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  })
})

// POST /dramas - Create drama
app.post('/', async (c) => {
  const user = getAuthUser(c)
  const body = await c.req.json()
  const ts = now()
  let teamId = resolveActiveTeamId(c, user)
  if (teamId == null) {
    teamId = ensureUserInDefaultTeam(user.id)
  }
  const res = db.insert(schema.dramas).values({
    title: body.title,
    description: body.description,
    genre: body.genre,
    style: body.style,
    tags: body.tags ? JSON.stringify(body.tags) : null,
    metadata: body.metadata,
    directorStyle: normalizeDirectorStyle(body.director_style),
    teamId,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const [result] = db.select().from(schema.dramas)
    .where(eq(schema.dramas.id, Number(res.lastInsertRowid))).all()

  // Create default episodes
  const totalEpisodes = body.total_episodes || 1
  for (let i = 1; i <= totalEpisodes; i++) {
    db.insert(schema.episodes).values({
      dramaId: result.id,
      episodeNumber: i,
      title: `第${i}集`,
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    }).run()
  }

  logActivity(getAuthUser(c), {
    action: 'drama.create',
    summary: `创建项目「${result.title}」`,
    resourceType: 'drama',
    resourceId: result.id,
    dramaId: result.id,
    metadata: { total_episodes: totalEpisodes },
  })

  return created(c, toSnakeCase(result))
})


// GET /dramas/stats — must be before /:id
app.get('/stats', async (c) => {
  const user = getAuthUser(c)
  const activeTeamId = resolveActiveTeamId(c, user)
  let all = db.select().from(schema.dramas).where(isNull(schema.dramas.deletedAt)).all()
  if (activeTeamId != null) {
    const sharedIds = getSharedDramaIdsByTeam(activeTeamId)
    all = all.filter(d => dramaVisibleToTeam(d, activeTeamId, sharedIds))
  }
  const byStatus = Object.entries(
    all.reduce((acc, d) => {
      acc[d.status || 'draft'] = (acc[d.status || 'draft'] || 0) + 1
      return acc
    }, {} as Record<string, number>)
  ).map(([status, count]) => ({ status, count }))
  return success(c, { total: all.length, by_status: byStatus })
})

// GET /dramas/:id/shares
app.get('/:id/shares', async (c) => {
  const id = Number(c.req.param('id'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!drama) return notFound(c, '剧本不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied
  const user = getAuthUser(c)
  return success(c, {
    owner_team_id: drama.teamId,
    owner_team_name: getOwnerTeamName(drama.teamId),
    shared_teams: getSharesByDramaId(id),
    can_manage: userCanManageDramaShares(drama, user),
  })
})

// POST /dramas/:id/shares
app.post('/:id/shares', async (c) => {
  const id = Number(c.req.param('id'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!drama) return notFound(c, '剧本不存在')
  const user = getAuthUser(c)
  if (!userCanManageDramaShares(drama, user)) {
    return forbidden(c, '仅归属团队管理员可管理共享')
  }
  const body = await c.req.json()
  const teamId = Number(body.team_id)
  if (!teamId) return badRequest(c, '请选择团队')
  if (teamId === drama.teamId) return badRequest(c, '不能共享给归属团队本身')
  shareDramaWithTeam(id, teamId, drama.teamId)
  logActivity(user, {
    action: 'drama.share',
    summary: `共享项目「${drama.title}」给团队 #${teamId}`,
    resourceType: 'drama',
    resourceId: id,
    dramaId: id,
    metadata: { team_id: teamId },
  })
  return created(c, { shared_teams: getSharesByDramaId(id) })
})

// DELETE /dramas/:id/shares/:teamId
app.delete('/:id/shares/:teamId', async (c) => {
  const id = Number(c.req.param('id'))
  const teamId = Number(c.req.param('teamId'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!drama) return notFound(c, '剧本不存在')
  const user = getAuthUser(c)
  if (!userCanManageDramaShares(drama, user)) {
    return forbidden(c, '仅归属团队管理员可管理共享')
  }
  unshareDramaFromTeam(id, teamId)
  logActivity(user, {
    action: 'drama.unshare',
    summary: `取消项目「${drama.title}」对团队 #${teamId} 的共享`,
    resourceType: 'drama',
    resourceId: id,
    dramaId: id,
    metadata: { team_id: teamId },
  })
  return success(c, { shared_teams: getSharesByDramaId(id) })
})

// GET /dramas/:id - Get drama detail
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, id))
  if (!drama) return notFound(c, '剧本不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied

  const eps = await db.select().from(schema.episodes)
    .where(eq(schema.episodes.dramaId, id))
    .all()
  const activeEps = eps.filter(e => !e.deletedAt)
  const chars = await db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, id))
  const scns = await db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, id))
  const prps = await db.select().from(schema.props)
    .where(eq(schema.props.dramaId, id))

  const deletion = toDeletionInfo(assessDramaDeletion(id))
  const episodesWithDeletion = activeEps.map(ep => ({
    ...toSnakeCase(ep),
    ...toDeletionInfo(assessEpisodeDeletion(ep.id)),
  }))

  return success(c, {
    ...toSnakeCase(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    episodes: episodesWithDeletion,
    characters: toSnakeCaseArray(chars.filter(ch => !ch.deletedAt)),
    scenes: toSnakeCaseArray(scns.filter(s => !s.deletedAt)),
    props: toSnakeCaseArray(prps.filter(p => !p.deletedAt)),
    shared_teams: getSharesByDramaId(id),
    owner_team_name: getOwnerTeamName(drama.teamId),
    can_manage_shares: userCanManageDramaShares(drama, getAuthUser(c)),
    can_manage_drama: userCanManageDrama(drama, getAuthUser(c)),
    is_archived: drama.status === 'archived',
    ...deletion,
  })
})

// PUT /dramas/:id - Update drama
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [existing] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!existing) return notFound(c, '剧本不存在')
  const denied = assertDramaAdminAccess(c, existing)
  if (denied) return denied
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  if (body.title !== undefined) updates.title = body.title
  if (body.description !== undefined) updates.description = body.description
  if (body.genre !== undefined) updates.genre = body.genre
  if (body.style !== undefined) updates.style = body.style
  if (body.status !== undefined) updates.status = body.status
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags)
  if (body.metadata !== undefined) updates.metadata = body.metadata
  if (body.image_aspect_ratio !== undefined) updates.imageAspectRatio = body.image_aspect_ratio
  if (body.director_style !== undefined) updates.directorStyle = normalizeDirectorStyle(body.director_style)
  db.update(schema.dramas).set(updates).where(eq(schema.dramas.id, id)).run()
  logActivity(getAuthUser(c), {
    action: 'drama.update',
    summary: `更新项目 #${id}`,
    resourceType: 'drama',
    resourceId: id,
    dramaId: id,
  })
  return success(c)
})

// POST /dramas/:id/archive — hide from list without deleting content
app.post('/:id/archive', async (c) => {
  const id = Number(c.req.param('id'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!drama) return notFound(c, '剧本不存在')
  const denied = assertDramaAdminAccess(c, drama)
  if (denied) return denied
  if (drama.status === 'archived') return success(c, { status: 'archived' })
  db.update(schema.dramas).set({ status: 'archived', updatedAt: now() }).where(eq(schema.dramas.id, id)).run()
  logActivity(getAuthUser(c), {
    action: 'drama.archive',
    summary: `归档项目「${drama.title}」`,
    resourceType: 'drama',
    resourceId: id,
    dramaId: id,
  })
  return success(c, { status: 'archived' })
})

// POST /dramas/:id/restore — restore archived project
app.post('/:id/restore', async (c) => {
  const id = Number(c.req.param('id'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!drama) return notFound(c, '剧本不存在')
  const denied = assertDramaAdminAccess(c, drama)
  if (denied) return denied
  db.update(schema.dramas).set({ status: 'draft', updatedAt: now() }).where(eq(schema.dramas.id, id)).run()
  logActivity(getAuthUser(c), {
    action: 'drama.restore',
    summary: `恢复项目「${drama.title}」`,
    resourceType: 'drama',
    resourceId: id,
    dramaId: id,
  })
  return success(c, { status: 'draft' })
})

// DELETE /dramas/:id - Soft delete (empty projects only)
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!drama) return notFound(c, '剧本不存在')
  const denied = assertDramaAdminAccess(c, drama)
  if (denied) return denied
  const check = assessDramaDeletion(id)
  if (!check.allowed) return badRequest(c, check.reason || '项目含制作内容，无法删除')
  await db.update(schema.dramas).set({ deletedAt: now(), updatedAt: now() }).where(eq(schema.dramas.id, id))
  logActivity(getAuthUser(c), {
    action: 'drama.delete',
    summary: `删除项目「${drama?.title || id}」`,
    resourceType: 'drama',
    resourceId: id,
    dramaId: id,
  })
  return success(c)
})

// PUT /dramas/:id/characters - Save characters
app.put('/:id/characters', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, '剧本不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied
  const body = await c.req.json()
  const chars = body.characters || []
  const ts = now()

  for (const char of chars) {
    if (char.id) {
      await db.update(schema.characters).set({ ...char, updatedAt: ts }).where(eq(schema.characters.id, char.id))
    } else {
      await db.insert(schema.characters).values({ ...char, dramaId, createdAt: ts, updatedAt: ts })
    }
  }
  return success(c)
})

// PUT /dramas/:id/episodes - Save episodes
app.put('/:id/episodes', async (c) => {
  const dramaId = Number(c.req.param('id'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).all()
  if (!drama) return notFound(c, '剧本不存在')
  const denied = assertDramaAdminAccess(c, drama)
  if (denied) return denied
  const body = await c.req.json()
  const episodes = body.episodes || []
  const ts = now()

  for (const ep of episodes) {
    if (ep.id) {
      await db.update(schema.episodes).set({ ...ep, updatedAt: ts }).where(eq(schema.episodes.id, ep.id))
    } else {
      await db.insert(schema.episodes).values({
        ...ep,
        dramaId,
        episodeNumber: ep.episode_number || ep.episodeNumber || 1,
        title: ep.title || '未命名',
        createdAt: ts,
        updatedAt: ts,
      })
    }
  }
  return success(c)
})

export default app
