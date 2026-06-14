import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { getActiveConfig, getConfigById, resolveVideoTaskConfig, getFallbackChengmengVideoConfig, promoteChengmengVideoConfig } from './ai.js'
import { now } from '../utils/response.js'
import { downloadFile, readFileAsDataUrl, readImageAsCompressedDataUrl } from '../utils/storage.js'
import { getDramaImageAspectRatio } from '../utils/image-size.js'
import { getVideoAdapter } from './adapters/registry'
import type { AIConfig } from './adapters/types'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'
import type { VideoContentRef } from '../utils/seedance-content.js'
import { parseVideoContentRefs } from '../utils/seedance-content.js'
import { validatePromptImageRefs, formatPromptImageRefIssues } from '../utils/video-content-refs.js'
import { isChengmengProvider, isChengmengBalanceError, CHENGMENG_VIDEO_MODELS } from '../constants/chengmeng.js'
import {
  normalizeChengmengContentRefs,
  normalizeChengmengReferenceUrls,
  normalizeChengmengAspectRatio,
  resolveChengmengMediaUrl,
  assertChengmengPromptLength,
  resolveChengmengPromptMediaCounts,
} from '../utils/chengmeng-content.js'
import { failVideoGeneration } from '../utils/generation-failure.js'
import { normalizeSeedanceRatio } from '../utils/video-aspect-ratio.js'

function formatVideoProviderError(status: number, errText: string, provider?: string): string {
  let message = ''
  try {
    const parsed = JSON.parse(errText)
    message = String(parsed?.error?.message || parsed?.message || '').trim()
    const code = String(parsed?.error?.code || parsed?.code || '').trim()
    if (status === 401 || code === 'AuthenticationError') {
      if (provider === 'volcengine') {
        return '火山方舟 API Key 无效或未配置，请在「设置 → AI 配置」中更新「火山方舟 Seedance-视频」的 API Key'
      }
      return message || 'API 认证失败，请检查服务配置中的 API Key'
    }
    if (message) return message
  } catch {
    // ignore JSON parse errors
  }
  const snippet = errText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return snippet ? `API error ${status}: ${snippet}` : `API error ${status}`
}

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
  userId?: number
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  const ts = now()
  const config = params.configId
    ? getConfigById(params.configId, { includeInactive: true })
    : getActiveConfig('video')
  if (!config) throw new Error('No video AI config available')
  const configId = config.id ?? params.configId ?? null

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
  const storedModel = useChengmeng
    ? (params.model || CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST)
    : (params.model || config.model)
  const aspectRatio = useChengmeng
    ? normalizeChengmengAspectRatio(rawAspect, defaultAspect)
    : normalizeSeedanceRatio(rawAspect, params.model || config.model, { hasReferenceMedia })

  if (useChengmeng) {
    const { imageCount, videoCount, audioCount } = resolveChengmengPromptMediaCounts({
      prompt: params.prompt,
      referenceMode: params.referenceMode,
      imageUrl: params.imageUrl,
      firstFrameUrl: params.firstFrameUrl,
      lastFrameUrl: params.lastFrameUrl,
      referenceImageUrls: params.referenceImageUrls,
      contentRefs: params.contentRefs,
    })
    assertChengmengPromptLength(params.prompt, imageCount, videoCount, audioCount)
  }

  const res = db.insert(schema.videoGenerations).values({
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    prompt: params.prompt,
    model: storedModel,
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
    configId,
    userId: params.userId ?? null,
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

async function processVideoGeneration(id: number, config: AIConfig, options?: { allowChengmengFallback?: boolean }) {
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

    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(formatVideoProviderError(resp.status, errText, config.provider))
    }
    const result = await resp.json() as any

    let parsed: ReturnType<typeof adapter.parseGenerateResponse>
    try {
      parsed = adapter.parseGenerateResponse(result)
    } catch (parseErr: any) {
      throw new Error(parseErr?.message || String(parseErr))
    }
    const { isAsync, taskId, videoUrl } = parsed

    if (!isAsync && videoUrl) {
      logTaskProgress('VideoTask', 'sync-complete', { id, videoUrl })
      // 同步模式
      await handleVideoComplete(id, videoUrl, record.duration, record.storyboardId)
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
    const message = err?.message || String(err)
    if (
      options?.allowChengmengFallback !== false
      && isChengmengProvider(config.provider)
      && isChengmengBalanceError(message)
    ) {
      const fallback = getFallbackChengmengVideoConfig(config.id)
      if (fallback?.id && fallback.id !== config.id) {
        logTaskWarn('VideoTask', 'chengmeng-balance-fallback', {
          id,
          fromConfigId: config.id,
          toConfigId: fallback.id,
          error: message,
        })
        db.update(schema.videoGenerations)
          .set({ configId: fallback.id, updatedAt: now() })
          .where(eq(schema.videoGenerations.id, id))
          .run()
        promoteChengmengVideoConfig(fallback.id)
        return processVideoGeneration(id, fallback, { allowChengmengFallback: false })
      }
    }
    logTaskError('VideoTask', 'process', { id, provider: config.provider, error: message })
    failVideoGeneration(id, message)
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

function shouldApplyVideoToStoryboard(storyboardId: number, generationId: number): boolean {
  const rows = db.select({ id: schema.videoGenerations.id })
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.storyboardId, storyboardId))
    .all()
  if (!rows.length) return true
  const latestId = Math.max(...rows.map(r => r.id))
  return generationId >= latestId
}

export async function handleVideoComplete(id: number, videoUrl: string, duration: number | null | undefined, storyboardId?: number | null) {
  const ts = now()
  let sbId = storyboardId ?? null
  if (!sbId) {
    const [record] = db.select({ storyboardId: schema.videoGenerations.storyboardId })
      .from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id))
      .all()
    sbId = record?.storyboardId ?? null
  }
  const applyToStoryboard = sbId ? shouldApplyVideoToStoryboard(sbId, id) : false

  // 先写入远程 URL 并标记完成，避免下载耗时导致前端轮询超时仍显示「生成中」
  db.update(schema.videoGenerations)
    .set({ videoUrl, status: 'completed', completedAt: ts, updatedAt: ts })
    .where(eq(schema.videoGenerations.id, id))
    .run()
  if (sbId && applyToStoryboard) {
    db.update(schema.storyboards)
      .set({ videoUrl, duration: duration || undefined, updatedAt: ts })
      .where(eq(schema.storyboards.id, sbId))
      .run()
  }
  logTaskProgress('VideoTask', 'remote-ready', {
    id,
    videoUrl: redactUrl(videoUrl),
    storyboardId: sbId,
    applyToStoryboard,
  })

  try {
    const localPath = await downloadFile(videoUrl, 'videos')
    db.update(schema.videoGenerations)
      .set({ localPath, updatedAt: now() })
      .where(eq(schema.videoGenerations.id, id))
      .run()
    if (sbId && applyToStoryboard) {
      db.update(schema.storyboards)
        .set({ videoUrl: localPath, updatedAt: now() })
        .where(eq(schema.storyboards.id, sbId))
        .run()
    }
    logTaskSuccess('VideoTask', 'downloaded', { id, localPath, storyboardId: sbId, applyToStoryboard, duration })
  } catch (err: any) {
    logTaskWarn('VideoTask', 'download-failed', {
      id,
      storyboardId: sbId,
      error: err?.message || String(err),
      hint: '已保留远程 videoUrl，页面可播放外链',
    })
  }
}

