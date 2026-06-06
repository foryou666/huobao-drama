import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { findActiveCharacterByName } from '../utils/character-redirect.js'
import { repairEpisodeSceneLinks } from '../utils/scene-redirect.js'
import {
  buildClipVideoPrompt,
  parseIndustrialScriptDetailed,
  validateParsedImport,
  type ParsedIndustrialShot,
} from '../utils/industrial-script-parser.js'

const MAX_CLIP_SECONDS = 15
const MIN_CLIP_SECONDS = 10

export function isLegacyStoryboard(clipSource?: string | null) {
  return !clipSource || clipSource === 'legacy'
}

function getEpisodeOrThrow(episodeId: number) {
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  if (!ep || ep.deletedAt) throw new Error('Episode not found')
  return ep
}

function getEpisodeCharacterIds(episodeId: number) {
  return new Set(
    db.select().from(schema.episodeCharacters)
      .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
      .map(link => link.characterId),
  )
}

function matchSceneId(dramaId: number, location?: string, time?: string): number | null {
  if (!location) return null
  const scenes = db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt))).all()
  const loc = location.trim()
  const t = String(time || '').trim()
  const exact = scenes.find(s => s.location === loc && (!t || s.time === t || s.time.includes(t) || t.includes(s.time)))
  if (exact) return exact.id
  const byLoc = scenes.find(s => s.location === loc || s.location.includes(loc) || loc.includes(s.location))
  return byLoc?.id ?? null
}

function inferCharacterIds(dramaId: number, episodeId: number, shot: ParsedIndustrialShot): number[] {
  const episodeCharIds = getEpisodeCharacterIds(episodeId)
  const chars = db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt))).all()
    .filter(c => !episodeCharIds.size || episodeCharIds.has(c.id))
    .sort((a, b) => b.name.length - a.name.length)

  const haystack = [shot.title, shot.performance, shot.dialogue, shot.aiPromptZh, shot.aiPromptEn].join(' ')
  const ids = new Set<number>()
  for (const ch of chars) {
    if (ch.name && haystack.includes(ch.name)) ids.add(ch.id)
  }
  return [...ids]
}

function syncPlanCharacters(planId: number, characterIds: number[]) {
  db.delete(schema.shotPlanCharacters).where(eq(schema.shotPlanCharacters.shotPlanId, planId)).run()
  for (const characterId of [...new Set(characterIds.filter(Boolean))]) {
    db.insert(schema.shotPlanCharacters).values({ shotPlanId: planId, characterId }).run()
  }
}

function syncStoryboardCharacters(storyboardId: number, characterIds: number[]) {
  db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, storyboardId)).run()
  for (const characterId of [...new Set(characterIds.filter(Boolean))]) {
    db.insert(schema.storyboardCharacters).values({ storyboardId, characterId }).run()
  }
}

function getPlanCharacterIds(planId: number) {
  return db.select().from(schema.shotPlanCharacters)
    .where(eq(schema.shotPlanCharacters.shotPlanId, planId)).all()
    .map(r => r.characterId)
}

export function listShotPlans(episodeId: number) {
  const rows = db.select().from(schema.shotPlans)
    .where(and(eq(schema.shotPlans.episodeId, episodeId), isNull(schema.shotPlans.deletedAt)))
    .all()
  rows.sort((a, b) => (a.sortOrder || a.shotNumber) - (b.sortOrder || b.shotNumber))
  return rows.map(row => ({
    ...row,
    character_ids: getPlanCharacterIds(row.id),
  }))
}

export function listClipsWithPlans(episodeId: number) {
  const clips = db.select().from(schema.storyboards)
    .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt)))
    .all()
    .sort((a, b) => a.storyboardNumber - b.storyboardNumber)

  const links = db.select().from(schema.shotClipPlans).all()
  const plans = listShotPlans(episodeId)
  const planById = new Map(plans.map(p => [p.id, p]))

  return clips.map(clip => {
    const planLinks = links
      .filter(l => l.storyboardId === clip.id)
      .sort((a, b) => a.orderInClip - b.orderInClip)
    const shotPlans = planLinks
      .map(l => planById.get(l.shotPlanId))
      .filter((p): p is NonNullable<typeof p> => !!p)
    const charIds = db.select().from(schema.storyboardCharacters)
      .where(eq(schema.storyboardCharacters.storyboardId, clip.id)).all()
      .map(r => r.characterId)
    return { clip, shotPlans, character_ids: charIds }
  })
}

