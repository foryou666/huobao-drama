import { db, schema } from '../db/index.js'
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { toSnakeCase } from '../utils/transform.js'
import { dramaVisibleToTeam, getSharedDramaIdsByTeam, userCanAccessDrama } from './drama-shares.js'
import type { AuthUser } from '../middleware/auth.js'
import { parseVideoContentRefs } from '../utils/seedance-content.js'
import { sanitizeUserFacingProviderError } from '../utils/provider-error-sanitize.js'
import { videoPosterPathForSource } from '../utils/video-poster.js'

type LedgerRefPath = { path: string; label: string | null }

function mapContentRefsToPaths(
  refs: ReturnType<typeof parseVideoContentRefs>,
): LedgerRefPath[] {
  return refs
    .map((ref) => {
      const path = String(ref.url || '').trim().replace(/^\/+/, '')
      return {
        path,
        label: ref.label || null,
      }
    })
    .filter(item => item.path)
}

/** 列表接口只返回路径（卡片展示走前端批量 resolve，避免逐条 OSS 签名） */
function parseReferenceImagePaths(row: {
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string | null
  referencePayload?: string | null
}): LedgerRefPath[] {
  const contentRefs = parseVideoContentRefs(row.referencePayload)
    .filter(ref => ref.type === 'image' && ref.role !== 'first_frame' && ref.role !== 'last_frame')

  if (contentRefs.length) {
    return mapContentRefsToPaths(contentRefs)
  }

  const paths: string[] = []
  const push = (value?: string | null) => {
    const next = String(value || '').trim()
    if (!next || paths.includes(next)) return
    paths.push(next)
  }

  push(row.imageUrl)
  push(row.firstFrameUrl)
  push(row.lastFrameUrl)

  if (row.referenceImageUrls) {
    try {
      const parsed = JSON.parse(row.referenceImageUrls)
      if (Array.isArray(parsed)) parsed.forEach(item => push(String(item || '')))
    } catch { /* ignore */ }
  }

  return paths.map(path => ({ path, label: null }))
}

function parseReferenceVideoPaths(row: { referencePayload?: string | null }): LedgerRefPath[] {
  return mapContentRefsToPaths(
    parseVideoContentRefs(row.referencePayload).filter(ref => ref.type === 'video'),
  )
}

function parseReferenceAudioPaths(row: { referencePayload?: string | null }): LedgerRefPath[] {
  return mapContentRefsToPaths(
    parseVideoContentRefs(row.referencePayload).filter(ref => ref.type === 'audio'),
  )
}

export interface VideoLedgerQuery {
  user: AuthUser
  activeTeamId?: number | null
  dramaId?: number
  episodeId?: number
  status?: string
  keyword?: string
  limit?: number
  offset?: number
  mineOnly?: boolean
  /** 指定成员（与 mineOnly 互斥，由路由校验团队权限） */
  userId?: number
  provider?: string
  models?: string[]
}

const OWNER_MAPS_TTL_MS = 60_000
let ownerMapsCache: { at: number; maps: ReturnType<typeof buildVideoOwnerMaps> } | null = null

function buildVideoOwnerMaps() {
  const creditTxUser = new Map<number, number>()
  for (const tx of db.select({
    id: schema.creditTransactions.id,
    userId: schema.creditTransactions.userId,
  }).from(schema.creditTransactions).all()) {
    creditTxUser.set(tx.id, tx.userId)
  }

  const generationOwner = new Map<number, number>()
  for (const log of db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.action, 'video.generate')).all()) {
    if (!log.metadata) continue
    try {
      const meta = JSON.parse(log.metadata)
      const genId = Number(meta.generation_id)
      if (Number.isFinite(genId) && genId > 0) {
        generationOwner.set(genId, log.userId)
      }
    } catch { /* ignore */ }
  }

  return { creditTxUser, generationOwner }
}

function getVideoOwnerMaps() {
  const now = Date.now()
  if (ownerMapsCache && now - ownerMapsCache.at < OWNER_MAPS_TTL_MS) {
    return ownerMapsCache.maps
  }
  const maps = buildVideoOwnerMaps()
  ownerMapsCache = { at: now, maps }
  return maps
}

function buildUserMap(userIds: number[]) {
  if (!userIds.length) return new Map<number, typeof schema.users.$inferSelect>()
  return new Map(
    db.select().from(schema.users).where(inArray(schema.users.id, userIds)).all()
      .map(u => [u.id, u]),
  )
}

function resolveOperatorFields(
  row: typeof schema.videoGenerations.$inferSelect,
  ownerMaps: ReturnType<typeof buildVideoOwnerMaps>,
  userMap: Map<number, typeof schema.users.$inferSelect>,
) {
  const ownerUserId = resolveVideoOwnerUserId(row, ownerMaps)
  const owner = ownerUserId ? userMap.get(ownerUserId) : null
  return {
    operator_id: ownerUserId,
    operator_name: owner?.displayName || owner?.username || null,
    username: owner?.username || null,
    display_name: owner?.displayName || owner?.username || null,
  }
}

