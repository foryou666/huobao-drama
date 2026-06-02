import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, now, badRequest } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { generateTTS } from '../services/tts-generation.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { tryChargeUser, tryRefundCharge, CREDIT_ACTIONS } from '../utils/credit-charge.js'
import { generateImage } from '../services/image-generation.js'
import { getActiveConfig, getConfigById } from '../services/ai.js'
import { imageReferenceSupportHint, supportsImageReference } from '../utils/image-reference-support.js'
import {
  buildBlockingImagePrompt,
  buildFirstFrameFromBlockingPrompt,
  collectBlockingReferenceImages,
  collectFrameFromBlockingReferences,
  resolveBlockingLayout,
  resolveBlockingShotMode,
  selectBlockingCharacterImages,
} from '../utils/blocking-image-prompts.js'
import { resolveSceneImageForStoryboard } from '../utils/scene-image-variants.js'
import {
  parseStoryboardCharacterImageRefs,
  resolveCharacterImageForStoryboard,
} from '../utils/character-image-variants.js'

const app = new Hono()

const IGNORE_TTS_SPEAKERS = /^(环境音|环境声|音效|效果音|sfx|sound ?effect|bgm|背景音|背景音乐|ambient)$/i
const IGNORE_TTS_TEXT = /^(无|无对白|无台词|无旁白|无需配音|无需对白|none|null|n\/a|na|环境音|环境声|音效|效果音|纯音效|纯环境音|只有环境音|仅环境音|背景音|背景音乐|bgm|sfx|ambient)$/i

function parseDialogueForTTS(dialogue?: string | null) {
  const raw = dialogue?.trim() || ''
  if (!raw) return { speaker: '', pureText: '', ignorable: true }
  const speakerMatch = raw.match(/^(.+?)[:：]/)
  const speaker = speakerMatch ? speakerMatch[1].replace(/[（(].+?[)）]/g, '').trim() : ''
  const pureText = raw.replace(/^.+?[:：]\s*/, '').replace(/[（(].+?[)）]/g, '').trim()
  const ignorable = (!!speaker && IGNORE_TTS_SPEAKERS.test(speaker)) || !pureText || IGNORE_TTS_TEXT.test(pureText)
  return { speaker, pureText, ignorable }
}

function syncStoryboardCharacters(storyboardId: number, characterIds: number[]) {
  db.delete(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
    .run()

  const uniqueIds = [...new Set((characterIds || []).filter(Boolean))]
  if (!uniqueIds.length) return

  for (const characterId of uniqueIds) {
    db.insert(schema.storyboardCharacters).values({
      storyboardId,
      characterId,
    }).run()
  }
}

function getStoryboardCharacterIds(storyboardId: number) {
  return db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId)).all()
    .map(link => link.characterId)
}

function validateStoryboardBindings(episodeId: number, sceneId: number | null | undefined, characterIds: number[] | undefined) {
  const episodeSceneIds = new Set(
    db.select().from(schema.episodeScenes)
      .where(eq(schema.episodeScenes.episodeId, episodeId)).all()
      .map(link => link.sceneId),
  )
  const episodeCharacterIds = new Set(
    db.select().from(schema.episodeCharacters)
      .where(eq(schema.episodeCharacters.episodeId, episodeId)).all()
      .map(link => link.characterId),
  )

  if (sceneId != null && !episodeSceneIds.has(sceneId)) {
    throw new Error('scene_id 必须来自当前集已关联场景')
  }

  const invalidCharacterIds = (characterIds || []).filter(id => !episodeCharacterIds.has(id))
  if (invalidCharacterIds.length) {
    throw new Error('character_ids 必须来自当前集已关联角色')
  }
}

