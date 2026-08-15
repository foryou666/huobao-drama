import { and, eq, inArray, isNull } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import {
  getEpisodeCharacters,
  getEpisodeScenes,
} from '../utils/episode-entity-links.js'
import {
  dramaVisibleToTeam,
  getSharedDramaIdsByTeam,
  userCanAccessDrama,
  userCanManageDrama,
} from './drama-shares.js'
import { enrichDramaListItems } from './drama-list-enrichment.js'
import type { AuthUser } from '../middleware/auth.js'

export const CANVAS_REF_KINDS = ['character', 'scene', 'prop', 'episode', 'storyboard'] as const
export type CanvasRefKind = typeof CANVAS_REF_KINDS[number]

export function isCanvasRefKind(kind: string): kind is CanvasRefKind {
  return (CANVAS_REF_KINDS as readonly string[]).includes(kind)
}

export function getBoardById(id: number) {
  const [board] = db.select().from(schema.canvasBoards)
    .where(eq(schema.canvasBoards.id, id)).all()
  return board ?? null
}

export function getBoardByDramaId(dramaId: number, { includeDeleted = false } = {}) {
  const rows = db.select().from(schema.canvasBoards)
    .where(eq(schema.canvasBoards.dramaId, dramaId)).all()
  const board = rows[0] ?? null
  if (!board) return null
  if (!includeDeleted && board.deletedAt) return null
  return board
}

export function createOrRestoreBoard(params: {
  dramaId: number
  title: string
  teamId: number | null
  createdBy: number
}) {
  const existing = getBoardByDramaId(params.dramaId, { includeDeleted: true })
  const ts = now()
  if (existing) {
    db.update(schema.canvasBoards).set({
      title: params.title || existing.title,
      teamId: params.teamId,
      deletedAt: null,
      updatedAt: ts,
    }).where(eq(schema.canvasBoards.id, existing.id)).run()
    return getBoardById(existing.id)!
  }

  const res = db.insert(schema.canvasBoards).values({
    dramaId: params.dramaId,
    title: params.title,
    teamId: params.teamId,
    createdBy: params.createdBy,
    focusEpisodeId: listDramaEpisodes(params.dramaId)[0]?.id ?? null,
    viewportJson: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
    createdAt: ts,
    updatedAt: ts,
  }).run()
  return getBoardById(Number(res.lastInsertRowid))!
}

export function softDeleteBoard(boardId: number) {
  db.update(schema.canvasBoards).set({
    deletedAt: now(),
    updatedAt: now(),
  }).where(eq(schema.canvasBoards.id, boardId)).run()
}

export function boardTitleForDrama(dramaTitle: string) {
  return `${String(dramaTitle || '未命名项目').trim() || '未命名项目'} · 画布`
}

/** 保证项目有画布（一剧一板）；已存在则恢复/对齐标题与团队 */
export function ensureBoardForDrama(
  drama: { id: number; title: string; teamId: number | null },
  createdBy: number,
  options: { syncNodes?: boolean } = {},
) {
  const title = boardTitleForDrama(drama.title)
  const board = createOrRestoreBoard({
    dramaId: drama.id,
    title,
    teamId: drama.teamId,
    createdBy,
  })
  const ts = now()
  if (board.title !== title || board.teamId !== drama.teamId) {
    db.update(schema.canvasBoards).set({
      title,
      teamId: drama.teamId,
      updatedAt: ts,
    }).where(eq(schema.canvasBoards.id, board.id)).run()
  }
  if (options.syncNodes !== false) {
    syncBoardFromDrama(board.id, drama.id)
  }
  return getBoardById(board.id)!
}

function listVisibleDramas(user: AuthUser, activeTeamId: number | null) {
  let dramas = db.select().from(schema.dramas)
    .where(isNull(schema.dramas.deletedAt)).all()
  if (activeTeamId != null) {
    const sharedIds = getSharedDramaIdsByTeam(activeTeamId)
    dramas = dramas.filter(d => dramaVisibleToTeam(d, activeTeamId, sharedIds))
  } else if (user.role !== 'admin') {
    dramas = dramas.filter(d => userCanAccessDrama(d, user))
  }
  return dramas
}

