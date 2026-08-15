import fs from 'fs'
import path from 'path'
import { eq } from 'drizzle-orm'
import {
  XYQ_VIDEO_PART_AGENT,
  XYQ_VIDEO_MODELS,
  XYQ_DEFAULT_VIDEO_MODEL,
  buildXyqSubmitMessage,
  buildXyqVideoPartToolParam,
  normalizeXyqAspectRatio,
  normalizeXyqDuration,
  normalizeXyqResolution,
  resolveXyqUpstreamVideoPartModelId,
  xyqRefLimitsForModel,
  xyqVideoModelLabel,
  type XyqVideoPartAsset,
} from '../constants/xyq-web.js'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { failVideoGeneration } from '../utils/generation-failure.js'
import { getAbsolutePath, parseDataUrl } from '../utils/storage.js'
import { openMediaReadStream } from '../utils/media-download.js'
import { parseVideoContentRefs, type VideoContentRef } from '../utils/seedance-content.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import {
  ensureS25DiscountRefVideo,
  isS25SilentDiscountRefPath,
  S25_DISCOUNT_REF_VIDEO_PATH,
} from '../utils/s25-discount-ref.js'
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

type XyqMediaType = 'image' | 'video' | 'audio'

function detectMediaTypeFromPath(filePath: string): XyqMediaType {
  if (/\.(mp4|mov|webm|m4v)$/i.test(filePath)) return 'video'
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(filePath)) return 'audio'
  return 'image'
}

