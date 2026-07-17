import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import type { RepaintAnalysis } from './repaint-types.js'
import { generateDetailedSegmentPrompt } from './repaint-segment-prompt.js'
import type { VideoContentRef } from '../utils/seedance-content.js'
import { CHENGMENT_DEFAULT_MODEL_ID } from '../constants/chengmeng.js'
import { extractVideoFrameAt } from '../utils/shot-frame.js'

/** Seedance 2.0 / 橙盟：单段 4–15 秒 */
const MIN_GEN_SEC = 4
const MAX_GEN_SEC = 15
const MAX_KEYFRAMES_PER_SEGMENT = 3

export interface PackedSegment {
  segment_index: number
  start_sec: number
  end_sec: number
  duration_sec: number
  shot_ids: string[]
}

function roundSec(n: number) {
  return Math.round(n * 100) / 100
}

function sceneIdForShot(analysis: RepaintAnalysis, shotId: string): string | null {
  const assignment = analysis.shot_assignments.find(a => a.shot_id === shotId)
  return assignment?.scene_id ?? null
}

function dominantSceneId(analysis: RepaintAnalysis, shotIds: string[]): string | null {
  const counts = new Map<string, number>()
  for (const shotId of shotIds) {
    const sceneId = sceneIdForShot(analysis, shotId)
    if (!sceneId) continue
    counts.set(sceneId, (counts.get(sceneId) || 0) + 1)
  }
  let best: string | null = null
  let max = 0
  for (const [sceneId, count] of counts) {
    if (count > max) {
      max = count
      best = sceneId
    }
  }
  return best
}

/**
 * 按 Seedance 2.0 打包：单段尽量接近 15s，上限 15s；
 * 场景切换时优先切段（同场景内才合并）。
 */
export function packShotsForSeedance(analysis: RepaintAnalysis): PackedSegment[] {
  const shots = analysis.shots
  if (!shots.length) return []

  const segments: PackedSegment[] = []
  let bucket: RepaintAnalysis['shots'] = []

  const flush = () => {
    if (!bucket.length) return
    const start = bucket[0].start_sec
    const end = bucket[bucket.length - 1].end_sec
    segments.push({
      segment_index: segments.length,
      start_sec: roundSec(start),
      end_sec: roundSec(end),
      duration_sec: roundSec(end - start),
      shot_ids: bucket.map(s => s.id),
    })
    bucket = []
  }

  for (const shot of shots) {
    const shotScene = sceneIdForShot(analysis, shot.id)

    if (!bucket.length) {
      bucket = [shot]
      if (shot.duration_sec >= MAX_GEN_SEC) flush()
      continue
    }

    const bucketScene = dominantSceneId(analysis, bucket.map(s => s.id))
    const bucketStart = bucket[0].start_sec
    const candidateDur = shot.end_sec - bucketStart

    if (bucketScene && shotScene && bucketScene !== shotScene) {
      flush()
      bucket = [shot]
      if (shot.duration_sec >= MAX_GEN_SEC) flush()
      continue
    }

    if (candidateDur > MAX_GEN_SEC) {
      flush()
      bucket = [shot]
      if (shot.duration_sec >= MAX_GEN_SEC) flush()
      continue
    }

    bucket.push(shot)
  }
  flush()

  if (segments.length > 1) {
    const last = segments[segments.length - 1]
    if (last.duration_sec < MIN_GEN_SEC) {
      const prev = segments[segments.length - 2]
      const lastScene = dominantSceneId(analysis, last.shot_ids)
      const prevScene = dominantSceneId(analysis, prev.shot_ids)
      const mergedDur = roundSec(prev.duration_sec + last.duration_sec)
      const sameScene = !lastScene || !prevScene || lastScene === prevScene
      if (sameScene && mergedDur <= MAX_GEN_SEC) {
        prev.end_sec = last.end_sec
        prev.duration_sec = roundSec(prev.end_sec - prev.start_sec)
        prev.shot_ids = [...prev.shot_ids, ...last.shot_ids]
        segments.pop()
        segments.forEach((seg, idx) => { seg.segment_index = idx })
      }
    }
  }

  return segments
}

function seedanceDuration(durationSec: number) {
  const d = Math.ceil(durationSec)
  return Math.min(MAX_GEN_SEC, Math.max(MIN_GEN_SEC, d))
}

function keyframeTimeSec(shot: RepaintAnalysis['shots'][number]) {
  const offset = Math.min(0.2, Math.max(0.05, shot.duration_sec * 0.12))
  return roundSec(shot.start_sec + offset)
}

function pickKeyframeShotIds(shotIds: string[]) {
  if (shotIds.length <= MAX_KEYFRAMES_PER_SEGMENT) return shotIds
  const mid = Math.floor(shotIds.length / 2)
  return [shotIds[0], shotIds[mid], shotIds[shotIds.length - 1]]
}

async function extractSegmentKeyframes(
  sourceVideoPath: string,
  analysis: RepaintAnalysis,
  packed: PackedSegment,
) {
  const keyframeShots = pickKeyframeShotIds(packed.shot_ids)
  const keyframes: Array<{ shotId: string; framePath: string }> = []

  for (const shotId of keyframeShots) {
    const shot = analysis.shots.find(s => s.id === shotId)
    if (!shot) continue
    try {
      const framePath = await extractVideoFrameAt(sourceVideoPath, keyframeTimeSec(shot))
      keyframes.push({ shotId, framePath })
    } catch {
      // 单镜抽帧失败时跳过
    }
  }

  return keyframes
}