function clearNonLegacyClips(episodeId: number) {
  const clips = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId)).all()
  for (const clip of clips) {
    if (isLegacyStoryboard(clip.clipSource)) continue
    db.delete(schema.shotClipPlans).where(eq(schema.shotClipPlans.storyboardId, clip.id)).run()
    db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, clip.id)).run()
    db.delete(schema.storyboards).where(eq(schema.storyboards.id, clip.id)).run()
  }
}

function clearShotPlans(episodeId: number) {
  const plans = db.select().from(schema.shotPlans)
    .where(eq(schema.shotPlans.episodeId, episodeId)).all()
  for (const plan of plans) {
    db.delete(schema.shotPlanCharacters).where(eq(schema.shotPlanCharacters.shotPlanId, plan.id)).run()
    db.delete(schema.shotClipPlans).where(eq(schema.shotClipPlans.shotPlanId, plan.id)).run()
  }
  db.delete(schema.shotPlans).where(eq(schema.shotPlans.episodeId, episodeId)).run()
}

export interface ImportResult {
  plan_count: number
  clip_count: number
  industrial: boolean
  skipped_template_count?: number
  marker_count?: number
  warning?: string
}

export function importIndustrialScript(episodeId: number, dramaId: number, text: string): ImportResult {
  repairEpisodeSceneLinks(episodeId, dramaId)
  const parsedResult = parseIndustrialScriptDetailed(text)
  const validationError = validateParsedImport(parsedResult)
  if (validationError) throw new Error(validationError)

  const parsed = parsedResult.shots
  if (!parsed.length) throw new Error('未能解析出任何镜头，请检查格式（需包含【镜头 001 - 标题】）')

  const warning = parsedResult.marker_count > parsed.length + parsedResult.skipped_template_count
    ? `文本中检测到 ${parsedResult.marker_count} 个镜头标记，成功导入 ${parsed.length} 个。若数量偏少，请确认已从 DeepSeek 复制完整输出（而非仅复制提示词模板）。`
    : parsedResult.skipped_template_count > 0
      ? `已跳过 ${parsedResult.skipped_template_count} 条模板示例镜头。`
      : undefined

  const ts = now()
  const isIndustrial = parsed.some(s => s.isIndustrial)

  db.transaction(() => {
    clearNonLegacyClips(episodeId)
    clearShotPlans(episodeId)

    const planRecords: Array<{ id: number; shot: ParsedIndustrialShot; characterIds: number[]; sceneId: number | null }> = []

    for (let i = 0; i < parsed.length; i++) {
      const shot = parsed[i]
      const sceneId = matchSceneId(dramaId, shot.location, shot.time)
      const characterIds = inferCharacterIds(dramaId, episodeId, shot)
      const res = db.insert(schema.shotPlans).values({
        episodeId,
        shotNumber: shot.shotNumber,
        title: shot.title,
        sceneId,
        location: shot.location || null,
        time: shot.time || null,
        action: shot.performance || null,
        dialogue: shot.dialogue || null,
        dialogueType: shot.dialogueType,
        duration: shot.duration,
        description: [shot.performance, shot.dialogue].filter(Boolean).join(' · ').slice(0, 280),
        industrialBlock: shot.industrialBlock,
        source: 'import',
        status: 'draft',
        sortOrder: i + 1,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      const planId = Number(res.lastInsertRowid)
      syncPlanCharacters(planId, characterIds)
      planRecords.push({ id: planId, shot, characterIds, sceneId })
    }

    if (isIndustrial) {
      autoGroupClipsInternal(episodeId, dramaId, planRecords, 'import', true)
    }
  })

  const planCount = parsed.length
  const clipCount = db.select().from(schema.storyboards)
    .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt)))
    .all()
    .filter(c => !isLegacyStoryboard(c.clipSource)).length

  return {
    plan_count: planCount,
    clip_count: clipCount,
    industrial: isIndustrial,
    skipped_template_count: parsedResult.skipped_template_count,
    marker_count: parsedResult.marker_count,
    warning,
  }
}

interface PlanRecord {
  id: number
  shot: ParsedIndustrialShot
  characterIds: number[]
  sceneId: number | null
}

