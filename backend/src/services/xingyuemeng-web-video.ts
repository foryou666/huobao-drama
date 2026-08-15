import { eq } from 'drizzle-orm'
import {
  XINGYUEMENG_DEFAULT_VIDEO_MODEL,
  XINGYUEMENG_REF_LIMITS,
  normalizeXingyuemengAspectRatio,
  normalizeXingyuemengDuration,
  resolveXingyuemengUpstreamModelName,
  xingyuemengVideoModelLabel,
} from '../constants/xingyuemeng-web.js'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { failVideoGeneration } from '../utils/generation-failure.js'
import { resolveChengmengMediaUrl } from '../utils/chengmeng-content.js'
import { ensureApiTrimmedAudioPath } from '../utils/audio-trim.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'
import type { VideoContentRef } from '../utils/seedance-content.js'
import type { VideoGenerationRecord } from './adapters/types.js'
import {
  buildXingyuemengGenerateBody,
  createXingyuemengStoryboardAsset,
  pollXingyuemengAsset,
  submitXingyuemengVideoTask,
  uploadXingyuemengFile,
} from './xingyuemeng-web-client.js'
import { getXingyuemengWebSession } from './xingyuemeng-web-session.js'
import {
  encodeXingyuemengSessionStyle,
  parseXingyuemengAssetIdFromStyle,
  resolveXingyuemengSessionForStyle,
} from '../utils/xingyuemeng-web-video-options.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_ROOT = path.resolve(__dirname, '../../../data')

function resolveSessionForRecord(record: VideoGenerationRecord) {
  const session = resolveXingyuemengSessionForStyle(record.style) || getXingyuemengWebSession()
  if (!session) throw new Error('S通道9 未配置 Token')
  return session
}

async function readLocalMediaBuffer(localOrUrl: string): Promise<{ buf: Buffer; filename: string; mime: string }> {
  const raw = String(localOrUrl || '').trim()
  if (/^https?:\/\//i.test(raw)) {
    const resp = await fetch(raw)
    if (!resp.ok) throw new Error(`下载参考素材失败 HTTP ${resp.status}`)
    const buf = Buffer.from(await resp.arrayBuffer())
    const filename = path.basename(new URL(raw).pathname) || `ref-${Date.now()}.bin`
    const mime = resp.headers.get('content-type') || 'application/octet-stream'
    return { buf, filename, mime }
  }
  const abs = path.isAbsolute(raw) ? raw : path.resolve(DATA_ROOT, raw.replace(/^\/+/, ''))
  if (!fs.existsSync(abs)) throw new Error(`本地素材不存在: ${raw}`)
  const buf = fs.readFileSync(abs)
  const filename = path.basename(abs)
  const ext = path.extname(filename).toLowerCase()
  const mime = ext === '.png' ? 'image/png'
    : (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg'
      : ext === '.webp' ? 'image/webp'
        : ext === '.mp4' ? 'video/mp4'
          : ext === '.mp3' ? 'audio/mpeg'
            : ext === '.wav' ? 'audio/wav'
              : 'application/octet-stream'
  return { buf, filename, mime }
}

async function resolveRefsForSubmit(
  session: NonNullable<ReturnType<typeof getXingyuemengWebSession>>,
  refs: VideoContentRef[],
  dramaId?: number | null,
): Promise<VideoContentRef[]> {
  const limits = XINGYUEMENG_REF_LIMITS
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
    const publicUrl = await resolveChengmengMediaUrl(localPath, dramaId)
    const source = publicUrl || localPath
    try {
      const { buf, filename, mime } = await readLocalMediaBuffer(source)
      const uploaded = await uploadXingyuemengFile(session, buf, filename, mime)
      resolved.push({ ...ref, url: uploaded })
    } catch (err: any) {
      if (/^https?:\/\//i.test(source)) {
        resolved.push({ ...ref, url: source })
      } else {
        const detail = String(err?.message || err || '').trim()
        throw new Error(`参考素材无法上传到星月梦: ${ref.url}${detail ? `（${detail}）` : ''}`)
      }
    }
  }
  return resolved
}

function collectRefsFromRecord(record: VideoGenerationRecord): VideoContentRef[] {
  const refs: VideoContentRef[] = []
  const push = (type: VideoContentRef['type'], url?: string | null) => {
    const value = String(url || '').trim()
    if (!value || value.startsWith('[') || value.startsWith('{') || value.endsWith(']') || value.endsWith('}')) return
    if (value.startsWith('"') || value.endsWith('"')) return
    refs.push({ type, url: value.replace(/^"+|"+$/g, '') })
  }
  try {
    const payload = record.referencePayload ? JSON.parse(String(record.referencePayload)) : null
    const list = Array.isArray(payload) ? payload
      : (Array.isArray(payload?.content) ? payload.content
        : (Array.isArray(payload?.refs) ? payload.refs : []))
    for (const item of list) {
      const type = String(item?.type || '').toLowerCase()
      const url = item?.url || item?.image_url || item?.video_url || item?.audio_url
      if (type === 'image' || type === 'video' || type === 'audio') push(type as any, url)
    }
  } catch { /* ignore */ }

  if (!refs.length) {
    const rawImages = String(record.referenceImageUrls || '').trim()
    let images: string[] = []
    if (rawImages.startsWith('[')) {
      try {
        const parsed = JSON.parse(rawImages)
        if (Array.isArray(parsed)) images = parsed.map(v => String(v || '').trim()).filter(Boolean)
      } catch { /* fall through */ }
    }
    if (!images.length) {
      images = rawImages.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    }
    for (const url of images) push('image', url)
    push('image', record.imageUrl)
    push('image', record.firstFrameUrl)
    push('image', record.lastFrameUrl)
  }
  return refs
}

