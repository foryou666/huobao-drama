import { db, schema } from '../db/index.js'
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { toSnakeCase } from '../utils/transform.js'
import { resolveDisplayMediaUrl } from '../utils/media-display-url.js'
import { thumbPathForSource } from '../utils/thumbnail.js'
import { dramaVisibleToTeam, getSharedDramaIdsByTeam, userCanAccessDrama } from './drama-shares.js'
import type { AuthUser } from '../middleware/auth.js'
import { sanitizeUserFacingProviderError } from '../utils/provider-error-sanitize.js'
import { canViewAllImageStudio } from '../utils/image-studio-access.js'
import { resolveJimengAccountFromStyle } from '../utils/jimeng-web-video-options.js'

function parseSizeAspectRatio(size?: string | null): string {
  const raw = String(size || '').trim()
  if (raw === '1920x1080') return '16:9'
  if (raw === '1080x1920') return '9:16'
  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(raw)
  if (match) {
    const w = Number(match[1])
    const h = Number(match[2])
    if (w > h) return '16:9'
    if (h > w) return '9:16'
  }
  return '16:9'
}

/** 列表接口只返回路径（避免逐条 OSS 签名） */
function parseReferenceImages(raw?: string | null) {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .map(path => ({ path }))
  } catch {
    return []
  }
}

export interface ImageLedgerQuery {
  user: AuthUser
  activeTeamId?: number | null
  dramaId?: number
  episodeId?: number
  status?: string
  keyword?: string
  limit?: number
  offset?: number
  mineOnly?: boolean
  studioOnly?: boolean
  userId?: number
  /** 仅管理员后台「生图记录」页开启；普通图片工作台勿传 */
  includeJimengAccount?: boolean
  /** 模型过滤：精确匹配，或 'dream' / 'dream5.0-pro' 表示即梦生图 */
  model?: string
}