// POST /storyboards
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()
  logTaskStart('StoryboardAPI', 'create', {
    episodeId: body.episode_id,
    shotNumber: body.storyboard_number || 1,
    sceneId: body.scene_id,
    characterIds: body.character_ids,
  })
  logTaskPayload('StoryboardAPI', 'create body', body)
  validateStoryboardBindings(body.episode_id, body.scene_id, body.character_ids)
  const res = db.insert(schema.storyboards).values({
    episodeId: body.episode_id,
    storyboardNumber: body.storyboard_number || 1,
    title: body.title,
    description: body.description,
    action: body.action,
    dialogue: body.dialogue,
    sceneId: body.scene_id,
    duration: body.duration || 10,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  syncStoryboardCharacters(Number(res.lastInsertRowid), body.character_ids || [])
  const [result] = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.id, Number(res.lastInsertRowid))).all()
  logTaskSuccess('StoryboardAPI', 'create', {
    storyboardId: result.id,
    episodeId: result.episodeId,
    shotNumber: result.storyboardNumber,
  })
  return created(c, {
    ...toSnakeCase(result),
    character_ids: getStoryboardCharacterIds(result.id),
  })
})

// PUT /storyboards/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [storyboard] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id)).all()
  if (!storyboard) return badRequest(c, '镜头不存在')
  logTaskStart('StoryboardAPI', 'update', {
    storyboardId: id,
    episodeId: storyboard.episodeId,
    fields: Object.keys(body),
  })
  logTaskPayload('StoryboardAPI', 'update body', body)

  const fieldMap: Record<string, string> = {
    title: 'title', description: 'description', shot_type: 'shotType',
    angle: 'angle', movement: 'movement', action: 'action',
    dialogue: 'dialogue', duration: 'duration', video_prompt: 'videoPrompt',
    image_prompt: 'imagePrompt', scene_id: 'sceneId', location: 'location',
    time: 'time', atmosphere: 'atmosphere', result: 'result',
    bgm_prompt: 'bgmPrompt', sound_effect: 'soundEffect',
    reference_images: 'referenceImages',
    character_image_refs: 'characterImageRefs',
    blocking_image: 'blockingImage',
    blocking_layout: 'blockingLayout',
    scene_angle_id: 'sceneAngleId',
    first_frame_image: 'firstFrameImage',
    last_frame_image: 'lastFrameImage',
  }

  const updates: Record<string, any> = { updatedAt: now() }
  for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
    if (snakeKey in body) {
      if (snakeKey === 'reference_images' && Array.isArray(body.reference_images)) {
        updates.referenceImages = JSON.stringify(body.reference_images)
      } else if (snakeKey === 'character_image_refs' && body.character_image_refs && typeof body.character_image_refs === 'object') {
        updates.characterImageRefs = JSON.stringify(body.character_image_refs)
      } else if (snakeKey === 'blocking_layout' && body.blocking_layout && typeof body.blocking_layout === 'object') {
        updates.blockingLayout = JSON.stringify(body.blocking_layout)
      } else {
        updates[camelKey] = body[snakeKey]
      }
    }
  }

  if ('dialogue' in body) {
    updates.ttsAudioUrl = null
    updates.subtitleUrl = null
  }

  validateStoryboardBindings(
    storyboard.episodeId,
    'scene_id' in body ? body.scene_id : storyboard.sceneId,
    'character_ids' in body ? body.character_ids : getStoryboardCharacterIds(id),
  )

  db.update(schema.storyboards).set(updates).where(eq(schema.storyboards.id, id)).run()
  if ('character_ids' in body) syncStoryboardCharacters(id, body.character_ids || [])
  logTaskSuccess('StoryboardAPI', 'update', {
    storyboardId: id,
    updatedFields: Object.keys(updates),
    characterIds: body.character_ids,
  })
  return success(c)
})

