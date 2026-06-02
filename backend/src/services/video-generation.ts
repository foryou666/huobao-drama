import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { getActiveConfig, getConfigById } from './ai.js'
import { now } from '../utils/response.js'
import { downloadFile, readFileAsDataUrl, readImageAsCompressedDataUrl } from '../utils/storage.js'
import { getDramaImageAspectRatio } from '../utils/image-size.js'
import { getVideoAdapter } from './adapters/registry'
import type { AIConfig } from './adapters/types'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'
import type { VideoContentRef } from '../utils/seedance-content.js'
import { parseVideoContentRefs } from '../utils/seedance-content.js'
import { validatePromptImageRefs, formatPromptImageRefIssues } from '../utils/video-content-refs.js'
import { isChengmengProvider } from '../constants/chengmeng.js'
import {
  normalizeChengmengContentRefs,
  normalizeChengmengReferenceUrls,
  normalizeChengmengAspectRatio,
  resolveChengmengMediaUrl,
} from '../utils/chengmeng-content.js'
import { failVideoGeneration } from '../utils/generation-failure.js'
import { normalizeSeedanceRatio } from '../utils/video-aspect-ratio.js'

interface GenerateVideoParams {
  storyboardId?: number
  dramaId?: number
  prompt: string
  model?: string
  referenceMode?: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  contentRefs?: VideoContentRef[]
  duration?: number
  aspectRatio?: string
  configId?: number
  creditTransactionId?: number
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  const ts = now()
  const config = params.configId
    ? getConfigById(params.configId)
    : getActiveConfig('video')
  if (!config) throw new Error('No active video AI config')

  if (params.storyboardId) {
    const [sb] = db.select().from(schema.storyboards)
      .where(eq(schema.storyboards.id, params.storyboardId)).all()
    if (sb) {
      let dramaId = params.dramaId
      if (!dramaId) {
        const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
        dramaId = ep?.dramaId
      }
      if (dramaId) {
        const prompt = String(params.prompt || sb.videoPrompt || '').trim()
        const issues = validatePromptImageRefs(prompt, sb, dramaId)
        if (issues.length) throw new Error(formatPromptImageRefIssues(issues))
      }
    }
  }

  const hasReferenceMedia = !!(params.contentRefs?.length)
    || !!(params.referenceImageUrls?.length)
    || !!(params.imageUrl || params.firstFrameUrl || params.lastFrameUrl)
  const defaultAspect = params.dramaId ? getDramaImageAspectRatio(params.dramaId) : '16:9'
  const rawAspect = params.aspectRatio || defaultAspect
  const useChengmeng = isChengmengProvider(config.provider)
  const aspectRatio = useChengmeng
    ? normalizeChengmengAspectRatio(rawAspect, defaultAspect)
    : normalizeSeedanceRatio(rawAspect, params.model || config.model, { hasReferenceMedia })