/** 为当前可见项目补齐缺失画布（历史数据迁移） */
export function ensureBoardsForAccessibleDramas(user: AuthUser, activeTeamId: number | null) {
  const dramas = listVisibleDramas(user, activeTeamId)
  let created = 0
  for (const drama of dramas) {
    const existing = getBoardByDramaId(drama.id)
    if (!existing) {
      // 列表补齐时只建板；打开画布时 loadBoardDetailSynced 再同步节点
      ensureBoardForDrama(drama, user.id, { syncNodes: false })
      created++
    } else {
      const title = boardTitleForDrama(drama.title)
      if (existing.title !== title || existing.teamId !== drama.teamId) {
        db.update(schema.canvasBoards).set({
          title,
          teamId: drama.teamId,
          updatedAt: now(),
        }).where(eq(schema.canvasBoards.id, existing.id)).run()
      }
    }
  }
  return { dramaCount: dramas.length, created }
}

export function softDeleteBoardByDramaId(dramaId: number) {
  const board = getBoardByDramaId(dramaId, { includeDeleted: true })
  if (!board || board.deletedAt) return
  softDeleteBoard(board.id)
}

function resolveDramaCovers(drama: typeof schema.dramas.$inferSelect, boardThumbnail?: string | null) {
  const meta = parseJson<Record<string, any>>(drama.metadata, {})
  const raw = meta.covers && typeof meta.covers === 'object' ? meta.covers : {}
  const cover34 = String(raw['3:4'] || '').trim() || null
  const cover43 = String(raw['4:3'] || '').trim() || null
  // 旧数据只有 thumbnail 时，视为竖版 3:4 保留
  const fallback = String(drama.thumbnail || boardThumbnail || '').trim() || null
  const covers = {
    '3:4': cover34 || fallback,
    '4:3': cover43,
  }
  const coverUrl = covers['3:4'] || covers['4:3'] || null
  return { covers, cover_url: coverUrl }
}

export async function listAccessibleBoards(user: AuthUser, activeTeamId: number | null) {
  const dramas = listVisibleDramas(user, activeTeamId)
  const dramaMap = new Map(dramas.map(d => [d.id, d]))
  const boards = db.select().from(schema.canvasBoards)
    .where(isNull(schema.canvasBoards.deletedAt)).all()
    .filter(b => dramaMap.has(b.dramaId))

  const enriched = await enrichDramaListItems(dramas, { activeTeamId, user })
  const enrichMap = new Map(dramas.map((d, i) => [d.id, enriched[i] as any]))

  return boards.map((board) => {
    const drama = dramaMap.get(board.dramaId)!
    const extra = enrichMap.get(board.dramaId) || {} as any
    const nodeCount = db.select().from(schema.canvasNodes)
      .where(and(
        eq(schema.canvasNodes.boardId, board.id),
        isNull(schema.canvasNodes.deletedAt),
      )).all().length
    const { covers, cover_url: coverUrl } = resolveDramaCovers(drama, board.thumbnail)
    return {
      ...toSnakeCase(board),
      drama_id: board.dramaId,
      // 与项目列表一致：按剧本身时间排序，不用画布板 updated_at（回填时容易颠倒）
      created_at: drama.createdAt,
      updated_at: drama.updatedAt,
      drama_title: drama.title,
      drama_status: drama.status,
      drama_style: drama.style,
      cover_url: coverUrl,
      cover_3_4: covers['3:4'],
      cover_4_3: covers['4:3'],
      covers,
      thumbnail: coverUrl,
      episode_count: Array.isArray(extra.episodes) ? extra.episodes.length : (extra.total_episodes || 0),
      episodes: extra.episodes || [],
      character_count: extra.character_count ?? 0,
      scene_count: extra.scene_count ?? 0,
      shared_teams: extra.shared_teams || [],
      owner_team_name: extra.owner_team_name || null,
      is_shared_project: !!extra.is_shared_project,
      can_manage: !!extra.can_manage_drama,
      can_manage_drama: !!extra.can_manage_drama,
      can_delete: !!extra.can_delete,
      project_kind: extra.project_kind || null,
      narration_job_id: extra.narration_job_id || null,
      is_narration: !!extra.is_narration,
      node_count: nodeCount,
    }
  }).sort((a, b) => {
    // 与项目列表一致：最近更新的在前；同秒时用 id 倒序保证最后创建的更靠前
    const byUpdated = String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    if (byUpdated) return byUpdated
    return Number(b.drama_id || 0) - Number(a.drama_id || 0)
  })
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function loadRefEntity(kind: CanvasRefKind, refId: number, dramaId: number) {
  if (kind === 'character') {
    const [row] = db.select().from(schema.characters)
      .where(and(eq(schema.characters.id, refId), isNull(schema.characters.deletedAt))).all()
    if (!row || row.dramaId !== dramaId) return null
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      image_url: row.imageUrl,
      description: row.description,
      has_image: !!row.imageUrl,
      voice_style: row.voiceStyle,
      updated_at: row.updatedAt,
    }
  }
  if (kind === 'scene') {
    const [row] = db.select().from(schema.scenes)
      .where(and(eq(schema.scenes.id, refId), isNull(schema.scenes.deletedAt))).all()
    if (!row || row.dramaId !== dramaId) return null
    const name = [row.location, row.time].filter(Boolean).join(' · ') || `场景 #${row.id}`
    return {
      id: row.id,
      name,
      location: row.location,
      time: row.time,
      image_url: row.imageUrl,
      description: row.prompt,
      has_image: !!row.imageUrl,
      updated_at: row.updatedAt,
    }
  }
  if (kind === 'prop') {
    const [row] = db.select().from(schema.props)
      .where(and(eq(schema.props.id, refId), isNull(schema.props.deletedAt))).all()
    if (!row || row.dramaId !== dramaId) return null
    return {
      id: row.id,
      name: row.name,
      image_url: row.imageUrl,
      description: row.description,
      has_image: !!row.imageUrl,
      updated_at: row.updatedAt,
    }
  }
  if (kind === 'storyboard') {
    const [row] = db.select().from(schema.storyboards)
      .where(and(eq(schema.storyboards.id, refId), isNull(schema.storyboards.deletedAt))).all()
    if (!row) return null
    const [ep] = db.select().from(schema.episodes)
      .where(eq(schema.episodes.id, row.episodeId)).all()
    if (!ep || ep.dramaId !== dramaId) return null
    const thumb = row.composedImage || row.firstFrameImage || row.lastFrameImage || row.blockingImage || null
    const title = String(row.title || '').trim() || `镜头 ${row.storyboardNumber}`
    return {
      id: row.id,
      name: title,
      episode_id: row.episodeId,
      shot_index: row.storyboardNumber,
      image_url: thumb,
      video_url: row.composedVideoUrl || row.videoUrl || null,
      description: row.videoPrompt || row.action || row.description || null,
      has_image: !!thumb,
      has_video: !!(row.composedVideoUrl || row.videoUrl),
      updated_at: row.updatedAt,
    }
  }
  const [row] = db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.id, refId), isNull(schema.episodes.deletedAt))).all()
  if (!row || row.dramaId !== dramaId) return null
  const hasScript = !!(row.scriptContent || row.content)
  return {
    id: row.id,
    name: row.title,
    episode_number: row.episodeNumber,
    status: row.status,
    has_script: hasScript,
    has_rewritten: !!row.scriptContent,
    script_preview: String(row.scriptContent || row.content || '').slice(0, 280),
    updated_at: row.updatedAt,
  }
}

