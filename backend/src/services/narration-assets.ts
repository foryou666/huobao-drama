import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { generateImage } from './image-generation.js'
import {
  appendCharacterImageStylePrompt,
  appendSceneImageStylePrompt,
  buildDefaultCharacterImagePrompt,
  buildDefaultSceneImagePrompt,
} from '../constants/image-prompt-templates.js'
import { getImageSizeForAspectRatio } from '../utils/image-size.js'
import { tryChargeImageUser, tryRefundCharge, CREDIT_ACTIONS } from '../utils/credit-charge.js'
import type { NarrationAnalysis, NarrationCharacter, NarrationProp, NarrationScene } from './narration-types.js'
import { parseNarrationAnalysis } from './narration-types.js'
import { listNarrationSegments } from './narration-segments.js'
import type { VideoContentRef } from '../utils/seedance-content.js'

export const NARRATION_IMAGE_MODEL = 'gpt-image-2'
const CHARACTER_IMAGE_SIZE = getImageSizeForAspectRatio('16:9')
const SCENE_IMAGE_SIZE = getImageSizeForAspectRatio('16:9')
const PROP_IMAGE_SIZE = '1024x1024'

const PROP_IMAGE_STYLE =
  '电影级道具设定图，白色纯净背景，完整展示道具主体，无人物，无场景，高清材质与结构细节，适合作为视频生成参考'

function saveJobAnalysis(jobId: number, analysis: NarrationAnalysis) {
  db.update(schema.narrationJobs).set({
    analysisJson: JSON.stringify(analysis),
    updatedAt: now(),
  }).where(eq(schema.narrationJobs.id, jobId)).run()
}

function normalizeAssetUrl(path?: string | null) {
  const raw = String(path || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return raw.startsWith('/') ? raw : `/${raw}`
}

export function buildNarrationCharacterImagePrompt(char: NarrationCharacter) {
  const traits = [char.appearance, char.description, char.role].filter(Boolean).join('，')
  const base = traits
    ? `${char.name}，${traits}`
    : buildDefaultCharacterImagePrompt({ name: char.name, appearance: char.appearance, description: char.description })
  return appendCharacterImageStylePrompt(base)
}

export function buildNarrationSceneImagePrompt(scene: NarrationScene) {
  const base = scene.prompt?.trim() || buildDefaultSceneImagePrompt(scene)
  return appendSceneImageStylePrompt(base)
}

export function buildNarrationPropImagePrompt(prop: NarrationProp) {
  const details = [prop.name, prop.type, prop.description, prop.prompt].filter(Boolean).join('，')
  return `${details}，${PROP_IMAGE_STYLE}`
}

function syncEntityImageFromGeneration(entity: {
  image_generation_id?: number
  image_url?: string
  image_status?: string
}) {
  if (!entity.image_generation_id || entity.image_url) return false
  const [gen] = db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.id, entity.image_generation_id)).all()
  if (!gen) return false
  if (gen.status === 'completed' && (gen.localPath || gen.imageUrl)) {
    entity.image_url = normalizeAssetUrl(gen.localPath || gen.imageUrl) || undefined
    entity.image_status = 'completed'
    return true
  }
  if (gen.status === 'failed') {
    entity.image_status = 'failed'
    return true
  }
  if (gen.status === 'processing' || gen.status === 'pending') {
    entity.image_status = 'generating'
  }
  return false
}

export function syncNarrationAssetImages(analysis: NarrationAnalysis): NarrationAnalysis {
  let changed = false
  for (const item of [...analysis.characters, ...analysis.scenes, ...analysis.props]) {
    if (syncEntityImageFromGeneration(item)) changed = true
  }
  return changed ? analysis : analysis
}

export function listNarrationAssetReadiness(analysis: NarrationAnalysis) {
  const rows = [
    ...analysis.characters.map(c => ({
      type: 'character' as const,
      id: c.id,
      name: c.name,
      has_image: !!c.image_url,
      image_status: c.image_status || (c.image_url ? 'completed' : 'missing'),
      image_url: c.image_url || null,
    })),
    ...analysis.scenes.map(s => ({
      type: 'scene' as const,
      id: s.id,
      name: s.location,
      has_image: !!s.image_url,
      image_status: s.image_status || (s.image_url ? 'completed' : 'missing'),
      image_url: s.image_url || null,
    })),
    ...analysis.props.map(p => ({
      type: 'prop' as const,
      id: p.id,
      name: p.name,
      has_image: !!p.image_url,
      image_status: p.image_status || (p.image_url ? 'completed' : 'missing'),
      image_url: p.image_url || null,
    })),
  ]
  const missing = rows.filter(r => !r.has_image)
  return {
    ready: missing.length === 0 && rows.length > 0,
    total: rows.length,
    ready_count: rows.filter(r => r.has_image).length,
    missing,
    items: rows,
  }
}

