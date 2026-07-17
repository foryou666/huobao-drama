import { Hono } from 'hono'
import { eq, and, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, now } from '../utils/response.js'
import { generateVoiceSample } from '../services/tts-generation.js'
import { generateImage } from '../services/image-generation.js'
import { logTaskError, logTaskStart, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { resolveCharacterImagePrompt, buildDefaultCharacterImagePrompt } from '../utils/character-image-prompt.js'
import { saveUploadedFile } from '../utils/storage.js'
import { syncCharacterPrimaryImage } from '../utils/oss-entity-sync.js'
import { syncCharacterAsset } from '../services/asset-library.js'
import { findActiveCharacterByName, redirectCharacterReferences } from '../utils/character-redirect.js'
import { getConfigById, getActiveConfig } from '../services/ai.js'
import {
  buildCharacterTransformPrompt,
  getCharacterTransformPreset,
  listCharacterTransformPresets,
} from '../utils/character-image-transforms.js'
import {
  appendCharacterOutfitImage,
  findCharacterOutfit,
  findCharacterOutfitByAssetId,
  listCharacterOutfits,
  removeCharacterOutfitCandidate,
  resolveCharacterImageSource,
  setCharacterOutfitDefault,
} from '../utils/character-image-variants.js'
import { buildOutfitChangePrompt, slugifyOutfitId } from '../utils/character-outfit-prompts.js'
import { imageReferenceSupportHint, supportsImageReference } from '../utils/image-reference-support.js'
import { tryChargeUser, tryChargeImageUser, tryRefundCharge, tryPreflightBatchImageCharge, chargeBatchImageItem, CREDIT_ACTIONS } from '../utils/credit-charge.js'
import { resolveBillingImageModel, resolveBillingImageProvider } from '../utils/image-billing.js'
import { linkCharacterToEpisode } from '../utils/episode-entity-links.js'
import path from 'path'

const IMAGE_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])

function isUploadableImage(file: File): boolean {
  if (file.type?.startsWith('image/')) return true
  const ext = path.extname(file.name || '').toLowerCase()
  return IMAGE_UPLOAD_EXTS.has(ext)
}

const app = new Hono()

// POST /characters — 手动创建角色（可选关联到某一集）
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.drama_id) return badRequest(c, 'drama_id is required')
  if (!String(body.name || '').trim()) return badRequest(c, 'name is required')

  const ts = now()
  const name = String(body.name).trim()
  const existing = db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, Number(body.drama_id)))
    .all()
    .find(ch => !ch.deletedAt && ch.name === name)

  if (existing) {
    if (body.episode_id) linkCharacterToEpisode(Number(body.episode_id), existing.id)
    syncCharacterAsset(existing.id)
    return success(c, { ...existing, merged: true, message: '同名角色已存在，已关联到本集' })
  }

  const res = db.insert(schema.characters).values({
    dramaId: Number(body.drama_id),
    name,
    role: body.role || '',
    description: body.description || '',
    appearance: body.appearance || '',
    personality: body.personality || '',
    imagePrompt: body.image_prompt?.trim() || buildDefaultCharacterImagePrompt({
      name,
      appearance: body.appearance,
      description: body.description,
    }),
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const charId = Number(res.lastInsertRowid)
  if (body.episode_id) linkCharacterToEpisode(Number(body.episode_id), charId)
  syncCharacterAsset(charId)
  const [created] = db.select().from(schema.characters).where(eq(schema.characters.id, charId)).all()
  logActivity(getAuthUser(c), {
    action: 'character.create',
    summary: `手动添加角色：${name}`,
    resourceType: 'character',
    resourceId: charId,
    dramaId: Number(body.drama_id),
    episodeId: body.episode_id ? Number(body.episode_id) : undefined,
  })
  return success(c, created)
})

// GET /characters/transform-presets — Seedance 适配风格预设（须在 /:id 之前注册）
app.get('/transform-presets', (c) => {
  return success(c, {
    presets: listCharacterTransformPresets(),
    reference_image_supported_providers: ['gemini', 'minimax', 'volcengine'],
    hint: imageReferenceSupportHint(),
  })
})

