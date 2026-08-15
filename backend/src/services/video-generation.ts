import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { getActiveConfig, getConfigById, resolveVideoTaskConfig, listChengmengVideoFallbackConfigs, promoteChengmengVideoConfig } from './ai.js'
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
import { fetchChengmengUserBalance } from './chengmeng-client.js'
import { findChengmengVideoConfigRow } from '../utils/chengmeng-video-options.js'
import { isAistarslabProvider } from '../constants/aistarslab.js'
import { isAigcccProvider } from '../constants/aigccc.js'
import { mapGrokAspectRatio, isGrokVideoModel } from '../constants/geeknow-grok.js'
import { normalizeJimengAspectRatio, resolveJimengSubmitModel } from '../constants/jimeng-web.js'
import { normalizeXyqAspectRatio, normalizeXyqDuration } from '../constants/xyq-web.js'
import { normalizeCozeAspectRatio, normalizeCozeDuration } from '../constants/coze-web.js'
import { normalizeFunshionAspectRatio, normalizeFunshionClarity, normalizeFunshionDuration } from '../constants/funshion-web.js'
import { normalizeXingyuemengAspectRatio, normalizeXingyuemengDuration, normalizeXingyuemengResolution } from '../constants/xingyuemeng-web.js'
import { normalizeDoubaoTrainingAspectRatio, normalizeDoubaoTrainingDuration } from '../constants/doubao-training.js'
import { processDoubaoTrainingVideoGeneration } from './doubao-training-video.js'
import { applyTrainingVideoOverlay } from '../utils/training-video-overlay.js'
import { trySyncStaticToOss } from '../utils/oss-entity-sync.js'
import { ensureVideoPoster } from '../utils/video-poster.js'
import { rewriteUrlsToSeedanceAssets } from './seedance-portrait.js'
import {
  assertNoDuplicateInFlightVideoSubmit,
  releaseVideoSubmitDedupLock,
} from '../utils/video-submit-dedup.js'
import { buildJimengVirtualConfig, processJimengWebVideoGeneration } from './jimeng-web-video.js'
import { buildXyqVirtualConfig, processXyqWebVideoGeneration } from './xyq-web-video.js'
import { buildCozeVirtualConfig, processCozeWebVideoGeneration } from './coze-web-video.js'
import { buildFunshionVirtualConfig, processFunshionWebVideoGeneration } from './funshion-web-video.js'
import { buildXingyuemengVirtualConfig, processXingyuemengWebVideoGeneration } from './xingyuemeng-web-video.js'
import { buildDoubaoTrainingVirtualConfig } from './doubao-training-video.js'
import {
  normalizeChengmengContentRefs,
  normalizeChengmengReferenceUrls,
  normalizeChengmengAspectRatio,
  resolveChengmengMediaUrl,
} from '../utils/chengmeng-content.js'
import {
  normalizeAistarslabAspectRatio,
  normalizeAistarslabContentRefs,
  normalizeAistarslabReferenceUrls,
  resolveAistarslabMediaUrl,
} from '../utils/aistarslab-content.js'
import {
  normalizeAigcccContentRefs,
  normalizeAigcccReferenceUrls,
  resolveAigcccMediaUrl,
} from '../utils/aigccc-content.js'
import { normalizeAigcccAspectRatio, normalizeAigcccDuration, normalizeAigcccMode } from '../constants/aigccc.js'
import { cancelVideoGeneration, expireVideoGeneration, failVideoGeneration } from '../utils/generation-failure.js'
import { normalizeSeedanceDisplayAspectRatio } from '../utils/video-aspect-ratio.js'
import { isSeedance2FamilyModel, normalizeSeedanceResolution } from '../constants/seedance.js'
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
  resolution?: string
  configId?: number
  provider?: string
  aistarslabChannel?: string
  jimengSessionId?: string
  xyqSessionId?: string
  cozeSessionId?: string
  funshionSessionId?: string
  xingyuemengSessionId?: string
  doubaoTrainingSessionId?: string
  creditTransactionId?: number
  userId?: number
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  const ts = now()
  let config = params.provider === 'jimeng_web'
    ? buildJimengVirtualConfig(params.model)
    : params.provider === 'xyq_web'
      ? buildXyqVirtualConfig(params.model)
    : params.provider === 'coze_web'
      ? buildCozeVirtualConfig(params.model)
    : params.provider === 'funshion_web'
      ? buildFunshionVirtualConfig(params.model)
    : params.provider === 'xingyuemeng_web'
      ? buildXingyuemengVirtualConfig(params.model)
    : params.provider === 'doubao_training'
      ? buildDoubaoTrainingVirtualConfig(params.model)
      : params.configId
      ? getConfigById(params.configId, { includeInactive: true })
      : getActiveConfig('video')

  // 通道1：禁止使用已停用/失效的橙盟配置（前端可能仍缓存旧 config_id）
  if (config && isChengmengProvider(config.provider)) {
    const activeRow = findChengmengVideoConfigRow()
    if (!activeRow?.isActive) {
      throw new Error('橙盟视频配置未启用，请联系管理员')
    }
    if (activeRow.id !== config.id) {
      const active = getConfigById(activeRow.id)
      if (!active) throw new Error('橙盟视频配置不可用，请联系管理员')
      logTaskWarn('VideoTask', 'chengmeng-stale-config-redirect', {
        fromConfigId: config.id,
        toConfigId: active.id,
      })
      config = active
    }
  }

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
    : (isAistarslabProvider(config.provider) || isAigcccProvider(config.provider) ? '9:16' : '16:9')
  const rawAspect = params.aspectRatio || defaultAspect
  const useChengmeng = isChengmengProvider(config.provider)
  const useAistarslab = isAistarslabProvider(config.provider)
  const useAigccc = isAigcccProvider(config.provider)
  const useGeeknowGrok = isGrokVideoModel(params.model || config.model)
    || config.provider === 'geeknow'
    || config.provider === 'qilingze'
    || config.provider === 'chatfire'
  const useJimengWeb = config.provider === 'jimeng_web'
  const useXyqWeb = config.provider === 'xyq_web'
  const useCozeWeb = config.provider === 'coze_web'
  const useFunshionWeb = config.provider === 'funshion_web'
  const useXingyuemengWeb = config.provider === 'xingyuemeng_web'
  const useDoubaoTraining = config.provider === 'doubao_training'
  const storedModel = useChengmeng
    ? (params.model || CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST)
    : useAigccc
      ? normalizeAigcccMode(params.model || config.model)
    : useJimengWeb
      ? resolveJimengSubmitModel(params.model)
      : useXyqWeb
        ? (params.model || config.model)
      : useCozeWeb
        ? (params.model || config.model)
      : useFunshionWeb
        ? (params.model || config.model)
      : useXingyuemengWeb
        ? (params.model || config.model)
      : useDoubaoTraining
        ? (params.model || config.model)
        : (params.model || config.model)
  const aspectRatio = useChengmeng
    ? normalizeChengmengAspectRatio(rawAspect, defaultAspect)
    : useAistarslab
      ? normalizeAistarslabAspectRatio(rawAspect, defaultAspect)
      : useAigccc
        ? normalizeAigcccAspectRatio(rawAspect)
      : useGeeknowGrok
      ? mapGrokAspectRatio(rawAspect)
      : useJimengWeb
        ? normalizeJimengAspectRatio(rawAspect, defaultAspect)
        : useXyqWeb
          ? normalizeXyqAspectRatio(rawAspect, defaultAspect)
        : useCozeWeb
          ? normalizeCozeAspectRatio(rawAspect, defaultAspect)
        : useFunshionWeb
          ? normalizeFunshionAspectRatio(rawAspect, defaultAspect)
        : useXingyuemengWeb
          ? normalizeXingyuemengAspectRatio(rawAspect, defaultAspect)
        : useDoubaoTraining
          ? normalizeDoubaoTrainingAspectRatio(rawAspect)
          // 入库保留用户横竖屏选择；上游由 adapter 按用户选择下发 ratio（不再强制 adaptive）
          : normalizeSeedanceDisplayAspectRatio(rawAspect, defaultAspect)

  const storedResolution = config.provider === 'volcengine'
    ? normalizeSeedanceResolution(params.resolution, params.model || config.model)
    : useFunshionWeb
      ? normalizeFunshionClarity(params.resolution)
    : useXingyuemengWeb
      ? normalizeXingyuemengResolution(params.resolution)
    : (params.resolution ? String(params.resolution).trim().toLowerCase() || null : null)

  const storedDuration = useDoubaoTraining
    ? normalizeDoubaoTrainingDuration(params.duration)
    : useXyqWeb
      ? normalizeXyqDuration(params.duration, storedModel)
    : useCozeWeb
      ? normalizeCozeDuration(params.duration)
    : useFunshionWeb
      ? normalizeFunshionDuration(params.duration)
    : useXingyuemengWeb
      ? normalizeXingyuemengDuration(params.duration)
    : useAigccc
      ? normalizeAigcccDuration(params.duration)
    : (params.duration || 15)

  const storedStyle = useJimengWeb
    ? (params.jimengSessionId ? `jimeng_session:${params.jimengSessionId}` : null)
    : useXyqWeb
      ? (params.xyqSessionId ? `xyq_key:${params.xyqSessionId}` : null)
    : useCozeWeb
      ? (params.cozeSessionId ? `coze_session:${params.cozeSessionId}` : null)
    : useFunshionWeb
      ? (params.funshionSessionId ? `funshion_session:${params.funshionSessionId}` : null)
    : useXingyuemengWeb
      ? (params.xingyuemengSessionId ? `xingyuemeng_session:${params.xingyuemengSessionId}` : null)
    : useDoubaoTraining
      ? (params.doubaoTrainingSessionId ? `doubao_training_session:${params.doubaoTrainingSessionId}` : null)
      : (params.aistarslabChannel || null)

  const dedupChannelKey = storedStyle
    && /^(jimeng_session|xyq_key|coze_session|funshion_session|xingyuemeng_session|doubao_training_session):/.test(storedStyle)
    ? null
    : storedStyle

  let dedupFingerprint: string | null = null
  if (params.userId) {
    dedupFingerprint = assertNoDuplicateInFlightVideoSubmit({
      userId: params.userId,
      prompt: params.prompt || '',
      model: storedModel,
      provider: config.provider,
      duration: storedDuration,
      aspectRatio,
      resolution: storedResolution,
      referenceMode: params.referenceMode || 'none',
      imageUrl: params.imageUrl,
      firstFrameUrl: params.firstFrameUrl,
      lastFrameUrl: params.lastFrameUrl,
      referenceImageUrls: params.referenceImageUrls || null,
      contentRefs: params.contentRefs || null,
      channelKey: dedupChannelKey,
    }) || null
  }

  try {
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
      duration: storedDuration,
      resolution: storedResolution,
      aspectRatio,
      style: storedStyle,
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
  } finally {
    releaseVideoSubmitDedupLock(dedupFingerprint, params.userId ?? null)
  }
}

