import { eq, inArray, isNull, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

export interface EpisodeCountSummary {
  total: number
  with_image: number
}

export interface EpisodeStoryboardSummary {
  total: number
  with_image: number
  with_video: number
}

export interface EpisodeScriptSummary {
  has_script: boolean
  has_source: boolean
  script_char_count: number
  source_char_count: number
  estimate_duration_sec: number
}

export interface EpisodeActivitySummary {
  total: number
  operator_count: number
  recent_operators: string[]
  last_operator_name: string | null
  last_operated_at: string | null
}

export interface EpisodeSummary {
  script: EpisodeScriptSummary
  activity: EpisodeActivitySummary
  characters: EpisodeCountSummary
  scenes: EpisodeCountSummary
  storyboards: EpisodeStoryboardSummary
  last_operator_name: string | null
  last_operated_at: string | null
}

function hasImageUrl(value: string | null | undefined): boolean {
  return Boolean(String(value || '').trim())
}

function hasStoryboardImage(sb: typeof schema.storyboards.$inferSelect): boolean {
  return hasImageUrl(sb.composedImage)
    || hasImageUrl(sb.firstFrameImage)
    || hasImageUrl(sb.blockingImage)
}

function countTextChars(text: string | null | undefined): number {
  return [...String(text || '').replace(/\s+/g, '')].length
}

function buildScriptSummary(ep: typeof schema.episodes.$inferSelect): EpisodeScriptSummary {
  const scriptText = String(ep.scriptContent || '').trim()
  const sourceText = String(ep.content || '').trim()
  return {
    has_script: Boolean(scriptText),
    has_source: Boolean(sourceText),
    script_char_count: countTextChars(scriptText),
    source_char_count: countTextChars(sourceText),
    estimate_duration_sec: Math.max(0, Number(ep.duration) || 0),
  }
}

function emptyActivitySummary(): EpisodeActivitySummary {
  return {
    total: 0,
    operator_count: 0,
    recent_operators: [],
    last_operator_name: null,
    last_operated_at: null,
  }
}

function emptySummary(): EpisodeSummary {
  return {
    script: {
      has_script: false,
      has_source: false,
      script_char_count: 0,
      source_char_count: 0,
      estimate_duration_sec: 0,
    },
    activity: emptyActivitySummary(),
    characters: { total: 0, with_image: 0 },
    scenes: { total: 0, with_image: 0 },
    storyboards: { total: 0, with_image: 0, with_video: 0 },
    last_operator_name: null,
    last_operated_at: null,
  }
}

function resolveOperatorName(
  row: typeof schema.activityLogs.$inferSelect,
  userMap: Map<number, typeof schema.users.$inferSelect>,
): string | null {
  const meta = row.metadata ? JSON.parse(row.metadata) : null
  const user = userMap.get(row.userId)
  return meta?.operator_name || user?.displayName || user?.username || null
}

function buildActivitySummary(
  rows: typeof schema.activityLogs.$inferSelect[],
  userMap: Map<number, typeof schema.users.$inferSelect>,
): EpisodeActivitySummary {
  if (!rows.length) return emptyActivitySummary()
  const sorted = [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const operatorNames: string[] = []
  const operatorSet = new Set<string>()
  for (const row of sorted) {
    const name = resolveOperatorName(row, userMap)
    if (!name || operatorSet.has(name)) continue
    operatorSet.add(name)
    operatorNames.push(name)
    if (operatorNames.length >= 3) break
  }
  const latest = sorted[0]
  return {
    total: rows.length,
    operator_count: new Set(sorted.map(row => row.userId)).size,
    recent_operators: operatorNames,
    last_operator_name: resolveOperatorName(latest, userMap),
    last_operated_at: latest.createdAt,
  }
}

export function getEpisodeSummariesForDrama(dramaId: number, episodeIds: number[]): Map<number, EpisodeSummary> {
  const result = new Map<number, EpisodeSummary>()
  if (!episodeIds.length) return result
  for (const id of episodeIds) result.set(id, emptySummary())

  const charLinks = db.select().from(schema.episodeCharacters)
    .where(inArray(schema.episodeCharacters.episodeId, episodeIds))
    .all()
  const sceneLinks = db.select().from(schema.episodeScenes)
    .where(inArray(schema.episodeScenes.episodeId, episodeIds))
    .all()
  const storyboards = db.select().from(schema.storyboards)
    .where(and(inArray(schema.storyboards.episodeId, episodeIds), isNull(schema.storyboards.deletedAt)))
    .all()
  const sbLinks = storyboards.length
    ? db.select().from(schema.storyboardCharacters)
      .where(inArray(schema.storyboardCharacters.storyboardId, storyboards.map(sb => sb.id)))
      .all()
    : []

  const allChars = db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt)))
    .all()
  const allScenes = db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt)))
    .all()
  const charById = new Map(allChars.map(ch => [ch.id, ch]))
  const sceneById = new Map(allScenes.map(sc => [sc.id, sc]))

  const charIdsByEpisode = new Map<number, Set<number>>()
  for (const link of charLinks) {
    const set = charIdsByEpisode.get(link.episodeId) || new Set<number>()
    set.add(link.characterId)
    charIdsByEpisode.set(link.episodeId, set)
  }

  const sceneIdsByEpisode = new Map<number, Set<number>>()
  for (const link of sceneLinks) {
    const set = sceneIdsByEpisode.get(link.episodeId) || new Set<number>()
    set.add(link.sceneId)
    sceneIdsByEpisode.set(link.episodeId, set)
  }

  const sbIdsByEpisode = new Map<number, number[]>()
  for (const sb of storyboards) {
    const list = sbIdsByEpisode.get(sb.episodeId) || []
    list.push(sb.id)
    sbIdsByEpisode.set(sb.episodeId, list)
  }

  for (const sb of storyboards) {
    if (!charIdsByEpisode.get(sb.episodeId)?.size) {
      for (const link of sbLinks.filter(item => item.storyboardId === sb.id)) {
        const set = charIdsByEpisode.get(sb.episodeId) || new Set<number>()
        set.add(link.characterId)
        charIdsByEpisode.set(sb.episodeId, set)
      }
    }
    if (sb.sceneId && !sceneIdsByEpisode.get(sb.episodeId)?.size) {
      const set = sceneIdsByEpisode.get(sb.episodeId) || new Set<number>()
      set.add(sb.sceneId)
      sceneIdsByEpisode.set(sb.episodeId, set)
    }
  }

  for (const episodeId of episodeIds) {
    const summary = result.get(episodeId)!
    const charIds = [...(charIdsByEpisode.get(episodeId) || [])]
    const sceneIds = [...(sceneIdsByEpisode.get(episodeId) || [])]
    const episodeStoryboards = storyboards.filter(sb => sb.episodeId === episodeId)

    summary.characters = {
      total: charIds.length,
      with_image: charIds.filter(id => {
        const ch = charById.get(id)
        return ch && (hasImageUrl(ch.imageUrl) || hasImageUrl(ch.localPath))
      }).length,
    }
    summary.scenes = {
      total: sceneIds.length,
      with_image: sceneIds.filter(id => {
        const sc = sceneById.get(id)
        return sc && (hasImageUrl(sc.imageUrl) || hasImageUrl(sc.localPath))
      }).length,
    }
    summary.storyboards = {
      total: episodeStoryboards.length,
      with_image: episodeStoryboards.filter(hasStoryboardImage).length,
      with_video: episodeStoryboards.filter(sb => hasImageUrl(sb.videoUrl) || hasImageUrl(sb.composedVideoUrl)).length,
    }
  }

  const activityRows = db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.dramaId, dramaId))
    .all()
    .filter(row =>
      (row.episodeId != null && episodeIds.includes(row.episodeId))
      || (row.resourceType === 'episode' && row.resourceId != null && episodeIds.includes(row.resourceId)),
    )

  const userIds = [...new Set(activityRows.map(row => row.userId))]
  const users = userIds.length
    ? db.select().from(schema.users).where(inArray(schema.users.id, userIds)).all()
    : []
  const userMap = new Map(users.map(u => [u.id, u]))

  const activityByEpisode = new Map<number, typeof activityRows>()
  for (const row of activityRows) {
    const episodeId = row.episodeId ?? (row.resourceType === 'episode' ? row.resourceId : null)
    if (!episodeId || !episodeIds.includes(episodeId)) continue
    const list = activityByEpisode.get(episodeId) || []
    list.push(row)
    activityByEpisode.set(episodeId, list)
  }

  for (const episodeId of episodeIds) {
    const summary = result.get(episodeId)
    if (!summary) continue
    const activity = buildActivitySummary(activityByEpisode.get(episodeId) || [], userMap)
    summary.activity = activity
    summary.last_operator_name = activity.last_operator_name
    summary.last_operated_at = activity.last_operated_at
  }

  const episodes = db.select().from(schema.episodes)
    .where(inArray(schema.episodes.id, episodeIds))
    .all()
  for (const ep of episodes) {
    const summary = result.get(ep.id)
    if (!summary) continue
    summary.script = buildScriptSummary(ep)
    if (!summary.last_operated_at && ep.updatedAt) {
      summary.last_operated_at = ep.updatedAt
      summary.activity.last_operated_at = ep.updatedAt
    }
  }

  return result
}

export function episodeSummaryToSnakeCase(summary: EpisodeSummary) {
  return {
    script: summary.script,
    activity: summary.activity,
    characters: summary.characters,
    scenes: summary.scenes,
    storyboards: summary.storyboards,
    last_operator_name: summary.last_operator_name,
    last_operated_at: summary.last_operated_at,
  }
}