// PUT /characters/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }
  for (const key of ['name', 'role', 'description', 'appearance', 'imagePrompt', 'personality', 'voiceStyle', 'voiceProvider', 'imageUrl', 'localPath', 'referenceImages', 'portraitType', 'seedanceAssetId', 'seedanceAssetGroupId', 'seedanceAssetStatus']) {
    const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())
    if (snakeKey in body) updates[key] = body[snakeKey]
    else if (key in body) updates[key] = body[key]
  }
  if ('reference_images' in body && Array.isArray(body.reference_images)) {
    updates.referenceImages = JSON.stringify(body.reference_images)
  }
  if ('voice_style' in body || 'voiceStyle' in body) {
    updates.voiceSampleUrl = null
  }
  db.update(schema.characters).set(updates).where(eq(schema.characters.id, id)).run()
  syncCharacterAsset(id)
  return success(c)
})

// DELETE /characters/:id — 软删除，同步隐藏资产库条目
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  if (!char) return badRequest(c, '角色不存在')
  const replacement = findActiveCharacterByName(char.dramaId, char.name)
  const ts = now()
  db.update(schema.characters)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(eq(schema.characters.id, id))
    .run()
  db.update(schema.assets)
    .set({ deletedAt: ts, updatedAt: ts })
    .where(and(
      eq(schema.assets.sourceType, 'character'),
      eq(schema.assets.sourceId, id),
      isNull(schema.assets.deletedAt),
    ))
    .run()
  if (replacement && replacement.id !== id) {
    redirectCharacterReferences(char.dramaId, id, replacement.id)
  }
  return success(c)
})

// POST /characters/:id/generate-voice-sample — 生成角色音色试听
app.post('/:id/generate-voice-sample', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  if (!char) return badRequest(c, 'Character not found')
  if (!char.voiceStyle) return badRequest(c, '请先分配音色')
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id))).all()
  if (!ep) return badRequest(c, 'Episode not found')

  const billed = tryChargeUser(c, CREDIT_ACTIONS.CHARACTER_VOICE_SAMPLE, {
    summary: `生成音色试听：${char.name}`,
    dramaId: char.dramaId,
    episodeId: ep.id,
    resourceType: 'character',
    resourceId: id,
  })
  if (billed.error) return billed.error

  try {
    logTaskStart('VoiceSample', 'generate', { characterId: id, characterName: char.name, episodeId: ep.id, voice: char.voiceStyle })
    const audioPath = await generateVoiceSample(char.name, char.voiceStyle, ep.audioConfigId ?? undefined)
    db.update(schema.characters)
      .set({ voiceSampleUrl: audioPath, updatedAt: now() })
      .where(eq(schema.characters.id, id)).run()
    logTaskSuccess('VoiceSample', 'generate', { characterId: id, path: audioPath })
    return success(c, { voice_sample_url: audioPath })
  } catch (err: any) {
    logTaskError('VoiceSample', 'generate', { characterId: id, error: err.message })
    return badRequest(c, `TTS 生成失败: ${err.message}`)
  }
})

// POST /characters/:id/outfits/:outfitId/candidates — 上传服装备选图
app.post('/:id/outfits/:outfitId/candidates', async (c) => {
  const id = Number(c.req.param('id'))
  const outfitId = String(c.req.param('outfitId') || '').trim()
  if (!outfitId) return badRequest(c, 'outfitId is required')

  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  if (!char) return badRequest(c, 'Character not found')

  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) return badRequest(c, 'file is required')
  if (!isUploadableImage(file)) return badRequest(c, '仅支持 JPG / PNG / WebP / GIF 等图片文件')

  const label = String(body['label'] || findCharacterOutfit(char.referenceImages, outfitId)?.label || '服装').trim()
  const candidateLabel = String(body['candidate_label'] || body['candidateLabel'] || '').trim() || undefined
  const setAsDefault = String(body['set_as_default'] ?? body['setAsDefault'] ?? 'true').toLowerCase() !== 'false'
  const costumeAssetIdRaw = body['costume_asset_id'] ?? body['costumeAssetId']
  const costumeAssetId = costumeAssetIdRaw != null && String(costumeAssetIdRaw).trim() !== ''
    ? Number(costumeAssetIdRaw)
    : undefined

  try {
    const buffer = await file.arrayBuffer()
    const savedPath = await saveUploadedFile(buffer, 'characters', file.name)
    const outfits = appendCharacterOutfitImage(id, {
      outfitId,
      label,
      url: savedPath,
      costumeAssetId: Number.isFinite(costumeAssetId) ? costumeAssetId : undefined,
      candidateLabel,
      setAsDefault,
    })
    try {
      await syncCharacterPrimaryImage(id, savedPath)
    } catch (ossErr: any) {
      logTaskWarn('CharacterOutfitUpload', 'oss-sync-failed', {
        characterId: id,
        outfitId,
        path: savedPath,
        error: ossErr?.message || String(ossErr),
      })
    }
    syncCharacterAsset(id)
    const outfit = outfits.find(item => item.outfit_id === outfitId) || null
    logActivity(getAuthUser(c), {
      action: 'character.image.outfit_candidate',
      summary: `上传服装备选：${char.name} · ${label}`,
      resourceType: 'character',
      resourceId: id,
      dramaId: char.dramaId,
      metadata: { outfit_id: outfitId, path: savedPath },
    })
    return success(c, { outfit, outfits })
  } catch (err: any) {
    return badRequest(c, err.message || '上传失败')
  }
})