async function processVideoGeneration(id: number, config: AIConfig, options?: { allowChengmengFallback?: boolean }) {
  if (config.provider === 'jimeng_web') {
    return processJimengWebVideoGeneration(id)
  }
  if (config.provider === 'xyq_web') {
    return processXyqWebVideoGeneration(id)
  }
  if (config.provider === 'coze_web') {
    return processCozeWebVideoGeneration(id)
  }
  if (config.provider === 'funshion_web') {
    return processFunshionWebVideoGeneration(id)
  }
  if (config.provider === 'xingyuemeng_web') {
    return processXingyuemengWebVideoGeneration(id)
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
    const useAigccc = isAigcccProvider(config.provider)
    const useGeeknowGrok = isGrokVideoModel(record.model || config.model)
      || config.provider === 'geeknow'
      || config.provider === 'qilingze'
      || config.provider === 'chatfire'
    const dramaId = record.dramaId ?? null
    const resolvedImageUrl = useChengmeng || useAistarslab || useAigccc
      ? await resolveChengmengMediaUrl(record.imageUrl, (useAistarslab || useAigccc) ? dramaId : undefined)
      : useGeeknowGrok
        ? await normalizeGrokReferenceUrl(record.imageUrl)
        : await normalizeVideoReferenceUrl(record.imageUrl)
    const resolvedFirstFrameUrl = useChengmeng || useAistarslab || useAigccc
      ? await resolveAigcccMediaUrl(record.firstFrameUrl, (useAistarslab || useAigccc) ? dramaId : undefined)
      : useGeeknowGrok
        ? await normalizeGrokReferenceUrl(record.firstFrameUrl)
        : await normalizeVideoReferenceUrl(record.firstFrameUrl)
    const resolvedLastFrameUrl = useChengmeng || useAistarslab || useAigccc
      ? await resolveAigcccMediaUrl(record.lastFrameUrl, (useAistarslab || useAigccc) ? dramaId : undefined)
      : useGeeknowGrok
        ? await normalizeGrokReferenceUrl(record.lastFrameUrl)
        : await normalizeVideoReferenceUrl(record.lastFrameUrl)
    const resolvedReferenceImageUrls = useChengmeng || useAistarslab || useAigccc
      ? await normalizeAigcccReferenceUrls(record.referenceImageUrls, (useAistarslab || useAigccc) ? dramaId : undefined)
      : useGeeknowGrok
        ? await normalizeGrokReferenceUrls(record.referenceImageUrls)
        : await normalizeVideoReferenceUrls(record.referenceImageUrls, dramaId)
    const resolvedContentRefs = useChengmeng
      ? await normalizeChengmengContentRefs(record.referencePayload)
      : useAistarslab
        ? await normalizeAistarslabContentRefs(record.referencePayload, dramaId)
        : useAigccc
          ? await normalizeAigcccContentRefs(record.referencePayload, dramaId)
        : useGeeknowGrok
          ? await normalizeGrokContentRefs(record.referencePayload)
          : await normalizeVideoContentRefs(record.referencePayload, dramaId)

    if (useChengmeng || useAistarslab || useAigccc) {
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
    } else if (isSeedance2FamilyModel(record.model)) {
      const rawRefs = parseVideoContentRefs(record.referencePayload)
      const rawAudio = rawRefs.filter(ref => ref.type === 'audio')
      const resolvedAudio = resolvedContentRefs.filter(ref => ref.type === 'audio')
      if (rawAudio.length > 0 && resolvedAudio.length === 0) {
        throw new Error('参考音频无法转为公网 URL 或读取失败，请确认音色 MP3 存在，并检查 OSS / PUBLIC_BASE_URL 配置')
      }
    }

    const referencePayloadForRequest = useChengmeng || useAistarslab || useAigccc || useGeeknowGrok
      ? (resolvedContentRefs.length ? JSON.stringify(resolvedContentRefs) : record.referencePayload)
      : (resolvedContentRefs.length ? JSON.stringify(resolvedContentRefs) : record.referencePayload)

    // 使用 Adapter 构建请求（Grok 路径传入压缩后的 data URL，避免原图过大导致 fetch failed）
    const { url, method, headers, body } = adapter.buildGenerateRequest(config, {
      id: record.id,
      model: record.model,
      prompt: record.prompt,
      referenceMode: record.referenceMode,
      imageUrl: resolvedImageUrl,
      firstFrameUrl: resolvedFirstFrameUrl,
      lastFrameUrl: resolvedLastFrameUrl,
      referenceImageUrls: resolvedReferenceImageUrls ? JSON.stringify(resolvedReferenceImageUrls) : null,
      referencePayload: referencePayloadForRequest,
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
    let resp: Response
    try {
      resp = await fetch(url, {
        method,
        headers: isFormData
          ? { Authorization: headers.Authorization || headers.authorization || '' }
          : headers,
        body: isFormData ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      })
    } catch (fetchErr: any) {
      const cause = fetchErr?.cause
      const detail = [
        fetchErr?.message,
        cause?.code,
        cause?.message,
        cause?.errno,
        cause?.syscall,
        cause?.hostname,
      ].filter(Boolean).join(' | ')
      throw new Error(`上游请求失败: ${detail || 'fetch failed'}`)
    }

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

    // 异步模式：更新 taskId，开始轮询（方舟先标 pending=排队中，便于取消）
    const initialStatus = String(config.provider || '').toLowerCase() === 'volcengine'
      || String(config.provider || '').toLowerCase() === 'volcengine_proxy'
      ? 'pending'
      : 'processing'
    db.update(schema.videoGenerations)
      .set({ taskId, status: initialStatus, updatedAt: now() })
      .where(eq(schema.videoGenerations.id, id))
      .run()
    logTaskProgress('VideoTask', 'poll-start', { id, taskId, provider: config.provider, status: initialStatus })

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
      && (
        isChengmengBalanceError(message)
        || /unauthorized|401|鉴权失败|未授权|invalid\s*api\s*key|api[_ ]?key.*invalid/i.test(message)
      )
    ) {
      const candidates = listChengmengVideoFallbackConfigs(config.id)
      let picked: typeof config | null = null
      for (const candidate of candidates) {
        if (!candidate.apiKey) continue
        try {
          await fetchChengmengUserBalance({ baseUrl: candidate.baseUrl, apiKey: candidate.apiKey })
          picked = candidate
          break
        } catch (probeErr: any) {
          logTaskWarn('VideoTask', 'chengmeng-fallback-probe-failed', {
            id,
            candidateId: candidate.id,
            error: String(probeErr?.message || probeErr),
          })
        }
      }
      if (picked?.id && picked.id !== config.id) {
        logTaskWarn('VideoTask', 'chengmeng-balance-fallback', {
          id,
          fromConfigId: config.id,
          toConfigId: picked.id,
          error: message,
        })
        db.update(schema.videoGenerations)
          .set({ configId: picked.id, updatedAt: now() })
          .where(eq(schema.videoGenerations.id, id))
          .run()
        promoteChengmengVideoConfig(picked.id)
        activeVideoSubmissions.delete(id)
        return processVideoGeneration(id, picked, { allowChengmengFallback: false })
      }
      logTaskWarn('VideoTask', 'chengmeng-no-valid-fallback', {
        id,
        fromConfigId: config.id,
        candidates: candidates.map(item => item.id),
        error: message,
      })
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

/** Grok / Imagine 参考图：压缩为 data URL，避免 multipart/JSON 体积过大导致 fetch failed */
async function normalizeGrokReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:image/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  const localPath = normalizeGrokReferencePathSync(raw)
  if (!localPath || localPath.startsWith('http://') || localPath.startsWith('https://')) return localPath
  if (!localPath.startsWith('static/')) return localPath
  try {
    return await readImageAsCompressedDataUrl(localPath, {
      maxWidth: 1024,
      maxHeight: 1024,
      quality: 72,
    })
  } catch (err) {
    logTaskWarn('VideoTask', 'grok-reference-compress-failed', {
      path: localPath,
      error: (err as Error).message,
    })
    return localPath
  }
}

async function normalizeGrokReferenceUrls(raw: string | null | undefined): Promise<string[]> {
  if (!raw?.trim()) return []
  let refs: string[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    refs = []
  }
  if (!Array.isArray(refs)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of refs) {
    const next = await normalizeGrokReferenceUrl(String(item || ''))
    if (!next || seen.has(next)) continue
    seen.add(next)
    out.push(next)
  }
  return out
}

async function normalizeGrokContentRefs(raw: string | null | undefined): Promise<VideoContentRef[]> {
  const refs = parseVideoContentRefs(raw)
  const out: VideoContentRef[] = []
  for (const ref of refs) {
    if (ref.type !== 'image' || !ref.url) continue
    const next = await normalizeGrokReferenceUrl(ref.url)
    if (!next) continue
    out.push({ ...ref, url: next })
  }
  return out
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

async function normalizeVideoContentRefs(
  raw: string | null | undefined,
  dramaId?: number | null,
): Promise<VideoContentRef[]> {
  if (!raw?.trim()) return []
  let refs: VideoContentRef[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(refs)) return []

  // 已认证角色基准图 → asset://（通道2 官方 Seedance）
  const rewrittenUrls = rewriteUrlsToSeedanceAssets(
    refs.map(ref => (ref?.type === 'image' ? String(ref?.url || '') : '')),
    dramaId,
  )
  let rewriteIdx = 0
  refs = refs.map((ref) => {
    if (ref?.type !== 'image') return ref
    const next = rewrittenUrls[rewriteIdx++]
    return next ? { ...ref, url: next } : ref
  })

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
        const next = await normalizeAudioReferenceUrl(audioPath, dramaId)
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

/**
 * 通道2 / 方舟 Seedance 参考音频：
 * - 优先公网 http(s)（与参考视频一致），避免 data URL 触发 Invalid base64 audio_url
 * - 兜底 data URL 时 MIME 须为 audio/mp3|wav（文档要求），不能用 audio/mpeg
 */
async function normalizeAudioReferenceUrl(
  value: string | null | undefined,
  dramaId?: number | null,
): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('asset://')) return raw

  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const resolved = await resolveChengmengMediaUrl(raw, dramaId)
    if (resolved && /^https?:\/\//i.test(resolved)) return resolved

    const localPath = raw.startsWith('/static/') ? raw.slice(1) : raw
    const dataUrl = readFileAsDataUrl(localPath, 8 * 1024 * 1024)
    if (dataUrl) return normalizeSeedanceAudioDataUrl(dataUrl)
    logTaskWarn('VideoTask', 'audio-reference-unresolved', {
      path: localPath,
      hint: '请配置 OSS 或 PUBLIC_BASE_URL，方舟参考音频需可访问 URL',
    })
    return null
  }

  if (raw.startsWith('data:audio/')) return normalizeSeedanceAudioDataUrl(raw)
  return raw
}

/** 方舟文档：data:audio/<mp3|wav>;base64,...（小写格式名） */
function normalizeSeedanceAudioDataUrl(dataUrl: string): string {
  return String(dataUrl || '')
    .replace(/^data:audio\/mpeg;base64,/i, 'data:audio/mp3;base64,')
    .replace(/^data:audio\/mp4;base64,/i, 'data:audio/mp3;base64,')
    .replace(/^data:audio\/x-wav;base64,/i, 'data:audio/wav;base64,')
    .replace(/^data:audio\/wave;base64,/i, 'data:audio/wav;base64,')
}

async function normalizeVideoMediaReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:video/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  // 本地 static 路径需转成公网 URL（OSS / PUBLIC_BASE_URL），火山官方与第三方 Seedance 均要求可访问 URL
  if (raw.startsWith('static/') || raw.startsWith('/static/') || raw.startsWith('data:')) {
    const resolved = await resolveChengmengMediaUrl(raw)
    if (resolved) return resolved
    logTaskWarn('VideoTask', 'video-reference-local-unresolved', { path: raw })
    return null
  }
  return raw
}

async function normalizeVideoReferenceUrls(
  raw: string | null | undefined,
  dramaId?: number | null,
): Promise<string[]> {
  if (!raw) return []
  let refs: string[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    refs = []
  }
  const rewritten = rewriteUrlsToSeedanceAssets(
    Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean))),
    dramaId,
  )
  const normalized = await Promise.all(rewritten.map((item) => normalizeVideoReferenceUrl(item)))
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

