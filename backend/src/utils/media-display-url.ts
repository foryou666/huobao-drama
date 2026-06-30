/**
 * 页面展示用媒体 URL — 默认 OSS；LOCAL_MEDIA_PREFER_DAYS>0 时近 N 天本地优先
 */
import fs from 'fs'
import { isOssConfigured, lookupOssObjectKey, resolveOssObjectKeyCandidates, signOssObjectKey } from './oss-upload.js'
import { getAbsolutePath } from './storage.js'

/** 本地热数据保留天数（0 = 始终 OSS，适合线上部署） */
const LOCAL_MEDIA_PREFER_DAYS = Number(process.env.LOCAL_MEDIA_PREFER_DAYS ?? 0)
const LOCAL_MEDIA_PREFER_MS = LOCAL_MEDIA_PREFER_DAYS * 24 * 3600 * 1000

function normalizeStaticPath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

/** 本地文件存在且在热数据窗口内 → 预览/播放走本地，避免 OSS 流量 */
export function shouldPreferLocalStaticPath(staticPath: string): boolean {
  if (LOCAL_MEDIA_PREFER_DAYS <= 0) return false
  const normalized = normalizeStaticPath(staticPath)
  if (!normalized.startsWith('static/')) return false
  try {
    const absPath = getAbsolutePath(normalized)
    if (!fs.existsSync(absPath)) return false
    const stat = fs.statSync(absPath)
    const mtime = stat.mtimeMs || stat.mtime.getTime()
    return Date.now() - mtime <= LOCAL_MEDIA_PREFER_MS
  } catch {
    return false
  }
}

/** 解析单条 static/ 或 https 为页面可展示的 URL */
export function resolveDisplayMediaUrl(raw: string | null | undefined): string | null {
  const path = normalizeStaticPath(String(raw || ''))
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path

  if (path.startsWith('static/')) {
    if (shouldPreferLocalStaticPath(path)) {
      return `/${path}`
    }
    if (isOssConfigured()) {
      const mapped = lookupOssObjectKey(path)
      if (mapped) return signOssObjectKey(mapped)

      let localExists = false
      try {
        localExists = fs.existsSync(getAbsolutePath(path))
      } catch {
        localExists = false
      }

      // 本地有文件（如视频封面缩略图）→ 同源 static，避免对未上传 OSS 的路径签发无效 URL
      if (localExists) {
        return `/${path}`
      }

      const candidates = resolveOssObjectKeyCandidates(path)
      for (const objectKey of candidates) {
        if (objectKey) return signOssObjectKey(objectKey)
      }
    }
  }

  return `/${path}`
}

export function resolveDisplayMediaUrls(paths: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  const seen = new Set<string>()
  for (const raw of paths) {
    const path = normalizeStaticPath(String(raw || ''))
    if (!path || seen.has(path)) continue
    seen.add(path)
    const url = resolveDisplayMediaUrl(path)
    if (url) result[path] = url
  }
  return result
}