function entitiesForShots(analysis: RepaintAnalysis, shotIds: string[]) {
  const idSet = new Set(shotIds)
  const chars = analysis.characters.filter(c => c.shot_ids?.some(id => idSet.has(id)))
  const scenes = analysis.scenes.filter(s => s.shot_ids?.some(id => idSet.has(id)))
  const props = analysis.props.filter(p => p.shot_ids?.some(id => idSet.has(id)))
  return { chars, scenes, props }
}

function resolveEntityImageUrl(localPath?: string | null, imageUrl?: string | null) {
  const raw = String(imageUrl || localPath || '').trim()
  if (!raw) return null
  return raw.startsWith('/') ? raw : `/${raw}`
}

function buildSegmentImageRefs(
  analysis: RepaintAnalysis,
  packed: PackedSegment,
  keyframes: Array<{ shotId: string; framePath: string }>,
) {
  const { chars, scenes, props } = entitiesForShots(analysis, packed.shot_ids)

  const contentRefs: VideoContentRef[] = []
  const promptLines: string[] = []
  let imageIndex = 1

  const pushImage = (label: string, url: string | null, role: VideoContentRef['role'] = 'reference_image') => {
    if (!url) return
    promptLines.push(`图片${imageIndex}是${label}`)
    contentRefs.push({ type: 'image', url, role, label })
    imageIndex += 1
  }

  for (const keyframe of keyframes) {
    const url = keyframe.framePath.startsWith('/') ? keyframe.framePath : `/${keyframe.framePath}`
    pushImage(`原镜头${keyframe.shotId}构图参考（严格匹配构图/站位/景别）`, url)
  }

  for (const draft of chars) {
    if (!draft.character_id) continue
    const [char] = db.select().from(schema.characters)
      .where(eq(schema.characters.id, draft.character_id)).all()
    pushImage(`角色${char?.name || draft.name}定妆`, resolveEntityImageUrl(char?.localPath, char?.imageUrl))
  }
  for (const draft of scenes) {
    if (!draft.scene_id) continue
    const [scene] = db.select().from(schema.scenes)
      .where(eq(schema.scenes.id, draft.scene_id)).all()
    pushImage(`场景${scene?.location || draft.location}`, resolveEntityImageUrl(scene?.localPath, scene?.imageUrl))
  }
  for (const draft of props) {
    if (!draft.prop_id) continue
    const [prop] = db.select().from(schema.props)
      .where(eq(schema.props.id, draft.prop_id)).all()
    pushImage(`道具${prop?.name || draft.name}定妆`, resolveEntityImageUrl(prop?.localPath, prop?.imageUrl))
  }

  return {
    imageHeader: promptLines.join('，'),
    contentRefs: contentRefs.filter(ref => !!ref.url),
  }
}

export async function buildSegmentPromptAndRefs(
  analysis: RepaintAnalysis,
  packed: PackedSegment,
  dramaId: number,
  sourceVideoPath?: string | null,
): Promise<{ prompt: string; contentRefs: VideoContentRef[]; duration: number }> {
  void dramaId

  const keyframes = sourceVideoPath
    ? await extractSegmentKeyframes(sourceVideoPath, analysis, packed)
    : []

  const { imageHeader, contentRefs } = buildSegmentImageRefs(analysis, packed, keyframes)
  const prompt = await generateDetailedSegmentPrompt(
    analysis,
    packed,
    packed.segment_index,
    imageHeader,
    {
      fidelityMode: true,
      sourceShotDuration: packed.duration_sec,
      shotCount: packed.shot_ids.length,
    },
  )

  return {
    prompt,
    contentRefs,
    duration: seedanceDuration(packed.duration_sec),
  }
}

export async function rebuildRepaintSegments(
  jobId: number,
  analysis: RepaintAnalysis,
  dramaId: number,
  sourceVideoPath?: string | null,
) {
  const ts = now()
  db.delete(schema.videoRepaintSegments)
    .where(eq(schema.videoRepaintSegments.jobId, jobId))
    .run()

  const packed = packShotsForSeedance(analysis)
  for (const seg of packed) {
    const { prompt, contentRefs, duration } = await buildSegmentPromptAndRefs(
      analysis,
      seg,
      dramaId,
      sourceVideoPath,
    )
    db.insert(schema.videoRepaintSegments).values({
      jobId,
      segmentIndex: seg.segment_index,
      startSec: seg.start_sec,
      endSec: seg.end_sec,
      durationSec: duration,
      shotIds: JSON.stringify(seg.shot_ids),
      videoPrompt: prompt,
      contentRefs: JSON.stringify(contentRefs),
      status: contentRefs.length ? 'prompt_ready' : 'draft',
      createdAt: ts,
      updatedAt: ts,
    }).run()
  }

  return db.select().from(schema.videoRepaintSegments)
    .where(eq(schema.videoRepaintSegments.jobId, jobId))
    .all()
    .sort((a, b) => a.segmentIndex - b.segmentIndex)
}

export function getRepaintDefaultVideoModel() {
  return String(CHENGMENT_DEFAULT_MODEL_ID)
}
