import ffmpeg from 'fluent-ffmpeg'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

export function resolveMediaFilePath(relativePath: string): string {
  const normalized = String(relativePath || '').trim().replace(/^\/+/, '')
  if (!normalized) return ''
  if (path.isAbsolute(normalized)) return normalized
  return path.join(projectRoot, 'data', normalized)
}

export function getAudioDurationSeconds(relativePath: string): Promise<number> {
  const filePath = resolveMediaFilePath(relativePath)
  if (!filePath) return Promise.resolve(0)
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
      resolve(Math.round(duration * 10) / 10)
    })
  })
}

export const VOICE_REF_MIN_SECONDS = 3
export const VOICE_REF_MAX_SECONDS = 10
export const MAX_VOICE_REFS = 3

export function validateVoiceRefDuration(seconds: number): string | null {
  const duration = Math.round(Number(seconds) * 10) / 10
  if (!Number.isFinite(duration) || duration <= 0) {
    return '无法读取音频时长，请确认文件为有效的 MP3（需已安装 ffmpeg）'
  }
  if (duration < VOICE_REF_MIN_SECONDS) {
    return `音色参考时长不能少于 ${VOICE_REF_MIN_SECONDS} 秒（当前 ${duration.toFixed(1)} 秒）`
  }
  if (duration > VOICE_REF_MAX_SECONDS) {
    return `音色参考时长不能超过 ${VOICE_REF_MAX_SECONDS} 秒（当前 ${duration.toFixed(1)} 秒），请裁剪后重新上传`
  }
  return null
}
