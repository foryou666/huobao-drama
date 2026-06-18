import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { toSnakeCase } from '../utils/transform.js'
import { resolveDisplayMediaUrl } from '../utils/media-display-url.js'
import { dramaVisibleToTeam, getSharedDramaIdsByTeam, userCanAccessDrama } from './drama-shares.js'
import type { AuthUser } from '../middleware/auth.js'
import { sanitizeUserFacingProviderError } from '../utils/provider-error-sanitize.js'

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
  return '9:16'
}

function parseReferenceImages(raw?: string | null) {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .map(path => ({
        path,
        display_url: resolveDisplayMediaUrl(path),
      }))
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

export function listImageLedger(query: ImageLedgerQuery) {
  const limit = Math.min(Math.max(Number(query.limit || 30), 1), 100)
  const offset = Math.max(Number(query.offset || 0), 0)
  const accessibleDramaIds = buildAccessibleDramaIds(query.user, query.activeTeamId)

  const storyboards = db.select().from(schema.storyboards).all()
  const sbMap = new Map(storyboards.map(sb => [sb.id, sb]))
  const episodes = db.select().from(schema.episodes).all().filter(e => !e.deletedAt)
  const epMap = new Map(episodes.map(e => [e.id, e]))
  const dramas = db.select().from(schema.dramas).all().filter(d => !d.deletedAt)
  const dramaMap = new Map(dramas.map(d => [d.id, d]))

  let rows = db.select().from(schema.imageGenerations).all()
    .filter(r => {
      if (!r.dramaId) return true
      return accessibleDramaIds.has(r.dramaId)
    })

  if (query.studioOnly) {
    rows = rows.filter(r => !r.storyboardId || r.imageType === 'studio')
  }

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

  const ownerMaps = query.mineOnly ? buildImageOwnerMaps() : null
  if (query.mineOnly) {
    rows = rows.filter(r => resolveImageOwnerUserId(r, ownerMaps!) === query.user.id)
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
    const rawImage = row.localPath || row.imageUrl
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
      image_url: row.imageUrl,
      local_path: row.localPath,
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
