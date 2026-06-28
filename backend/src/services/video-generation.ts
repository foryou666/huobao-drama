import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { getActiveConfig, getConfigById, resolveVideoTaskConfig, getFallbackChengmengVideoConfig, promoteChengmengVideoConfig } from './ai.js'
import { now } from '../utils/response.js'
import { downloadFile, readFileAsDataUrl, readImageAsCompressedDataUrl } from '../utils/storage.js'
import { getDramaImageAspectRatio } from '../utils/image-size.js'
import { getVideoAdapter } from './adapters/registry'
import type { AIConfig, ProviderRequest } from './adapters/types'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'
import type { VideoContentRef } from '../utils/seedance-content.js'
import { parseVideoContentRefs } from '../utils/seedance-content.js'
import { validatePromptImageRefs, formatPromptImageRefIssues } from '../utils/video-content-refs.js'
import { isChengmengProvider, isChengmengBalanceError, CHENGMENG_VIDEO_MODELS } from '../constants/chengmeng.js'
import { isAistarslabProvider } from '../constants/aistarslab.js'
import { mapGrokAspectRatio } from '../constants/geeknow-grok.js'
import { normalizeJimengAspectRatio, resolveJimengSubmitModel } from '../constants/jimeng-web.js'
import { normalizeDoubaoTrainingAspectRatio, normalizeDoubaoTrainingDuration } from '../constants/doubao-training.js'
import { processDoubaoTrainingVideoGeneration } from './doubao-training-video.js'
import { applyTrainingVideoOverlay } from '../utils/training-video-overlay.js'
import { trySyncStaticToOss } from '../utils/oss-entity-sync.js'
import { buildJimengVirtualConfig, processJimengWebVideoGeneration } from './jimeng-web-video.js'
import { buildDoubaoTrainingVirtualConfig } from './doubao-training-video.js'
import {
  normalizeChengmengContentRefs,
  normalizeChengmengReferenceUrls,
  normalizeChengmengAspectRatio,
  resolveChengmengMediaUrl,
  assertChengmengPromptLength,
  resolveChengmengPromptMediaCounts,
} from '../utils/chengmeng-content.js'
import {
  normalizeAistarslabAspectRatio,
  normalizeAistarslabContentRefs,
  normalizeAistarslabReferenceUrls,
  resolveAistarslabMediaUrl,
} from '../utils/aistarslab-content.js'
import { failVideoGeneration } from '../utils/generation-failure.js'
import { normalizeSeedanceRatio } from '../utils/video-aspect-ratio.js'
import { isSeedance2Model } from '../constants/seedance.js'
import { ensureApiTrimmedAudioPath } from '../utils/audio-trim.js'
import { extractVolcengineApiErrorMessage, formatVolcengineVideoError } from '../utils/volcengine-video-errors.js'
import { sanitizeUserFacingProviderError } from '../utils/provider-error-sanitize.js'

/** 防止同一本地任务重复向上游 POST 创建（重启/并发/误调） */
const activeVideoSubmissions = new Set<number>()
const activeVideoPolls = new Set<number>()

function resumePollForRecord(
  id: number,
  config: AIConfig,
  record: typeof schema.videoGenerations.$inferSelect,
) {
  if (adapterIsVidu(config.provider)) return
  pollVideoTask(id, config, record.taskId!, record.storyboardId)
    .catch(err => logTaskError('VideoTask', 'resume-poll', { id, error: err.message }))
}

function adapterIsVidu(provider?: string | null) {
  return String(provider || '').trim().toLowerCase() === 'vidu'
}

