import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { getActiveConfig, getConfigById } from './ai.js'
import { now } from '../utils/response.js'
import { downloadFile, readImageAsCompressedDataUrl, saveBase64Image } from '../utils/storage.js'
import { getImageAdapter } from './adapters/registry'
import type { AIConfig } from './adapters/types'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'
import { resolveGenerationImageSize } from '../utils/image-size.js'
import { appendCharacterImageVariant, appendCharacterOutfitVariant, upsertCharacterOutfit } from '../utils/character-image-variants.js'
import { syncCharacterAsset, syncSceneAsset } from './asset-library.js'
import { upsertSceneAngleImage } from '../utils/scene-image-variants.js'
import { formatProviderError } from '../utils/format-provider-error.js'
import { failImageGeneration } from '../utils/generation-failure.js'

function resolveOutfitLabel(record: typeof schema.imageGenerations.$inferSelect): string {
  if (record.propId) {
    const [asset] = db.select().from(schema.assets).where(eq(schema.assets.id, record.propId)).all()
    if (asset?.name) return asset.name
  }
  const fromPrompt = record.prompt?.match(/换装为「(.+?)」/)?.[1]
    || record.prompt?.match(/「(.+?)」换装/)?.[1]
  return fromPrompt || record.frameType || '服装'
}

function shouldUpdateSceneHeroImage(record: typeof schema.imageGenerations.$inferSelect): boolean {
  if (!record.sceneId) return false
  if (record.storyboardId) return false
  if (record.imageType === 'scene_angle' || record.imageType === 'scene_angle_sheet') return false
  return true
}

function applySceneImageCompletion(record: typeof schema.imageGenerations.$inferSelect, localPath: string) {
  if (!record.sceneId) return
  if ((record.imageType === 'scene_angle' || record.imageType === 'scene_angle_sheet') && record.frameType) {
    upsertSceneAngleImage(record.sceneId, record.frameType, localPath)
    syncSceneAsset(record.sceneId)
    return
  }
  if (!shouldUpdateSceneHeroImage(record)) return
  db.update(schema.scenes)
    .set({ imageUrl: localPath, status: 'completed', updatedAt: now() })
    .where(eq(schema.scenes.id, record.sceneId))
    .run()
  syncSceneAsset(record.sceneId)
}

function applyCharacterImageCompletion(record: typeof schema.imageGenerations.$inferSelect, localPath: string) {
  if (!record.characterId) return
  if (record.imageType === 'character_outfit_variant' && record.frameType && record.style) {
    appendCharacterOutfitVariant(record.characterId, record.frameType, localPath, record.style)
  } else if (record.imageType === 'character_outfit' && record.frameType) {
    upsertCharacterOutfit(record.characterId, {
      outfitId: record.frameType,
      label: resolveOutfitLabel(record),
      url: localPath,
      costumeAssetId: record.propId ?? null,
    })
  } else if (record.imageType === 'character_variant') {
    appendCharacterImageVariant(record.characterId, localPath, record.style || null)
  } else {
    db.update(schema.characters).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.characters.id, record.characterId)).run()
  }
  syncCharacterAsset(record.characterId)
}

interface GenerateImageParams {
  storyboardId?: number
  dramaId?: number
  sceneId?: number
  characterId?: number
  propId?: number
  prompt: string
  model?: string
  size?: string
  referenceImages?: string[]
  frameType?: string
  imageType?: string
  variantId?: string
  configId?: number
  creditTransactionId?: number
}

