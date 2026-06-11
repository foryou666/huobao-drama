import fs from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import { CHENGMENT_AUDIO_MAX_CLIP_SECONDS } from '../constants/chengmeng.js'
import { getAudioDurationSeconds, resolveMediaFilePath } from './audio-duration.js'
import { ensureFfmpegConfigured } from './ffmpeg-path.js'
import { logTaskProgress, logTaskWarn } from './task-logger.js'

function normalizeStaticPath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function trimmedAudioRelativePath(sourcePath: string, maxSeconds: number): string {
  const normalized = normalizeStaticPath(sourcePath)
  const basename = path.basename(normalized).replace(/\.[^.]+$/i, '')
  return `static/api-audio/${basename}-${maxSeconds}s.mp3`
}

function trimAudioFile(inputPath: string, outputPath: string, maxSeconds: number): Promise<void> {
  ensureFfmpegConfigured()
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(0)
      .duration(maxSeconds)
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .format('mp3')
      .on('end', () => resolve())
      .on('error', err => reject(err))
      .save(outputPath)
  })
}

/**
 * 发给第三方 API 前将参考音频裁到指定秒数（默认 3 秒）。
 * 音色库原文件不变，裁剪副本存 static/api-audio/。
 */
export async function ensureApiTrimmedAudioPath(
  relativePath: string,
  maxSeconds = CHENGMENT_AUDIO_MAX_CLIP_SECONDS,
): Promise<string> {
  const normalized = normalizeStaticPath(relativePath)
  if (!normalized.startsWith('static/')) return normalized

  const absPath = resolveMediaFilePath(normalized)
  if (!absPath || !fs.existsSync(absPath)) return normalized

  const duration = await getAudioDurationSeconds(normalized)
  if (duration > 0 && duration <= maxSeconds) return normalized

  const trimmedRel = trimmedAudioRelativePath(normalized, maxSeconds)
  const trimmedAbs = resolveMediaFilePath(trimmedRel)

  try {
    const sourceStat = fs.statSync(absPath)
    if (fs.existsSync(trimmedAbs)) {
      const trimmedStat = fs.statSync(trimmedAbs)
      if (trimmedStat.mtimeMs >= sourceStat.mtimeMs) {
        return trimmedRel
      }
    }

    await trimAudioFile(absPath, trimmedAbs, maxSeconds)
    logTaskProgress('AudioTrim', 'trimmed-for-api', {
      source: normalized,
      output: trimmedRel,
      maxSeconds,
      originalSeconds: duration || null,
    })
    return trimmedRel
  } catch (err: any) {
    logTaskWarn('AudioTrim', 'trim-failed', {
      source: normalized,
      error: err?.message || String(err),
      hint: '请安装 ffmpeg，或手动将音色裁剪到 3 秒以内',
    })
    throw new Error(
      `参考音频过长（${duration ? `${duration.toFixed(1)} 秒` : '未知时长'}），自动裁剪失败。`
      + '请安装 ffmpeg 或将 MP3 手动裁剪到 3 秒以内后再生成。',
    )
  }
}