function sceneKey(plan: PlanRecord) {
  return plan.sceneId != null
    ? `scene:${plan.sceneId}`
    : `loc:${plan.shot.location || ''}|${plan.shot.time || ''}`
}

function packPlansIntoClips(plans: PlanRecord[]): PlanRecord[][] {
  const groups: PlanRecord[][] = []
  let current: PlanRecord[] = []
  let currentScene = ''
  let currentDuration = 0

  const flush = () => {
    if (current.length) groups.push(current)
    current = []
    currentDuration = 0
  }

  for (const plan of plans) {
    const key = sceneKey(plan)
    const dur = Number(plan.shot.duration) || 2
    const sceneChanged = currentScene && key !== currentScene

    if (sceneChanged) flush()

    if (currentDuration + dur > MAX_CLIP_SECONDS && current.length) {
      flush()
    }

    currentScene = key
    current.push(plan)
    currentDuration += dur
  }
  flush()
  return groups
}

function autoGroupClipsInternal(
  episodeId: number,
  dramaId: number,
  planRecords: PlanRecord[],
  clipSource: string,
  expanded: boolean,
) {
  clearNonLegacyClips(episodeId)
  const groups = packPlansIntoClips(planRecords)
  const ts = now()

  groups.forEach((group, idx) => {
    const duration = Math.min(MAX_CLIP_SECONDS, Math.max(
      MIN_CLIP_SECONDS,
      Math.round(group.reduce((s, p) => s + (Number(p.shot.duration) || 2), 0)),
    ))
    const sceneId = group.find(p => p.sceneId)?.sceneId ?? null
    const location = group[0]?.shot.location || null
    const time = group[0]?.shot.time || null
    const title = location
      ? `${location}${time ? ` · ${time}` : ''}（${group[0].shot.shotNumber}-${group[group.length - 1].shot.shotNumber}）`
      : `片段 ${idx + 1}`

    const allCharIds = [...new Set(group.flatMap(p => p.characterIds))]
    const videoPrompt = expanded ? buildClipVideoPrompt(group.map(p => p.shot)) : null

    const res = db.insert(schema.storyboards).values({
      episodeId,
      storyboardNumber: idx + 1,
      title,
      sceneId,
      location,
      time,
      duration,
      videoPrompt,
      promptStatus: expanded ? 'expanded' : 'empty',
      clipSource,
      description: group.map(p => p.shot.title).join(' / '),
      createdAt: ts,
      updatedAt: ts,
    }).run()

    const clipId = Number(res.lastInsertRowid)
    syncStoryboardCharacters(clipId, allCharIds)

    group.forEach((plan, order) => {
      db.insert(schema.shotClipPlans).values({
        storyboardId: clipId,
        shotPlanId: plan.id,
        orderInClip: order + 1,
      }).run()
    })
  })
}

export function autoGroupClips(episodeId: number, dramaId: number, clipSource = 'auto_scene') {
  const plans = listShotPlans(episodeId)
  if (!plans.length) throw new Error('暂无镜头列表，请先导入或生成')

  const planRecords: PlanRecord[] = plans.map(p => ({
    id: p.id,
    shot: {
      shotNumber: p.shotNumber,
      title: p.title || '',
      duration: Number(p.duration) || 2,
      performance: p.action || undefined,
      dialogue: p.dialogue || undefined,
      dialogueType: p.dialogueType || 'dialogue',
      industrialBlock: p.industrialBlock || '',
      isIndustrial: !!p.industrialBlock,
      location: p.location || undefined,
      time: p.time || undefined,
    },
    characterIds: p.character_ids,
    sceneId: p.sceneId,
  }))

  const expanded = planRecords.every(p => p.shot.isIndustrial && p.shot.industrialBlock)

  db.transaction(() => {
    autoGroupClipsInternal(episodeId, dramaId, planRecords, clipSource, expanded)
  })

  return { clip_count: packPlansIntoClips(planRecords).length }
}

export function confirmShotPlans(episodeId: number) {
  const ts = now()
  db.update(schema.shotPlans)
    .set({ status: 'confirmed', updatedAt: ts })
    .where(and(eq(schema.shotPlans.episodeId, episodeId), isNull(schema.shotPlans.deletedAt)))
    .run()
  return { confirmed: true }
}