  const res = db.insert(schema.videoGenerations).values({
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    prompt: params.prompt,
    model: params.model || config.model,
    provider: config.provider,
    referenceMode: params.referenceMode || 'none',
    imageUrl: params.imageUrl,
    firstFrameUrl: params.firstFrameUrl,
    lastFrameUrl: params.lastFrameUrl,
    referenceImageUrls: params.referenceImageUrls ? JSON.stringify(params.referenceImageUrls) : null,
    referencePayload: params.contentRefs?.length ? JSON.stringify(params.contentRefs) : null,
    duration: params.duration || 15,
    aspectRatio,
    creditTransactionId: params.creditTransactionId ?? null,
    status: 'processing',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const lastId = Number(res.lastInsertRowid)
  logTaskStart('VideoTask', 'enqueue', {
    id: lastId,
    provider: config.provider,
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    referenceMode: params.referenceMode || 'none',
    duration: params.duration || 15,
  })
  logTaskPayload('VideoTask', 'enqueue params', {
    id: lastId,
    config: {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
    },
    params,
  })
  processVideoGeneration(lastId, config).catch(err => {
    logTaskError('VideoTask', 'process', { id: lastId, error: err.message })
    console.error(`Video generation ${lastId} failed:`, err)
  })
  return lastId
}

async function processVideoGeneration(id: number, config: AIConfig) {
  const adapter = getVideoAdapter(config.provider)

  try {
    const rows = db.select().from(schema.videoGenerations).where(eq(schema.videoGenerations.id, id)).all()
    const record = rows[0]
    if (!record) return
    logTaskProgress('VideoTask', 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      referenceMode: record.referenceMode,
    })

    const useChengmeng = isChengmengProvider(config.provider)
    const resolvedImageUrl = useChengmeng
      ? await resolveChengmengMediaUrl(record.imageUrl)
      : await normalizeVideoReferenceUrl(record.imageUrl)
    const resolvedFirstFrameUrl = useChengmeng
      ? await resolveChengmengMediaUrl(record.firstFrameUrl)
      : await normalizeVideoReferenceUrl(record.firstFrameUrl)
    const resolvedLastFrameUrl = useChengmeng
      ? await resolveChengmengMediaUrl(record.lastFrameUrl)
      : await normalizeVideoReferenceUrl(record.lastFrameUrl)
    const resolvedReferenceImageUrls = useChengmeng
      ? await normalizeChengmengReferenceUrls(record.referenceImageUrls)
      : await normalizeVideoReferenceUrls(record.referenceImageUrls)
    const resolvedContentRefs = useChengmeng
      ? await normalizeChengmengContentRefs(record.referencePayload)
      : await normalizeVideoContentRefs(record.referencePayload)

    if (useChengmeng) {
      const rawRefs = parseVideoContentRefs(record.referencePayload)
      if (rawRefs.length > 0 && resolvedContentRefs.length === 0) {
        throw new Error('参考图无法转为公网 URL，请检查 OSS 配置（backend/.env 中的 OSS_ACCESS_KEY_ID/SECRET）')
      }
    }

    const referencePayload = useChengmeng
      ? JSON.stringify(resolvedContentRefs)
      : (resolvedContentRefs.length ? JSON.stringify(resolvedContentRefs) : record.referencePayload)

    // 使用 Adapter 构建请求
    const { url, method, headers, body } = adapter.buildGenerateRequest(config, {
      id: record.id,
      model: record.model,
      prompt: record.prompt,
      referenceMode: record.referenceMode,
      imageUrl: resolvedImageUrl,
      firstFrameUrl: resolvedFirstFrameUrl,
      lastFrameUrl: resolvedLastFrameUrl,
      referenceImageUrls: resolvedReferenceImageUrls ? JSON.stringify(resolvedReferenceImageUrls) : null,
      referencePayload,
      duration: record.duration,
      aspectRatio: record.aspectRatio,
    })
    logTaskProgress('VideoTask', 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
      referenceMode: record.referenceMode,
    })
    logTaskPayload('VideoTask', 'request payload', {
      id,
      method,
      url,
      headers,
      body,
    })

    const resp = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
    })

    if (!resp.ok) throw new Error(`API error ${resp.status}: ${await resp.text()}`)
    const result = await resp.json() as any

    const { isAsync, taskId, videoUrl } = adapter.parseGenerateResponse(result)

    if (!isAsync && videoUrl) {
      logTaskProgress('VideoTask', 'sync-complete', { id, videoUrl })
      // 同步模式
      await handleVideoComplete(id, videoUrl, record.duration)
      return
    }

    // 异步模式：更新 taskId，开始轮询
    db.update(schema.videoGenerations)
      .set({ taskId, status: 'processing', updatedAt: now() })
      .where(eq(schema.videoGenerations.id, id))
      .run()
    logTaskProgress('VideoTask', 'poll-start', { id, taskId, provider: config.provider })

    // Vidu 没有轮询端点，跳过轮询（依赖 Webhook 回调）
    if (adapter.provider === 'vidu') {
      logTaskProgress('VideoTask', 'webhook-wait', { id, taskId, provider: adapter.provider })
      return
    }

    pollVideoTask(id, config, taskId!, record.storyboardId)
  } catch (err: any) {
    logTaskError('VideoTask', 'process', { id, provider: config.provider, error: err.message })
    failVideoGeneration(id, err.message)
  }
}