export function listDramaEpisodes(dramaId: number) {
  return db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt))).all()
    .sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0))
}

function getEpisodePropIds(episodeId: number): Set<number> {
  const sbIds = db.select({ id: schema.storyboards.id })
    .from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .all()
    .map(r => r.id)
  if (!sbIds.length) return new Set()
  const links = db.select().from(schema.storyboardProps)
    .where(inArray(schema.storyboardProps.storyboardId, sbIds))
    .all()
  return new Set(links.map(l => l.propId))
}

export type EpisodeMembership = {
  characterIds: Set<number>
  sceneIds: Set<number>
  propIds: Set<number>
  storyboardIds: Set<number>
}

export function getEpisodeMembership(episodeId: number, dramaId: number): EpisodeMembership {
  const storyboardIds = new Set(
    db.select({ id: schema.storyboards.id })
      .from(schema.storyboards)
      .where(and(
        eq(schema.storyboards.episodeId, episodeId),
        isNull(schema.storyboards.deletedAt),
      ))
      .all()
      .map(r => r.id),
  )
  return {
    characterIds: new Set(getEpisodeCharacters(episodeId, dramaId).map(c => c.id)),
    sceneIds: new Set(getEpisodeScenes(episodeId, dramaId).map(s => s.id)),
    propIds: getEpisodePropIds(episodeId),
    storyboardIds,
  }
}

/** 解析当前画布聚焦集：已存且有效则用，否则默认第 1 集 */
export function resolveFocusEpisodeId(
  board: typeof schema.canvasBoards.$inferSelect,
): number | null {
  const episodes = listDramaEpisodes(board.dramaId)
  if (!episodes.length) return null
  if (board.focusEpisodeId != null) {
    const hit = episodes.find(e => e.id === board.focusEpisodeId)
    if (hit) return hit.id
  }
  return episodes[0].id
}

