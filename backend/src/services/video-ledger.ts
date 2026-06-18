import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { toSnakeCase } from '../utils/transform.js'
import { resolveDisplayMediaUrl } from '../utils/media-display-url.js'
import { dramaVisibleToTeam, getSharedDramaIdsByTeam, userCanAccessDrama } from './drama-shares.js'
import type { AuthUser } from '../middleware/auth.js'
import { parseVideoContentRefs } from '../utils/seedance-content.js'
import { sanitizeUserFacingProviderError } from '../utils/provider-error-sanitize.js'

function parseReferenceImages(row: {
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string | null
  referencePayload?: string | null
}) {
  const contentRefs = parseVideoContentRefs(row.referencePayload)
    .filter(ref => ref.type === 'image' && ref.role !== 'first_frame' && ref.role !== 'last_frame')

  if (contentRefs.length) {
    return contentRefs.map((ref) => {
      const path = String(ref.url || '').trim().replace(/^\/+/, '')
      return {
        path,
        display_url: resolveDisplayMediaUrl(path),
        label: ref.label || null,
      }
    }).filter(item => item.path)
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

  for (const ref of parseVideoContentRefs(row.referencePayload)) {
    if (ref.type === 'image') push(ref.url)
  }

  return paths.map(path => ({
    path,
    display_url: resolveDisplayMediaUrl(path),
  }))
}

function parseReferenceVideos(row: { referencePayload?: string | null }) {
  return parseVideoContentRefs(row.referencePayload)
    .filter(ref => ref.type === 'video')
    .map((ref, idx) => {
      const path = String(ref.url || '').trim().replace(/^\/+/, '')
      return {
        path,
        label: ref.label || `参考视频${idx + 1}`,
      }
    })
    .filter(item => item.path)
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
  provider?: string
  models?: string[]
}

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

export function listVideoLedger(query: VideoLedgerQuery) {
  const limit = Math.min(Math.max(Number(query.limit || 30), 1), 100)
  const offset = Math.max(Number(query.offset || 0), 0)
  const accessibleDramaIds = buildAccessibleDramaIds(query.user, query.activeTeamId)

  const storyboards = db.select().from(schema.storyboards).all()
  const sbMap = new Map(storyboards.map(sb => [sb.id, sb]))
  const episodes = db.select().from(schema.episodes).all().filter(e => !e.deletedAt)
  const epMap = new Map(episodes.map(e => [e.id, e]))
  const dramas = db.select().from(schema.dramas).all().filter(d => !d.deletedAt)
  const dramaMap = new Map(dramas.map(d => [d.id, d]))

  let rows = db.select().from(schema.videoGenerations).all()
    .filter(r => !r.deletedAt)
    .filter(r => {
      if (!r.dramaId) return true
      return accessibleDramaIds.has(r.dramaId)
    })

  if (query.dramaId) rows = rows.filter(r => r.dramaId === query.dramaId)
  if (query.episodeId) {
    rows = rows.filter(r => {
      const sb = r.storyboardId ? sbMap.get(r.storyboardId) : null
      return sb?.episodeId === query.episodeId
    })
  }
  if (query.status && query.status !== 'all') {
    if (query.status === 'processing') {
      rows = rows.filter(r => r.status === 'processing' || r.status === 'pending')
    } else {
      rows = rows.filter(r => String(r.status || 'pending') === query.status)
    }
  }
  if (query.keyword?.trim()) {
    const kw = query.keyword.trim().toLowerCase()
    rows = rows.filter(r => String(r.prompt || '').toLowerCase().includes(kw))
  }
  if (query.provider?.trim()) {
    const provider = query.provider.trim().toLowerCase()
    rows = rows.filter(r => String(r.provider || '').toLowerCase() === provider)
  }
  if (query.models?.length) {
    const allowed = new Set(query.models.map(item => item.trim()).filter(Boolean))
    rows = rows.filter(r => allowed.has(String(r.model || '')))
  }

  const ownerMaps = query.mineOnly ? buildVideoOwnerMaps() : null
  if (query.mineOnly) {
    rows = rows.filter(r => resolveVideoOwnerUserId(r, ownerMaps!) === query.user.id)
  }

  rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  const stats = {
    total: rows.length,
    completed: rows.filter(r => r.status === 'completed').length,
    processing: rows.filter(r => r.status === 'processing' || r.status === 'pending').length,
    failed: rows.filter(r => r.status === 'failed').length,
  }

  const page = rows.slice(offset, offset + limit)
  const items = page.map((row) => {
    const sb = row.storyboardId ? sbMap.get(row.storyboardId) : null
    const ep = sb ? epMap.get(sb.episodeId) : null
    const drama = row.dramaId ? dramaMap.get(row.dramaId) : null
    const rawVideo = row.localPath || row.videoUrl
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
      reference_mode: row.referenceMode,
      video_url: row.videoUrl,
      local_path: row.localPath,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      completed_at: row.completedAt,
      display_video_url: resolveDisplayMediaUrl(rawVideo),
      reference_images: parseReferenceImages(row),
      reference_videos: parseReferenceVideos(row),
      reference_payload: row.referencePayload,
      is_manual: !row.storyboardId,
      drama_title: drama?.title || null,
      episode_id: ep?.id || null,
      episode_number: ep?.episodeNumber || null,
      episode_title: ep?.title || null,
      storyboard_title: sb?.title || null,
      storyboard_number: sb?.storyboardNumber || null,
      storyboard_exists: !!sb,
    })
  })

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
