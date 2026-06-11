import ffmpeg from 'fluent-ffmpeg'
import { parseFile } from 'music-metadata'
import path from 'path'
import { ensureFfmpegConfigured } from './ffmpeg-path.js'
import { getAbsolutePath } from './storage.js'

export function resolveMediaFilePath(relativePath: string): string {
  const normalized = String(relativePath || '').trim().replace(/^\/+/, '')
  if (!normalized) return ''
  if (path.isAbsolute(normalized)) return normalized
  if (normalized.startsWith('static/')) return getAbsolutePath(normalized)
  return getAbsolutePath(`static/${normalized}`)
}

function roundDuration(seconds: number): number {
  return Math.round(seconds * 10) / 10
}

function durationFromFfprobe(filePath: string): Promise<number> {
  ensureFfmpegConfigured()
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        resolve(0)
        return
      }
      const formatDur = Number(metadata.format?.duration || 0)
      const streamDur = Math.max(
        0,
        ...(metadata.streams || [])
          .filter(stream => stream.codec_type === 'audio')
          .map(stream => Number(stream.duration || 0)),
      )
      const duration = Math.max(formatDur, streamDur)
      resolve(duration > 0 ? roundDuration(duration) : 0)
    })
  })
}

async function durationFromMetadata(filePath: string): Promise<number> {
  try {
    const metadata = await parseFile(filePath, { duration: true })
    const duration = Number(metadata.format.duration || 0)
    return duration > 0 ? roundDuration(duration) : 0
  } catch {
    return 0
  }
}

export async function getAudioDurationSeconds(relativePath: string): Promise<number> {
  const filePath = resolveMediaFilePath(relativePath)
  if (!filePath) return 0

  const fromFfprobe = await durationFromFfprobe(filePath)
  if (fromFfprobe > 0) return fromFfprobe

  return durationFromMetadata(filePath)
}

export const VOICE_REF_MIN_SECONDS = 3
export const VOICE_REF_MAX_SECONDS = 10
export const MAX_VOICE_REFS = 3

export function validateVoiceRefDuration(seconds: number): string | null {
  const duration = roundDuration(Number(seconds))
  if (!Number.isFinite(duration) || duration <= 0) {
    return '无法读取音频时长，请确认文件为有效的 MP3（时长 3~10 秒）'
  }
  if (duration < VOICE_REF_MIN_SECONDS) {
    return `音色参考时长不能少于 ${VOICE_REF_MIN_SECONDS} 秒（当前 ${duration.toFixed(1)} 秒）`
  }
  if (duration > VOICE_REF_MAX_SECONDS) {
    return `音色参考时长不能超过 ${VOICE_REF_MAX_SECONDS} 秒（当前 ${duration.toFixed(1)} 秒），请裁剪后重新上传`
  }
  return null
}
