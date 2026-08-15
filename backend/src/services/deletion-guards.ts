import { eq, and, isNull, inArray, count } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

export type ContentStats = {
  episodes: number
  storyboards: number
  images: number
  videos: number
  characters: number
  scenes: number
  props: number
  assets: number
}

export type DeletionAssessment = {
  allowed: boolean
  reason: string | null
  stats: ContentStats
  summary: string
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

function emptyStats(): ContentStats {
  return {
    episodes: 0,
    storyboards: 0,
    images: 0,
    videos: 0,
    characters: 0,
    scenes: 0,
    props: 0,
    assets: 0,
  }
}

export function formatContentSummary(stats: ContentStats): string {
  const parts: string[] = []
  if (stats.episodes) parts.push(`${stats.episodes} 集`)
  if (stats.storyboards) parts.push(`${stats.storyboards} 镜头`)
  if (stats.images) parts.push(`${stats.images} 张图片`)
  if (stats.videos) parts.push(`${stats.videos} 个视频`)
  if (stats.characters) parts.push(`${stats.characters} 角色`)
  if (stats.scenes) parts.push(`${stats.scenes} 场景`)
  if (stats.props) parts.push(`${stats.props} 道具`)
  if (stats.assets) parts.push(`${stats.assets} 项资产`)
  return parts.length ? parts.join(' · ') : '无制作内容'
}

function countRows(value: unknown): number {
  return Number(value || 0)
}

function countActiveAssets(where: { dramaId?: number; episodeId?: number }) {
  const conditions = [isNull(schema.assets.deletedAt)]
  if (where.dramaId != null) conditions.push(eq(schema.assets.dramaId, where.dramaId))
  if (where.episodeId != null) conditions.push(eq(schema.assets.episodeId, where.episodeId))
  const [row] = db.select({ value: count() }).from(schema.assets).where(and(...conditions)).all()
  return countRows(row?.value)
}

function countStoryboardGenerations(storyboardIds: number[]) {
  if (!storyboardIds.length) return { images: 0, videos: 0 }
  const [images] = db.select({ value: count() }).from(schema.imageGenerations)
    .where(inArray(schema.imageGenerations.storyboardId, storyboardIds))
    .all()
  const [videos] = db.select({ value: count() }).from(schema.videoGenerations)
    .where(and(
      inArray(schema.videoGenerations.storyboardId, storyboardIds),
      isNull(schema.videoGenerations.deletedAt),
    ))
    .all()
  return { images: countRows(images?.value), videos: countRows(videos?.value) }
}

function getActiveStoryboardsForEpisode(episodeId: number) {
  return db.select({ id: schema.storyboards.id }).from(schema.storyboards)
    .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt)))
    .all()
}

export function getEpisodeContentStats(episodeId: number): ContentStats {
  const storyboards = getActiveStoryboardsForEpisode(episodeId)
  const sbIds = storyboards.map(sb => sb.id)
  const gens = countStoryboardGenerations(sbIds)
  const [merges] = db.select({ value: count() }).from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt)))
    .all()

  return {
    ...emptyStats(),
    episodes: 1,
    storyboards: storyboards.length,
    images: gens.images,
    videos: gens.videos + countRows(merges?.value),
    assets: countActiveAssets({ episodeId }),
  }
}

function buildEpisodeDeletionAssessment(
  episode: typeof schema.episodes.$inferSelect,
  stats: ContentStats,
  activeEpisodeCount: number,
): DeletionAssessment {
  const blockers: string[] = []

  if (activeEpisodeCount <= 1) {
    blockers.push('至少保留一集，请归档或删除整个项目')
  }
  if (hasText(episode.scriptContent) || hasText(episode.content)) {
    blockers.push('已有剧本内容')
  }
  if (stats.storyboards > 0) blockers.push(`${stats.storyboards} 个镜头`)
  if (stats.images > 0) blockers.push(`${stats.images} 条图片生成记录`)
  if (stats.videos > 0) blockers.push(`${stats.videos} 条视频/合成记录`)
  if (stats.assets > 0) blockers.push(`${stats.assets} 项资产`)
  if (hasText(episode.videoUrl) || hasText(episode.thumbnail)) {
    blockers.push('已有集级视频或封面')
  }

  const summary = formatContentSummary(stats)
  if (blockers.length) {
    return {
      allowed: false,
      reason: `该集含制作内容，无法直接删除（${blockers.join('；')}）。请使用归档项目，或先清空相关内容。`,
      stats,
      summary,
    }
  }

  return { allowed: true, reason: null, stats, summary }
}

