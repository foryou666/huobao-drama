/**
 * 页面展示用媒体 URL — 优先 OSS 签名地址，否则回退本地 /static/
 */
import { isOssConfigured, lookupOssObjectKey, signOssObjectKey } from './oss-upload.js'
import { resolveProjectObjectKeyForStaticPath } from './oss-path.js'

function normalizeStaticPath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

/** 解析单条 static/ 或 https 为页面可展示的 URL */
export function resolveDisplayMediaUrl(raw: string | null | undefined): string | null {
  const path = normalizeStaticPath(String(raw || ''))
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path

  if (path.startsWith('static/') && isOssConfigured()) {
    const objectKey = lookupOssObjectKey(path) || resolveProjectObjectKeyForStaticPath(path)
    if (objectKey) {
      return signOssObjectKey(objectKey)
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
