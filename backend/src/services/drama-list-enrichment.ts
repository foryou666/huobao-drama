import { eq, and, isNull, inArray, count } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { toSnakeCase } from '../utils/transform.js'
import {
  formatContentSummary,
  type ContentStats,
  type DeletionAssessment,
  toDeletionInfo,
} from './deletion-guards.js'
import { userCanManageDrama } from './drama-shares.js'
import type { AuthUser } from '../middleware/auth.js'

type DramaRow = typeof schema.dramas.$inferSelect

type EpisodeLite = {
  id: number
  episode_number: number
  script_content: string | null
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

function countMap(rows: { dramaId: number | null; count: number }[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const row of rows) {
    if (row.dramaId != null) m.set(row.dramaId, row.count)
  }
  return m
}

function getCount(m: Map<number, number>, dramaId: number): number {
  return m.get(dramaId) ?? 0
}

function assessListDeletion(episodes: EpisodeLite[], stats: ContentStats): DeletionAssessment {
  const blockers: string[] = []

  for (const ep of episodes) {
    if (hasText(ep.script_content)) {
      blockers.push(`第 ${ep.episode_number} 集已有剧本`)
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

async function loadBatchCounts(dramaIds: number[]) {
  if (!dramaIds.length) {
    return {
      episodesByDrama: new Map<number, EpisodeLite[]>(),
      charCounts: new Map<number, number>(),
      sceneCounts: new Map<number, number>(),
      propCounts: new Map<number, number>(),
      assetCounts: new Map<number, number>(),
      storyboardCounts: new Map<number, number>(),
      imageCounts: new Map<number, number>(),
      videoCounts: new Map<number, number>(),
    }
  }

  const episodeRows = await db.select({
    dramaId: schema.episodes.dramaId,
    id: schema.episodes.id,
    episodeNumber: schema.episodes.episodeNumber,
    scriptContent: schema.episodes.scriptContent,
    content: schema.episodes.content,
    videoUrl: schema.episodes.videoUrl,
    thumbnail: schema.episodes.thumbnail,
    deletedAt: schema.episodes.deletedAt,
  }).from(schema.episodes).where(inArray(schema.episodes.dramaId, dramaIds))

  const episodesByDrama = new Map<number, EpisodeLite[]>()
  for (const row of episodeRows) {
    if (row.deletedAt || row.dramaId == null) continue
    const list = episodesByDrama.get(row.dramaId) || []
    const hasScript = hasText(row.scriptContent) || hasText(row.content)
    list.push({
      id: row.id,
      episode_number: row.episodeNumber,
      script_content: hasScript ? '1' : null,
    })
    episodesByDrama.set(row.dramaId, list)
  }

  const [
    charRows,
    sceneRows,
    propRows,
    assetRows,
    storyboardRows,
    imageRows,
    videoRows,
  ] = await Promise.all([
    db.select({ dramaId: schema.characters.dramaId, count: count() })
      .from(schema.characters)
      .where(and(inArray(schema.characters.dramaId, dramaIds), isNull(schema.characters.deletedAt)))
      .groupBy(schema.characters.dramaId),
    db.select({ dramaId: schema.scenes.dramaId, count: count() })
      .from(schema.scenes)
      .where(and(inArray(schema.scenes.dramaId, dramaIds), isNull(schema.scenes.deletedAt)))
      .groupBy(schema.scenes.dramaId),
    db.select({ dramaId: schema.props.dramaId, count: count() })
      .from(schema.props)
      .where(and(inArray(schema.props.dramaId, dramaIds), isNull(schema.props.deletedAt)))
      .groupBy(schema.props.dramaId),
    db.select({ dramaId: schema.assets.dramaId, count: count() })
      .from(schema.assets)
      .where(and(inArray(schema.assets.dramaId, dramaIds), isNull(schema.assets.deletedAt)))
      .groupBy(schema.assets.dramaId),
    db.select({ dramaId: schema.episodes.dramaId, count: count() })
      .from(schema.storyboards)
      .innerJoin(schema.episodes, eq(schema.storyboards.episodeId, schema.episodes.id))
      .where(and(
        inArray(schema.episodes.dramaId, dramaIds),
        isNull(schema.storyboards.deletedAt),
        isNull(schema.episodes.deletedAt),
      ))
      .groupBy(schema.episodes.dramaId),
    db.select({ dramaId: schema.imageGenerations.dramaId, count: count() })
      .from(schema.imageGenerations)
      .where(inArray(schema.imageGenerations.dramaId, dramaIds))
      .groupBy(schema.imageGenerations.dramaId),
    db.select({ dramaId: schema.videoGenerations.dramaId, count: count() })
      .from(schema.videoGenerations)
      .where(and(inArray(schema.videoGenerations.dramaId, dramaIds), isNull(schema.videoGenerations.deletedAt)))
      .groupBy(schema.videoGenerations.dramaId),
  ])

  return {
    episodesByDrama,
    charCounts: countMap(charRows),
    sceneCounts: countMap(sceneRows),
    propCounts: countMap(propRows),
    assetCounts: countMap(assetRows),
    storyboardCounts: countMap(storyboardRows),
    imageCounts: countMap(imageRows),
    videoCounts: countMap(videoRows),
  }
}

async function loadSharesByDramaIds(dramaIds: number[]) {
  const sharesByDrama = new Map<number, { team_id: number; team_name: string; shared_at: string }[]>()
  if (!dramaIds.length) return sharesByDrama

  const shareRows = await db.select().from(schema.dramaTeamShares)
    .where(inArray(schema.dramaTeamShares.dramaId, dramaIds))
  const teams = await db.select({ id: schema.teams.id, name: schema.teams.name }).from(schema.teams)
  const teamMap = new Map(teams.map(t => [t.id, t.name]))

  for (const share of shareRows) {
    const list = sharesByDrama.get(share.dramaId) || []
    list.push({
      team_id: share.teamId,
      team_name: teamMap.get(share.teamId) || `#${share.teamId}`,
      shared_at: share.createdAt,
    })
    sharesByDrama.set(share.dramaId, list)
  }
  return sharesByDrama
}

export async function enrichDramaListItems(
  items: DramaRow[],
  opts: { activeTeamId: number | null; user: AuthUser },
) {
  const dramaIds = items.map(d => d.id)
  const [batch, sharesByDrama, teams] = await Promise.all([
    loadBatchCounts(dramaIds),
    loadSharesByDramaIds(dramaIds),
    db.select({ id: schema.teams.id, name: schema.teams.name }).from(schema.teams),
  ])
  const teamMap = new Map(teams.map(t => [t.id, t.name]))

  return items.map((drama) => {
    const episodes = batch.episodesByDrama.get(drama.id) || []
    const stats: ContentStats = {
      episodes: episodes.length,
      storyboards: getCount(batch.storyboardCounts, drama.id),
      images: getCount(batch.imageCounts, drama.id),
      videos: getCount(batch.videoCounts, drama.id),
      characters: getCount(batch.charCounts, drama.id),
      scenes: getCount(batch.sceneCounts, drama.id),
      props: getCount(batch.propCounts, drama.id),
      assets: getCount(batch.assetCounts, drama.id),
    }
    const deletion = toDeletionInfo(assessListDeletion(episodes, stats))
    let meta: Record<string, any> = {}
    try {
      meta = drama.metadata ? JSON.parse(drama.metadata) : {}
    } catch {
      meta = {}
    }
    const rawCovers = meta.covers && typeof meta.covers === 'object' ? meta.covers : {}
    const cover34 = String(rawCovers['3:4'] || drama.thumbnail || '').trim() || null
    const cover43 = String(rawCovers['4:3'] || '').trim() || null
    const covers = { '3:4': cover34, '4:3': cover43 }

    return {
      ...toSnakeCase(drama),
      tags: drama.tags ? JSON.parse(drama.tags) : [],
      total_episodes: episodes.length,
      episodes,
      character_count: stats.characters,
      scene_count: stats.scenes,
      covers,
      cover_3_4: cover34,
      cover_4_3: cover43,
      cover_url: cover34 || cover43 || null,
      shared_teams: sharesByDrama.get(drama.id) || [],
      is_shared_project: opts.activeTeamId != null && drama.teamId !== opts.activeTeamId,
      owner_team_name: drama.teamId ? (teamMap.get(drama.teamId) ?? null) : null,
      can_manage_drama: userCanManageDrama(drama, opts.user),
      is_archived: drama.status === 'archived',
      ...deletion,
    }
  })
}
