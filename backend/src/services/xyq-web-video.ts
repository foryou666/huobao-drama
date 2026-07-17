import fs from 'fs'
import path from 'path'
import { eq } from 'drizzle-orm'
import {
  XYQ_DEFAULT_VIDEO_MODEL,
  XYQ_REF_LIMITS,
  buildXyqSubmitMessage,
  normalizeXyqAspectRatio,
  normalizeXyqDuration,
  xyqVideoModelLabel,
} from '../constants/xyq-web.js'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { failVideoGeneration } from '../utils/generation-failure.js'
import { getAbsolutePath, parseDataUrl } from '../utils/storage.js'
import { openMediaReadStream } from '../utils/media-download.js'
import { parseVideoContentRefs, type VideoContentRef } from '../utils/seedance-content.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import type { VideoGenerationRecord } from './adapters/types.js'
import {
  decodeXyqTaskId,
  encodeXyqTaskId,
  pollXyqRunOnce,
  submitXyqRun,
  uploadXyqAsset,
} from './xyq-web-client.js'
import { resolveXyqSessionForStyle } from '../utils/xyq-web-video-options.js'
import { getXyqWebSession } from './xyq-web-session.js'

function resolveSessionForRecord(record: VideoGenerationRecord) {
  const session = resolveXyqSessionForStyle(record.style) || getXyqWebSession()
  if (!session) throw new Error('S通道5 Access Key 未配置')
  return session
}

function detectMime(filePath: string, mediaType: 'image' | 'video'): string {
  const ext = path.extname(filePath).toLowerCase()
  if (mediaType === 'video') {
    if (ext === '.mov') return 'video/quicktime'
    if (ext === '.webm') return 'video/webm'
    return 'video/mp4'
  }
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

async function readMediaBuffer(ref: string): Promise<{ buffer: Buffer; filename: string; mimeType: string; mediaType: 'image' | 'video' } | null> {
  const raw = String(ref || '').trim()
  if (!raw) return null

  const parsed = parseDataUrl(raw)
  if (parsed) {
    const mime = parsed.mimeType.toLowerCase()
    const mediaType: 'image' | 'video' = mime.startsWith('video/') ? 'video' : 'image'
    const ext = mediaType === 'video' ? '.mp4' : '.png'
    return {
      buffer: Buffer.from(parsed.data, 'base64'),
      filename: `reference${ext}`,
      mimeType: mime || detectMime(`x${ext}`, mediaType),
      mediaType,
    }
  }

  const staticPath = raw.replace(/^\/+/, '')
  if (staticPath.startsWith('static/')) {
    const absPath = getAbsolutePath(staticPath)
    const mediaType: 'image' | 'video' = /\.(mp4|mov|webm|m4v)$/i.test(staticPath) ? 'video' : 'image'
    if (fs.existsSync(absPath)) {
      const ext = path.extname(absPath).toLowerCase() || (mediaType === 'video' ? '.mp4' : '.png')
      return {
        buffer: fs.readFileSync(absPath),
        filename: `reference${ext}`,
        mimeType: detectMime(absPath, mediaType),
        mediaType,
      }
    }
    try {
      const { stream } = await openMediaReadStream(staticPath)
      const chunks: Buffer[] = []
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        stream.on('end', () => resolve())
        stream.on('error', reject)
      })
      const ext = path.extname(staticPath).toLowerCase() || (mediaType === 'video' ? '.mp4' : '.png')
      return {
        buffer: Buffer.concat(chunks),
        filename: `reference${ext}`,
        mimeType: detectMime(staticPath, mediaType),
        mediaType,
      }
    } catch {
      return null
    }
  }

  return null
}

function collectRefs(record: VideoGenerationRecord): VideoContentRef[] {
  const refs: VideoContentRef[] = []
  const seen = new Set<string>()
  const push = (type: 'image' | 'video' | 'audio', url?: string | null) => {
    const next = String(url || '').trim()
    if (!next || seen.has(`${type}:${next}`)) return
    seen.add(`${type}:${next}`)
    refs.push({ type, url: next })
  }

  if (record.referenceMode === 'single' && record.imageUrl) push('image', record.imageUrl)
  if (record.referenceMode === 'first_last') {
    push('image', record.firstFrameUrl)
    push('image', record.lastFrameUrl)
  }
  if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
    try {
      const list = typeof record.referenceImageUrls === 'string'
        ? JSON.parse(record.referenceImageUrls)
        : record.referenceImageUrls
      if (Array.isArray(list)) list.forEach((url: string) => push('image', url))
    } catch { /* ignore */ }
  }

  for (const ref of parseVideoContentRefs(record.referencePayload)) {
    if (ref.type === 'image' || ref.type === 'video') push(ref.type, ref.url)
  }

  const images = refs.filter(r => r.type === 'image').slice(0, XYQ_REF_LIMITS.images)
  const videos = refs.filter(r => r.type === 'video').slice(0, XYQ_REF_LIMITS.videos)
  return [...images, ...videos]
}