function resolveVideoOwnerUserId(
  row: typeof schema.videoGenerations.$inferSelect,
  maps: ReturnType<typeof buildVideoOwnerMaps>,
): number | null {
  if (row.userId) return row.userId
  if (row.creditTransactionId) {
    const fromTx = maps.creditTxUser.get(row.creditTransactionId)
    if (fromTx) return fromTx
  }
  return maps.generationOwner.get(row.id) ?? null
}

function buildAccessibleDramaIds(user: AuthUser, activeTeamId: number | null | undefined): Set<number> {
  const sharedIds = activeTeamId != null ? getSharedDramaIdsByTeam(activeTeamId) : undefined
  const dramas = db.select().from(schema.dramas).all().filter(d => !d.deletedAt)
  const ids = new Set<number>()
  for (const drama of dramas) {
    if (user.role === 'admin') {
      if (activeTeamId != null && !dramaVisibleToTeam(drama, activeTeamId, sharedIds)) continue
      ids.add(drama.id)
      continue
    }
    if (userCanAccessDrama(drama, user)) ids.add(drama.id)
  }
  return ids
}

function buildLedgerSqlConditions(
  query: VideoLedgerQuery,
  accessibleDramaIds: Set<number>,
): SQL[] {
  const conditions: SQL[] = [isNull(schema.videoGenerations.deletedAt)]

  if (query.dramaId) {
    conditions.push(eq(schema.videoGenerations.dramaId, query.dramaId))
  } else if (query.user.role !== 'admin' || query.activeTeamId != null) {
    const accessibleList = [...accessibleDramaIds]
    if (!accessibleList.length) {
      conditions.push(sql`0 = 1`)
    } else {
      conditions.push(or(
        isNull(schema.videoGenerations.dramaId),
        inArray(schema.videoGenerations.dramaId, accessibleList),
      )!)
    }
  }

  if (query.provider?.trim()) {
    conditions.push(eq(schema.videoGenerations.provider, query.provider.trim()))
  }
  if (query.status && query.status !== 'all') {
    if (query.status === 'processing') {
      conditions.push(or(
        eq(schema.videoGenerations.status, 'processing'),
        eq(schema.videoGenerations.status, 'pending'),
      )!)
    } else if (query.status === 'cancelled') {
      conditions.push(or(
        eq(schema.videoGenerations.status, 'cancelled'),
        eq(schema.videoGenerations.status, 'canceled'),
      )!)
    } else {
      conditions.push(eq(schema.videoGenerations.status, query.status))
    }
  }
  if (query.models?.length) {
    const allowed = query.models.map(item => item.trim()).filter(Boolean)
    if (allowed.length) {
      conditions.push(inArray(schema.videoGenerations.model, allowed))
    }
  }
  if (query.keyword?.trim()) {
    const kw = `%${query.keyword.trim().replace(/[%_]/g, '')}%`
    conditions.push(sql`lower(${schema.videoGenerations.prompt}) like lower(${kw})`)
  }

  const targetUserId = query.userId ?? (query.mineOnly ? query.user.id : null)
  if (targetUserId) {
    conditions.push(or(
      eq(schema.videoGenerations.userId, targetUserId),
      isNull(schema.videoGenerations.userId),
    )!)
  }

  return conditions
}

function warmVideoPosters(rows: typeof schema.videoGenerations.$inferSelect[]) {
  void (async () => {
    const { ensureVideoPoster } = await import('../utils/video-poster.js')
    for (const row of rows) {
      if (row.status !== 'completed') continue
      const path = row.localPath || row.videoUrl
      if (!path) continue
      try {
        await ensureVideoPoster(path)
      } catch {
        /* ignore */
      }
    }
  })()
}

function emptyLedgerResult(limit: number, offset: number) {
  return {
    items: [],
    stats: { total: 0, completed: 0, processing: 0, failed: 0, cancelled: 0, expired: 0 },
    pagination: { limit, offset, total: 0, has_more: false },
  }
}