function formatVideoProviderError(status: number, errText: string, provider?: string): string {
  const message = extractVolcengineApiErrorMessage(errText)
  const code = (() => {
    try {
      const parsed = JSON.parse(errText)
      return String(parsed?.error?.code || parsed?.code || '').trim()
    } catch {
      return ''
    }
  })()

  if (status === 401 || code === 'AuthenticationError') {
    return formatVolcengineVideoError(message || 'API 认证失败', provider)
  }
  if (message) return formatVolcengineVideoError(message, provider)

  const snippet = errText.replace(/\s+/g, ' ').trim().slice(0, 240)
  return sanitizeUserFacingProviderError(
    snippet ? `API error ${status}: ${snippet}` : `API error ${status}`,
  )
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
  provider?: string
  aistarslabChannel?: string
  jimengSessionId?: string
  doubaoTrainingSessionId?: string
  creditTransactionId?: number
  userId?: number
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  const ts = now()
  const config = params.provider === 'jimeng_web'
    ? buildJimengVirtualConfig(params.model)
    : params.provider === 'doubao_training'
      ? buildDoubaoTrainingVirtualConfig(params.model)
      : params.configId
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
  const defaultAspect = params.dramaId
    ? getDramaImageAspectRatio(params.dramaId)
    : (isAistarslabProvider(config.provider) ? '9:16' : '16:9')
  const rawAspect = params.aspectRatio || defaultAspect
  const useChengmeng = isChengmengProvider(config.provider)
  const useAistarslab = isAistarslabProvider(config.provider)
  const useGeeknowGrok = config.provider === 'geeknow'
  const useJimengWeb = config.provider === 'jimeng_web'
  const useDoubaoTraining = config.provider === 'doubao_training'
  const storedModel = useChengmeng
    ? (params.model || CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST)
    : useJimengWeb
      ? resolveJimengSubmitModel(params.model)
      : useDoubaoTraining
        ? (params.model || config.model)
        : (params.model || config.model)
  const aspectRatio = useChengmeng
    ? normalizeChengmengAspectRatio(rawAspect, defaultAspect)
    : useAistarslab
      ? normalizeAistarslabAspectRatio(rawAspect, defaultAspect)
      : useGeeknowGrok
      ? mapGrokAspectRatio(rawAspect)
      : useJimengWeb
        ? normalizeJimengAspectRatio(rawAspect, defaultAspect)
        : useDoubaoTraining
          ? normalizeDoubaoTrainingAspectRatio(rawAspect)
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
    duration: useDoubaoTraining
      ? normalizeDoubaoTrainingDuration(params.duration)
      : (params.duration || 15),
    aspectRatio,
    style: useJimengWeb
      ? (params.jimengSessionId ? `jimeng_session:${params.jimengSessionId}` : null)
      : useDoubaoTraining
        ? (params.doubaoTrainingSessionId ? `doubao_training_session:${params.doubaoTrainingSessionId}` : null)
        : (params.aistarslabChannel || null),
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
  if (config.provider === 'jimeng_web') {
    return processJimengWebVideoGeneration(id)
  }
  if (config.provider === 'doubao_training') {
    return processDoubaoTrainingVideoGeneration(id)
  }

  const adapter = getVideoAdapter(config.provider)

  try {
    const rows = db.select().from(schema.videoGenerations).where(eq(schema.videoGenerations.id, id)).all()
    const record = rows[0]
    if (!record) return

    if (record.status === 'completed' || record.status === 'failed') {
      logTaskWarn('VideoTask', 'submit-skipped', { id, reason: 'terminal status', status: record.status })
      return
    }

    if (record.taskId) {
      logTaskWarn('VideoTask', 'submit-skipped', {
        id,
        reason: 'task_id already set — poll only, never resubmit',
        taskId: record.taskId,
      })
      resumePollForRecord(id, config, record)
      return
    }

    if (activeVideoSubmissions.has(id)) {
      logTaskWarn('VideoTask', 'submit-skipped', { id, reason: 'submission already in flight' })
      return
    }
    activeVideoSubmissions.add(id)

    logTaskProgress('VideoTask', 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      referenceMode: record.referenceMode,
    })

    const useChengmeng = isChengmengProvider(config.provider)
    const useAistarslab = isAistarslabProvider(config.provider)
    const useGeeknowGrok = config.provider === 'geeknow'
    const dramaId = record.dramaId ?? null
    const resolvedImageUrl = useChengmeng || useAistarslab
      ? await resolveChengmengMediaUrl(record.imageUrl, useAistarslab ? dramaId : undefined)
      : useGeeknowGrok
        ? normalizeGrokReferencePathSync(record.imageUrl)
        : await normalizeVideoReferenceUrl(record.imageUrl)
    const resolvedFirstFrameUrl = useChengmeng || useAistarslab
      ? await resolveAistarslabMediaUrl(record.firstFrameUrl, useAistarslab ? dramaId : undefined)
      : useGeeknowGrok
        ? normalizeGrokReferencePathSync(record.firstFrameUrl)
        : await normalizeVideoReferenceUrl(record.firstFrameUrl)
    const resolvedLastFrameUrl = useChengmeng || useAistarslab
      ? await resolveAistarslabMediaUrl(record.lastFrameUrl, useAistarslab ? dramaId : undefined)
      : useGeeknowGrok
        ? normalizeGrokReferencePathSync(record.lastFrameUrl)
        : await normalizeVideoReferenceUrl(record.lastFrameUrl)
    const resolvedReferenceImageUrls = useChengmeng || useAistarslab
      ? await normalizeAistarslabReferenceUrls(record.referenceImageUrls, useAistarslab ? dramaId : undefined)
      : useGeeknowGrok
        ? normalizeGrokReferenceUrls(record.referenceImageUrls)
        : await normalizeVideoReferenceUrls(record.referenceImageUrls)
    const resolvedContentRefs = useChengmeng
      ? await normalizeChengmengContentRefs(record.referencePayload)
      : useAistarslab
        ? await normalizeAistarslabContentRefs(record.referencePayload, dramaId)
        : useGeeknowGrok
          ? normalizeGrokContentRefs(record.referencePayload)
          : await normalizeVideoContentRefs(record.referencePayload)

    if (useChengmeng || useAistarslab) {
      const rawRefs = parseVideoContentRefs(record.referencePayload)
      let rawRefUrls: string[] = []
      if (record.referenceImageUrls) {
        try {
          const parsed = JSON.parse(record.referenceImageUrls)
          if (Array.isArray(parsed)) rawRefUrls = parsed.map(String).filter(Boolean)
        } catch { /* ignore */ }
      }
      const hasRawRefMedia = rawRefs.length > 0
        || rawRefUrls.length > 0
        || !!(record.imageUrl || record.firstFrameUrl || record.lastFrameUrl)
      const hasResolvedRefMedia = resolvedContentRefs.length > 0
        || (resolvedReferenceImageUrls?.length ?? 0) > 0
        || !!(resolvedImageUrl || resolvedFirstFrameUrl || resolvedLastFrameUrl)
      if (hasRawRefMedia && !hasResolvedRefMedia) {
        throw new Error('参考图无法转为公网 URL，请检查 OSS 配置（backend/.env 中的 OSS_ACCESS_KEY_ID/SECRET）')
      }
    } else if (isSeedance2Model(record.model)) {
      const rawRefs = parseVideoContentRefs(record.referencePayload)
      const rawAudio = rawRefs.filter(ref => ref.type === 'audio')
      const resolvedAudio = resolvedContentRefs.filter(ref => ref.type === 'audio')
      if (rawAudio.length > 0 && resolvedAudio.length === 0) {
        throw new Error('参考音频无法读取或过长，请确认音色 MP3 存在；系统会自动裁剪至 3 秒，需安装 ffmpeg')
      }
    }

    const referencePayload = useChengmeng || useAistarslab
      ? JSON.stringify(resolvedContentRefs)
      : useGeeknowGrok
        ? (resolvedContentRefs.length ? JSON.stringify(resolvedContentRefs) : record.referencePayload)
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
      providerChannel: record.style,
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

    const [freshBeforePost] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id)).all()
    if (freshBeforePost?.taskId) {
      logTaskWarn('VideoTask', 'submit-skipped', {
        id,
        reason: 'task_id set before POST (race guard)',
        taskId: freshBeforePost.taskId,
      })
      resumePollForRecord(id, config, freshBeforePost)
      return
    }

    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
    const resp = await fetch(url, {
      method,
      headers: isFormData
        ? { Authorization: headers.Authorization || headers.authorization || '' }
        : headers,
      body: isFormData ? body : JSON.stringify(body),
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
        activeVideoSubmissions.delete(id)
        return processVideoGeneration(id, fallback, { allowChengmengFallback: false })
      }
    }
    logTaskError('VideoTask', 'process', { id, provider: config.provider, error: message })
    failVideoGeneration(id, message)
  } finally {
    activeVideoSubmissions.delete(id)
  }
}

