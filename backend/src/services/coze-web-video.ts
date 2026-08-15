import { eq } from 'drizzle-orm'
import {
  COZE_DEFAULT_VIDEO_MODEL,
  COZE_REF_LIMITS,
  cozeVideoModelLabel,
  normalizeCozeAspectRatio,
  normalizeCozeDuration,
  resolveCozeUpstreamModel,
} from '../constants/coze-web.js'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { failVideoGeneration } from '../utils/generation-failure.js'
import { resolveChengmengMediaUrl } from '../utils/chengmeng-content.js'
import { ensureApiTrimmedAudioPath } from '../utils/audio-trim.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import type { VideoContentRef } from '../utils/seedance-content.js'
import type { VideoGenerationRecord } from './adapters/types.js'
import {
  buildCozeGenerateBody,
  collectRefsFromRecordFields,
  parseCozePollStatus,
  pollCozeVideoTask as pollCozeTaskApi,
  submitCozeVideoTask,
} from './coze-web-client.js'
import { resolveCozeSessionForStyle } from '../utils/coze-web-video-options.js'
import { getCozeWebSession } from './coze-web-session.js'

function resolveSessionForRecord(record: VideoGenerationRecord) {
  const session = resolveCozeSessionForStyle(record.style) || getCozeWebSession()
  if (!session) throw new Error('S通道7 未配置 Cookie 或 PAT')
  return session
}

async function resolveRefsForSubmit(
  refs: VideoContentRef[],
  dramaId?: number | null,
): Promise<VideoContentRef[]> {
  const limits = COZE_REF_LIMITS
  const images = refs.filter(r => r.type === 'image').slice(0, limits.images)
  const videos = refs.filter(r => r.type === 'video').slice(0, limits.videos)
  const audios = refs.filter(r => r.type === 'audio').slice(0, limits.audios)
  const ordered = [...images, ...videos, ...audios]

  const resolved: VideoContentRef[] = []
  for (const ref of ordered) {
    let localPath = ref.url
    if (ref.type === 'audio') {
      localPath = await ensureApiTrimmedAudioPath(ref.url)
    }
    const url = await resolveChengmengMediaUrl(localPath, dramaId)
    if (url) resolved.push({ ...ref, url })
  }
  return resolved
}

export async function submitCozeVideo(record: VideoGenerationRecord): Promise<string> {
  const session = resolveSessionForRecord(record)
  const rawRefs = collectRefsFromRecordFields({
    referenceMode: record.referenceMode,
    imageUrl: record.imageUrl,
    firstFrameUrl: record.firstFrameUrl,
    lastFrameUrl: record.lastFrameUrl,
    referenceImageUrls: record.referenceImageUrls,
    referencePayload: record.referencePayload,
  })
  const refs = await resolveRefsForSubmit(rawRefs, record.dramaId)
  const body = buildCozeGenerateBody({
    model: record.model,
    prompt: String(record.prompt || ''),
    duration: record.duration,
    aspectRatio: record.aspectRatio,
    resolution: record.resolution,
    refs,
    baseUrl: session.baseUrl,
  })

  logTaskPayload('CozeVideo', 'submit', {
    recordId: record.id,
    model: record.model,
    upstreamModel: resolveCozeUpstreamModel(record.model),
    label: cozeVideoModelLabel(record.model),
    duration: normalizeCozeDuration(record.duration),
    ratio: normalizeCozeAspectRatio(record.aspectRatio),
    refCount: refs.length,
  })

  return submitCozeVideoTask(session, body)
}

export async function pollCozeVideoOnce(taskId: string, style?: string | null) {
  const session = resolveCozeSessionForStyle(style) || getCozeWebSession()
  if (!session) throw new Error('S通道7 未配置 Cookie 或 PAT')
  const result = await pollCozeTaskApi(session, taskId)
  return parseCozePollStatus(result)
}

export async function pollCozeVideoTask(
  id: number,
  taskId: string,
  storyboardId?: number | null,
  duration?: number | null,
  style?: string | null,
) {
  await new Promise(r => setTimeout(r, 5000))
  for (let i = 0; i < 180; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 0 : 10000))
    try {
      logTaskProgress('VideoTask', 'coze-poll', { id, taskId, attempt: i + 1 })
      const poll = await pollCozeVideoOnce(taskId, style)
      if (poll.status === 'completed' && poll.videoUrl) {
        logTaskSuccess('VideoTask', 'coze-complete', { id, taskId, videoUrl: poll.videoUrl })
        const { handleVideoComplete } = await import('./video-generation.js')
        await handleVideoComplete(id, poll.videoUrl, duration, storyboardId)
        return
      }
      if (poll.status === 'failed') {
        failVideoGeneration(id, poll.error || 'S通道7视频生成失败')
        return
      }
    } catch (err: any) {
      logTaskWarn('VideoTask', 'coze-poll-retry', { id, taskId, attempt: i + 1, error: err.message })
      if (i >= 179) {
        failVideoGeneration(id, `S通道7轮询超时: ${err.message}`)
        return
      }
    }
  }
  failVideoGeneration(id, 'S通道7视频生成超时')
}

export async function processCozeWebVideoGeneration(id: number) {
  const [record] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id)).all()
  if (!record) return

  try {
    logTaskProgress('VideoTask', 'coze-submit', { id, model: record.model })
    const taskId = await submitCozeVideo(record as VideoGenerationRecord)
    db.update(schema.videoGenerations)
      .set({ taskId, status: 'processing', updatedAt: now() })
      .where(eq(schema.videoGenerations.id, id))
      .run()
    pollCozeVideoTask(id, taskId, record.storyboardId, record.duration, record.style).catch(err => {
      logTaskError('VideoTask', 'coze-poll', { id, error: err.message })
    })
  } catch (err: any) {
    logTaskError('VideoTask', 'coze-submit', { id, error: err.message })
    failVideoGeneration(id, err.message)
  }
}

export function buildCozeVirtualConfig(model?: string | null) {
  return {
    id: 0,
    provider: 'coze_web',
    baseUrl: 'https://api.coze.cn',
    apiKey: '',
    model: model || COZE_DEFAULT_VIDEO_MODEL,
    settings: {},
  }
}