// PUT /characters/:id/outfits/:outfitId/default — 将备选图设为服装定稿
app.put('/:id/outfits/:outfitId/default', async (c) => {
  const id = Number(c.req.param('id'))
  const outfitId = String(c.req.param('outfitId') || '').trim()
  const body = await c.req.json()
  const candidateId = String(body.candidate_id || body.candidateId || '').trim()
  if (!candidateId) return badRequest(c, 'candidate_id is required')

  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  if (!char) return badRequest(c, 'Character not found')

  const outfit = setCharacterOutfitDefault(id, outfitId, candidateId)
  if (!outfit) return badRequest(c, '服装或备选图不存在')
  syncCharacterAsset(id)
  const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  logActivity(getAuthUser(c), {
    action: 'character.image.outfit_default',
    summary: `设置服装定稿：${char.name} · ${outfit.label}`,
    resourceType: 'character',
    resourceId: id,
    dramaId: char.dramaId,
    metadata: { outfit_id: outfitId, candidate_id: candidateId },
  })
  return success(c, { outfit, outfits: listCharacterOutfits(updated?.referenceImages) })
})

// DELETE /characters/:id/outfits/:outfitId/candidates/:candidateId
app.delete('/:id/outfits/:outfitId/candidates/:candidateId', async (c) => {
  const id = Number(c.req.param('id'))
  const outfitId = String(c.req.param('outfitId') || '').trim()
  const candidateId = String(c.req.param('candidateId') || '').trim()
  if (!candidateId) return badRequest(c, 'candidateId is required')

  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  if (!char) return badRequest(c, 'Character not found')

  const outfit = removeCharacterOutfitCandidate(id, outfitId, candidateId)
  syncCharacterAsset(id)
  const [updated] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  logActivity(getAuthUser(c), {
    action: 'character.image.outfit_candidate_delete',
    summary: `删除服装备选：${char.name}`,
    resourceType: 'character',
    resourceId: id,
    dramaId: char.dramaId,
    metadata: { outfit_id: outfitId, candidate_id: candidateId },
  })
  return success(c, { outfit, outfits: listCharacterOutfits(updated?.referenceImages) })
})

// POST /characters/:id/upload-image — 手动上传角色形象
app.post('/:id/upload-image', async (c) => {
  const id = Number(c.req.param('id'))
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  if (!char) return badRequest(c, 'Character not found')

  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) return badRequest(c, 'file is required')
  if (!isUploadableImage(file)) return badRequest(c, '仅支持 JPG / PNG / WebP / GIF 等图片文件')

  try {
    const buffer = await file.arrayBuffer()
    const savedPath = await saveUploadedFile(buffer, 'characters', file.name)
    const ts = now()
    db.update(schema.characters)
      .set({ imageUrl: savedPath, localPath: savedPath, updatedAt: ts })
      .where(eq(schema.characters.id, id))
      .run()
    let ossWarning: string | null = null
    try {
      await syncCharacterPrimaryImage(id, savedPath)
    } catch (ossErr: any) {
      ossWarning = ossErr?.message || String(ossErr)
      logTaskWarn('CharacterUpload', 'oss-sync-failed', { characterId: id, path: savedPath, error: ossWarning })
    }
    syncCharacterAsset(id)
    logActivity(getAuthUser(c), {
      action: 'character.image.upload',
      summary: `上传角色图：${char.name}`,
      resourceType: 'character',
      resourceId: id,
      dramaId: char.dramaId,
    })
    return success(c, {
      path: savedPath,
      url: `/${savedPath}`,
      oss_warning: ossWarning || undefined,
    })
  } catch (err: any) {
    return badRequest(c, err.message || '上传失败')
  }
})