function normalizeGrokReferencePathSync(value: string | null | undefined): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    return raw.startsWith('/static/') ? raw.slice(1) : raw
  }
  if (raw.startsWith('data:image/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return raw
}

function normalizeGrokReferenceUrls(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return []
  let refs: string[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    refs = []
  }
  return Array.from(new Set(
    refs.map(item => String(item || '').trim()).filter(Boolean),
  )).map(item => (item.startsWith('/static/') ? item.slice(1) : item))
}

function normalizeGrokContentRefs(raw: string | null | undefined): VideoContentRef[] {
  const refs = parseVideoContentRefs(raw)
  return refs
    .filter(ref => ref.type === 'image' && ref.url)
    .map(ref => ({
      ...ref,
      url: String(ref.url).trim().replace(/^\/+/, ''),
    }))
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
        let audioPath = url
        if (url.startsWith('static/') || url.startsWith('/static/')) {
          audioPath = await ensureApiTrimmedAudioPath(url)
        }
        const next = await normalizeAudioReferenceUrl(audioPath)
        return next ? { ...ref, url: next, role: 'reference_audio' as const } : null
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

async function fetchAdapterRequest(req: ProviderRequest) {
  const isFormData = typeof FormData !== 'undefined' && req.body instanceof FormData
  return fetch(req.url, {
    method: req.method,
    headers: isFormData
      ? { Authorization: req.headers.Authorization || req.headers.authorization || '' }
      : req.headers,
    body: isFormData ? req.body : req.body != null ? JSON.stringify(req.body) : undefined,
  })
}

async function pollVideoTask(id: number, config: AIConfig, taskId: string, storyboardId?: number | null) {
  if (activeVideoPolls.has(id)) {
    logTaskWarn('VideoTask', 'poll-skipped', { id, taskId, reason: 'poll already running' })
    return
  }
  activeVideoPolls.add(id)

  const adapter = getVideoAdapter(config.provider)

  try {
    for (let i = 0; i < 300; i++) {
      await new Promise(r => setTimeout(r, 10000))
      try {
        const pollReq = adapter.buildPollRequest(config, taskId)
        logTaskProgress('VideoTask', 'poll-request', {
          id,
          taskId,
          provider: config.provider,
          method: pollReq.method,
          url: redactUrl(pollReq.url),
          attempt: i + 1,
        })
        const resp = await fetchAdapterRequest(pollReq)
        if (!resp.ok) continue
        const result = await resp.json() as any

        const pollResp = adapter.parsePollResponse(result)

        if (pollResp.status === 'completed' && pollResp.videoUrl) {
          logTaskSuccess('VideoTask', 'poll-complete', { id, taskId, videoUrl: pollResp.videoUrl })
          await handleVideoComplete(id, pollResp.videoUrl, null, storyboardId)
          return
        }
        if (pollResp.status === 'failed') {
          const errMsg = formatVolcengineVideoError(pollResp.error || 'Video generation failed', config.provider)
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
  } finally {
    activeVideoPolls.delete(id)
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
    const [videoMeta] = db.select({
      provider: schema.videoGenerations.provider,
      dramaId: schema.videoGenerations.dramaId,
    })
      .from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id))
      .all()
    let localPath = await downloadFile(videoUrl, 'videos', { syncOss: false })
    if (videoMeta?.provider === 'doubao_training') {
      localPath = await applyTrainingVideoOverlay(localPath)
    }
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
    await trySyncStaticToOss(localPath, videoMeta?.dramaId)
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

  if (config.provider === 'jimeng_web') {
    if (!record.taskId) throw new Error('该记录无 task_id，无法向即梦查询')
    const poll = await import('./jimeng-web-video.js').then(m => m.pollJimengVideoOnce(record.taskId!, record.style))
    if (poll.status === 'completed' && poll.videoUrl) {
      await handleVideoComplete(id, poll.videoUrl, record.duration, record.storyboardId)
    } else if (poll.status === 'failed') {
      failVideoGeneration(id, poll.error || '即梦视频生成失败')
    }
    const [updated] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id)).all()
    return updated || null
  }

  const adapter = getVideoAdapter(config.provider)
  if (adapter.provider === 'vidu') {
    throw new Error('Vidu 视频请等待 Webhook 回调')
  }

  const pollReq = adapter.buildPollRequest(config, record.taskId)
  const resp = await fetchAdapterRequest(pollReq)
  if (!resp.ok) throw new Error(`查询任务失败 HTTP ${resp.status}`)
  const result = await resp.json() as any
  const pollResp = adapter.parsePollResponse(result)

  if (pollResp.status === 'completed' && pollResp.videoUrl) {
    await handleVideoComplete(id, pollResp.videoUrl, record.duration, record.storyboardId)
  } else if (pollResp.status === 'failed') {
    failVideoGeneration(id, formatVolcengineVideoError(pollResp.error || 'Video generation failed', config.provider))
  }

  const [updated] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id)).all()
  return updated || null
}