export function buildNarrationSegmentContentRefs(
  analysis: NarrationAnalysis,
  segmentIndex: number,
): { contentRefs: VideoContentRef[]; promptPrefix: string } {
  const meta = analysis.segment_meta.find(m => m.segment_index === segmentIndex)
  const contentRefs: VideoContentRef[] = []
  const promptLines: string[] = []
  let imageIndex = 1

  const pushImage = (label: string, url?: string | null) => {
    const normalized = normalizeAssetUrl(url)
    if (!normalized) return
    promptLines.push(`图片${imageIndex}是${label}`)
    contentRefs.push({
      type: 'image',
      url: normalized,
      role: 'reference_image',
      label,
    })
    imageIndex += 1
  }

  for (const cid of meta?.character_ids || []) {
    const char = analysis.characters.find(c => c.id === cid)
    if (char) pushImage(`角色${char.name}三视图定妆（严格保持容貌、发型、服装一致）`, char.image_url)
  }

  const scene = analysis.scenes.find(s => s.id === meta?.scene_id)
  if (scene) pushImage(`场景${scene.location}设定`, scene.image_url)

  for (const pid of meta?.prop_ids || []) {
    const prop = analysis.props.find(p => p.id === pid)
    if (prop) pushImage(`道具${prop.name}设定`, prop.image_url)
  }

  return {
    contentRefs: contentRefs.slice(0, 6),
    promptPrefix: promptLines.length ? `${promptLines.join('，')}。` : '',
  }
}

export function packNarrationSegmentContentRefs(jobId: number, analysis: NarrationAnalysis) {
  const ts = now()
  const segments = listNarrationSegments(jobId)
  for (const seg of segments) {
    const { contentRefs } = buildNarrationSegmentContentRefs(analysis, seg.segmentIndex)
    db.update(schema.narrationSegments).set({
      contentRefs: JSON.stringify(contentRefs),
      updatedAt: ts,
    }).where(eq(schema.narrationSegments.id, seg.id)).run()
  }
}

async function chargeAndGenerateImage(
  c: Context,
  opts: {
    jobId: number
    dramaId?: number | null
    prompt: string
    size: string
    imageType: string
    summary: string
  },
) {
  const billed = tryChargeImageUser(c, CREDIT_ACTIONS.IMAGE_GENERATE, NARRATION_IMAGE_MODEL, {
    summary: opts.summary,
    dramaId: opts.dramaId ?? undefined,
    resourceType: 'narration_asset',
    resourceId: opts.jobId,
  })
  if (billed.error) return { error: billed.error }

  try {
    const genId = await generateImage({
      dramaId: opts.dramaId ?? undefined,
      prompt: opts.prompt,
      model: NARRATION_IMAGE_MODEL,
      size: opts.size,
      imageType: opts.imageType,
      creditTransactionId: billed.charge.transactionId,
    })
    return { genId, credits_balance: billed.charge.balance }
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '解说漫资产生图失败退款',
      resourceType: 'narration_asset',
      resourceId: opts.jobId,
      metadata: { reason: err.message },
    })
    throw err
  }
}

export async function generateNarrationCharacterImage(
  c: Context,
  jobId: number,
  characterId: string,
  analysis: NarrationAnalysis,
  dramaId?: number | null,
) {
  const char = analysis.characters.find(item => item.id === characterId)
  if (!char) throw new Error('角色不存在')
  if (char.image_url) return { skipped: true, character: char }

  const result = await chargeAndGenerateImage(c, {
    jobId,
    dramaId,
    prompt: buildNarrationCharacterImagePrompt(char),
    size: CHARACTER_IMAGE_SIZE,
    imageType: 'narration_character',
    summary: `解说漫角色三视图 · ${char.name}`,
  })
  if (result.error) return result

  char.image_generation_id = result.genId
  char.image_status = 'generating'
  saveJobAnalysis(jobId, analysis)
  return { character: char, image_generation_id: result.genId, credits_balance: result.credits_balance }
}