function isVideoTerminalLocalStatus(status?: string | null) {
  const s = String(status || '').toLowerCase()
  return s === 'completed' || s === 'failed' || s === 'cancelled' || s === 'expired'
}

function syncVideoIntermediateStatus(id: number, nextStatus: 'pending' | 'processing') {
  const [row] = db.select({ status: schema.videoGenerations.status })
    .from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id))
    .all()
  if (!row || isVideoTerminalLocalStatus(row.status)) return
  if (row.status === nextStatus) return
  db.update(schema.videoGenerations)
    .set({ status: nextStatus, updatedAt: now() })
    .where(eq(schema.videoGenerations.id, id))
    .run()
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
        const [local] = db.select({ status: schema.videoGenerations.status })
          .from(schema.videoGenerations)
          .where(eq(schema.videoGenerations.id, id))
          .all()
        if (!local || isVideoTerminalLocalStatus(local.status)) {
          logTaskProgress('VideoTask', 'poll-stop', { id, taskId, status: local?.status || 'missing' })
          return
        }

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
        if (pollResp.status === 'cancelled') {
          logTaskProgress('VideoTask', 'poll-cancelled', { id, taskId })
          cancelVideoGeneration(id, pollResp.error || '任务已取消')
          return
        }
        if (pollResp.status === 'expired') {
          logTaskProgress('VideoTask', 'poll-expired', { id, taskId })
          expireVideoGeneration(id, pollResp.error || '任务已过期')
          return
        }
        if (pollResp.status === 'pending' || pollResp.status === 'processing') {
          syncVideoIntermediateStatus(id, pollResp.status)
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

/** 取消上游排队任务并退款（方舟仅 queued 可取消） */
export async function cancelVideoTask(id: number, opts?: { userId?: number | null; isAdmin?: boolean }) {
  const [record] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id))
    .all()
  if (!record) throw new Error('视频任务不存在')
  if (opts?.userId != null && !opts.isAdmin && record.userId != null && record.userId !== opts.userId) {
    throw new Error('无权取消该任务')
  }
  if (isVideoTerminalLocalStatus(record.status)) {
    throw new Error('任务已结束，无法取消')
  }
  if (!record.taskId) {
    cancelVideoGeneration(id, '任务已取消（未提交上游）')
    return { ok: true as const, status: 'cancelled' as const }
  }

  const config = resolveVideoTaskConfig(record)
  if (!config) throw new Error('未找到视频服务配置')
  const adapter = getVideoAdapter(config.provider)
  if (typeof adapter.buildCancelRequest !== 'function') {
    throw new Error('当前通道不支持取消上游任务')
  }

  const cancelReq = adapter.buildCancelRequest(config, record.taskId)
  const resp = await fetchAdapterRequest(cancelReq)
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    // 生成中不可取消时，保持本地状态并提示
    if (resp.status === 400) {
      throw new Error(formatVideoProviderError(resp.status, errText, config.provider) || '任务生成中，暂不支持取消')
    }
    throw new Error(formatVideoProviderError(resp.status, errText, config.provider) || `取消失败 HTTP ${resp.status}`)
  }

  cancelVideoGeneration(id, '用户取消任务')
  return { ok: true as const, status: 'cancelled' as const }
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
    await ensureVideoPoster(localPath).catch(() => {})
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

  if (config.provider === 'xyq_web') {
    if (!record.taskId) throw new Error('该记录无 task_id，无法向S通道5查询')
    const poll = await import('./xyq-web-video.js').then(m => m.pollXyqVideoOnce(record.taskId!, record.style))
    if (poll.status === 'completed' && poll.videoUrl) {
      await handleVideoComplete(id, poll.videoUrl, record.duration, record.storyboardId)
    } else if (poll.status === 'failed' || poll.status === 'canceled' || poll.status === 'requires_action') {
      failVideoGeneration(id, poll.error || 'S通道5视频生成失败')
    }
    const [updated] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id)).all()
    return updated || null
  }

  if (config.provider === 'coze_web') {
    if (!record.taskId) throw new Error('该记录无 task_id，无法向S通道7查询')
    const poll = await import('./coze-web-video.js').then(m => m.pollCozeVideoOnce(record.taskId!, record.style))
    if (poll.status === 'completed' && poll.videoUrl) {
      await handleVideoComplete(id, poll.videoUrl, record.duration, record.storyboardId)
    } else if (poll.status === 'failed') {
      failVideoGeneration(id, poll.error || 'S通道7视频生成失败')
    }
    const [updated] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id)).all()
    return updated || null
  }

  if (config.provider === 'funshion_web') {
    if (!record.taskId) throw new Error('该记录无 task_id，无法向S通道8查询')
    const poll = await import('./funshion-web-video.js').then(m => m.pollFunshionVideoOnce(record.taskId!, record.style))
    if (poll.status === 'completed' && poll.videoUrl) {
      await handleVideoComplete(id, poll.videoUrl, record.duration, record.storyboardId)
    } else if (poll.status === 'failed') {
      failVideoGeneration(id, poll.error || 'S通道8视频生成失败')
    }
    const [updated] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id)).all()
    return updated || null
  }

  if (config.provider === 'xingyuemeng_web') {
    if (!record.taskId) throw new Error('该记录无 task_id，无法向S通道9查询')
    const poll = await import('./xingyuemeng-web-video.js').then(m => m.pollXingyuemengVideoOnce(record.taskId!, record.style))
    if (poll.status === 'completed' && poll.videoUrl) {
      await handleVideoComplete(id, poll.videoUrl, record.duration, record.storyboardId)
    } else if (poll.status === 'failed') {
      failVideoGeneration(id, poll.error || 'S通道9视频生成失败')
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
  } else if (pollResp.status === 'cancelled') {
    cancelVideoGeneration(id, pollResp.error || '任务已取消')
  } else if (pollResp.status === 'expired') {
    expireVideoGeneration(id, pollResp.error || '任务已过期')
  } else if (pollResp.status === 'pending' || pollResp.status === 'processing') {
    syncVideoIntermediateStatus(id, pollResp.status)
  }

  const [updated] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id)).all()
  return updated || null
}

