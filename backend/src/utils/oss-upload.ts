/**
 * 阿里云 OSS 上传 — 将本地 static/ 文件转为公网 URL，供橙盟等第三方视频接口拉取
 */
import fs from 'fs'
import path from 'path'
import OSS from 'ali-oss'
import { eq, or } from 'drizzle-orm'
import {
  CHENGMENT_REF_IMAGE_MAX_BYTES,
  CHENGMENT_REF_IMAGE_MAX_HEIGHT,
  CHENGMENT_REF_IMAGE_MAX_WIDTH,
  CHENGMENT_REF_IMAGE_QUALITY,
  CHENGMENT_REF_IMAGE_REUPLOAD_BYTES,
} from '../constants/chengmeng.js'
import { compressLocalImageFile, getAbsolutePath, isLocalImageFile } from './storage.js'
import { isImageStaticPath } from './thumbnail.js'
import { logTaskProgress, logTaskWarn } from './task-logger.js'
import { now } from './response.js'
import { db, schema } from '../db/index.js'
import { ossKeyPrefix, projectAssetObjectKey, resolveProjectObjectKeyForStaticPath } from './oss-path.js'

let client: OSS | null = null

/** 签名 URL 有效期（秒），橙盟异步任务需足够长 */
const SIGNED_URL_EXPIRES_SEC = 7 * 24 * 3600

export function ossBucket(): string {
  const fromEnv = (process.env.OSS_BUCKET || '').trim()
  if (fromEnv) return fromEnv
  const endpoint = (process.env.OSS_ENDPOINT || process.env.OSS_PUBLIC_BASE_URL || '').trim()
  const match = endpoint.match(/^https?:\/\/([^.]+)\./i)
  return match?.[1] || 'llingjingmanju'
}

function ossRegion(): string {
  return (process.env.OSS_REGION || 'oss-cn-qingdao').trim()
}

export { ossKeyPrefix } from './oss-path.js'

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

function buildFallbackObjectKey(relativeStaticPath: string): string {
  const normalized = relativeStaticPath.replace(/^\/+/, '')
  const projectKey = resolveProjectObjectKeyForStaticPath(normalized)
  if (projectKey) return projectKey
  const prefix = ossKeyPrefix()
  const fallback = `unknown/asset/${normalized.replace(/^static\//, '')}`
  return prefix ? `${prefix}/${fallback}` : fallback
}

function upsertPathMapping(localPath: string, objectKey: string) {
  const normalized = localPath.replace(/^\/+/, '')
  const ts = now()
  db.insert(schema.ossStaticMappings)
    .values({ localPath: normalized, objectKey, updatedAt: ts })
    .onConflictDoUpdate({
      target: schema.ossStaticMappings.localPath,
      set: { objectKey, updatedAt: ts },
    })
    .run()
}

export function lookupOssObjectKey(localPath: string): string | null {
  const normalized = String(localPath || '').trim().replace(/^\/+/, '')
  if (!normalized) return null

  const mapped = db.select()
    .from(schema.ossStaticMappings)
    .where(eq(schema.ossStaticMappings.localPath, normalized))
    .all()[0]
  if (mapped?.objectKey) return mapped.objectKey

  const [char] = db.select()
    .from(schema.characters)
    .where(or(
      eq(schema.characters.imageUrl, normalized),
      eq(schema.characters.localPath, normalized),
    ))
    .all()
  if (char?.ossObjectKey) return char.ossObjectKey

  const [scene] = db.select()
    .from(schema.scenes)
    .where(or(
      eq(schema.scenes.imageUrl, normalized),
      eq(schema.scenes.localPath, normalized),
    ))
    .all()
  if (scene?.ossObjectKey) return scene.ossObjectKey

  return null
}