function buildImageOwnerMaps() {
  const creditTxUser = new Map<number, number>()
  for (const tx of db.select({
    id: schema.creditTransactions.id,
    userId: schema.creditTransactions.userId,
  }).from(schema.creditTransactions).all()) {
    creditTxUser.set(tx.id, tx.userId)
  }

  const generationOwner = new Map<number, number>()
  for (const log of db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.action, 'image.generate')).all()) {
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

const OWNER_MAPS_TTL_MS = 60_000
let ownerMapsCache: { at: number; maps: ReturnType<typeof buildImageOwnerMaps> } | null = null

export function invalidateImageOwnerMapsCache() {
  ownerMapsCache = null
}

function getImageOwnerMaps() {
  const now = Date.now()
  if (ownerMapsCache && now - ownerMapsCache.at < OWNER_MAPS_TTL_MS) {
    return ownerMapsCache.maps
  }
  const maps = buildImageOwnerMaps()
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
  row: typeof schema.imageGenerations.$inferSelect,
  ownerMaps: ReturnType<typeof buildImageOwnerMaps>,
  userMap: Map<number, typeof schema.users.$inferSelect>,
) {
  const ownerUserId = resolveImageOwnerUserId(row, ownerMaps)
  const owner = ownerUserId ? userMap.get(ownerUserId) : null
  return {
    operator_id: ownerUserId,
    operator_name: owner?.displayName || owner?.username || null,
    username: owner?.username || null,
    display_name: owner?.displayName || owner?.username || null,
  }
}

function resolveImageOwnerUserId(
  row: typeof schema.imageGenerations.$inferSelect,
  maps: ReturnType<typeof buildImageOwnerMaps>,
): number | null {
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

function resolveThumbFields(rawImage?: string | null) {
  const thumbPath = rawImage ? thumbPathForSource(rawImage) : null
  if (!thumbPath) {
    return { thumb_path: null as string | null, display_thumbnail_url: null as string | null }
  }
  return {
    thumb_path: thumbPath,
    display_thumbnail_url: resolveDisplayMediaUrl(thumbPath),
  }
}

function warmMissingThumbnails(rows: typeof schema.imageGenerations.$inferSelect[]) {
  void (async () => {
    const { ensureThumbnail } = await import('../utils/thumbnail.js')
    for (const row of rows) {
      if (row.status !== 'completed' || !row.localPath) continue
      try {
        await ensureThumbnail(row.localPath)
      } catch {
        /* ignore */
      }
    }
  })()
}

function isImageRowAccessible(
  row: typeof schema.imageGenerations.$inferSelect,
  accessibleDramaIds: Set<number>,
): boolean {
  if (!row.dramaId) return true
  return accessibleDramaIds.has(row.dramaId)
}

function buildImageLedgerSqlConditions(query: ImageLedgerQuery): SQL[] {
  const conditions: SQL[] = []

  if (query.studioOnly) {
    conditions.push(or(
      isNull(schema.imageGenerations.storyboardId),
      eq(schema.imageGenerations.imageType, 'studio'),
    )!)
  }
  if (query.dramaId) {
    conditions.push(eq(schema.imageGenerations.dramaId, query.dramaId))
  }
  if (query.status && query.status !== 'all') {
    if (query.status === 'processing') {
      conditions.push(or(
        eq(schema.imageGenerations.status, 'processing'),
        eq(schema.imageGenerations.status, 'pending'),
      )!)
    } else {
      conditions.push(eq(schema.imageGenerations.status, query.status))
    }
  }
  if (query.keyword?.trim()) {
    const kw = `%${query.keyword.trim().replace(/[%_]/g, '')}%`
    conditions.push(sql`lower(${schema.imageGenerations.prompt}) like lower(${kw})`)
  }
  if (query.model?.trim()) {
    const needle = query.model.trim().toLowerCase()
    if (needle === 'dream' || needle === 'dream5.0-pro' || needle === 'dream5.0 pro') {
      conditions.push(or(
        sql`lower(coalesce(${schema.imageGenerations.model}, '')) like '%dream5%'`,
        eq(schema.imageGenerations.provider, 'jimeng_web'),
      )!)
    } else {
      conditions.push(sql`lower(coalesce(${schema.imageGenerations.model}, '')) = ${needle}`)
    }
  }

  return conditions
}

export function listImageLedger(query: ImageLedgerQuery) {
  const limit = Math.min(Math.max(Number(query.limit || 30), 1), 100)
  const offset = Math.max(Number(query.offset || 0), 0)
  const isAdminGlobalView = canViewAllImageStudio(query.user) && (Boolean(query.userId) || !query.mineOnly)
  const accessibleDramaIds = buildAccessibleDramaIds(query.user, query.activeTeamId)

  const sqlConditions = buildImageLedgerSqlConditions(query)
  let rows = db.select().from(schema.imageGenerations)
    .where(sqlConditions.length ? and(...sqlConditions) : undefined)
    .all()

  if (!isAdminGlobalView) {
    rows = rows.filter(r => isImageRowAccessible(r, accessibleDramaIds))
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

  const showcasePins = rows.filter(r => r.isPinned)

  const ownerMapsForFilter = getImageOwnerMaps()
  if (query.userId) {
    rows = rows.filter(r => resolveImageOwnerUserId(r, ownerMapsForFilter) === query.userId)
  } else if (query.mineOnly) {
    rows = rows.filter(r => resolveImageOwnerUserId(r, ownerMapsForFilter) === query.user.id)
    const rowIds = new Set(rows.map(r => r.id))
    for (const pin of showcasePins) {
      if (!rowIds.has(pin.id)) {
        rows.push(pin)
        rowIds.add(pin.id)
      }
    }
  }

  rows.sort((a, b) => {
    const aPinned = a.isPinned ? 1 : 0
    const bPinned = b.isPinned ? 1 : 0
    if (aPinned !== bPinned) return bPinned - aPinned
    if (aPinned && bPinned) {
      const pinnedCmp = String(b.pinnedAt || '').localeCompare(String(a.pinnedAt || ''))
      if (pinnedCmp !== 0) return pinnedCmp
    }
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
  })

  const stats = {
    total: rows.length,
    completed: rows.filter(r => r.status === 'completed').length,
    processing: rows.filter(r => r.status === 'processing' || r.status === 'pending').length,
    failed: rows.filter(r => r.status === 'failed').length,
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

  const displayOwnerMaps = getImageOwnerMaps()
  const ownerIds = [...new Set(
    page.map(row => resolveImageOwnerUserId(row, displayOwnerMaps)).filter((id): id is number => !!id),
  )]
  const userMap = buildUserMap(ownerIds)

  const revealJimengAccount = query.includeJimengAccount === true && query.user?.role === 'admin'
  const items = page.map((row) => {
    const sb = row.storyboardId ? sbMap.get(row.storyboardId) : null
    const ep = sb ? epMap.get(sb.episodeId) : null
    const drama = row.dramaId ? dramaMap.get(row.dramaId) : null
    const rawImage = row.localPath || row.imageUrl
    const thumbFields = resolveThumbFields(rawImage)
    const operator = resolveOperatorFields(row, displayOwnerMaps, userMap)
    const jimengAccount = revealJimengAccount ? resolveJimengAccountFromStyle(row.style) : null
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
      size: row.size,
      aspect_ratio: parseSizeAspectRatio(row.size),
      image_type: row.imageType,
      reference_images: parseReferenceImages(row.referenceImages),
      is_manual: !row.storyboardId,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      completed_at: row.completedAt,
      display_image_url: resolveDisplayMediaUrl(rawImage),
      ...thumbFields,
      image_url: row.imageUrl,
      local_path: row.localPath,
      drama_title: drama?.title || null,
      episode_id: ep?.id || null,
      episode_number: ep?.episodeNumber || null,
      episode_title: ep?.title || null,
      storyboard_title: sb?.title || null,
      storyboard_number: sb?.storyboardNumber || null,
      storyboard_exists: !!sb,
      is_pinned: !!row.isPinned,
      pinned_at: row.pinnedAt || null,
      ...operator,
      ...(jimengAccount || {}),
    })
  })

  warmMissingThumbnails(page)

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