/** 使用任务创建时的 Key 向橙盟等平台查询一次任务状态（补下载/刷新外链） */
export async function refreshVideoFromProvider(id: number): Promise<typeof schema.videoGenerations.$inferSelect | null> {
  const [record] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id)).all()
  if (!record) return null
  if (!record.taskId) throw new Error('该记录无 task_id，无法向服务商查询')

  const config = resolveVideoTaskConfig(record)
  if (!config) throw new Error('未找到视频服务配置')

  const adapter = getVideoAdapter(config.provider)
  if (adapter.provider === 'vidu') {
    throw new Error('Vidu 视频请等待 Webhook 回调')
  }

  const { url, method, headers } = adapter.buildPollRequest(config, record.taskId)
  const resp = await fetch(url, { method, headers })
  if (!resp.ok) throw new Error(`查询任务失败 HTTP ${resp.status}`)
  const result = await resp.json() as any
  const pollResp = adapter.parsePollResponse(result)

  if (pollResp.status === 'completed' && pollResp.videoUrl) {
    await handleVideoComplete(id, pollResp.videoUrl, record.duration, record.storyboardId)
  } else if (pollResp.status === 'failed') {
    failVideoGeneration(id, pollResp.error || 'Video generation failed')
  }

  const [updated] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id)).all()
  return updated || null
}

/** 服务重启后恢复 processing 任务的轮询 */
export function resumeProcessingVideoTasks() {
  const rows = db.select()
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.status, 'processing'))
    .all()
  for (const row of rows) {
    if (!row.taskId || !row.provider) continue
    const config = resolveVideoTaskConfig(row)
    if (!config) {
      logTaskWarn('VideoTask', 'resume-skipped', { id: row.id, reason: 'no config' })
      continue
    }
    logTaskProgress('VideoTask', 'resume-poll', {
      id: row.id,
      taskId: row.taskId,
      provider: row.provider,
      configId: row.configId ?? config.id,
    })
    pollVideoTask(row.id, config, row.taskId, row.storyboardId).catch(err => {
      logTaskError('VideoTask', 'resume-poll', { id: row.id, error: err.message })
    })
  }
}