export async function generateImage(params: GenerateImageParams): Promise<number> {
  const ts = now()
  const config = (params.configId ? getConfigById(params.configId) : null)
    || getActiveConfig('image')
  if (!config) throw new Error('No active image AI config')

  const size = await resolveGenerationImageSize({
    explicitSize: params.size,
    dramaId: params.dramaId,
    referenceImages: params.referenceImages,
    imageType: params.imageType,
  })

  const res = db.insert(schema.imageGenerations).values({
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    propId: params.propId,
    prompt: params.prompt,
    model: params.model || config.model,
    provider: config.provider,
    size,
    frameType: params.frameType,
    imageType: params.imageType,
    style: params.variantId,
    referenceImages: params.referenceImages ? JSON.stringify(params.referenceImages) : null,
    creditTransactionId: params.creditTransactionId ?? null,
    status: 'processing',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const lastId = Number(res.lastInsertRowid)
  logTaskStart('ImageTask', 'enqueue', {
    id: lastId,
    provider: config.provider,
    storyboardId: params.storyboardId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    frameType: params.frameType,
    model: params.model || config.model,
  })
  logTaskPayload('ImageTask', 'enqueue params', {
    id: lastId,
    config: {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
    },
    params,
  })
  processImageGeneration(lastId, config).catch(err => {
    logTaskError('ImageTask', 'process', { id: lastId, error: err.message })
    console.error(`Image generation ${lastId} failed:`, err)
  })
  return lastId
}

async function processImageGeneration(id: number, config: AIConfig) {
  const adapter = getImageAdapter(config.provider)

  try {
    const rows = db.select().from(schema.imageGenerations).where(eq(schema.imageGenerations.id, id)).all()
    const record = rows[0]
    if (!record) return
    logTaskProgress('ImageTask', 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      sceneId: record.sceneId,
      characterId: record.characterId,
      frameType: record.frameType,
    })

    // 使用 Adapter 构建请求
    const resolvedReferenceImages = await normalizeReferenceImages(record.referenceImages)
    const { url, method, headers, body } = adapter.buildGenerateRequest(config, {
      id: record.id,
      model: record.model,
      prompt: record.prompt,
      size: record.size,
      frameType: record.frameType,
      referenceImages: resolvedReferenceImages ? JSON.stringify(resolvedReferenceImages) : null,
    })
    logTaskProgress('ImageTask', 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
      referenceCount: resolvedReferenceImages.length,
    })
    logTaskPayload('ImageTask', 'request payload', {
      id,
      method,
      url,
      headers,
      body: body instanceof FormData ? '[FormData]' : body,
    })

    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
    const resp = await fetch(url, {
      method,
      headers: isFormData
        ? { Authorization: headers.Authorization || headers.authorization || '' }
        : headers,
      body: isFormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
    })

    if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`)
    const result = await resp.json() as any
    logTaskPayload('ImageTask', 'response payload', {
      id,
      provider: config.provider,
      result,
    })

    const { isAsync, taskId, imageUrl } = adapter.parseGenerateResponse(result)

    if (!isAsync && imageUrl) {
      logTaskProgress('ImageTask', 'sync-complete', { id, imageUrl })
      // 同步模式：直接下载图片
      await handleImageComplete(id, config.provider, imageUrl)
      return
    }

    if (!isAsync && !imageUrl) {
      // 同步模式但无 URL（Gemini 等返回 base64）
      const b64 = adapter.extractImageBase64(result)
      if (b64) {
        logTaskProgress('ImageTask', 'sync-base64-complete', { id, mimeType: b64.mimeType })
        await handleImageCompleteBase64(id, config.provider, b64.data, b64.mimeType)
        return
      }
      throw new Error('No image URL or base64 data in response')
    }

    // 异步模式：更新 taskId，开始轮询
    db.update(schema.imageGenerations)
      .set({ taskId, status: 'processing', updatedAt: now() })
      .where(eq(schema.imageGenerations.id, id))
      .run()
    logTaskProgress('ImageTask', 'poll-start', { id, taskId, provider: config.provider })
    pollImageTask(id, config, taskId!)
  } catch (err: any) {
    logTaskError('ImageTask', 'process', { id, provider: config.provider, error: err.message })
    failImageGeneration(id, formatProviderError(err.message))
  }
}

async function normalizeReferenceImages(raw: string | null | undefined): Promise<string[]> {
  if (!raw) return []
  let refs: string[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    refs = []
  }

  const deduped = Array.from(
    new Set(
      refs
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )

  const normalized = await Promise.all(deduped.map(async (value) => {
    if (value.startsWith('data:image/')) return value
    if (value.startsWith('static/') || value.startsWith('/static/')) {
      const localPath = value.startsWith('/static/') ? value.slice(1) : value
      try {
        return await readImageAsCompressedDataUrl(localPath, {
          maxWidth: 768,
          maxHeight: 768,
          quality: 68,
        })
      } catch (err) {
        logTaskWarn('ImageTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
        return null
      }
    }
    return value
  }))

  return normalized.filter((item): item is string => !!item).slice(0, 6)
}

async function pollImageTask(id: number, config: AIConfig, taskId: string) {
  const adapter = getImageAdapter(config.provider)
  const startedAt = Date.now()
  const maxDurationMs = 600_000

  for (let i = 0; i < 120; i++) {
    if (Date.now() - startedAt >= maxDurationMs) {
      logTaskError('ImageTask', 'poll-timeout', { id, taskId, error: 'Polling exceeded 10 minutes' })
      failImageGeneration(id, 'Timeout: Polling exceeded 10 minutes')
      return
    }
    await new Promise(r => setTimeout(r, 5000))
    if (Date.now() - startedAt >= maxDurationMs) {
      logTaskError('ImageTask', 'poll-timeout', { id, taskId, error: 'Polling exceeded 10 minutes' })
      failImageGeneration(id, 'Timeout: Polling exceeded 10 minutes')
      return
    }
    try {
      const { url, method, headers } = adapter.buildPollRequest(config, taskId)
      logTaskProgress('ImageTask', 'poll-request', {
        id,
        taskId,
        provider: config.provider,
        method,
        url: redactUrl(url),
        attempt: i + 1,
      })
      const remainingMs = Math.max(1_000, maxDurationMs - (Date.now() - startedAt))
      const resp = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(remainingMs),
      })
      if (!resp.ok) continue
      const result = await resp.json() as any

      const pollResp = adapter.parsePollResponse(result)

      if (pollResp.status === 'completed' && pollResp.imageUrl) {
        logTaskSuccess('ImageTask', 'poll-complete', { id, taskId, imageUrl: pollResp.imageUrl })
        await handleImageComplete(id, config.provider, pollResp.imageUrl)
        return
      }
      if (pollResp.status === 'completed' && adapter.provider === 'gemini') {
        // Gemini 可能返回 base64
        const b64 = adapter.extractImageBase64(result)
        if (b64) {
          logTaskSuccess('ImageTask', 'poll-base64-complete', { id, taskId, mimeType: b64.mimeType })
          await handleImageCompleteBase64(id, config.provider, b64.data, b64.mimeType)
          return
        }
      }
      if (pollResp.status === 'failed') {
        const errMsg = pollResp.error || 'Generation failed'
        logTaskError('ImageTask', 'poll-failed', { id, taskId, error: errMsg })
        failImageGeneration(id, errMsg)
        return
      }
    } catch (err: any) {
      if (i === 119 || Date.now() - startedAt >= maxDurationMs) {
        logTaskError('ImageTask', 'poll-timeout', { id, taskId, error: err.message })
        failImageGeneration(id, `Timeout: ${err.message}`)
        return
      }
      logTaskWarn('ImageTask', 'poll-retry', { id, taskId, attempt: i + 1, error: err.message })
    }
  }
}

async function handleImageComplete(id: number, provider: string, imageUrl: string) {
  const localPath = await downloadFile(imageUrl, 'images')
  const rows = db.select().from(schema.imageGenerations).where(eq(schema.imageGenerations.id, id)).all()
  const record = rows[0]

  db.update(schema.imageGenerations)
    .set({ imageUrl, localPath, status: 'completed', updatedAt: now() })
    .where(eq(schema.imageGenerations.id, id))
    .run()
  logTaskSuccess('ImageTask', 'downloaded', { id, provider, localPath })

  // 更新关联表
  if (record?.storyboardId) {
    const sbUpdate: Record<string, any> = { updatedAt: now() }
    if (record.frameType === 'first_frame') sbUpdate.firstFrameImage = localPath
    else if (record.frameType === 'last_frame') sbUpdate.lastFrameImage = localPath
    else if (record.frameType === 'blocking') sbUpdate.blockingImage = localPath
    else sbUpdate.composedImage = localPath
    db.update(schema.storyboards).set(sbUpdate).where(eq(schema.storyboards.id, record.storyboardId)).run()
  }
  if (record?.characterId) applyCharacterImageCompletion(record, localPath)
  applySceneImageCompletion(record, localPath)
}

async function handleImageCompleteBase64(id: number, provider: string, base64Data: string, mimeType: string) {
  const localPath = await saveBase64Image(base64Data, mimeType, 'images')
  const rows = db.select().from(schema.imageGenerations).where(eq(schema.imageGenerations.id, id)).all()
  const record = rows[0]

  db.update(schema.imageGenerations)
    .set({ localPath, status: 'completed', updatedAt: now() })
    .where(eq(schema.imageGenerations.id, id))
    .run()
  logTaskSuccess('ImageTask', 'saved-base64', { id, provider, mimeType, localPath })

  // 更新关联表
  if (record?.storyboardId) {
    const sbUpdate: Record<string, any> = { updatedAt: now() }
    if (record.frameType === 'first_frame') sbUpdate.firstFrameImage = localPath
    else if (record.frameType === 'last_frame') sbUpdate.lastFrameImage = localPath
    else if (record.frameType === 'blocking') sbUpdate.blockingImage = localPath
    else sbUpdate.composedImage = localPath
    db.update(schema.storyboards).set(sbUpdate).where(eq(schema.storyboards.id, record.storyboardId)).run()
  }
  if (record?.characterId) applyCharacterImageCompletion(record, localPath)
  applySceneImageCompletion(record, localPath)
}
