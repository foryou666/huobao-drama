/**
 * 列表/网格缩略图 — static/foo/bar.png → static/thumbs/foo/bar.webp
 */
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { getAbsolutePath } from './storage.js'

const THUMB_MAX_WIDTH = 480
const THUMB_WEBP_QUALITY = 80
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export function normalizeStaticPath(raw: string | null | undefined): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

export function isImageStaticPath(raw: string | null | undefined): boolean {
  const normalized = normalizeStaticPath(raw)
  if (!normalized.startsWith('static/')) return false
  if (normalized.startsWith('static/thumbs/')) return false
  const ext = path.extname(normalized).toLowerCase()
  return IMAGE_EXTS.has(ext)
}

/** 由原图路径推导缩略图相对路径（不检查文件是否存在） */
export function thumbPathForSource(sourcePath: string | null | undefined): string | null {
  const normalized = normalizeStaticPath(sourcePath)
  if (!isImageStaticPath(normalized)) return null
  const rest = normalized.slice('static/'.length)
  const withoutExt = rest.replace(/\.[^.]+$/i, '')
  return `static/thumbs/${withoutExt}.webp`
}

export function thumbAbsolutePath(thumbPath: string): string {
  return getAbsolutePath(thumbPath)
}

/** 生成缩略图；已存在且比原图新则跳过 */
export async function ensureThumbnail(sourcePath: string | null | undefined): Promise<string | null> {
  const normalized = normalizeStaticPath(sourcePath)
  if (!isImageStaticPath(normalized)) return null

  const thumbPath = thumbPathForSource(normalized)
  if (!thumbPath) return null

  const sourceAbs = getAbsolutePath(normalized)
  if (!fs.existsSync(sourceAbs)) return null

  const thumbAbs = getAbsolutePath(thumbPath)
  fs.mkdirSync(path.dirname(thumbAbs), { recursive: true })

  try {
    const sourceStat = fs.statSync(sourceAbs)
    if (fs.existsSync(thumbAbs)) {
      const thumbStat = fs.statSync(thumbAbs)
      if (thumbStat.mtimeMs >= sourceStat.mtimeMs) return thumbPath
    }

    await sharp(sourceAbs)
      .rotate()
      .resize({
        width: THUMB_MAX_WIDTH,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: THUMB_WEBP_QUALITY })
      .toFile(thumbAbs)

    return thumbPath
  } catch (err) {
    console.warn('[thumbnail] generate failed:', normalized, (err as Error)?.message || err)
    return null
  }
}