/** 确保 focus_episode_id 已写入（缺省时落库为第一集） */
export function ensureBoardFocusEpisode(boardId: number): number | null {
  const board = getBoardById(boardId)
  if (!board || board.deletedAt) return null
  const focusId = resolveFocusEpisodeId(board)
  if (focusId != null && board.focusEpisodeId !== focusId) {
    db.update(schema.canvasBoards).set({
      focusEpisodeId: focusId,
      updatedAt: now(),
    }).where(eq(schema.canvasBoards.id, boardId)).run()
  }
  return focusId
}

export function setBoardFocusEpisode(boardId: number, episodeId: number) {
  const board = getBoardById(boardId)
  if (!board || board.deletedAt) throw new Error('画布不存在')
  const [ep] = db.select().from(schema.episodes)
    .where(and(
      eq(schema.episodes.id, episodeId),
      eq(schema.episodes.dramaId, board.dramaId),
      isNull(schema.episodes.deletedAt),
    )).all()
  if (!ep) throw new Error('集不存在或不属于该项目')
  db.update(schema.canvasBoards).set({
    focusEpisodeId: episodeId,
    updatedAt: now(),
  }).where(eq(schema.canvasBoards.id, boardId)).run()
  return episodeId
}

function nodeBelongsToFocus(
  kind: string,
  refType: string | null,
  refId: number | null,
  focusEpisodeId: number | null,
  membership: EpisodeMembership | null,
): boolean {
  if (kind === 'note') return true
  if (focusEpisodeId == null || !membership) return true
  const type = (refType || kind) as string
  if (!isCanvasRefKind(type) || refId == null) return true
  if (type === 'episode') return refId === focusEpisodeId
  if (type === 'character') return membership.characterIds.has(refId)
  if (type === 'scene') return membership.sceneIds.has(refId)
  if (type === 'prop') return membership.propIds.has(refId)
  if (type === 'storyboard') return membership.storyboardIds.has(refId)
  return false
}

export function serializeBoardDetail(board: typeof schema.canvasBoards.$inferSelect) {
  const [drama] = db.select().from(schema.dramas)
    .where(eq(schema.dramas.id, board.dramaId)).all()
  const focusEpisodeId = resolveFocusEpisodeId(board)
  const membership = focusEpisodeId != null
    ? getEpisodeMembership(focusEpisodeId, board.dramaId)
    : null
  const episodes = listDramaEpisodes(board.dramaId).map(e => ({
    id: e.id,
    episode_number: e.episodeNumber,
    title: e.title,
    status: e.status,
  }))

  const nodes = db.select().from(schema.canvasNodes)
    .where(and(
      eq(schema.canvasNodes.boardId, board.id),
      isNull(schema.canvasNodes.deletedAt),
    )).all()
  const edges = db.select().from(schema.canvasEdges)
    .where(eq(schema.canvasEdges.boardId, board.id)).all()

  const hydratedNodes = nodes
    .filter(node => nodeBelongsToFocus(
      String(node.kind),
      node.refType,
      node.refId,
      focusEpisodeId,
      membership,
    ))
    .map((node) => {
      const kind = String(node.kind)
      const refType = (node.refType || kind) as CanvasRefKind
      const refId = node.refId
      let entity: Record<string, unknown> | null = null
      let stale = false
      if (isCanvasRefKind(refType) && refId != null) {
        entity = loadRefEntity(refType, refId, board.dramaId)
        stale = !entity
      }
      const content = parseJson<Record<string, unknown> | null>(node.contentJson, null)
      return {
        ...toSnakeCase(node),
        layout: parseJson(node.layoutJson, {}),
        content,
        entity,
        stale,
        label: entity
          ? String(entity.name || '')
          : String(content?.text || content?.title || (stale ? `已删除${kind}` : kind)),
      }
    })

  const visibleKeys = new Set(hydratedNodes.map(n => String((n as any).node_key || '')))

  return {
    ...toSnakeCase(board),
    focus_episode_id: focusEpisodeId,
    episodes,
    viewport: parseJson(board.viewportJson, { x: 0, y: 0, zoom: 1 }),
    drama: drama ? {
      id: drama.id,
      title: drama.title,
      status: drama.status,
      team_id: drama.teamId,
      deleted: !!drama.deletedAt,
    } : null,
    nodes: hydratedNodes,
    edges: edges
      .filter(edge => visibleKeys.has(edge.fromNodeKey) && visibleKeys.has(edge.toNodeKey))
      .map(edge => ({
        ...toSnakeCase(edge),
        layout: parseJson(edge.layoutJson, {}),
      })),
  }
}