function applyPublicBase(signedUrl: string): string {
  const publicBase = (process.env.OSS_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  if (!publicBase) return signedUrl
  try {
    const origin = new URL(signedUrl).origin
    return signedUrl.replace(origin, publicBase)
  } catch {
    return signedUrl
  }
}

export function signOssObjectKey(objectKey: string): string {
  return applyPublicBase(getClient().signatureUrl(objectKey, {
    expires: SIGNED_URL_EXPIRES_SEC,
    method: 'GET',
  }))
}

async function compressImageForOss(absPath: string) {
  return compressLocalImageFile(absPath, {
    maxWidth: CHENGMENT_REF_IMAGE_MAX_WIDTH,
    maxHeight: CHENGMENT_REF_IMAGE_MAX_HEIGHT,
    quality: CHENGMENT_REF_IMAGE_QUALITY,
    maxBytes: CHENGMENT_REF_IMAGE_MAX_BYTES,
  })
}

/** 上传本地文件到指定 OSS objectKey（覆盖写入）；图片自动压缩为 JPEG */
export async function putLocalFileToOss(absPath: string, objectKey: string): Promise<void> {
  const compressed = await compressImageForOss(absPath)
  if (compressed) {
    const originalBytes = fs.statSync(absPath).size
    await getClient().put(objectKey, compressed.buffer, {
      headers: {
        'Content-Type': compressed.contentType,
      },
    })
    logTaskProgress('OSS', 'uploaded-compressed-image', {
      objectKey,
      originalBytes,
      compressedBytes: compressed.buffer.length,
    })
    return
  }

  await getClient().put(objectKey, absPath, {
    headers: {
      'Content-Type': mimeFromPath(absPath),
    },
  })
}

async function ensureCompressedOssImage(staticPath: string, objectKey: string): Promise<void> {
  const absPath = getAbsolutePath(staticPath)
  if (!fs.existsSync(absPath) || !isLocalImageFile(absPath)) return
  const originalBytes = fs.statSync(absPath).size
  if (originalBytes <= CHENGMENT_REF_IMAGE_REUPLOAD_BYTES) return
  await putLocalFileToOss(absPath, objectKey)
}

/**
 * 兜底：按 static 路径上传 OSS（镜头帧等非角色/场景资源）
 * 角色/场景图应在生成/上传时已同步，此处仅处理未映射资源
 */
export async function uploadStaticToOss(relativeStaticPath: string, dramaId?: number | null): Promise<string> {
  const normalized = relativeStaticPath.replace(/^\/+/, '')
  if (!normalized.startsWith('static/')) {
    throw new Error(`仅支持 static/ 路径上传 OSS: ${relativeStaticPath}`)
  }

  const existingKey = lookupOssObjectKey(normalized)
  if (existingKey) {
    return signOssObjectKey(existingKey)
  }

  const absPath = getAbsolutePath(normalized)
  if (!fs.existsSync(absPath)) {
    throw new Error(`本地文件不存在: ${normalized}`)
  }

  const objectKey = (Number.isFinite(Number(dramaId)) && Number(dramaId) > 0
    ? projectAssetObjectKey(Number(dramaId), normalized)
    : null)
    ?? resolveProjectObjectKeyForStaticPath(normalized)
    ?? buildFallbackObjectKey(normalized)
  await putLocalFileToOss(absPath, objectKey)
  upsertPathMapping(normalized, objectKey)
  logTaskProgress('OSS', 'uploaded-fallback', { path: normalized, objectKey, dramaId: dramaId ?? null })
  return signOssObjectKey(objectKey)
}

/** 解析媒体 URL：已是 http(s) 则原样返回；本地 static/ 优先读 OSS 映射签名 */
export async function resolveMediaUrlForExternalApi(
  value: string | null | undefined,
  dramaId?: number | null,
): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw

  let staticPath: string | null = null
  if (raw.startsWith('/static/')) staticPath = raw.slice(1)
  else if (raw.startsWith('static/')) staticPath = raw

  if (staticPath && isOssConfigured()) {
    try {
      const mappedKey = lookupOssObjectKey(staticPath)
      if (mappedKey) {
        const dramaIdNum = Number(dramaId)
        if (mappedKey.startsWith('unknown/') && Number.isFinite(dramaIdNum) && dramaIdNum > 0) {
          const absPath = getAbsolutePath(staticPath)
          if (fs.existsSync(absPath)) {
            const objectKey = projectAssetObjectKey(dramaIdNum, staticPath)
            await putLocalFileToOss(absPath, objectKey)
            upsertPathMapping(staticPath, objectKey)
            logTaskProgress('OSS', 'remapped-unknown-key', { path: staticPath, objectKey, dramaId: dramaIdNum })
            return signOssObjectKey(objectKey)
          }
        }
        if (isImageStaticPath(staticPath)) {
          await ensureCompressedOssImage(staticPath, mappedKey)
        }
        return signOssObjectKey(mappedKey)
      }
      return await uploadStaticToOss(staticPath, dramaId)
    } catch (err: any) {
      logTaskWarn('OSS', 'upload-failed', { path: staticPath, error: err?.message || String(err) })
      throw err
    }
  }

  return null
}
