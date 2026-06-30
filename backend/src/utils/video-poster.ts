/**
 * 视频列表封面 — ffmpeg 抽帧 → static/thumbs/videos/{id}.webp
 */
import fs from 'fs'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import sharp from 'sharp'
import { getAbsolutePath } from './storage.js'
import { ensureFfmpegConfigured } from './ffmpeg-path.js'
import { normalizeStaticPath } from './thumbnail.js'
import { resolveDisplayMediaUrl } from './media-display-url.js'

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.bin'])
const POSTER_MAX_WIDTH = 480
const POSTER_WEBP_QUALITY = 80

export function isVideoStaticPath(raw: string | null | undefined): boolean {
  const normalized = normalizeStaticPath(raw)
  if (!normalized.startsWith('static/videos/')) return false
  if (normalized.startsWith('static/thumbs/')) return false
  return VIDEO_EXTS.has(path.extname(normalized).toLowerCase())
}

/** static/videos/a.mp4 → static/thumbs/videos/a.webp */
export function videoPosterPathForSource(sourcePath: string | null | undefined): string | null {
  const normalized = normalizeStaticPath(sourcePath)
  if (!isVideoStaticPath(normalized)) return null
  const rest = normalized.slice('static/'.length)
  const withoutExt = rest.replace(/\.[^.]+$/i, '')
  return `static/thumbs/${withoutExt}.webp`
}

function extractFramePng(sourceAbs: string, tmpPng: string): Promise<void> {
  ensureFfmpegConfigured()
  fs.mkdirSync(path.dirname(tmpPng), { recursive: true })
  return new Promise((resolve, reject) => {
    ffmpeg(sourceAbs)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .screenshots({
        count: 1,
        timemarks: ['0.5'],
        filename: path.basename(tmpPng),
        folder: path.dirname(tmpPng),
        size: `${POSTER_MAX_WIDTH}x?`,
      })
  })
}

/** 生成视频封面；已存在且比原视频新则跳过 */
export async function ensureVideoPoster(sourcePath: string | null | undefined): Promise<string | null> {
  const normalized = normalizeStaticPath(sourcePath)
  if (!isVideoStaticPath(normalized)) return null

  const posterPath = videoPosterPathForSource(normalized)
  if (!posterPath) return null

  const sourceAbs = getAbsolutePath(normalized)
  if (!fs.existsSync(sourceAbs)) return null

  const posterAbs = getAbsolutePath(posterPath)
  fs.mkdirSync(path.dirname(posterAbs), { recursive: true })

  try {
    const sourceStat = fs.statSync(sourceAbs)
    if (fs.existsSync(posterAbs)) {
      const posterStat = fs.statSync(posterAbs)
      if (posterStat.mtimeMs >= sourceStat.mtimeMs && posterStat.size > 0) {
        return posterPath
      }
    }

    const tmpPng = posterAbs.replace(/\.webp$/i, '.tmp.png')
    await extractFramePng(sourceAbs, tmpPng)
    if (!fs.existsSync(tmpPng)) {
      throw new Error('ffmpeg 未输出抽帧文件')
    }
    await sharp(tmpPng)
      .rotate()
      .webp({ quality: POSTER_WEBP_QUALITY })
      .toFile(posterAbs)
    fs.unlinkSync(tmpPng)
    return posterPath
  } catch (err) {
    console.warn('[video-poster] generate failed:', normalized, (err as Error)?.message || err)
    return null
  }
}

export function videoPosterExists(sourcePath: string | null | undefined): boolean {
  const posterPath = videoPosterPathForSource(sourcePath)
  if (!posterPath) return false
  try {
    return fs.existsSync(getAbsolutePath(posterPath))
  } catch {
    return false
  }
}

/** 页面展示用封面 URL（与 resolveDisplayMediaUrl 一致，默认 OSS） */
export function resolvePosterDisplayUrl(rawVideo: string | null | undefined): string | null {
  const posterPath = videoPosterPathForSource(rawVideo)
  if (!posterPath) return null
  return resolveDisplayMediaUrl(posterPath)
}
