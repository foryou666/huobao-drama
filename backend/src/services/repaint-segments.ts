import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import type { RepaintAnalysis } from './repaint-types.js'
import { generateDetailedSegmentPrompt } from './repaint-segment-prompt.js'
import type { VideoContentRef } from '../utils/seedance-content.js'
import { CHENGMENT_DEFAULT_MODEL_ID } from '../constants/chengmeng.js'

const MIN_SEGMENT_SEC = 4
const MAX_SEGMENT_SEC = 15

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

export function packShotsIntoSegments(
  shots: RepaintAnalysis['shots'],
  minSec = MIN_SEGMENT_SEC,
  maxSec = MAX_SEGMENT_SEC,
): PackedSegment[] {
  if (!shots.length) return []

  const segments: PackedSegment[] = []
  let bucket: typeof shots = []
  let bucketStart = shots[0].start_sec

  const flush = () => {
    if (!bucket.length) return
    const start = bucketStart
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
    if (!bucket.length) bucketStart = shot.start_sec
    const candidateEnd = shot.end_sec
    const candidateDur = candidateEnd - bucketStart

    if (candidateDur > maxSec && bucket.length) {
      flush()
      bucketStart = shot.start_sec
      bucket = [shot]
      continue
    }

    bucket.push(shot)
    if (candidateDur >= minSec) flush()
  }
  flush()

  // 尾段不足 minSec 时合并到上一段
  if (segments.length > 1) {
    const last = segments[segments.length - 1]
    if (last.duration_sec < minSec) {
      const prev = segments[segments.length - 2]
      prev.end_sec = last.end_sec
      prev.duration_sec = roundSec(prev.end_sec - prev.start_sec)
      prev.shot_ids = [...prev.shot_ids, ...last.shot_ids]
      segments.pop()
      segments.forEach((seg, idx) => { seg.segment_index = idx })
    }
  }

  return segments
}

function seedanceDuration(durationSec: number) {
  const d = Math.ceil(durationSec)
  return Math.min(MAX_SEGMENT_SEC, Math.max(MIN_SEGMENT_SEC, d))
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
  dramaId: number,
) {
  const { chars, scenes, props } = entitiesForShots(analysis, packed.shot_ids)
  void dramaId

  const contentRefs: VideoContentRef[] = []
  const promptLines: string[] = []
  let imageIndex = 1

  const pushImage = (label: string, url: string | null) => {
    if (!url) return
    promptLines.push(`图片${imageIndex}是${label}`)
    contentRefs.push({ type: 'image', url, role: 'reference_image', label })
    imageIndex += 1
  }

  for (const draft of chars) {
    if (!draft.character_id) continue
    const [char] = db.select().from(schema.characters)
      .where(eq(schema.characters.id, draft.character_id)).all()
    pushImage(char?.name || draft.name, resolveEntityImageUrl(char?.localPath, char?.imageUrl))
  }
  for (const draft of scenes) {
    if (!draft.scene_id) continue
    const [scene] = db.select().from(schema.scenes)
      .where(eq(schema.scenes.id, draft.scene_id)).all()
    pushImage(scene?.location || draft.location, resolveEntityImageUrl(scene?.localPath, scene?.imageUrl))
  }
  for (const draft of props) {
    if (!draft.prop_id) continue
    const [prop] = db.select().from(schema.props)
      .where(eq(schema.props.id, draft.prop_id)).all()
    pushImage(prop?.name || draft.name, resolveEntityImageUrl(prop?.localPath, prop?.imageUrl))
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
): Promise<{ prompt: string; contentRefs: VideoContentRef[]; duration: number }> {
  const { imageHeader, contentRefs } = buildSegmentImageRefs(analysis, packed, dramaId)
  const prompt = await generateDetailedSegmentPrompt(
    analysis,
    packed,
    packed.segment_index,
    imageHeader,
  )

  return {
    prompt,
    contentRefs,
    duration: seedanceDuration(packed.duration_sec),
  }
}

export async function rebuildRepaintSegments(jobId: number, analysis: RepaintAnalysis, dramaId: number) {
  const ts = now()
  db.delete(schema.videoRepaintSegments)
    .where(eq(schema.videoRepaintSegments.jobId, jobId))
    .run()

  const packed = packShotsIntoSegments(analysis.shots)
  for (const seg of packed) {
    const { prompt, contentRefs, duration } = await buildSegmentPromptAndRefs(analysis, seg, dramaId)
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
