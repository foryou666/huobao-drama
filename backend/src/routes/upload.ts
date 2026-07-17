import { Hono } from 'hono'
import fs from 'fs'
import { success, badRequest } from '../utils/response.js'
import { saveUploadedFile } from '../utils/storage.js'
import { resolveMediaFilePath } from '../utils/media-path.js'
import { thumbPathForSource } from '../utils/thumbnail.js'
import { trySyncUploadImageToOss } from '../utils/oss-entity-sync.js'
import { createReferenceUploadAsset } from '../services/asset-library.js'
import { getAudioDurationSeconds, validateVoiceRefDuration } from '../utils/audio-duration.js'

const app = new Hono()

// POST /upload/image — 视频参考图：默认入库 reference 类，同步 OSS
app.post('/image', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return badRequest(c, 'file is required')
  }

  const dramaIdRaw = body['drama_id']
  const dramaId = dramaIdRaw != null && String(dramaIdRaw).trim() !== ''
    ? Number(dramaIdRaw)
    : null

  const buffer = await file.arrayBuffer()
  const path = await saveUploadedFile(buffer, 'uploads', file.name)

  let ossUrl: string | null = null
  try {
    ossUrl = await trySyncUploadImageToOss(path, dramaId)
  } catch (err: any) {
    // OSS 失败仍保留本地文件并入库，便于参考图库复用
    console.warn('[upload/image] OSS sync failed:', err?.message || err)
  }

  let assetId: number | null = null
  try {
    assetId = createReferenceUploadAsset({
      dramaId: Number.isFinite(dramaId) && dramaId! > 0 ? dramaId : null,
      localPath: path,
      originalName: file.name,
    })
  } catch (err: any) {
    console.error('[upload/image] reference asset create failed:', err?.message || err)
    return badRequest(c, err?.message || '参考图入库失败')
  }

  return success(c, {
    url: `/${path}`,
    path,
    thumbnail_url: thumbPathForSource(path),
    oss_url: ossUrl,
    asset_id: assetId,
    name: file.name.replace(/\.[^.]+$/, '') || '参考图',
  })
})

// POST /upload/video — 视频参考素材：同步 OSS 供 Seedance VIP 等第三方拉取
app.post('/video', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return badRequest(c, 'file is required')
  }

  const mime = String(file.type || '').toLowerCase()
  const lowerName = String(file.name || '').toLowerCase()
  const isVideo = mime.startsWith('video/')
    || lowerName.endsWith('.mp4')
    || lowerName.endsWith('.mov')
    || lowerName.endsWith('.webm')
    || lowerName.endsWith('.m4v')
  if (!isVideo) {
    return badRequest(c, '仅支持 MP4 / MOV / WebM / M4V 视频')
  }

  const dramaIdRaw = body['drama_id']
  const dramaId = dramaIdRaw != null && String(dramaIdRaw).trim() !== ''
    ? Number(dramaIdRaw)
    : null

  const buffer = await file.arrayBuffer()
  const path = await saveUploadedFile(buffer, 'uploads', file.name)

  let ossUrl: string | null = null
  try {
    ossUrl = await trySyncUploadImageToOss(path, dramaId)
  } catch (err: any) {
    console.warn('[upload/video] OSS sync failed:', err?.message || err)
  }

  return success(c, {
    url: `/${path}`,
    path,
    oss_url: ossUrl,
    name: file.name.replace(/\.[^.]+$/, '') || '参考视频',
  })
})

function isVoiceRefAudioFile(mime: string, lowerName: string) {
  if (mime.startsWith('audio/')) return true
  return ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm'].some(ext => lowerName.endsWith(ext))
}

// POST /upload/audio — TTS 参考音色（临时上传，不入资产库）
app.post('/audio', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || !(file instanceof File)) {
    return badRequest(c, 'file is required')
  }

  const mime = String(file.type || '').toLowerCase()
  const lowerName = String(file.name || '').toLowerCase()
  if (!isVoiceRefAudioFile(mime, lowerName)) {
    return badRequest(c, '仅支持 MP3 / WAV / M4A 等常见音频格式')
  }

  const buffer = await file.arrayBuffer()
  const path = await saveUploadedFile(buffer, 'uploads/tts-voice-ref', file.name)

  const duration = await getAudioDurationSeconds(path)
  const durationError = validateVoiceRefDuration(duration)
  if (durationError) {
    const abs = resolveMediaFilePath(path)
    if (abs && fs.existsSync(abs)) fs.unlinkSync(abs)
    return badRequest(c, durationError)
  }

  const displayName = file.name.replace(/\.[^.]+$/, '') || '参考音色'

  return success(c, {
    url: `/${path}`,
    path,
    name: displayName,
    duration_sec: duration,
  })
})

export default app
