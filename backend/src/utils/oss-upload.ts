/**
 * 阿里云 OSS 上传 — 将本地 static/ 文件转为公网 URL，供橙盟等第三方视频接口拉取
 */
import fs from 'fs'
import path from 'path'
import OSS from 'ali-oss'
import { getAbsolutePath } from './storage.js'
import { logTaskProgress, logTaskWarn } from './task-logger.js'

let client: OSS | null = null
/** 已上传的 static 路径 → OSS objectKey */
const objectKeyCache = new Map<string, string>()

/** 签名 URL 有效期（秒），橙盟异步任务需足够长 */
const SIGNED_URL_EXPIRES_SEC = 7 * 24 * 3600

function ossBucket(): string {
  const fromEnv = (process.env.OSS_BUCKET || '').trim()
  if (fromEnv) return fromEnv
  const endpoint = (process.env.OSS_ENDPOINT || process.env.OSS_PUBLIC_BASE_URL || '').trim()
  const match = endpoint.match(/^https?:\/\/([^.]+)\./i)
  return match?.[1] || 'llingjingmanju'
}

function ossRegion(): string {
  return (process.env.OSS_REGION || 'oss-cn-qingdao').trim()
}

function ossPublicBase(): string {
  const custom = (process.env.OSS_PUBLIC_BASE_URL || process.env.OSS_ENDPOINT || '').trim().replace(/\/+$/, '')
  if (custom) return custom
  return `https://${ossBucket()}.${ossRegion()}.aliyuncs.com`
}

function ossKeyPrefix(): string {
  return (process.env.OSS_KEY_PREFIX || 'hongguoduanju').replace(/^\/+|\/+$/g, '')
}

export function isOssConfigured(): boolean {
  return !!(process.env.OSS_ACCESS_KEY_ID?.trim() && process.env.OSS_ACCESS_KEY_SECRET?.trim())
}

function getClient(): OSS {
  if (!client) {
    if (!isOssConfigured()) {
      throw new Error('OSS 未配置：请设置 OSS_ACCESS_KEY_ID 与 OSS_ACCESS_KEY_SECRET')
    }
    client = new OSS({
      region: ossRegion(),
      accessKeyId: process.env.OSS_ACCESS_KEY_ID!.trim(),
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!.trim(),
      bucket: ossBucket(),
    })
  }
  return client
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  }
  return map[ext] || 'application/octet-stream'
}

function buildObjectKey(relativeStaticPath: string): string {
  const normalized = relativeStaticPath.replace(/^\/+/, '')
  const prefix = ossKeyPrefix()
  return prefix ? `${prefix}/${normalized}` : normalized
}

function buildSignedUrl(objectKey: string): string {
  return getClient().signatureUrl(objectKey, {
    expires: SIGNED_URL_EXPIRES_SEC,
    method: 'GET',
  })
}

/** 将 static/... 本地路径上传到 OSS，返回带签名的公网 https URL */
export async function uploadStaticToOss(relativeStaticPath: string): Promise<string> {
  const normalized = relativeStaticPath.replace(/^\/+/, '')
  if (!normalized.startsWith('static/')) {
    throw new Error(`仅支持 static/ 路径上传 OSS: ${relativeStaticPath}`)
  }

  let objectKey = objectKeyCache.get(normalized)
  if (!objectKey) {
    const absPath = getAbsolutePath(normalized)
    if (!fs.existsSync(absPath)) {
      throw new Error(`本地文件不存在: ${normalized}`)
    }

    objectKey = buildObjectKey(normalized)
    const oss = getClient()
    await oss.put(objectKey, absPath, {
      headers: {
        'Content-Type': mimeFromPath(absPath),
      },
    })
    objectKeyCache.set(normalized, objectKey)
    logTaskProgress('OSS', 'uploaded', { path: normalized, objectKey })
  }

  const url = buildSignedUrl(objectKey)
  logTaskProgress('OSS', 'signed-url', { path: normalized, objectKey })
  return url
}

/** 解析媒体 URL：已是 http(s) 则原样返回；本地 static/ 则上传 OSS */
export async function resolveMediaUrlForExternalApi(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw

  let staticPath: string | null = null
  if (raw.startsWith('/static/')) staticPath = raw.slice(1)
  else if (raw.startsWith('static/')) staticPath = raw

  if (staticPath && isOssConfigured()) {
    try {
      return await uploadStaticToOss(staticPath)
    } catch (err: any) {
      logTaskWarn('OSS', 'upload-failed', { path: staticPath, error: err?.message || String(err) })
      throw err
    }
  }

  return null
}