export function assessEpisodeDeletion(episodeId: number): DeletionAssessment {
  const [episode] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  if (!episode || episode.deletedAt) {
    return { allowed: false, reason: '集不存在', stats: emptyStats(), summary: '无制作内容' }
  }

  const [activeCount] = db.select({ value: count() }).from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, episode.dramaId), isNull(schema.episodes.deletedAt)))
    .all()

  return buildEpisodeDeletionAssessment(
    episode,
    getEpisodeContentStats(episodeId),
    countRows(activeCount?.value),
  )
}

/**
 * 批量评估某项目下多集的删除条件，避免逐集全表扫描 generation/assets。
 */
export function assessEpisodeDeletionsForDrama(
  dramaId: number,
  episodes: Array<typeof schema.episodes.$inferSelect>,
): Map<number, DeletionAssessment> {
  const result = new Map<number, DeletionAssessment>()
  const active = episodes.filter(ep => !ep.deletedAt)
  if (!active.length) return result

  const episodeIds = active.map(ep => ep.id)
  const storyboards = db.select({
    id: schema.storyboards.id,
    episodeId: schema.storyboards.episodeId,
  }).from(schema.storyboards)
    .where(and(
      inArray(schema.storyboards.episodeId, episodeIds),
      isNull(schema.storyboards.deletedAt),
    ))
    .all()

  const sbIdsByEpisode = new Map<number, number[]>()
  for (const sb of storyboards) {
    const list = sbIdsByEpisode.get(sb.episodeId) || []
    list.push(sb.id)
    sbIdsByEpisode.set(sb.episodeId, list)
  }
  const allSbIds = storyboards.map(sb => sb.id)

  const imageCounts = new Map<number, number>()
  const videoCounts = new Map<number, number>()
  if (allSbIds.length) {
    const imageRows = db.select({
      storyboardId: schema.imageGenerations.storyboardId,
      value: count(),
    }).from(schema.imageGenerations)
      .where(inArray(schema.imageGenerations.storyboardId, allSbIds))
      .groupBy(schema.imageGenerations.storyboardId)
      .all()
    for (const row of imageRows) {
      if (row.storyboardId != null) imageCounts.set(row.storyboardId, countRows(row.value))
    }

    const videoRows = db.select({
      storyboardId: schema.videoGenerations.storyboardId,
      value: count(),
    }).from(schema.videoGenerations)
      .where(and(
        inArray(schema.videoGenerations.storyboardId, allSbIds),
        isNull(schema.videoGenerations.deletedAt),
      ))
      .groupBy(schema.videoGenerations.storyboardId)
      .all()
    for (const row of videoRows) {
      if (row.storyboardId != null) videoCounts.set(row.storyboardId, countRows(row.value))
    }
  }

  const mergeCounts = new Map<number, number>()
  const mergeRows = db.select({
    episodeId: schema.videoMerges.episodeId,
    value: count(),
  }).from(schema.videoMerges)
    .where(and(
      inArray(schema.videoMerges.episodeId, episodeIds),
      isNull(schema.videoMerges.deletedAt),
    ))
    .groupBy(schema.videoMerges.episodeId)
    .all()
  for (const row of mergeRows) {
    mergeCounts.set(row.episodeId, countRows(row.value))
  }

  const assetCounts = new Map<number, number>()
  const assetRows = db.select({
    episodeId: schema.assets.episodeId,
    value: count(),
  }).from(schema.assets)
    .where(and(
      inArray(schema.assets.episodeId, episodeIds),
      isNull(schema.assets.deletedAt),
    ))
    .groupBy(schema.assets.episodeId)
    .all()
  for (const row of assetRows) {
    if (row.episodeId != null) assetCounts.set(row.episodeId, countRows(row.value))
  }

  for (const ep of active) {
    const sbIds = sbIdsByEpisode.get(ep.id) || []
    let images = 0
    let videos = 0
    for (const sbId of sbIds) {
      images += imageCounts.get(sbId) || 0
      videos += videoCounts.get(sbId) || 0
    }
    videos += mergeCounts.get(ep.id) || 0
    const stats: ContentStats = {
      ...emptyStats(),
      episodes: 1,
      storyboards: sbIds.length,
      images,
      videos,
      assets: assetCounts.get(ep.id) || 0,
    }
    result.set(ep.id, buildEpisodeDeletionAssessment(ep, stats, active.length))
  }

  return result
}