export function listVideoLedger(query: VideoLedgerQuery) {
  const limit = Math.min(Math.max(Number(query.limit || 30), 1), 100)
  const offset = Math.max(Number(query.offset || 0), 0)
  const accessibleDramaIds = buildAccessibleDramaIds(query.user, query.activeTeamId)

  const sqlConditions = buildLedgerSqlConditions(query, accessibleDramaIds)
  let rows = db.select().from(schema.videoGenerations)
    .where(and(...sqlConditions))
    // 必须二级排序，否则同秒创建的记录分页会重叠/漏项
    .orderBy(desc(schema.videoGenerations.createdAt), desc(schema.videoGenerations.id))
    .all()

  const targetUserId = query.userId ?? (query.mineOnly ? query.user.id : null)
  if (targetUserId && rows.some(r => r.userId == null)) {
    const ownerMaps = getVideoOwnerMaps()
    rows = rows.filter(r => {
      if (r.userId) return r.userId === targetUserId
      return resolveVideoOwnerUserId(r, ownerMaps) === targetUserId
    })
  }

  if (!rows.length) {
    return emptyLedgerResult(limit, offset)
  }

  if (query.episodeId) {
    const storyboardIds = [...new Set(rows.map(r => r.storyboardId).filter((id): id is number => !!id))]
    const storyboards = storyboardIds.length
      ? db.select().from(schema.storyboards).where(inArray(schema.storyboards.id, storyboardIds)).all()
      : []
    const sbMap = new Map(storyboards.map(sb => [sb.id, sb]))
    rows = rows.filter((r) => {
      const sb = r.storyboardId ? sbMap.get(r.storyboardId) : null
      return sb?.episodeId === query.episodeId
    })
  }

  const stats = {
    total: rows.length,
    completed: rows.filter(r => r.status === 'completed').length,
    processing: rows.filter(r => r.status === 'processing' || r.status === 'pending').length,
    failed: rows.filter(r => r.status === 'failed').length,
    cancelled: rows.filter(r => r.status === 'cancelled' || r.status === 'canceled').length,
    expired: rows.filter(r => r.status === 'expired').length,
  }

  const page = rows.slice(offset, offset + limit)

  const storyboardIds = [...new Set(page.map(r => r.storyboardId).filter((id): id is number => !!id))]
  const storyboards = storyboardIds.length
    ? db.select().from(schema.storyboards).where(inArray(schema.storyboards.id, storyboardIds)).all()
    : []
  const sbMap = new Map(storyboards.map(sb => [sb.id, sb]))

  const episodeIds = [...new Set(storyboards.map(sb => sb.episodeId).filter((id): id is number => !!id))]
  const dramaIds = [...new Set(page.map(r => r.dramaId).filter((id): id is number => !!id))]

  const episodes = episodeIds.length
    ? db.select().from(schema.episodes).where(inArray(schema.episodes.id, episodeIds)).all().filter(e => !e.deletedAt)
    : []
  const epMap = new Map(episodes.map(e => [e.id, e]))

  const dramas = dramaIds.length
    ? db.select().from(schema.dramas).where(inArray(schema.dramas.id, dramaIds)).all().filter(d => !d.deletedAt)
    : []
  const dramaMap = new Map(dramas.map(d => [d.id, d]))

  const displayOwnerMaps = getVideoOwnerMaps()
  const ownerIds = [...new Set(
    page.map(row => resolveVideoOwnerUserId(row, displayOwnerMaps)).filter((id): id is number => !!id),
  )]
  const userMap = buildUserMap(ownerIds)

  const items = page.map((row) => {
    const sb = row.storyboardId ? sbMap.get(row.storyboardId) : null
    const ep = sb ? epMap.get(sb.episodeId) : null
    const drama = row.dramaId ? dramaMap.get(row.dramaId) : null
    const rawVideo = row.localPath || row.videoUrl
    const operator = resolveOperatorFields(row, displayOwnerMaps, userMap)
    return toSnakeCase({
      id: row.id,
      storyboard_id: row.storyboardId,
      drama_id: row.dramaId,
      provider: row.provider,
      model: row.model,
      prompt: row.prompt,
      status: row.status,
      task_id: row.taskId,
      error_msg: sanitizeUserFacingProviderError(row.errorMsg),
      duration: row.duration,
      aspect_ratio: row.aspectRatio,
      resolution: row.resolution,
      width: row.width,
      height: row.height,
      reference_mode: row.referenceMode,
      video_url: row.videoUrl,
      local_path: row.localPath,
      poster_path: videoPosterPathForSource(rawVideo),
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      completed_at: row.completedAt,
      reference_images: parseReferenceImagePaths(row),
      reference_videos: parseReferenceVideoPaths(row),
      reference_audios: parseReferenceAudioPaths(row),
      is_manual: !row.storyboardId,
      drama_title: drama?.title || null,
      episode_id: ep?.id || null,
      episode_number: ep?.episodeNumber || null,
      episode_title: ep?.title || null,
      storyboard_title: sb?.title || null,
      storyboard_number: sb?.storyboardNumber || null,
      storyboard_exists: !!sb,
      ...operator,
    })
  })

  warmVideoPosters(page)

  return {
    items,
    stats,
    pagination: {
      limit,
      offset,
      total: rows.length,
      has_more: offset + limit < rows.length,
    },
  }
}