export function updateShotPlan(
  planId: number,
  episodeId: number,
  dramaId: number,
  fields: Record<string, unknown>,
) {
  const [plan] = db.select().from(schema.shotPlans).where(eq(schema.shotPlans.id, planId)).all()
  if (!plan || plan.episodeId !== episodeId || plan.deletedAt) throw new Error('镜头不存在')

  const ts = now()
  const updates: Record<string, unknown> = { updatedAt: ts }

  const map: Record<string, string> = {
    title: 'title',
    scene_id: 'sceneId',
    location: 'location',
    time: 'time',
    action: 'action',
    dialogue: 'dialogue',
    dialogue_type: 'dialogueType',
    duration: 'duration',
    description: 'description',
    shot_number: 'shotNumber',
    sort_order: 'sortOrder',
  }
  for (const [key, col] of Object.entries(map)) {
    if (key in fields) updates[col] = fields[key]
  }

  db.update(schema.shotPlans).set(updates as any).where(eq(schema.shotPlans.id, planId)).run()

  if ('character_ids' in fields && Array.isArray(fields.character_ids)) {
    const episodeCharIds = getEpisodeCharacterIds(episodeId)
    const ids = (fields.character_ids as number[]).filter(id => episodeCharIds.has(id))
    syncPlanCharacters(planId, ids)
  }

  markClipsStaleForPlan(planId)

  const [updated] = db.select().from(schema.shotPlans).where(eq(schema.shotPlans.id, planId)).all()
  return { ...updated, character_ids: getPlanCharacterIds(planId) }
}

export function markClipsStaleForPlan(planId: number) {
  const links = db.select().from(schema.shotClipPlans)
    .where(eq(schema.shotClipPlans.shotPlanId, planId)).all()
  const ts = now()
  for (const link of links) {
    db.update(schema.storyboards)
      .set({ promptStatus: 'stale', updatedAt: ts })
      .where(eq(schema.storyboards.id, link.storyboardId))
      .run()
  }
}

export function reorderShotPlans(episodeId: number, orderedIds: number[]) {
  const ts = now()
  orderedIds.forEach((id, index) => {
    db.update(schema.shotPlans)
      .set({ sortOrder: index + 1, updatedAt: ts })
      .where(and(eq(schema.shotPlans.id, id), eq(schema.shotPlans.episodeId, episodeId)))
      .run()
  })
  return { reordered: orderedIds.length }
}

function planRecordFromRow(p: typeof schema.shotPlans.$inferSelect & { character_ids?: number[] }): PlanRecord {
  return {
    id: p.id,
    shot: {
      shotNumber: p.shotNumber,
      title: p.title || '',
      duration: Number(p.duration) || 2,
      performance: p.action || undefined,
      dialogue: p.dialogue || undefined,
      dialogueType: p.dialogueType || 'dialogue',
      industrialBlock: p.industrialBlock || '',
      isIndustrial: !!p.industrialBlock,
      location: p.location || undefined,
      time: p.time || undefined,
    },
    characterIds: getPlanCharacterIds(p.id),
    sceneId: p.sceneId,
  }
}

function planRecordsFromClip(storyboardId: number): PlanRecord[] {
  const links = db.select().from(schema.shotClipPlans)
    .where(eq(schema.shotClipPlans.storyboardId, storyboardId)).all()
    .sort((a, b) => a.orderInClip - b.orderInClip)

  return links.map(link => {
    const [p] = db.select().from(schema.shotPlans).where(eq(schema.shotPlans.id, link.shotPlanId)).all()
    if (!p || p.deletedAt) return null
    return planRecordFromRow(p)
  }).filter((r): r is PlanRecord => !!r)
}

function renumberClips(episodeId: number) {
  const clips = db.select().from(schema.storyboards)
    .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt)))
    .all()
    .filter(c => !isLegacyStoryboard(c.clipSource))
    .sort((a, b) => a.storyboardNumber - b.storyboardNumber)

  const ts = now()
  clips.forEach((clip, idx) => {
    db.update(schema.storyboards)
      .set({ storyboardNumber: idx + 1, updatedAt: ts })
      .where(eq(schema.storyboards.id, clip.id))
      .run()
  })
}