// POST /storyboards/:id/generate-blocking — 3D 预可视化场景站位图
app.post('/:id/generate-blocking', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id)).all()
  if (!sb) return badRequest(c, '镜头不存在')

  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
  if (!ep) return badRequest(c, 'Episode not found')

  const charIds = getStoryboardCharacterIds(id)
  if (!charIds.length) return badRequest(c, '请先为镜头绑定至少一名角色')

  const config = (ep.imageConfigId != null ? getConfigById(ep.imageConfigId) : null)
    || getActiveConfig('image')
  if (!config) return badRequest(c, 'No active image AI config')
  if (!supportsImageReference(config.provider, config.model)) {
    return badRequest(c, `当前图片模型（${config.provider} · ${config.model || 'unknown'}）不支持参考图生图。${imageReferenceSupportHint()}`)
  }

  const layout = resolveBlockingLayout(
    body.blocking_layout ? JSON.stringify(body.blocking_layout) : sb.blockingLayout,
    charIds,
  )

  const characterImageRefs = parseStoryboardCharacterImageRefs(sb.characterImageRefs)
  const chars = db.select().from(schema.characters).where(eq(schema.characters.dramaId, ep.dramaId)).all()
  const characterImages: string[] = []
  const characterMeta: Array<{ id: number; name: string; entry: typeof layout.characters[number] }> = []

  for (const entry of layout.characters) {
    const char = chars.find(row => row.id === entry.character_id)
    if (!char) continue
    const image = resolveCharacterImageForStoryboard(char, characterImageRefs)
    if (!image) {
      return badRequest(c, `角色「${char.name}」还没有可用参考图，请先生成或上传角色图`)
    }
    characterImages.push(image)
    characterMeta.push({ id: char.id, name: char.name, entry })
  }

  let sceneImage: string | null = null
  let sceneLocation = sb.location || ''
  let sceneTime = sb.time || ''
  if (sb.sceneId) {
    const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sb.sceneId)).all()
    sceneImage = scene ? resolveSceneImageForStoryboard(scene, sb) : null
    sceneLocation = scene?.location || sceneLocation
    sceneTime = scene?.time || sceneTime
    if (!sceneImage) {
      return badRequest(c, '请先为绑定场景生成场景图，或更换已有场景图的场景')
    }
  }

  const shotMode = resolveBlockingShotMode({
    shotType: sb.shotType,
    description: sb.description,
    imagePrompt: sb.imagePrompt,
    characterCount: characterMeta.length,
  })
  const selectedCharacterImages = selectBlockingCharacterImages(
    characterImages,
    characterMeta,
    shotMode,
    sb.description,
    sb.imagePrompt,
  )

  const referenceImages = collectBlockingReferenceImages({
    sceneImage,
    characterImages: selectedCharacterImages,
  })
  if (!referenceImages.length) {
    return badRequest(c, '缺少场景或角色参考图，无法生成站位图')
  }

  const prompt = buildBlockingImagePrompt({
    title: sb.title,
    description: sb.description,
    imagePrompt: sb.imagePrompt,
    action: sb.action,
    atmosphere: sb.atmosphere,
    shotType: sb.shotType,
    angle: sb.angle,
    movement: sb.movement,
    location: sb.location,
    time: sb.time,
    sceneLocation,
    sceneTime,
    characters: characterMeta,
    layout,
    customPrompt: body.prompt,
    shotMode,
  })

  const billed = tryChargeUser(c, CREDIT_ACTIONS.STORYBOARD_BLOCKING, {
    summary: `场景站位图 #${sb.storyboardNumber}`,
    episodeId: sb.episodeId,
    dramaId: ep.dramaId,
    resourceType: 'storyboard',
    resourceId: id,
  })
  if (billed.error) return billed.error

  try {
    logTaskStart('StoryboardAPI', 'generate-blocking', {
      storyboardId: id,
      episodeId: sb.episodeId,
      characterCount: charIds.length,
      provider: config.provider,
    })
    const genId = await generateImage({
      storyboardId: id,
      dramaId: ep.dramaId,
      sceneId: sb.sceneId ?? undefined,
      prompt,
      referenceImages,
      frameType: 'blocking',
      imageType: 'storyboard_blocking',
      configId: ep.imageConfigId ?? undefined,
      creditTransactionId: billed.charge.transactionId,
    })

    if (body.blocking_layout) {
      db.update(schema.storyboards)
        .set({ blockingLayout: JSON.stringify(body.blocking_layout), updatedAt: now() })
        .where(eq(schema.storyboards.id, id))
        .run()
    }

    logTaskSuccess('StoryboardAPI', 'generate-blocking', { storyboardId: id, generationId: genId })
    logActivity(getAuthUser(c), {
      action: 'storyboard.blocking',
      summary: `场景站位图 #${sb.storyboardNumber}`,
      resourceType: 'storyboard',
      resourceId: id,
      episodeId: sb.episodeId,
      dramaId: ep.dramaId,
      creditCost: billed.charge.cost,
      metadata: {
        generation_id: genId,
        character_count: charIds.length,
        credit_tx_id: billed.charge.transactionId,
      },
    })
    return success(c, {
      image_generation_id: genId,
      blocking_layout: layout,
      credits_balance: billed.charge.balance,
    })
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '站位图生成失败退款',
      episodeId: sb.episodeId,
      dramaId: ep.dramaId,
      resourceType: 'storyboard',
      resourceId: id,
      metadata: { reason: err.message },
    })
    logTaskError('StoryboardAPI', 'generate-blocking', { storyboardId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /storyboards/:id/generate-frame-from-blocking — 基于站位图生成首帧/尾帧
app.post('/:id/generate-frame-from-blocking', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const frameType = body.frame_type === 'last_frame' ? 'last_frame' : 'first_frame'
  const frameLabel = frameType === 'first_frame' ? '首帧' : '尾帧'

  const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id)).all()
  if (!sb) return badRequest(c, '镜头不存在')
  if (!sb.blockingImage) return badRequest(c, '请先生成场景站位图')

  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
  if (!ep) return badRequest(c, 'Episode not found')

  const config = (ep.imageConfigId != null ? getConfigById(ep.imageConfigId) : null)
    || getActiveConfig('image')
  if (!config) return badRequest(c, 'No active image AI config')
  if (!supportsImageReference(config.provider, config.model)) {
    return badRequest(c, `当前图片模型（${config.provider} · ${config.model || 'unknown'}）不支持参考图生图。${imageReferenceSupportHint()}`)
  }

  const charIds = getStoryboardCharacterIds(id)
  const layout = resolveBlockingLayout(sb.blockingLayout, charIds)
  const characterImageRefs = parseStoryboardCharacterImageRefs(sb.characterImageRefs)
  const chars = db.select().from(schema.characters).where(eq(schema.characters.dramaId, ep.dramaId)).all()
  const characterImages: string[] = []
  const characterMeta: Array<{ name: string; entry: typeof layout.characters[number] }> = []

  for (const entry of layout.characters) {
    const char = chars.find(row => row.id === entry.character_id)
    if (!char) continue
    const image = resolveCharacterImageForStoryboard(char, characterImageRefs)
    if (image) characterImages.push(image)
    characterMeta.push({ name: char?.name || '角色', entry })
  }

  let sceneImage: string | null = null
  if (sb.sceneId) {
    const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sb.sceneId)).all()
    sceneImage = scene ? resolveSceneImageForStoryboard(scene, sb) : null
  }

  const referenceImages = collectFrameFromBlockingReferences({
    blockingImage: sb.blockingImage,
    sceneImage,
    characterImages,
  })

  const prompt = buildFirstFrameFromBlockingPrompt({
    title: sb.title,
    description: sb.description,
    imagePrompt: sb.imagePrompt,
    action: sb.action,
    atmosphere: sb.atmosphere,
    shotType: sb.shotType,
    angle: sb.angle,
    movement: sb.movement,
    location: sb.location,
    time: sb.time,
    characters: characterMeta,
    frameType,
    customPrompt: body.prompt,
  })

  const billed = tryChargeUser(c, CREDIT_ACTIONS.IMAGE_GENERATE, {
    summary: `从站位图生成${frameLabel} #${sb.storyboardNumber}`,
    episodeId: sb.episodeId,
    dramaId: ep.dramaId,
    resourceType: 'storyboard',
    resourceId: id,
    metadata: { source: 'blocking', frame_type: frameType },
  })
  if (billed.error) return billed.error

  try {
    logTaskStart('StoryboardAPI', 'generate-frame-from-blocking', {
      storyboardId: id,
      frameType,
      provider: config.provider,
    })
    const genId = await generateImage({
      storyboardId: id,
      dramaId: ep.dramaId,
      sceneId: sb.sceneId ?? undefined,
      prompt,
      referenceImages,
      frameType,
      imageType: 'storyboard_frame_from_blocking',
      configId: ep.imageConfigId ?? undefined,
      creditTransactionId: billed.charge.transactionId,
    })

    logTaskSuccess('StoryboardAPI', 'generate-frame-from-blocking', { storyboardId: id, generationId: genId, frameType })
    logActivity(getAuthUser(c), {
      action: 'image.generate',
      summary: `从站位图生成${frameLabel} #${sb.storyboardNumber}`,
      resourceType: 'storyboard',
      resourceId: id,
      episodeId: sb.episodeId,
      dramaId: ep.dramaId,
      creditCost: billed.charge.cost,
      metadata: {
        generation_id: genId,
        frame_type: frameType,
        source: 'blocking',
        credit_tx_id: billed.charge.transactionId,
      },
    })
    return success(c, {
      image_generation_id: genId,
      frame_type: frameType,
      credits_balance: billed.charge.balance,
    })
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: `从站位图生成${frameLabel}失败退款`,
      episodeId: sb.episodeId,
      dramaId: ep.dramaId,
      resourceType: 'storyboard',
      resourceId: id,
      metadata: { reason: err.message, frame_type: frameType },
    })
    logTaskError('StoryboardAPI', 'generate-frame-from-blocking', { storyboardId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /storyboards/:id/generate-tts
app.post('/:id/generate-tts', async (c) => {
  const id = Number(c.req.param('id'))
  const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id)).all()
  if (!sb) return badRequest(c, '镜头不存在')
  const parsedDialogue = parseDialogueForTTS(sb.dialogue)
  if (parsedDialogue.ignorable) return badRequest(c, '该镜头没有可生成的对白或旁白')
  logTaskStart('StoryboardAPI', 'generate-tts', {
    storyboardId: id,
    episodeId: sb.episodeId,
    dialoguePreview: (sb.dialogue || '').slice(0, 40),
  })
  logTaskPayload('StoryboardAPI', 'generate-tts input', {
    storyboardId: id,
    episodeId: sb.episodeId,
    dialogue: sb.dialogue,
  })

  let voiceId = 'alloy'
  const speaker = parsedDialogue.speaker

  if (speaker) {
    if (!/^(旁白|画外音|narrator)$/i.test(speaker)) {
      const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
      if (ep) {
        const chars = db.select().from(schema.characters).where(eq(schema.characters.dramaId, ep.dramaId)).all()
        const found = chars.find((char) => char.name === speaker)
        if (found?.voiceStyle) voiceId = found.voiceStyle
      }
    }
  }

  const pureDialogue = parsedDialogue.pureText
  if (!pureDialogue) return badRequest(c, '未提取到可合成的文本')

  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()

  const billed = tryChargeUser(c, CREDIT_ACTIONS.STORYBOARD_TTS, {
    summary: `镜头配音 #${sb.storyboardNumber}`,
    episodeId: sb.episodeId,
    dramaId: ep?.dramaId,
    resourceType: 'storyboard',
    resourceId: id,
  })
  if (billed.error) return billed.error

  try {
    const audioPath = await generateTTS({ text: pureDialogue, voice: voiceId, configId: ep?.audioConfigId || null })
  db.update(schema.storyboards)
    .set({ ttsAudioUrl: audioPath, updatedAt: now() })
    .where(eq(schema.storyboards.id, id))
    .run()

    logTaskSuccess('StoryboardAPI', 'generate-tts', {
      storyboardId: id,
      voiceId,
      path: audioPath,
      textLength: pureDialogue.length,
    })
    logActivity(getAuthUser(c), {
      action: 'storyboard.tts',
      summary: `镜头配音 #${sb.storyboardNumber}`,
      resourceType: 'storyboard',
      resourceId: id,
      episodeId: sb.episodeId,
      dramaId: ep?.dramaId,
      creditCost: billed.charge.cost,
      metadata: { credit_tx_id: billed.charge.transactionId },
    })
    return success(c, { tts_audio_url: audioPath, voice_id: voiceId, text: pureDialogue, credits_balance: billed.charge.balance })
  } catch (err: any) {
    logTaskError('StoryboardAPI', 'generate-tts', { storyboardId: id, voiceId, error: err.message })
    return badRequest(c, err.message)
  }
})

// DELETE /storyboards/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  logTaskStart('StoryboardAPI', 'delete', { storyboardId: id })
  db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, id)).run()
  db.delete(schema.storyboards).where(eq(schema.storyboards.id, id)).run()
  logTaskSuccess('StoryboardAPI', 'delete', { storyboardId: id })
  return success(c)
})

export default app