function detectMime(filePath: string, mediaType: XyqMediaType): string {
  const ext = path.extname(filePath).toLowerCase()
  if (mediaType === 'video') {
    if (ext === '.mov') return 'video/quicktime'
    if (ext === '.webm') return 'video/webm'
    return 'video/mp4'
  }
  if (mediaType === 'audio') {
    if (ext === '.wav') return 'audio/wav'
    if (ext === '.m4a') return 'audio/mp4'
    if (ext === '.aac') return 'audio/aac'
    if (ext === '.ogg') return 'audio/ogg'
    if (ext === '.flac') return 'audio/flac'
    return 'audio/mpeg'
  }
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

function defaultExt(mediaType: XyqMediaType): string {
  if (mediaType === 'video') return '.mp4'
  if (mediaType === 'audio') return '.mp3'
  return '.png'
}

async function readMediaBuffer(ref: string): Promise<{ buffer: Buffer; filename: string; mimeType: string; mediaType: XyqMediaType } | null> {
  const raw = String(ref || '').trim()
  if (!raw) return null

  const parsed = parseDataUrl(raw)
  if (parsed) {
    const mime = parsed.mimeType.toLowerCase()
    const mediaType: XyqMediaType = mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : 'image'
    const ext = defaultExt(mediaType)
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
    const mediaType = detectMediaTypeFromPath(staticPath)
    if (fs.existsSync(absPath)) {
      const ext = path.extname(absPath).toLowerCase() || defaultExt(mediaType)
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
      const ext = path.extname(staticPath).toLowerCase() || defaultExt(mediaType)
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
    if (ref.type === 'image' || ref.type === 'video' || ref.type === 'audio') push(ref.type, ref.url)
  }

  const limits = xyqRefLimitsForModel(record.model)
  let images = refs.filter(r => r.type === 'image')
  let videos = refs.filter(r => r.type === 'video')
  let audios = refs.filter(r => r.type === 'audio')

  // Seedance 2.5：无用户参考视频时静默附加短视频，触发上游参考视频优惠价
  const isS25 = String(record.model || '').trim() === XYQ_VIDEO_MODELS.SEEDANCE_2_5
  if (isS25 && videos.length === 0) {
    const discountPath = ensureS25DiscountRefVideo()
    if (discountPath) {
      const maxTotal = limits.maxTotal
      const currentTotal = images.length + audios.length
      if (maxTotal != null && currentTotal >= maxTotal && images.length > 0) {
        const dropped = images[images.length - 1]
        const dropIdx = refs.findIndex(r => r.type === 'image' && r.url === dropped.url)
        if (dropIdx >= 0) refs.splice(dropIdx, 1)
        seen.delete(`image:${dropped.url}`)
      }
      push('video', discountPath)
      images = refs.filter(r => r.type === 'image')
      videos = refs.filter(r => r.type === 'video')
      audios = refs.filter(r => r.type === 'audio')
    } else {
      logTaskWarn('XyqVideo', 's25-discount-ref-missing', { path: S25_DISCOUNT_REF_VIDEO_PATH })
    }
  }

  images = images.slice(0, limits.images)
  videos = videos.slice(0, limits.videos)
  audios = audios.slice(0, limits.audios)
  let ordered = [...images, ...videos, ...audios]
  if (limits.maxTotal != null && ordered.length > limits.maxTotal) {
    ordered = ordered.slice(0, limits.maxTotal)
  }
  return ordered
}

async function uploadRefs(
  session: NonNullable<ReturnType<typeof getXyqWebSession>>,
  refs: VideoContentRef[],
): Promise<{
  assetIds: string[]
  images: XyqVideoPartAsset[]
  videos: XyqVideoPartAsset[]
  audios: XyqVideoPartAsset[]
}> {
  const assetIds: string[] = []
  const images: XyqVideoPartAsset[] = []
  const videos: XyqVideoPartAsset[] = []
  const audios: XyqVideoPartAsset[] = []

  for (const ref of refs) {
    const media = await readMediaBuffer(ref.url)
    if (!media) continue
    const assetId = await uploadXyqAsset(session, {
      buffer: media.buffer,
      filename: media.filename,
      mimeType: media.mimeType,
    })
    assetIds.push(assetId)
    const item: XyqVideoPartAsset = {
      asset_id: assetId,
      name: media.filename,
    }
    if (ref.type === 'video' || media.mediaType === 'video') videos.push(item)
    else if (ref.type === 'audio' || media.mediaType === 'audio') audios.push(item)
    else images.push(item)
  }
  return { assetIds, images, videos, audios }
}

export async function submitXyqVideo(record: VideoGenerationRecord): Promise<string> {
  const session = resolveSessionForRecord(record)
  const refs = collectRefs(record)
  const uploaded = refs.length
    ? await uploadRefs(session, refs)
    : { assetIds: [] as string[], images: [] as XyqVideoPartAsset[], videos: [] as XyqVideoPartAsset[], audios: [] as XyqVideoPartAsset[] }

  const duration = normalizeXyqDuration(record.duration, record.model)
  const ratio = normalizeXyqAspectRatio(record.aspectRatio)
  const resolution = normalizeXyqResolution(record.resolution)
  const upstreamModel = resolveXyqUpstreamVideoPartModelId(record.model)
  const prompt = String(record.prompt || '').trim()
  const message = buildXyqSubmitMessage({
    model: record.model,
    prompt,
    duration,
    aspectRatio: ratio,
    hasAssets: uploaded.assetIds.length > 0,
  })
  const videoPartToolParam = buildXyqVideoPartToolParam({
    model: record.model,
    prompt,
    duration,
    aspectRatio: ratio,
    resolution,
    images: uploaded.images,
    videos: uploaded.videos,
    audios: uploaded.audios,
  })

  logTaskPayload('XyqVideo', 'submit', {
    recordId: record.id,
    model: record.model,
    label: xyqVideoModelLabel(record.model),
    upstreamModel,
    agent: XYQ_VIDEO_PART_AGENT,
    duration,
    ratio,
    resolution,
    assetCount: uploaded.assetIds.length,
    imageCount: uploaded.images.length,
    videoCount: uploaded.videos.length,
    audioCount: uploaded.audios.length,
    silentDiscountVideo: String(record.model || '').trim() === XYQ_VIDEO_MODELS.SEEDANCE_2_5
      && refs.some(r => r.type === 'video' && isS25SilentDiscountRefPath(r.url)),
  })

  const result = await submitXyqRun(session, {
    message,
    assetIds: uploaded.assetIds,
    agentName: XYQ_VIDEO_PART_AGENT,
    videoPartToolParam,
  })
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