// POST /characters/:id/transform-image — 参考原图或指定服装生成 Seedance 适配风格
app.post('/:id/transform-image', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  if (!char) return badRequest(c, 'Character not found')
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const preset = getCharacterTransformPreset(String(body.transform_type || ''))
  if (!preset) return badRequest(c, '无效的 transform_type')

  const sourceKey = String(body.source || body.outfit_id || 'primary').trim() || 'primary'
  const sourceImage = resolveCharacterImageSource(char, sourceKey)
  if (!sourceImage) {
    return badRequest(c, sourceKey === 'primary' ? '请先生成或上传角色原图，再进行风格转换' : '未找到指定服装图，请先生成换装图')
  }

  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id))).all()
  if (!ep) return badRequest(c, 'Episode not found')

  const config = (ep.imageConfigId != null ? getConfigById(ep.imageConfigId) : null)
    || getActiveConfig('image')
  if (!config) return badRequest(c, 'No active image AI config')
  if (!supportsImageReference(config.provider, config.model)) {
    return badRequest(c, `当前图片模型（${config.provider} · ${config.model || 'unknown'}）不支持参考图生图。${imageReferenceSupportHint()}`)
  }

  const prompt = buildCharacterTransformPrompt(preset, char.name)
  const isOutfitSource = sourceKey !== 'primary'

  const billed = tryChargeImageUser(c, CREDIT_ACTIONS.CHARACTER_TRANSFORM, config.model, {
    summary: `角色风格转换：${char.name} · ${preset.label}`,
    dramaId: char.dramaId,
    episodeId: ep.id,
    resourceType: 'character',
    resourceId: id,
  }, config.provider)
  if (billed.error) return billed.error

  try {
    logTaskStart('CharacterImage', 'transform', {
      characterId: id,
      episodeId: ep.id,
      transformType: preset.id,
      source: sourceKey,
      provider: config.provider,
    })
    const genId = await generateImage({
      characterId: id,
      dramaId: char.dramaId,
      prompt,
      referenceImages: [sourceImage],
      imageType: isOutfitSource ? 'character_outfit_variant' : 'character_variant',
      variantId: preset.id,
      frameType: isOutfitSource ? sourceKey : undefined,
      configId: ep.imageConfigId ?? undefined,
      creditTransactionId: billed.charge.transactionId,
    })
    logTaskSuccess('CharacterImage', 'transform', { characterId: id, generationId: genId, transformType: preset.id, source: sourceKey })
    logActivity(getAuthUser(c), {
      action: 'character.image.transform',
      summary: `角色图风格转换：${char.name} · ${preset.label}${isOutfitSource ? ` · ${sourceKey}` : ''}`,
      resourceType: 'character',
      resourceId: id,
      dramaId: char.dramaId,
      episodeId: ep.id,
      creditCost: billed.charge.cost,
      metadata: { generation_id: genId, transform_type: preset.id, source: sourceKey, credit_tx_id: billed.charge.transactionId },
    })
    return success(c, {
      image_generation_id: genId,
      transform_type: preset.id,
      source: sourceKey,
      label: preset.label,
      reference_image_supported: true,
      provider: config.provider,
      credits_balance: billed.charge.balance,
    })
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '角色风格转换失败退款',
      dramaId: char.dramaId,
      episodeId: ep.id,
      resourceType: 'character',
      resourceId: id,
      metadata: { reason: err.message },
    })
    logTaskError('CharacterImage', 'transform', { characterId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /characters/:id/generate-outfit — 角色 + 服装资产双参考图换装
app.post('/:id/generate-outfit', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  if (!char) return badRequest(c, 'Character not found')
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const costumeAssetId = Number(body.costume_asset_id)
  if (!Number.isFinite(costumeAssetId) || costumeAssetId <= 0) {
    return badRequest(c, 'costume_asset_id is required')
  }

  const [asset] = db.select().from(schema.assets).where(eq(schema.assets.id, costumeAssetId)).all()
  if (!asset || asset.deletedAt) return badRequest(c, '服装资产不存在')
  if (asset.type !== 'costume') {
    return badRequest(c, '所选资产不是服装类型，请在资产库中使用「服装资产」分类')
  }

  const charImage = String(char.imageUrl || char.localPath || '').trim()
  if (!charImage) return badRequest(c, '请先生成或上传角色基准图，再进行换装')

  const costumeImage = String(asset.url || asset.localPath || '').trim()
  if (!costumeImage) return badRequest(c, '所选服装资产没有可用图片')

  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id))).all()
  if (!ep) return badRequest(c, 'Episode not found')

  const config = (ep.imageConfigId != null ? getConfigById(ep.imageConfigId) : null)
    || getActiveConfig('image')
  if (!config) return badRequest(c, 'No active image AI config')
  if (!supportsImageReference(config.provider, config.model)) {
    return badRequest(c, `当前图片模型（${config.provider} · ${config.model || 'unknown'}）不支持参考图生图。${imageReferenceSupportHint()}`)
  }

  const label = String(body.label || asset.name || '服装').trim()
  const existingOutfit = findCharacterOutfitByAssetId(char.referenceImages, costumeAssetId)
  const outfitId = String(body.outfit_id || existingOutfit?.outfit_id || slugifyOutfitId(label, costumeAssetId))
  const prompt = buildOutfitChangePrompt(char.name, label, body.prompt)

  const billed = tryChargeImageUser(c, CREDIT_ACTIONS.CHARACTER_OUTFIT, config.model, {
    summary: `角色换装：${char.name} · ${label}`,
    dramaId: char.dramaId,
    episodeId: ep.id,
    resourceType: 'character',
    resourceId: id,
  }, config.provider)
  if (billed.error) return billed.error

  try {
    logTaskStart('CharacterImage', 'generate-outfit', {
      characterId: id,
      episodeId: ep.id,
      costumeAssetId,
      outfitId,
      provider: config.provider,
    })
    const genId = await generateImage({
      characterId: id,
      dramaId: char.dramaId,
      prompt,
      referenceImages: [charImage, costumeImage],
      imageType: 'character_outfit',
      frameType: outfitId,
      propId: costumeAssetId,
      configId: ep.imageConfigId ?? undefined,
      creditTransactionId: billed.charge.transactionId,
    })
    logTaskSuccess('CharacterImage', 'generate-outfit', { characterId: id, generationId: genId, outfitId })
    logActivity(getAuthUser(c), {
      action: 'character.image.outfit',
      summary: `角色换装：${char.name} · ${label}`,
      resourceType: 'character',
      resourceId: id,
      dramaId: char.dramaId,
      episodeId: ep.id,
      creditCost: billed.charge.cost,
      metadata: { generation_id: genId, outfit_id: outfitId, costume_asset_id: costumeAssetId, credit_tx_id: billed.charge.transactionId },
    })
    return success(c, {
      image_generation_id: genId,
      outfit_id: outfitId,
      label,
      costume_asset_id: costumeAssetId,
      reference_image_supported: true,
      provider: config.provider,
      credits_balance: billed.charge.balance,
    })
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '角色换装失败退款',
      dramaId: char.dramaId,
      episodeId: ep.id,
      resourceType: 'character',
      resourceId: id,
      metadata: { reason: err.message },
    })
    logTaskError('CharacterImage', 'generate-outfit', { characterId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /characters/:id/generate-image
app.post('/:id/generate-image', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, id)).all()
  if (!char) return badRequest(c, 'Character not found')
  if (!body.episode_id) return badRequest(c, 'episode_id is required')

  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id))).all()
  if (!ep) return badRequest(c, 'Episode not found')

  const prompt = resolveCharacterImagePrompt(char, body.prompt)
  if (body.prompt?.trim()) {
    db.update(schema.characters).set({ imagePrompt: prompt, updatedAt: now() }).where(eq(schema.characters.id, id)).run()
  }

  const billingModel = resolveBillingImageModel({ imageConfigId: ep.imageConfigId })
  const billingProvider = resolveBillingImageProvider({ imageConfigId: ep.imageConfigId })
  const billed = tryChargeImageUser(c, CREDIT_ACTIONS.CHARACTER_IMAGE, billingModel, {
    summary: `生成角色图：${char.name}`,
    dramaId: char.dramaId,
    episodeId: ep.id,
    resourceType: 'character',
    resourceId: id,
  }, billingProvider)
  if (billed.error) return billed.error

  try {
    logTaskStart('CharacterImage', 'generate', { characterId: id, episodeId: ep.id, dramaId: char.dramaId, prompt })
    const genId = await generateImage({
      characterId: id,
      dramaId: char.dramaId,
      prompt,
      configId: ep.imageConfigId ?? undefined,
      creditTransactionId: billed.charge.transactionId,
    })
    logTaskSuccess('CharacterImage', 'generate', { characterId: id, generationId: genId })
    logActivity(getAuthUser(c), {
      action: 'character.image',
      summary: `生成角色图：${char.name}`,
      resourceType: 'character',
      resourceId: id,
      dramaId: char.dramaId,
      episodeId: ep.id,
      creditCost: billed.charge.cost,
      metadata: { generation_id: genId, credit_tx_id: billed.charge.transactionId },
    })
    return success(c, { image_generation_id: genId, credits_balance: billed.charge.balance })
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '角色图生成失败退款',
      dramaId: char.dramaId,
      episodeId: ep.id,
      resourceType: 'character',
      resourceId: id,
      metadata: { reason: err.message },
    })
    logTaskError('CharacterImage', 'generate', { characterId: id, error: err.message })
    return badRequest(c, err.message)
  }
})