export async function generateNarrationSceneImage(
  c: Context,
  jobId: number,
  sceneId: string,
  analysis: NarrationAnalysis,
  dramaId?: number | null,
) {
  const scene = analysis.scenes.find(item => item.id === sceneId)
  if (!scene) throw new Error('场景不存在')
  if (scene.image_url) return { skipped: true, scene }

  const result = await chargeAndGenerateImage(c, {
    jobId,
    dramaId,
    prompt: buildNarrationSceneImagePrompt(scene),
    size: SCENE_IMAGE_SIZE,
    imageType: 'narration_scene',
    summary: `解说漫场景定稿 · ${scene.location}`,
  })
  if (result.error) return result

  scene.image_generation_id = result.genId
  scene.image_status = 'generating'
  saveJobAnalysis(jobId, analysis)
  return { scene, image_generation_id: result.genId, credits_balance: result.credits_balance }
}

export async function generateNarrationPropImage(
  c: Context,
  jobId: number,
  propId: string,
  analysis: NarrationAnalysis,
  dramaId?: number | null,
) {
  const prop = analysis.props.find(item => item.id === propId)
  if (!prop) throw new Error('道具不存在')
  if (prop.image_url) return { skipped: true, prop }

  const result = await chargeAndGenerateImage(c, {
    jobId,
    dramaId,
    prompt: buildNarrationPropImagePrompt(prop),
    size: PROP_IMAGE_SIZE,
    imageType: 'narration_prop',
    summary: `解说漫道具定稿 · ${prop.name}`,
  })
  if (result.error) return result

  prop.image_generation_id = result.genId
  prop.image_status = 'generating'
  saveJobAnalysis(jobId, analysis)
  return { prop, image_generation_id: result.genId, credits_balance: result.credits_balance }
}

export async function generateAllNarrationAssets(
  c: Context,
  jobId: number,
  analysis: NarrationAnalysis,
  dramaId?: number | null,
) {
  const queued: string[] = []
  const errors: string[] = []

  for (const char of analysis.characters) {
    if (char.image_url || char.image_status === 'generating') continue
    try {
      const res = await generateNarrationCharacterImage(c, jobId, char.id, analysis, dramaId)
      if ((res as any).error) errors.push(`角色 ${char.name}`)
      else if (!(res as any).skipped) queued.push(`角色 ${char.name}`)
    } catch (err: any) {
      errors.push(`角色 ${char.name}: ${err.message}`)
    }
  }
  for (const scene of analysis.scenes) {
    if (scene.image_url || scene.image_status === 'generating') continue
    try {
      const res = await generateNarrationSceneImage(c, jobId, scene.id, analysis, dramaId)
      if ((res as any).error) errors.push(`场景 ${scene.location}`)
      else if (!(res as any).skipped) queued.push(`场景 ${scene.location}`)
    } catch (err: any) {
      errors.push(`场景 ${scene.location}: ${err.message}`)
    }
  }
  for (const prop of analysis.props) {
    if (prop.image_url || prop.image_status === 'generating') continue
    try {
      const res = await generateNarrationPropImage(c, jobId, prop.id, analysis, dramaId)
      if ((res as any).error) errors.push(`道具 ${prop.name}`)
      else if (!(res as any).skipped) queued.push(`道具 ${prop.name}`)
    } catch (err: any) {
      errors.push(`道具 ${prop.name}: ${err.message}`)
    }
  }

  syncNarrationAssetImages(analysis)
  saveJobAnalysis(jobId, analysis)
  packNarrationSegmentContentRefs(jobId, analysis)
  return { queued, errors }
}

export function loadSyncedNarrationAnalysis(jobId: number, raw?: string | null) {
  const analysis = parseNarrationAnalysis(raw)
  let changed = false
  for (const item of [...analysis.characters, ...analysis.scenes, ...analysis.props]) {
    if (syncEntityImageFromGeneration(item)) changed = true
  }
  if (changed) {
    saveJobAnalysis(jobId, analysis)
    packNarrationSegmentContentRefs(jobId, analysis)
  }
  return analysis
}