export async function submitXingyuemengVideo(record: VideoGenerationRecord): Promise<string> {
  const session = resolveSessionForRecord(record)
  const { assetId, projectId, episodeId } = await createXingyuemengStoryboardAsset(session)
  const rawRefs = collectRefsFromRecord(record)
  const refs = await resolveRefsForSubmit(session, rawRefs, record.dramaId)
  const body = buildXingyuemengGenerateBody({
    model: record.model,
    prompt: String(record.prompt || ''),
    duration: record.duration,
    aspectRatio: record.aspectRatio,
    resolution: record.resolution,
    refs,
  })

  logTaskPayload('XingyuemengVideo', 'submit', {
    recordId: record.id,
    model: record.model,
    upstreamModel: resolveXingyuemengUpstreamModelName(record.model),
    label: xingyuemengVideoModelLabel(record.model),
    duration: normalizeXingyuemengDuration(record.duration),
    ratio: normalizeXingyuemengAspectRatio(record.aspectRatio),
    projectId,
    episodeId,
    assetId,
    refCount: refs.length,
  })

  const style = encodeXingyuemengSessionStyle(session.id, assetId)
  db.update(schema.videoGenerations)
    .set({ style, updatedAt: now() })
    .where(eq(schema.videoGenerations.id, record.id))
    .run()

  return submitXingyuemengVideoTask(session, assetId, body)
}

export async function pollXingyuemengVideoOnce(taskId: string, style?: string | null) {
  const session = resolveXingyuemengSessionForStyle(style) || getXingyuemengWebSession()
  if (!session) throw new Error('S通道9 未配置 Token')
  const assetId = parseXingyuemengAssetIdFromStyle(style)
  if (!assetId) throw new Error('缺少星月梦 assetId')
  void taskId
  return pollXingyuemengAsset(session, assetId)
}

export async function pollXingyuemengVideoTask(
  id: number,
  taskId: string,
  storyboardId?: number | null,
  duration?: number | null,
  style?: string | null,
) {
  await new Promise(r => setTimeout(r, 5000))
  for (let i = 0; i < 180; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 0 : 8000))
    try {
      logTaskProgress('VideoTask', 'xingyuemeng-poll', { id, taskId, attempt: i + 1 })
      const session = resolveXingyuemengSessionForStyle(style) || getXingyuemengWebSession()
      if (session && taskId) {
        try {
          const { xingyuemengRequest } = await import('./xingyuemeng-web-client.js')
          await xingyuemengRequest(session, 'POST', `/v1/resource-generation/task/${encodeURIComponent(taskId)}`, {})
        } catch { /* optional heartbeat */ }
      }
      const poll = await pollXingyuemengVideoOnce(taskId, style)
      if (poll.status === 'completed' && poll.videoUrl) {
        logTaskSuccess('VideoTask', 'xingyuemeng-complete', { id, taskId, videoUrl: poll.videoUrl })
        const { handleVideoComplete } = await import('./video-generation.js')
        await handleVideoComplete(id, poll.videoUrl, duration, storyboardId)
        return
      }
      if (poll.status === 'failed') {
        failVideoGeneration(id, poll.error || 'S通道9视频生成失败')
        return
      }
    } catch (err: any) {
      logTaskError('VideoTask', 'xingyuemeng-poll-retry', { id, taskId, attempt: i + 1, error: err.message })
      if (i >= 179) {
        failVideoGeneration(id, `S通道9轮询超时: ${err.message}`)
        return
      }
    }
  }
  failVideoGeneration(id, 'S通道9视频生成超时')
}

export async function processXingyuemengWebVideoGeneration(id: number) {
  const [record] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id)).all()
  if (!record) return
  if (record.status === 'completed' || record.status === 'failed') return

  try {
    logTaskProgress('VideoTask', 'xingyuemeng-submit', { id, model: record.model })
    const taskId = record.taskId || await submitXingyuemengVideo(record as any)
    if (!record.taskId) {
      db.update(schema.videoGenerations)
        .set({ taskId, status: 'processing', updatedAt: now() })
        .where(eq(schema.videoGenerations.id, id))
        .run()
      logTaskSuccess('VideoTask', 'xingyuemeng-submitted', { id, taskId })
    }
    const [fresh] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id)).all()
    pollXingyuemengVideoTask(
      id,
      taskId,
      record.storyboardId,
      record.duration,
      fresh?.style ?? record.style,
    ).catch(err => {
      logTaskError('VideoTask', 'xingyuemeng-poll', { id, error: err.message })
    })
  } catch (err: any) {
    logTaskError('VideoTask', 'xingyuemeng-submit', { id, error: err.message })
    failVideoGeneration(id, err.message)
  }
}

export function buildXingyuemengVirtualConfig(model?: string | null) {
  return {
    id: 0,
    provider: 'xingyuemeng_web',
    baseUrl: 'https://s1.xingyuemeng.com/api',
    apiKey: '',
    model: model || XINGYUEMENG_DEFAULT_VIDEO_MODEL,
    settings: {},
  }
}