// POST /characters/batch-generate-images
app.post('/batch-generate-images', async (c) => {
  const body = await c.req.json()
  const ids: number[] = body.character_ids || []
  if (!body.episode_id) return badRequest(c, 'episode_id is required')
  if (!ids.length) return badRequest(c, 'character_ids is required')
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, Number(body.episode_id))).all()
  if (!ep) return badRequest(c, 'Episode not found')

  const billingModel = resolveBillingImageModel({ imageConfigId: ep.imageConfigId })
  const billingProvider = resolveBillingImageProvider({ imageConfigId: ep.imageConfigId })
  const preflight = tryPreflightBatchImageCharge(c, CREDIT_ACTIONS.CHARACTER_IMAGE, ids.length, billingModel, billingProvider)
  if (preflight.error) return preflight.error

  const results: Array<{ character_id: number; image_generation_id: number }> = []
  const failed: Array<{ character_id: number; error: string }> = []
  const creditTxIds: number[] = []
  let totalCharged = 0
  let lastBalance = preflight.balance

  for (const cid of ids) {
    const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, cid)).all()
    if (!char) {
      failed.push({ character_id: cid, error: '角色不存在' })
      continue
    }
    const prompt = resolveCharacterImagePrompt(char)
    const charge = chargeBatchImageItem(preflight.user.id, CREDIT_ACTIONS.CHARACTER_IMAGE, billingModel, {
      summary: `批量生成角色图：${char.name}`,
      dramaId: char.dramaId,
      episodeId: ep.id,
      resourceType: 'character',
      resourceId: cid,
      metadata: { batch: 'character_images' },
    }, billingProvider)
    if (!charge.ok) {
      failed.push({ character_id: cid, error: charge.message || '积分不足' })
      break
    }
    totalCharged += charge.cost
    lastBalance = charge.balance
    if (charge.transactionId) creditTxIds.push(charge.transactionId)

    try {
      const genId = await generateImage({
        characterId: cid,
        dramaId: char.dramaId,
        prompt,
        configId: ep.imageConfigId ?? undefined,
        creditTransactionId: charge.transactionId,
      })
      results.push({ character_id: cid, image_generation_id: genId })
    } catch (err: any) {
      tryRefundCharge(charge.transactionId, {
        summary: `批量角色图失败退款：${char.name}`,
        dramaId: char.dramaId,
        episodeId: ep.id,
        resourceType: 'character',
        resourceId: cid,
        metadata: { reason: err.message, batch: 'character_images' },
      })
      failed.push({ character_id: cid, error: err.message })
    }
  }

  logTaskSuccess('CharacterImage', 'batch-generate', {
    episodeId: ep.id,
    requested: ids.length,
    started: results.length,
    failed: failed.length,
  })
  logActivity(getAuthUser(c), {
    action: 'character.image.batch',
    summary: `批量生成角色图（${results.length}/${ids.length} 张）`,
    episodeId: ep.id,
    dramaId: ep.dramaId,
    creditCost: totalCharged,
    metadata: {
      character_ids: ids,
      generation_ids: results.map(item => item.image_generation_id),
      credit_tx_ids: creditTxIds,
      failed,
    },
  })
  return success(c, {
    count: results.length,
    items: results,
    failed,
    credits_balance: lastBalance,
  })
})

export default app