/** 实体池：默认按聚焦集过滤；未选集时返回空实体（仍返回集列表供 UI） */
export function listDramaPool(dramaId: number, episodeId?: number | null) {
  const episodeRows = listDramaEpisodes(dramaId)
  const episodes = episodeRows.map(r => ({
    id: r.id,
    kind: 'episode' as const,
    name: r.title,
    episode_number: r.episodeNumber,
    image_url: r.thumbnail,
  }))

  if (episodeId == null) {
    return {
      characters: [], scenes: [], props: [], storyboards: [], episodes,
      focus_episode_id: null,
    }
  }

  const ep = episodeRows.find(e => e.id === episodeId)
  if (!ep) {
    return {
      characters: [], scenes: [], props: [], storyboards: [], episodes,
      focus_episode_id: null,
    }
  }

  const characters = getEpisodeCharacters(episodeId, dramaId)
    .map(r => ({
      id: r.id,
      kind: 'character' as const,
      name: r.name,
      image_url: r.imageUrl,
      has_image: !!r.imageUrl,
    }))
  const scenes = getEpisodeScenes(episodeId, dramaId)
    .map(r => ({
      id: r.id,
      kind: 'scene' as const,
      name: [r.location, r.time].filter(Boolean).join(' · ') || `场景 #${r.id}`,
      image_url: r.imageUrl,
      has_image: !!r.imageUrl,
    }))
  const propIds = getEpisodePropIds(episodeId)
  const props = propIds.size
    ? db.select().from(schema.props)
      .where(and(eq(schema.props.dramaId, dramaId), isNull(schema.props.deletedAt))).all()
      .filter(r => propIds.has(r.id))
      .map(r => ({
        id: r.id,
        kind: 'prop' as const,
        name: r.name,
        image_url: r.imageUrl,
        has_image: !!r.imageUrl,
      }))
    : []

  const storyboards = db.select().from(schema.storyboards)
    .where(and(
      eq(schema.storyboards.episodeId, episodeId),
      isNull(schema.storyboards.deletedAt),
    ))
    .all()
    .sort((a, b) => (a.storyboardNumber || 0) - (b.storyboardNumber || 0))
    .map(r => {
      const thumb = r.composedImage || r.firstFrameImage || r.lastFrameImage || r.blockingImage || null
      return {
        id: r.id,
        kind: 'storyboard' as const,
        name: String(r.title || '').trim() || `镜头 ${r.storyboardNumber}`,
        shot_index: r.storyboardNumber,
        image_url: thumb,
        has_image: !!thumb,
        has_video: !!(r.composedVideoUrl || r.videoUrl),
      }
    })

  // 池内「集」只展示当前聚焦集，避免整剧 100+ 集刷屏
  return {
    characters,
    scenes,
    props,
    storyboards,
    episodes: [{
      id: ep.id,
      kind: 'episode' as const,
      name: ep.title,
      episode_number: ep.episodeNumber,
      image_url: ep.thumbnail,
      has_script: !!(ep.scriptContent || ep.content),
    }],
    focus_episode_id: episodeId,
  }
}

export function assertRefBelongsToDrama(kind: CanvasRefKind, refId: number, dramaId: number) {
  return !!loadRefEntity(kind, refId, dramaId)
}

const KIND_COLUMN: Record<CanvasRefKind, number> = {
  episode: 0,
  character: 1,
  scene: 2,
  prop: 3,
  storyboard: 4,
}

function defaultNodeSize(kind: CanvasRefKind) {
  if (kind === 'storyboard') return { w: 200, h: 168 }
  if (kind === 'character' || kind === 'scene') return { w: 200, h: 168 }
  if (kind === 'episode') return { w: 240, h: 140 }
  return { w: 200, h: 120 }
}

function nextAutoPosition(
  kind: CanvasRefKind,
  existing: Array<{ refType: string | null; x: number; y: number }>,
  kindRowIndex: number,
) {
  const col = KIND_COLUMN[kind] ?? 0
  const columnNodes = existing.filter(n => n.refType === kind)
  const baseX = 80 + col * 280
  if (columnNodes.length) {
    const maxY = Math.max(...columnNodes.map(n => Number(n.y) || 0))
    return { x: baseX, y: maxY + 190 }
  }
  return { x: baseX, y: 80 + kindRowIndex * 190 }
}

