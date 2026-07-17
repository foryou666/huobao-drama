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
import { episodeSummaryToSnakeCase, getEpisodeSummariesForDrama } from '../services/episode-summary.js'
import {
  enrichPropForStudio,
  hydratePropImagesFromLinkedAssets,
  reconcileOrphanAssets,
} from '../services/asset-library.js'
import { enrichDramaListItems } from '../services/drama-list-enrichment.js'
import {
  boardTitleForDrama,
  ensureBoardForDrama,
  getBoardByDramaId,
  softDeleteBoardByDramaId,
} from '../services/canvas-boards.js'
import { generateImage } from '../services/image-generation.js'
import { listCharacterImages } from '../utils/character-image-variants.js'
import { listSceneImages } from '../utils/scene-image-variants.js'
import { tryChargeImageUser, tryRefundCharge, CREDIT_ACTIONS } from '../utils/credit-charge.js'
import { resolveBillingImageModel, resolveBillingImageProvider } from '../utils/image-billing.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import {
  COVER_ASPECT_RATIOS,
  getImageSizeForAspectRatio,
  resolveCoverAspectRatio,
  type CoverAspectRatio,
} from '../utils/image-size.js'

/** 封面候选图可生成比例（短剧常用 9:16 / 16:9；亦兼容旧 3:4 / 4:3） */
type CoverGenerateAspectRatio = '9:16' | '16:9' | '3:4' | '4:3'
import { getMaxImageReferenceCount } from '../utils/image-reference-limits.js'
import { resolveImageGenerationConfig } from '../utils/image-config-routing.js'
import { imageReferenceSupportHint, supportsImageReference } from '../utils/image-reference-support.js'

const app = new Hono()

function parseDramaMetadata(raw: string | null | undefined): Record<string, any> {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** 短剧海报共用提示词（不含比例约束，比例在生成时按所选比例追加） */
function buildDramaCoverBasePrompt(
  drama: typeof schema.dramas.$inferSelect,
  opts?: { characterNames?: string[]; sceneNames?: string[] },
) {
  const style = drama.style || 'cinematic'
  const genre = drama.genre || '短剧'
  const desc = String(drama.description || '').trim()
  const bits = [
    '短剧海报封面',
    `必须在画面中清晰写出剧名《${drama.title}》，标题醒目、完整可读，排版美观（可位于画面上方或主视觉旁）`,
    '电影级光影与人物/场景主视觉，构图饱满，适合作为项目封面与短剧海报',
    genre ? `题材：${genre}` : '',
    style ? `画风：${style}` : '',
    desc ? `故事氛围：${desc.slice(0, 200)}` : '',
    opts?.characterNames?.length ? `主要角色：${opts.characterNames.slice(0, 8).join('、')}` : '',
    opts?.sceneNames?.length ? `场景元素：${opts.sceneNames.slice(0, 6).join('、')}` : '',
    '参考图中的角色与场景需保持一致性',
    '禁止平台水印、字幕条、边框与 UI 控件；剧名文字必须保留',
  ].filter(Boolean)
  return bits.join('。')
}

function resolveCoverGenerateAspectRatio(raw?: string | null): CoverGenerateAspectRatio | null {
  const s = String(raw || '').trim()
  if (s === '9:16' || s === '16:9' || s === '3:4' || s === '4:3') return s
  return null
}

function coverAspectPromptLine(aspectRatio: CoverGenerateAspectRatio): string {
  if (aspectRatio === '9:16') return '严格 9:16 竖构图（portrait，宽:高=9:16，短剧竖屏海报）'
  if (aspectRatio === '16:9') return '严格 16:9 横构图（landscape，宽:高=16:9）'
  if (aspectRatio === '3:4') return '严格 3:4 竖构图（portrait，宽:高=3:4）'
  return '严格 4:3 横构图（landscape，宽:高=4:3）'
}

function buildDramaCoverPrompt(
  drama: typeof schema.dramas.$inferSelect,
  aspectRatio: CoverGenerateAspectRatio,
  customPrompt?: string,
  opts?: { characterNames?: string[]; sceneNames?: string[] },
) {
  const base = customPrompt?.trim() || buildDramaCoverBasePrompt(drama, opts)
  const aspectLine = coverAspectPromptLine(aspectRatio)
  // 用户自定义提示词已含比例句时不再重复追加
  if (
    base.includes('9:16') || base.includes('16:9')
    || base.includes('3:4') || base.includes('4:3')
    || base.includes('竖构图') || base.includes('横构图')
  ) {
    return base
  }
  return `${base}。${aspectLine}`
}

/** 默认只生成 1 张（9:16），节省成本；前端可显式传多个比例 */
function normalizeCoverAspectRatios(raw: unknown): CoverGenerateAspectRatio[] {
  const list = Array.isArray(raw) ? raw : ['9:16']
  const out: CoverGenerateAspectRatio[] = []
  for (const item of list) {
    const ratio = resolveCoverGenerateAspectRatio(String(item || ''))
    if (ratio && !out.includes(ratio)) out.push(ratio)
  }
  return out.length ? out : ['9:16']
}

function coverAspectFromSize(size?: string | null): CoverGenerateAspectRatio | null {
  const s = String(size || '').trim().toLowerCase()
  if (s === '1080x1920' || s === '9:16') return '9:16'
  if (s === '1920x1080' || s === '16:9') return '16:9'
  if (s === '1080x1440' || s === '3:4') return '3:4'
  if (s === '1440x1080' || s === '4:3') return '4:3'
  const m = s.match(/^(\d+)\s*x\s*(\d+)$/)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!w || !h) return null
  const ar = w / h
  if (Math.abs(ar - 9 / 16) < 0.08) return '9:16'
  if (Math.abs(ar - 16 / 9) < 0.08) return '16:9'
  if (Math.abs(ar - 3 / 4) < 0.08) return '3:4'
  if (Math.abs(ar - 4 / 3) < 0.08) return '4:3'
  return null
}

