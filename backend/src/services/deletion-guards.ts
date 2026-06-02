import { eq, and, isNull } from 'drizzle-orm'
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

function countActiveAssets(where: { dramaId?: number; episodeId?: number }) {
  const rows = db.select().from(schema.assets).all()
  return rows.filter(a =>
    !a.deletedAt
    && (where.dramaId == null || a.dramaId === where.dramaId)
    && (where.episodeId == null || a.episodeId === where.episodeId),
  ).length
}

function countStoryboardGenerations(storyboardIds: number[]) {
  if (!storyboardIds.length) return { images: 0, videos: 0 }
  const images = db.select().from(schema.imageGenerations).all()
    .filter(g => g.storyboardId != null && storyboardIds.includes(g.storyboardId)).length
  const videos = db.select().from(schema.videoGenerations).all()
    .filter(g => !g.deletedAt && g.storyboardId != null && storyboardIds.includes(g.storyboardId)).length
  return { images, videos }
}

function getActiveStoryboardsForEpisode(episodeId: number) {
  return db.select().from(schema.storyboards)
    .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt)))
    .all()
}

export function getEpisodeContentStats(episodeId: number): ContentStats {
  const storyboards = getActiveStoryboardsForEpisode(episodeId)
  const sbIds = storyboards.map(sb => sb.id)
  const gens = countStoryboardGenerations(sbIds)
  const merges = db.select().from(schema.videoMerges)
    .where(and(eq(schema.videoMerges.episodeId, episodeId), isNull(schema.videoMerges.deletedAt)))
    .all()

  return {
    ...emptyStats(),
    episodes: 1,
    storyboards: storyboards.length,
    images: gens.images,
    videos: gens.videos + merges.length,
    assets: countActiveAssets({ episodeId }),
  }
}

export function assessEpisodeDeletion(episodeId: number): DeletionAssessment {
  const [episode] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  if (!episode || episode.deletedAt) {
    return { allowed: false, reason: '集不存在', stats: emptyStats(), summary: '无制作内容' }
  }

  const stats = getEpisodeContentStats(episodeId)
  const blockers: string[] = []

  const activeEpisodes = db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, episode.dramaId), isNull(schema.episodes.deletedAt)))
    .all()
  if (activeEpisodes.length <= 1) {
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

export function getDramaContentStats(dramaId: number): ContentStats {
  const episodes = db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
    .all()
  const characters = db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt)))
    .all()
  const scenes = db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt)))
    .all()
  const props = db.select().from(schema.props)
    .where(and(eq(schema.props.dramaId, dramaId), isNull(schema.props.deletedAt)))
    .all()

  let storyboards = 0
  let images = 0
  let videos = 0
  for (const ep of episodes) {
    const epStats = getEpisodeContentStats(ep.id)
    storyboards += epStats.storyboards
    images += epStats.images
    videos += epStats.videos
  }

  const dramaImages = db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.dramaId, dramaId)).all().length
  const dramaVideos = db.select().from(schema.videoGenerations)
    .where(and(eq(schema.videoGenerations.dramaId, dramaId), isNull(schema.videoGenerations.deletedAt)))
    .all().length

  return {
    episodes: episodes.length,
    storyboards,
    images: images + dramaImages,
    videos: videos + dramaVideos,
    characters: characters.length,
    scenes: scenes.length,
    props: props.length,
    assets: countActiveAssets({ dramaId }),
  }
}

export function assessDramaDeletion(dramaId: number): DeletionAssessment {
  const stats = getDramaContentStats(dramaId)
  const blockers: string[] = []

  const episodes = db.select().from(schema.episodes)
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