async function normalizeVideoReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('asset://')) return raw
  if (raw.startsWith('data:image/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const localPath = raw.startsWith('/static/') ? raw.slice(1) : raw
    try {
      return await readImageAsCompressedDataUrl(localPath, {
        maxWidth: 768,
        maxHeight: 768,
        quality: 68,
      })
    } catch (err) {
      logTaskWarn('VideoTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
      return null
    }
  }
  return raw
}

async function normalizeVideoContentRefs(raw: string | null | undefined): Promise<VideoContentRef[]> {
  if (!raw?.trim()) return []
  let refs: VideoContentRef[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(refs)) return []
  const normalized = await Promise.all(
    refs.map(async (ref) => {
      const url = String(ref?.url || '').trim()
      if (!url) return null
      const type = ref?.type
      if (type === 'image') {
        const next = await normalizeVideoReferenceUrl(url)
        return next ? { ...ref, url: next } : null
      }
      if (type === 'audio') {
        const next = await normalizeAudioReferenceUrl(url)
        return next ? { ...ref, url: next } : null
      }
      if (type === 'video') {
        const next = await normalizeVideoMediaReferenceUrl(url)
        return next ? { ...ref, url: next } : null
      }
      return null
    }),
  )
  return normalized.filter((item): item is VideoContentRef => !!item)
}

async function normalizeAudioReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:audio/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const localPath = raw.startsWith('/static/') ? raw.slice(1) : raw
    const dataUrl = readFileAsDataUrl(localPath, 8 * 1024 * 1024)
    if (dataUrl) return dataUrl
    logTaskWarn('VideoTask', 'audio-reference-too-large', { path: localPath })
    return null
  }
  return raw
}

async function normalizeVideoMediaReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:video/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    logTaskWarn('VideoTask', 'video-reference-local-skipped', { path: raw })
    return null
  }
  return raw
}

async function normalizeVideoReferenceUrls(raw: string | null | undefined): Promise<string[]> {
  if (!raw) return []
  let refs: string[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    refs = []
  }
  const normalized = await Promise.all(
    Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean))).map((item) => normalizeVideoReferenceUrl(item)),
  )
  return normalized.filter((item): item is string => !!item)
}

async function pollVideoTask(id: number, config: AIConfig, taskId: string, storyboardId?: number | null) {
  const adapter = getVideoAdapter(config.provider)

  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 10000))
    try {
      const { url, method, headers } = adapter.buildPollRequest(config, taskId)
      logTaskProgress('VideoTask', 'poll-request', {
        id,
        taskId,
        provider: config.provider,
        method,
        url: redactUrl(url),
        attempt: i + 1,
      })
      const resp = await fetch(url, { method, headers })
      if (!resp.ok) continue
      const result = await resp.json() as any

      const pollResp = adapter.parsePollResponse(result)

      if (pollResp.status === 'completed' && pollResp.videoUrl) {
        logTaskSuccess('VideoTask', 'poll-complete', { id, taskId, videoUrl: pollResp.videoUrl })
        await handleVideoComplete(id, pollResp.videoUrl, null, storyboardId)
        return
      }
      if (pollResp.status === 'failed') {
        const errMsg = pollResp.error || 'Video generation failed'
        logTaskError('VideoTask', 'poll-failed', { id, taskId, error: errMsg })
        failVideoGeneration(id, errMsg)
        return
      }
    } catch (err: any) {
      if (i === 299) {
        logTaskError('VideoTask', 'poll-timeout', { id, taskId, error: err.message })
        failVideoGeneration(id, `Timeout: ${err.message}`)
        return
      }
      logTaskWarn('VideoTask', 'poll-retry', { id, taskId, attempt: i + 1, error: err.message })
    }
  }
}

async function handleVideoComplete(id: number, videoUrl: string, duration: number | null | undefined, storyboardId?: number | null) {
  const localPath = await downloadFile(videoUrl, 'videos')
  db.update(schema.videoGenerations)
    .set({ videoUrl, localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.videoGenerations.id, id))
    .run()
  logTaskSuccess('VideoTask', 'downloaded', { id, localPath, storyboardId, duration })

  if (storyboardId) {
    db.update(schema.storyboards)
      .set({ videoUrl: localPath, duration: duration || undefined, updatedAt: now() })
      .where(eq(schema.storyboards.id, storyboardId))
      .run()
  }
}