/** 服务重启后恢复 processing 任务的轮询（绝不重新 POST 创建） */
export function resumeProcessingVideoTasks() {
  const rows = db.select()
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.status, 'processing'))
    .all()
  for (const row of rows) {
    if (!row.taskId) {
      logTaskWarn('VideoTask', 'resume-skipped', {
        id: row.id,
        provider: row.provider,
        reason: 'processing without task_id — mark failed to prevent duplicate upstream charge',
      })
      failVideoGeneration(
        row.id,
        '任务未获得上游 ID（可能服务重启中断）。已停止以免重复扣费，请在前端手动重新提交。',
      )
      continue
    }
    if (!row.provider) {
      logTaskWarn('VideoTask', 'resume-skipped', { id: row.id, reason: 'no provider' })
      continue
    }
    if (row.provider === 'jimeng_web') {
      logTaskProgress('VideoTask', 'resume-poll', {
        id: row.id,
        taskId: row.taskId,
        provider: row.provider,
      })
      import('./jimeng-web-video.js').then(m => {
        m.pollJimengVideoTask(row.id, row.taskId!, row.storyboardId, row.duration, row.style).catch(err => {
          logTaskError('VideoTask', 'resume-poll', { id: row.id, error: err.message })
        })
      })
      continue
    }
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
    resumePollForRecord(row.id, config, row)
  }
}