function refreshClipFromPlans(storyboardId: number) {
  const [clip] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId)).all()
  if (!clip || isLegacyStoryboard(clip.clipSource)) return

  const records = planRecordsFromClip(storyboardId)
  if (!records.length) return

  const totalSec = records.reduce((s, p) => s + (Number(p.shot.duration) || 2), 0)
  const duration = Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, Math.round(totalSec)))
  const expanded = records.every(r => r.shot.industrialBlock)
  const sceneId = records.find(r => r.sceneId)?.sceneId ?? clip.sceneId
  const location = records[0]?.shot.location || clip.location
  const time = records[0]?.shot.time || clip.time
  const title = location
    ? `${location}${time ? ` · ${time}` : ''}（${records[0].shot.shotNumber}-${records[records.length - 1].shot.shotNumber}）`
    : clip.title

  const allCharIds = [...new Set(records.flatMap(p => p.characterIds))]
  const videoPrompt = expanded ? buildClipVideoPrompt(records.map(p => p.shot)) : clip.videoPrompt

  db.update(schema.storyboards).set({
    title,
    sceneId,
    location,
    time,
    duration,
    videoPrompt,
    promptStatus: expanded ? 'expanded' : (clip.videoPrompt ? 'stale' : 'empty'),
    description: records.map(p => p.shot.title).join(' / '),
    clipSource: clip.clipSource === 'auto_scene' ? 'manual' : (clip.clipSource || 'manual'),
    updatedAt: now(),
  }).where(eq(schema.storyboards.id, storyboardId)).run()

  syncStoryboardCharacters(storyboardId, allCharIds)
}

/** 将微镜头从当前片段移到目标片段（保持镜头编号顺序，自动重建 video_prompt） */
export function movePlanToClip(episodeId: number, planId: number, targetClipId: number) {
  const [plan] = db.select().from(schema.shotPlans).where(eq(schema.shotPlans.id, planId)).all()
  if (!plan || plan.episodeId !== episodeId || plan.deletedAt) throw new Error('镜头不存在')

  const [targetClip] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, targetClipId)).all()
  if (!targetClip || targetClip.episodeId !== episodeId || targetClip.deletedAt || isLegacyStoryboard(targetClip.clipSource)) {
    throw new Error('目标片段不存在')
  }

  const [sourceLink] = db.select().from(schema.shotClipPlans).where(eq(schema.shotClipPlans.shotPlanId, planId)).all()
  const sourceClipId = sourceLink?.storyboardId
  if (sourceClipId === targetClipId) return { moved: false, message: '已在目标片段中' }

  db.transaction(() => {
    if (sourceLink) {
      db.delete(schema.shotClipPlans).where(eq(schema.shotClipPlans.shotPlanId, planId)).run()
    }

    const targetLinks = db.select().from(schema.shotClipPlans)
      .where(eq(schema.shotClipPlans.storyboardId, targetClipId)).all()
    const allIds = [...new Set([...targetLinks.map(l => l.shotPlanId), planId])]
    const sorted = allIds.map(id => {
      const [p] = db.select().from(schema.shotPlans).where(eq(schema.shotPlans.id, id)).all()
      return { id, shotNumber: p?.shotNumber || 0 }
    }).sort((a, b) => a.shotNumber - b.shotNumber)

    db.delete(schema.shotClipPlans).where(eq(schema.shotClipPlans.storyboardId, targetClipId)).run()
    sorted.forEach((item, i) => {
      db.insert(schema.shotClipPlans).values({
        storyboardId: targetClipId,
        shotPlanId: item.id,
        orderInClip: i + 1,
      }).run()
    })

    refreshClipFromPlans(targetClipId)

    if (sourceClipId) {
      const remaining = db.select().from(schema.shotClipPlans)
        .where(eq(schema.shotClipPlans.storyboardId, sourceClipId)).all()
      if (!remaining.length) {
        db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, sourceClipId)).run()
        db.delete(schema.storyboards).where(eq(schema.storyboards.id, sourceClipId)).run()
        renumberClips(episodeId)
      } else {
        refreshClipFromPlans(sourceClipId)
      }
    }
  })

  return { moved: true }
}

export function getPlanClipId(planId: number): number | null {
  const [link] = db.select().from(schema.shotClipPlans).where(eq(schema.shotClipPlans.shotPlanId, planId)).all()
  return link?.storyboardId ?? null
}

export function matchCharacterByName(dramaId: number, name: string) {
  return findActiveCharacterByName(dramaId, name)
}