function entityImagePath(row: { localPath?: string | null; imageUrl?: string | null }): string | null {
  const local = String(row.localPath || '').trim()
  if (local) return local
  const url = String(row.imageUrl || '').trim()
  if (url.startsWith('static/') || url.startsWith('/static/')) {
    return url.replace(/^\/+/, '')
  }
  return url || null
}

function normalizeRefPath(raw: unknown): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function parseImageRefsMap(raw: unknown): Record<number, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<number, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = Number(key)
    const path = normalizeRefPath(value)
    if (!Number.isFinite(id) || id <= 0 || !path) continue
    out[id] = path
  }
  return out
}

// GET /dramas - List dramas
app.get('/', async (c) => {
  const user = getAuthUser(c)
  const activeTeamId = resolveActiveTeamId(c, user)
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('page_size') || 20)
  const status = c.req.query('status')
  const keyword = c.req.query('keyword')
  const includeArchived = c.req.query('include_archived') === '1'
  const lite = c.req.query('lite') === '1' || c.req.query('picker') === '1'

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

  if (lite) {
    return success(c, {
      items: items.map(drama => ({
        id: drama.id,
        title: drama.title,
        status: drama.status,
        is_archived: drama.status === 'archived',
      })),
      pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
    })
  }

  const enriched = await enrichDramaListItems(items, { activeTeamId, user })

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

  // 项目与画布 1:1：创建项目时自动生成画布
  ensureBoardForDrama(result, user.id, { syncNodes: true })

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
// workbench=1：分镜工作台轻量加载（跳过全库扫描式删除评估与每集摘要，打开第 N 集时显著更快）
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const workbench = ['1', 'true', 'yes'].includes(String(c.req.query('workbench') || '').toLowerCase())
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, id))
  if (!drama) return notFound(c, '剧本不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied

  if (!workbench) {
    reconcileOrphanAssets(id)
    hydratePropImagesFromLinkedAssets(id)
  }

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

  let episodesOut = activeEps.map(ep => toSnakeCase(ep))
  let deletion: Record<string, unknown> = {}
  if (!workbench) {
    deletion = toDeletionInfo(assessDramaDeletion(id))
    const episodeSummaries = getEpisodeSummariesForDrama(id, activeEps.map(ep => ep.id))
    episodesOut = activeEps.map(ep => ({
      ...toSnakeCase(ep),
      ...toDeletionInfo(assessEpisodeDeletion(ep.id)),
      summary: episodeSummaryToSnakeCase(episodeSummaries.get(ep.id) || {
        script: {
          has_script: false,
          has_source: false,
          script_char_count: 0,
          source_char_count: 0,
          estimate_duration_sec: 0,
        },
        activity: {
          total: 0,
          operator_count: 0,
          recent_operators: [],
          last_operator_name: null,
          last_operated_at: null,
        },
        characters: { total: 0, with_image: 0 },
        scenes: { total: 0, with_image: 0 },
        storyboards: { total: 0, with_image: 0, with_video: 0 },
        last_operator_name: null,
        last_operated_at: null,
      }),
    }))
  }

  const dramaMeta = parseDramaMetadata(drama.metadata)
  const dramaCoversRaw = dramaMeta.covers && typeof dramaMeta.covers === 'object' ? dramaMeta.covers : {}
  const dramaCovers = {
    '3:4': String(dramaCoversRaw['3:4'] || drama.thumbnail || '').trim() || null,
    '4:3': String(dramaCoversRaw['4:3'] || '').trim() || null,
  }

  return success(c, {
    ...toSnakeCase(drama),
    tags: drama.tags ? JSON.parse(drama.tags) : [],
    covers: dramaCovers,
    cover_3_4: dramaCovers['3:4'],
    cover_4_3: dramaCovers['4:3'],
    episodes: episodesOut,
    characters: toSnakeCaseArray(chars.filter(ch => !ch.deletedAt)),
    scenes: toSnakeCaseArray(scns.filter(s => !s.deletedAt)),
    props: prps.filter(p => !p.deletedAt).map((prop) => {
      const enriched = enrichPropForStudio(prop)
      return {
        ...toSnakeCase(enriched),
        prop_media: toSnakeCase(enriched.propMedia),
      }
    }),
    shared_teams: getSharesByDramaId(id),
    owner_team_name: getOwnerTeamName(drama.teamId),
    can_manage_shares: userCanManageDramaShares(drama, getAuthUser(c)),
    can_manage_drama: userCanManageDrama(drama, getAuthUser(c)),
    is_archived: drama.status === 'archived',
    ...deletion,
  })
})