export function importNodes(
  boardId: number,
  refs: Array<{ ref_type: string; ref_id: number; x?: number; y?: number }>,
  dramaId: number,
  opts: { reviveRemoved?: boolean } = {},
) {
  const ts = now()
  const allNodes = db.select().from(schema.canvasNodes)
    .where(eq(schema.canvasNodes.boardId, boardId)).all()
  const existing = allNodes.filter(n => !n.deletedAt)
  const byRef = new Map(
    allNodes
      .filter(n => n.refType && n.refId != null)
      .map(n => [`${n.refType}:${n.refId}`, n]),
  )

  const created: typeof existing = []
  const kindCounters: Record<string, number> = {}
  for (const ref of refs) {
    const kind = String(ref.ref_type || '').trim()
    const refId = Number(ref.ref_id)
    if (!isCanvasRefKind(kind) || !refId) continue
    if (!assertRefBelongsToDrama(kind, refId, dramaId)) continue

    const key = `${kind}:${refId}`
    const hit = byRef.get(key)
    if (hit) {
      // 用户从画布移除过的节点：普通同步不再上板；force 时可恢复
      if (hit.deletedAt) {
        if (!opts.reviveRemoved) continue
        const auto = nextAutoPosition(kind, existing, kindCounters[kind] || 0)
        kindCounters[kind] = (kindCounters[kind] || 0) + 1
        db.update(schema.canvasNodes).set({
          deletedAt: null,
          x: ref.x ?? auto.x,
          y: ref.y ?? auto.y,
          updatedAt: ts,
        }).where(eq(schema.canvasNodes.id, hit.id)).run()
        const [revived] = db.select().from(schema.canvasNodes)
          .where(eq(schema.canvasNodes.id, hit.id)).all()
        if (revived) {
          created.push(revived)
          existing.push(revived)
        }
        continue
      }
      if (ref.x != null || ref.y != null) {
        db.update(schema.canvasNodes).set({
          x: ref.x ?? hit.x,
          y: ref.y ?? hit.y,
          updatedAt: ts,
        }).where(eq(schema.canvasNodes.id, hit.id)).run()
      }
      continue
    }

    const rowIndex = kindCounters[kind] || 0
    kindCounters[kind] = rowIndex + 1
    const auto = nextAutoPosition(kind, [...existing, ...created], rowIndex)
    const size = defaultNodeSize(kind)
    const nodeKey = randomUUID()
    const x = ref.x ?? auto.x
    const y = ref.y ?? auto.y
    const res = db.insert(schema.canvasNodes).values({
      boardId,
      nodeKey,
      kind,
      refType: kind,
      refId,
      x,
      y,
      w: size.w,
      h: size.h,
      zIndex: 0,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    const [row] = db.select().from(schema.canvasNodes)
      .where(eq(schema.canvasNodes.id, Number(res.lastInsertRowid))).all()
    if (row) {
      created.push(row)
      byRef.set(key, row)
    }
  }

  if (created.length) {
    db.update(schema.canvasBoards).set({ updatedAt: ts })
      .where(eq(schema.canvasBoards.id, boardId)).run()
  }
  return created
}

/** 将「当前聚焦集」尚未上板的角色/场景/道具/本集卡片同步到画布（不扫全剧） */
export function syncBoardFromDrama(
  boardId: number,
  dramaId: number,
  opts: { reviveRemoved?: boolean; episodeId?: number | null } = {},
) {
  const board = getBoardById(boardId)
  const focusId = opts.episodeId != null
    ? opts.episodeId
    : (board ? ensureBoardFocusEpisode(boardId) : null)
  const pool = listDramaPool(dramaId, focusId)
  const refs = [
    ...pool.characters.map(item => ({ ref_type: 'character', ref_id: item.id })),
    ...pool.scenes.map(item => ({ ref_type: 'scene', ref_id: item.id })),
    ...pool.props.map(item => ({ ref_type: 'prop', ref_id: item.id })),
    ...pool.storyboards.map(item => ({ ref_type: 'storyboard', ref_id: item.id })),
    ...pool.episodes.map(item => ({ ref_type: 'episode', ref_id: item.id })),
  ]
  return importNodes(boardId, refs, dramaId, opts)
}

/** 画布工作室上下文：流水线状态 + 本集资产完成度 */
export function getCanvasStudioContext(boardId: number) {
  const board = getBoardById(boardId)
  if (!board || board.deletedAt) return null
  const focusId = ensureBoardFocusEpisode(boardId)
  const [ep] = focusId
    ? db.select().from(schema.episodes).where(eq(schema.episodes.id, focusId)).all()
    : []
  const pool = listDramaPool(board.dramaId, focusId)
  const chars = pool.characters
  const scenes = pool.scenes
  const storyboards = pool.storyboards
  const charWithImage = chars.filter(c => c.has_image).length
  const sceneWithImage = scenes.filter(s => s.has_image).length
  const sbWithImage = storyboards.filter(s => s.has_image).length
  const sbWithVideo = storyboards.filter(s => s.has_video).length

  const steps = [
    {
      key: 'script:rewrite',
      label: '整理剧本',
      agent: 'script_rewriter',
      status: ep?.scriptContent ? 'done' : (ep?.content ? 'ready' : 'pending'),
    },
    {
      key: 'script:extract',
      label: '提取资产',
      agent: 'extractor',
      status: chars.length || scenes.length ? 'done' : ((ep?.scriptContent || ep?.content) ? 'ready' : 'pending'),
      count: chars.length + scenes.length,
    },
    {
      key: 'script:voice',
      label: '分配音色',
      agent: 'voice_assigner',
      status: 'ready',
    },
    {
      key: 'prod:chars',
      label: '角色立绘',
      agent: 'grid_prompt_generator',
      status: chars.length && charWithImage === chars.length
        ? 'done'
        : (charWithImage > 0 ? 'partial' : (chars.length ? 'ready' : 'pending')),
      completed: charWithImage,
      total: chars.length,
    },
    {
      key: 'prod:scenes',
      label: '场景图',
      agent: 'grid_prompt_generator',
      status: scenes.length && sceneWithImage === scenes.length
        ? 'done'
        : (sceneWithImage > 0 ? 'partial' : (scenes.length ? 'ready' : 'pending')),
      completed: sceneWithImage,
      total: scenes.length,
    },
    {
      key: 'script:storyboard',
      label: '拆解分镜',
      agent: 'storyboard_breaker',
      status: storyboards.length ? 'done' : (ep?.scriptContent ? 'ready' : 'pending'),
      count: storyboards.length,
    },
    {
      key: 'prod:videos',
      label: '生成视频',
      agent: 'storyboard_breaker',
      status: storyboards.length && sbWithVideo === storyboards.length
        ? 'done'
        : (sbWithVideo > 0 ? 'partial' : (storyboards.length ? 'ready' : 'pending')),
      completed: sbWithVideo,
      total: storyboards.length,
    },
    {
      key: 'export:merge',
      label: '拼接导出',
      agent: 'storyboard_breaker',
      status: 'ready',
    },
  ]

  return {
    focus_episode_id: focusId,
    episode: ep ? {
      id: ep.id,
      episode_number: ep.episodeNumber,
      title: ep.title,
      has_content: !!ep.content,
      has_script: !!ep.scriptContent,
    } : null,
    counts: {
      characters: chars.length,
      characters_with_image: charWithImage,
      scenes: scenes.length,
      scenes_with_image: sceneWithImage,
      props: pool.props.length,
      storyboards: storyboards.length,
      storyboards_with_image: sbWithImage,
      storyboards_with_video: sbWithVideo,
    },
    steps,
  }
}

export function loadBoardDetailSynced(boardId: number) {
  const board = getBoardById(boardId)
  if (!board || board.deletedAt) return null
  ensureBoardFocusEpisode(board.id)
  syncBoardFromDrama(board.id, board.dramaId)
  return serializeBoardDetail(getBoardById(board.id)!)
}

export function replaceBoardLayout(
  boardId: number,
  payload: {
    viewport?: { x?: number; y?: number; zoom?: number }
    nodes?: Array<{
      node_key: string
      x?: number
      y?: number
      w?: number
      h?: number
      z_index?: number
      layout_json?: unknown
      content_json?: unknown
    }>
    edges?: Array<{
      edge_key: string
      from_node_key: string
      to_node_key: string
      edge_type?: string
      layout_json?: unknown
    }>
  },
  baseUpdatedAt?: string | null,
) {
  const board = getBoardById(boardId)
  if (!board || board.deletedAt) throw new Error('画布不存在')
  if (baseUpdatedAt && board.updatedAt !== baseUpdatedAt) {
    const err = new Error('画布布局已更新，请刷新后重试')
    ;(err as any).code = 409
    throw err
  }

  const ts = now()
  let touched = false
  if (payload.viewport) {
    const current = parseJson(board.viewportJson, { x: 0, y: 0, zoom: 1 })
    db.update(schema.canvasBoards).set({
      viewportJson: JSON.stringify({
        x: payload.viewport.x ?? current.x,
        y: payload.viewport.y ?? current.y,
        zoom: payload.viewport.zoom ?? current.zoom,
      }),
      updatedAt: ts,
    }).where(eq(schema.canvasBoards.id, boardId)).run()
    touched = true
  }

  if (payload.nodes?.length) {
    const existing = db.select().from(schema.canvasNodes)
      .where(and(
        eq(schema.canvasNodes.boardId, boardId),
        isNull(schema.canvasNodes.deletedAt),
      )).all()
    const map = new Map(existing.map(n => [n.nodeKey, n]))
    for (const node of payload.nodes) {
      const row = map.get(String(node.node_key))
      if (!row) continue
      db.update(schema.canvasNodes).set({
        x: node.x ?? row.x,
        y: node.y ?? row.y,
        w: node.w ?? row.w,
        h: node.h ?? row.h,
        zIndex: node.z_index ?? row.zIndex,
        layoutJson: node.layout_json !== undefined
          ? JSON.stringify(node.layout_json)
          : row.layoutJson,
        contentJson: node.content_json !== undefined
          ? JSON.stringify(node.content_json)
          : row.contentJson,
        updatedAt: ts,
      }).where(eq(schema.canvasNodes.id, row.id)).run()
      touched = true
    }
  }

  if (payload.edges) {
    db.delete(schema.canvasEdges)
      .where(eq(schema.canvasEdges.boardId, boardId)).run()
    for (const edge of payload.edges) {
      const edgeKey = String(edge.edge_key || randomUUID())
      const fromKey = String(edge.from_node_key || '').trim()
      const toKey = String(edge.to_node_key || '').trim()
      if (!fromKey || !toKey) continue
      db.insert(schema.canvasEdges).values({
        boardId,
        edgeKey,
        fromNodeKey: fromKey,
        toNodeKey: toKey,
        edgeType: String(edge.edge_type || 'link'),
        layoutJson: edge.layout_json != null ? JSON.stringify(edge.layout_json) : null,
        createdAt: ts,
        updatedAt: ts,
      }).run()
    }
    touched = true
  }

  if (touched && !payload.viewport) {
    db.update(schema.canvasBoards).set({ updatedAt: ts })
      .where(eq(schema.canvasBoards.id, boardId)).run()
  }

  return getBoardById(boardId)!
}

export function softDeleteNode(boardId: number, nodeKey: string) {
  const [node] = db.select().from(schema.canvasNodes)
    .where(and(
      eq(schema.canvasNodes.boardId, boardId),
      eq(schema.canvasNodes.nodeKey, nodeKey),
      isNull(schema.canvasNodes.deletedAt),
    )).all()
  if (!node) return false
  const ts = now()
  db.update(schema.canvasNodes).set({ deletedAt: ts, updatedAt: ts })
    .where(eq(schema.canvasNodes.id, node.id)).run()
  db.update(schema.canvasBoards).set({ updatedAt: ts })
    .where(eq(schema.canvasBoards.id, boardId)).run()
  // drop edges touching this node
  const edges = db.select().from(schema.canvasEdges)
    .where(eq(schema.canvasEdges.boardId, boardId)).all()
  for (const edge of edges) {
    if (edge.fromNodeKey === nodeKey || edge.toNodeKey === nodeKey) {
      db.delete(schema.canvasEdges).where(eq(schema.canvasEdges.id, edge.id)).run()
    }
  }
  return true
}

export function createNoteNode(boardId: number, text: string, x = 120, y = 120) {
  const ts = now()
  const nodeKey = randomUUID()
  const res = db.insert(schema.canvasNodes).values({
    boardId,
    nodeKey,
    kind: 'note',
    refType: null,
    refId: null,
    x,
    y,
    w: 220,
    h: 140,
    zIndex: 0,
    contentJson: JSON.stringify({ text: String(text || '').trim() || '便签' }),
    createdAt: ts,
    updatedAt: ts,
  }).run()
  db.update(schema.canvasBoards).set({ updatedAt: ts })
    .where(eq(schema.canvasBoards.id, boardId)).run()
  return db.select().from(schema.canvasNodes)
    .where(eq(schema.canvasNodes.id, Number(res.lastInsertRowid))).all()[0]
}