/** 服务重启后恢复 processing/pending 任务的轮询（绝不重新 POST 创建） */
export function resumeProcessingVideoTasks() {
  const rows = db.select()
    .from(schema.videoGenerations)
    .all()
    .filter(r => r.status === 'processing' || r.status === 'pending')
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
    if (row.provider === 'xyq_web') {
      logTaskProgress('VideoTask', 'resume-poll', {
        id: row.id,
        taskId: row.taskId,
        provider: row.provider,
      })
      import('./xyq-web-video.js').then(m => {
        m.pollXyqVideoTask(row.id, row.taskId!, row.storyboardId, row.duration, row.style).catch(err => {
          logTaskError('VideoTask', 'resume-poll', { id: row.id, error: err.message })
        })
      })
      continue
    }
    if (row.provider === 'coze_web') {
      logTaskProgress('VideoTask', 'resume-poll', {
        id: row.id,
        taskId: row.taskId,
        provider: row.provider,
      })
      import('./coze-web-video.js').then(m => {
        m.pollCozeVideoTask(row.id, row.taskId!, row.storyboardId, row.duration, row.style).catch(err => {
          logTaskError('VideoTask', 'resume-poll', { id: row.id, error: err.message })
        })
      })
      continue
    }
    if (row.provider === 'funshion_web') {
      logTaskProgress('VideoTask', 'resume-poll', {
        id: row.id,
        taskId: row.taskId,
        provider: row.provider,
      })
      import('./funshion-web-video.js').then(m => {
        m.pollFunshionVideoTask(row.id, row.taskId!, row.storyboardId, row.duration, row.style, row.prompt).catch(err => {
          logTaskError('VideoTask', 'resume-poll', { id: row.id, error: err.message })
        })
      })
      continue
    }
    if (row.provider === 'xingyuemeng_web') {
      logTaskProgress('VideoTask', 'resume-poll', {
        id: row.id,
        taskId: row.taskId,
        provider: row.provider,
      })
      import('./xingyuemeng-web-video.js').then(m => {
        m.pollXingyuemengVideoTask(row.id, row.taskId!, row.storyboardId, row.duration, row.style).catch(err => {
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