async function uploadRefs(session: ReturnType<typeof getXyqWebSession>, refs: VideoContentRef[]): Promise<string[]> {
  if (!session) return []
  const assetIds: string[] = []
  for (const ref of refs) {
    const media = await readMediaBuffer(ref.url)
    if (!media) continue
    const assetId = await uploadXyqAsset(session, {
      buffer: media.buffer,
      filename: media.filename,
      mimeType: media.mimeType,
    })
    assetIds.push(assetId)
  }
  return assetIds
}

export async function submitXyqVideo(record: VideoGenerationRecord): Promise<string> {
  const session = resolveSessionForRecord(record)
  const refs = collectRefs(record)
  const assetIds = refs.length ? await uploadRefs(session, refs) : []
  const message = buildXyqSubmitMessage({
    model: record.model,
    prompt: String(record.prompt || ''),
    duration: record.duration,
    aspectRatio: record.aspectRatio,
    hasAssets: assetIds.length > 0,
  })

  logTaskPayload('XyqVideo', 'submit', {
    recordId: record.id,
    model: record.model,
    label: xyqVideoModelLabel(record.model),
    duration: normalizeXyqDuration(record.duration),
    ratio: normalizeXyqAspectRatio(record.aspectRatio),
    assetCount: assetIds.length,
  })

  const result = await submitXyqRun(session, { message, assetIds })
  return encodeXyqTaskId(result.threadId, result.runId)
}

export async function pollXyqVideoOnce(taskId: string, style?: string | null) {
  const session = resolveXyqSessionForStyle(style) || getXyqWebSession()
  if (!session) throw new Error('S通道5 Access Key 未配置')
  const decoded = decodeXyqTaskId(taskId)
  if (!decoded) throw new Error('S通道5 taskId 无效')
  return pollXyqRunOnce(session, decoded.threadId, decoded.runId)
}

export async function pollXyqVideoTask(
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
      logTaskProgress('VideoTask', 'xyq-poll', { id, taskId, attempt: i + 1 })
      const poll = await pollXyqVideoOnce(taskId, style)
      if (poll.status === 'completed' && poll.videoUrl) {
        logTaskSuccess('VideoTask', 'xyq-complete', { id, taskId, videoUrl: poll.videoUrl })
        const { handleVideoComplete } = await import('./video-generation.js')
        await handleVideoComplete(id, poll.videoUrl, duration, storyboardId)
        return
      }
      if (poll.status === 'failed' || poll.status === 'canceled' || poll.status === 'requires_action') {
        failVideoGeneration(id, poll.error || 'S通道5视频生成失败')
        return
      }
    } catch (err: any) {
      logTaskWarn('VideoTask', 'xyq-poll-retry', { id, taskId, attempt: i + 1, error: err.message })
      if (i >= 179) {
        failVideoGeneration(id, `S通道5轮询超时: ${err.message}`)
        return
      }
    }
  }
  failVideoGeneration(id, 'S通道5视频生成超时')
}

export async function processXyqWebVideoGeneration(id: number) {
  const [record] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id)).all()
  if (!record) return

  try {
    logTaskProgress('VideoTask', 'xyq-submit', { id, model: record.model })
    const taskId = await submitXyqVideo(record as VideoGenerationRecord)
    db.update(schema.videoGenerations)
      .set({ taskId, status: 'processing', updatedAt: now() })
      .where(eq(schema.videoGenerations.id, id))
      .run()
    pollXyqVideoTask(id, taskId, record.storyboardId, record.duration, record.style).catch(err => {
      logTaskError('VideoTask', 'xyq-poll', { id, error: err.message })
    })
  } catch (err: any) {
    logTaskError('VideoTask', 'xyq-submit', { id, error: err.message })
    failVideoGeneration(id, err.message)
  }
}

export function buildXyqVirtualConfig(model?: string | null) {
  return {
    id: 0,
    provider: 'xyq_web',
    baseUrl: 'https://xyq.jianying.com',
    apiKey: '',
    model: model || XYQ_DEFAULT_VIDEO_MODEL,
    settings: {},
  }
}