export function getDramaContentStats(dramaId: number): ContentStats {
  const episodes = db.select({ id: schema.episodes.id }).from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
    .all()
  const episodeIds = episodes.map(ep => ep.id)

  const [characters] = db.select({ value: count() }).from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt)))
    .all()
  const [scenes] = db.select({ value: count() }).from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt)))
    .all()
  const [props] = db.select({ value: count() }).from(schema.props)
    .where(and(eq(schema.props.dramaId, dramaId), isNull(schema.props.deletedAt)))
    .all()

  const storyboards = episodeIds.length
    ? db.select({ id: schema.storyboards.id }).from(schema.storyboards)
      .where(and(
        inArray(schema.storyboards.episodeId, episodeIds),
        isNull(schema.storyboards.deletedAt),
      ))
      .all()
    : []
  const sbIds = storyboards.map(sb => sb.id)
  const gens = countStoryboardGenerations(sbIds)

  const [merges] = episodeIds.length
    ? db.select({ value: count() }).from(schema.videoMerges)
      .where(and(
        inArray(schema.videoMerges.episodeId, episodeIds),
        isNull(schema.videoMerges.deletedAt),
      ))
      .all()
    : [{ value: 0 }]

  const [dramaImages] = db.select({ value: count() }).from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.dramaId, dramaId))
    .all()
  const [dramaVideos] = db.select({ value: count() }).from(schema.videoGenerations)
    .where(and(eq(schema.videoGenerations.dramaId, dramaId), isNull(schema.videoGenerations.deletedAt)))
    .all()

  return {
    episodes: episodes.length,
    storyboards: storyboards.length,
    images: gens.images + countRows(dramaImages?.value),
    videos: gens.videos + countRows(merges?.value) + countRows(dramaVideos?.value),
    characters: countRows(characters?.value),
    scenes: countRows(scenes?.value),
    props: countRows(props?.value),
    assets: countActiveAssets({ dramaId }),
  }
}

export function assessDramaDeletion(dramaId: number): DeletionAssessment {
  const stats = getDramaContentStats(dramaId)
  const blockers: string[] = []

  const episodes = db.select({
    episodeNumber: schema.episodes.episodeNumber,
    scriptContent: schema.episodes.scriptContent,
    content: schema.episodes.content,
    videoUrl: schema.episodes.videoUrl,
    thumbnail: schema.episodes.thumbnail,
  }).from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
    .all()
  for (const ep of episodes) {
    if (hasText(ep.scriptContent) || hasText(ep.content)) {
      blockers.push(`第 ${ep.episodeNumber} 集已有剧本`)
    }
    if (hasText(ep.videoUrl) || hasText(ep.thumbnail)) {
      blockers.push(`第 ${ep.episodeNumber} 集已有视频或封面`)
    }
  }

  if (stats.storyboards > 0) blockers.push(`${stats.storyboards} 个镜头`)
  if (stats.images > 0) blockers.push(`${stats.images} 条图片记录`)
  if (stats.videos > 0) blockers.push(`${stats.videos} 条视频记录`)
  if (stats.characters > 0) blockers.push(`${stats.characters} 个角色`)
  if (stats.scenes > 0) blockers.push(`${stats.scenes} 个场景`)
  if (stats.props > 0) blockers.push(`${stats.props} 个道具`)
  if (stats.assets > 0) blockers.push(`${stats.assets} 项资产`)

  const summary = formatContentSummary(stats)
  if (blockers.length) {
    return {
      allowed: false,
      reason: `项目含制作内容，无法直接删除（${blockers.join('；')}）。请使用「归档」从列表隐藏，或先清空相关内容。`,
      stats,
      summary,
    }
  }

  return { allowed: true, reason: null, stats, summary }
}

export function toDeletionInfo(assessment: DeletionAssessment) {
  return {
    can_delete: assessment.allowed,
    delete_block_reason: assessment.reason,
    content_stats: assessment.stats,
    content_summary: assessment.summary,
  }
}