const DRAMA_ADMIN_UPDATE_KEYS = [
  'title', 'description', 'genre', 'style', 'status', 'tags', 'metadata', 'director_style',
] as const

// PUT /dramas/:id - Update drama
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [existing] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!existing) return notFound(c, '剧本不存在')
  const teamDenied = assertDramaTeamAccess(c, existing)
  if (teamDenied) return teamDenied
  const body = await c.req.json()
  const needsAdmin = DRAMA_ADMIN_UPDATE_KEYS.some(key => body[key] !== undefined)
  if (needsAdmin) {
    const adminDenied = assertDramaAdminAccess(c, existing)
    if (adminDenied) return adminDenied
  }
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
  if (body.thumbnail !== undefined) updates.thumbnail = body.thumbnail
  db.update(schema.dramas).set(updates).where(eq(schema.dramas.id, id)).run()
  if (body.title !== undefined || body.thumbnail !== undefined) {
    const board = getBoardByDramaId(id)
    if (board) {
      const boardUpdates: Record<string, any> = { updatedAt: now() }
      if (body.title !== undefined) boardUpdates.title = boardTitleForDrama(String(body.title))
      if (body.thumbnail !== undefined) boardUpdates.thumbnail = body.thumbnail
      db.update(schema.canvasBoards).set(boardUpdates).where(eq(schema.canvasBoards.id, board.id)).run()
    }
  }
  logActivity(getAuthUser(c), {
    action: 'drama.update',
    summary: `更新项目 #${id}`,
    resourceType: 'drama',
    resourceId: id,
    dramaId: id,
  })
  return success(c)
})

// GET /dramas/:id/cover-candidates — 已生成的封面候选图（供弹窗挑选裁切）
app.get('/:id/cover-candidates', async (c) => {
  const id = Number(c.req.param('id'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!drama || drama.deletedAt) return notFound(c, '项目不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied

  // 只返回最近候选，避免弹窗一次拉全量历史图导致卡顿
  const limit = Math.min(80, Math.max(1, Number(c.req.query('limit') || 40)))
  const rows = db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.dramaId, id))
    .all()
    .filter(row => row.imageType === 'drama_cover_candidate')
    .sort((a, b) => b.id - a.id)
    .slice(0, limit)

  const items = rows.map((row) => {
    const path = entityImagePath(row)
    return {
      id: row.id,
      status: row.status,
      aspect_ratio: coverAspectFromSize(row.size),
      size: row.size,
      local_path: row.localPath,
      image_url: row.imageUrl,
      path,
      prompt: row.prompt,
      created_at: row.createdAt,
      completed_at: row.completedAt,
      error_msg: row.errorMsg,
    }
  })

  return success(c, { items, limit })
})

// POST /dramas/:id/generate-cover — AI 生成项目/画布封面（默认 1 张 3:4；可选角色/场景参考图）
app.post('/:id/generate-cover', async (c) => {
  const id = Number(c.req.param('id'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!drama || drama.deletedAt) return notFound(c, '项目不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied

  const body = await c.req.json().catch(() => ({}))
  const aspectRatios = normalizeCoverAspectRatios(body.aspect_ratios)

  // 与图片工作台一致：固定 gpt-image-2，由路由选上游，不暴露/不接受渠道选择
  const studioModel = 'gpt-image-2'
  let config
  try {
    config = resolveImageGenerationConfig({ model: studioModel })
  } catch (err: any) {
    return badRequest(c, err?.message || '图片服务配置不可用')
  }

  const allChars = db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, id)).all()
    .filter(ch => !ch.deletedAt)
  const allScenes = db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, id)).all()
    .filter(sc => !sc.deletedAt)

  // 显式传 character_ids（含空数组）时不再默认全选角色
  const characterIds = Array.isArray(body.character_ids)
    ? body.character_ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
    : []
  const sceneIds = Array.isArray(body.scene_ids)
    ? body.scene_ids.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
    : []
  const characterImageRefs = parseImageRefsMap(body.character_image_refs)
  const sceneImageRefs = parseImageRefsMap(body.scene_image_refs)

  const selectedChars = allChars.filter(ch => characterIds.includes(ch.id))
  const selectedScenes = allScenes.filter(sc => sceneIds.includes(sc.id))

  const resolveEntityRef = (
    entity: { id: number; localPath?: string | null; imageUrl?: string | null },
    preferred: string | undefined,
    allowedUrls: string[],
  ) => {
    const preferredNorm = normalizeRefPath(preferred)
    if (preferredNorm) {
      const hit = allowedUrls.find(url => normalizeRefPath(url) === preferredNorm)
      if (hit) return normalizeRefPath(hit)
    }
    return entityImagePath(entity)
  }

  const maxRefs = getMaxImageReferenceCount(config)
  const referenceImages: string[] = []
  for (const ch of selectedChars) {
    const allowed = listCharacterImages(ch).map(item => item.url).filter(Boolean)
    const path = resolveEntityRef(ch, characterImageRefs[ch.id], allowed)
    if (path && !referenceImages.includes(path)) referenceImages.push(path)
    if (referenceImages.length >= maxRefs) break
  }
  if (referenceImages.length < maxRefs) {
    for (const sc of selectedScenes) {
      const allowed = listSceneImages(sc).map(item => item.url).filter(Boolean)
      const path = resolveEntityRef(sc, sceneImageRefs[sc.id], allowed)
      if (path && !referenceImages.includes(path)) referenceImages.push(path)
      if (referenceImages.length >= maxRefs) break
    }
  }
  if (referenceImages.length && !supportsImageReference(config.provider, studioModel)) {
    return badRequest(c, imageReferenceSupportHint())
  }

  const characterNames = selectedChars.map(ch => ch.name).filter(Boolean)
  const sceneNames = selectedScenes.map(sc => [sc.location, sc.time].filter(Boolean).join('·')).filter(Boolean)

  const chargeTxIds: number[] = []
  let lastBalance: number | undefined
  let totalCost = 0
  const items: Array<{ aspect_ratio: CoverGenerateAspectRatio; image_generation_id: number }> = []

  const refundAll = (reason: string) => {
    for (const transactionId of chargeTxIds) {
      tryRefundCharge(transactionId, {
        summary: '项目封面生成失败退款',
        dramaId: id,
        resourceType: 'drama',
        resourceId: id,
        metadata: { reason },
      })
    }
  }

  try {
    for (const aspectRatio of aspectRatios) {
      const billingModel = resolveBillingImageModel({ explicitModel: studioModel })
      const billingProvider = resolveBillingImageProvider({ explicitModel: studioModel })
      const billed = tryChargeImageUser(c, CREDIT_ACTIONS.IMAGE_GENERATE, billingModel, {
        summary: `生成项目封面（${aspectRatio}）：${drama.title}`,
        dramaId: id,
        resourceType: 'drama',
        resourceId: id,
      }, billingProvider)
      if (billed.error) {
        refundAll('余额不足或计费失败')
        return billed.error
      }
      if (billed.charge.transactionId != null) chargeTxIds.push(billed.charge.transactionId)
      totalCost += billed.charge.cost || 0
      lastBalance = billed.charge.balance

      const prompt = buildDramaCoverPrompt(drama, aspectRatio, body.prompt, {
        characterNames,
        sceneNames,
      })
      logTaskStart('DramaCover', 'generate', { dramaId: id, aspectRatio, prompt, refs: referenceImages.length })
      const genId = await generateImage({
        dramaId: id,
        prompt,
        model: studioModel,
        imageType: 'drama_cover_candidate',
        size: getImageSizeForAspectRatio(aspectRatio),
        referenceImages: referenceImages.length ? referenceImages : undefined,
        creditTransactionId: billed.charge.transactionId,
      })
      items.push({ aspect_ratio: aspectRatio, image_generation_id: genId })
      logTaskSuccess('DramaCover', 'generate', { dramaId: id, aspectRatio, generationId: genId })
    }

    logActivity(getAuthUser(c), {
      action: 'drama.cover',
      summary: `生成项目封面：${drama.title}`,
      resourceType: 'drama',
      resourceId: id,
      dramaId: id,
      creditCost: totalCost,
      metadata: {
        items,
        character_ids: characterIds,
        scene_ids: sceneIds,
        model: studioModel,
        reference_count: referenceImages.length,
      },
    })
    return success(c, {
      items,
      // 兼容旧前端只读单个 id
      image_generation_id: items[0]?.image_generation_id,
      credits_balance: lastBalance,
    })
  } catch (err: any) {
    refundAll(err.message)
    logTaskError('DramaCover', 'generate', { dramaId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /dramas/:id/apply-cover — 裁切确认后写入 3:4 / 4:3 封面
app.post('/:id/apply-cover', async (c) => {
  const id = Number(c.req.param('id'))
  const [drama] = db.select().from(schema.dramas).where(eq(schema.dramas.id, id)).all()
  if (!drama || drama.deletedAt) return notFound(c, '项目不存在')
  const denied = assertDramaTeamAccess(c, drama)
  if (denied) return denied

  const body = await c.req.json().catch(() => ({}))
  const coversIn = body.covers && typeof body.covers === 'object' ? body.covers : {}
  const nextCovers: Partial<Record<CoverAspectRatio, string>> = {}
  for (const ratio of COVER_ASPECT_RATIOS) {
    const path = String(coversIn[ratio] || '').trim()
    if (path) nextCovers[ratio] = path.replace(/^\/+/, '')
  }
  if (!Object.keys(nextCovers).length) return badRequest(c, '请至少提供一张封面')

  const meta = parseDramaMetadata(drama.metadata)
  const prevCovers = meta.covers && typeof meta.covers === 'object' ? { ...meta.covers } : {}
  // 未写入 metadata 的旧 thumbnail，并入 3:4，避免只存一张时丢掉历史封面
  if (!prevCovers['3:4'] && drama.thumbnail) prevCovers['3:4'] = drama.thumbnail
  const mergedCovers: Record<string, string> = { ...prevCovers }
  for (const [ratio, path] of Object.entries(nextCovers)) {
    if (path) mergedCovers[ratio] = path
  }
  meta.covers = {
    '3:4': mergedCovers['3:4'] || null,
    '4:3': mergedCovers['4:3'] || null,
  }

  const primaryRatio = resolveCoverAspectRatio(body.primary_aspect_ratio) || '3:4'
  const thumbnail = mergedCovers[primaryRatio]
    || mergedCovers['3:4']
    || mergedCovers['4:3']
    || drama.thumbnail
    || null

  db.update(schema.dramas)
    .set({
      thumbnail,
      metadata: JSON.stringify(meta),
      updatedAt: now(),
    })
    .where(eq(schema.dramas.id, id))
    .run()

  const board = getBoardByDramaId(id)
  if (board && thumbnail) {
    db.update(schema.canvasBoards)
      .set({ thumbnail, updatedAt: now() })
      .where(eq(schema.canvasBoards.id, board.id))
      .run()
  }

  logActivity(getAuthUser(c), {
    action: 'drama.cover.apply',
    summary: `应用项目封面：${drama.title}`,
    resourceType: 'drama',
    resourceId: id,
    dramaId: id,
    metadata: {
      covers: meta.covers,
      applied: nextCovers,
      primary_aspect_ratio: primaryRatio,
    },
  })

  return success(c, {
    thumbnail,
    covers: meta.covers,
    cover_3_4: meta.covers['3:4'] || null,
    cover_4_3: meta.covers['4:3'] || null,
    cover_url: thumbnail,
  })
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
  softDeleteBoardByDramaId(id)
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
