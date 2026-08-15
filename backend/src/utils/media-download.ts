import fs, { createReadStream } from 'fs'
import path from 'path'
import { Readable } from 'stream'
import type { Readable as ReadableStreamType } from 'stream'
import { eq } from 'drizzle-orm'
import { getAbsolutePath } from './storage.js'
import {
  findExistingOssObjectKey,
  getOssReadStream,
  isOssConfigured,
  resolveOssObjectKeyCandidates,
  signOssObjectKeyForDownload,
} from './oss-upload.js'
import { shouldPreferLocalStaticPath } from './media-display-url.js'
import { db, schema } from '../db/index.js'

export function assertSafeStaticMediaPath(raw: string): string {
  const normalized = String(raw || '').trim().replace(/^\/+/, '')
  if (!normalized) throw new Error('path is required')
  if (!normalized.startsWith('static/') || normalized.includes('..')) {
    throw new Error('invalid path')
  }
  const abs = path.resolve(getAbsolutePath(normalized))
  const root = path.resolve(getAbsolutePath('static'))
  if (!abs.startsWith(root)) {
    throw new Error('invalid path')
  }
  return normalized
}

export function sanitizeDownloadFilename(name: string, fallback: string): string {
  const base = String(name || fallback).trim() || fallback
  return base.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180)
}

export function mimeForStaticPath(staticPath: string): string {
  const ext = path.extname(staticPath).toLowerCase()
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.zip': 'application/zip',
    '.flac': 'audio/flac',
  }
  return map[ext] || 'application/octet-stream'
}

async function openOssReadStreamForStaticPath(staticPath: string): Promise<ReadableStreamType | null> {
  if (!isOssConfigured()) return null
  const candidates = resolveOssObjectKeyCandidates(staticPath)
  for (const objectKey of candidates) {
    try {
      return await getOssReadStream(objectKey)
    } catch {
      /* 尝试下一个候选 key */
    }
  }
  return null
}

/** 打开 static 逻辑路径的读取流：本地优先，其次 OSS */
export async function openMediaReadStream(staticPath: string): Promise<{ stream: ReadableStreamType; source: 'local' | 'oss' }> {
  const normalized = assertSafeStaticMediaPath(staticPath)
  const absPath = getAbsolutePath(normalized)

  if (fs.existsSync(absPath)) {
    return { stream: createReadStream(absPath), source: 'local' }
  }

  if (!shouldPreferLocalStaticPath(normalized)) {
    const ossStream = await openOssReadStreamForStaticPath(normalized)
    if (ossStream) return { stream: ossStream, source: 'oss' }
  }

  const ossStream = await openOssReadStreamForStaticPath(normalized)
  if (ossStream) return { stream: ossStream, source: 'oss' }

  throw new Error('file not found')
}

async function openRemoteUrlReadStream(url: string): Promise<{ stream: ReadableStreamType; contentType: string }> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error('file not found')
  if (!res.body) throw new Error('file not found')
  const stream = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
  const contentType = res.headers.get('content-type') || 'video/mp4'
  return { stream, contentType }
}

/** 视频生成记录下载：优先 static/OSS，否则服务端拉取上游 video_url */
export async function openVideoGenerationReadStream(
  id: number,
): Promise<{ stream: ReadableStreamType; source: 'local' | 'oss' | 'remote'; contentType: string }> {
  const [row] = db.select().from(schema.videoGenerations).where(eq(schema.videoGenerations.id, id)).all()
  if (!row) throw new Error('not found')

  const localPath = String(row.localPath || '').trim().replace(/^\/+/, '')
  if (localPath.startsWith('static/')) {
    try {
      const opened = await openMediaReadStream(localPath)
      return {
        stream: opened.stream,
        source: opened.source,
        contentType: mimeForStaticPath(localPath),
      }
    } catch {
      /* OSS / 本地均不可用时回退 video_url */
    }
  }

  const remote = String(row.videoUrl || '').trim()
  if (remote.startsWith('http://') || remote.startsWith('https://')) {
    const opened = await openRemoteUrlReadStream(remote)
    return { stream: opened.stream, source: 'remote', contentType: opened.contentType }
  }

  throw new Error('file not found')
}

export type MediaDownloadLink = {
  url: string
  filename: string
  source: 'local' | 'oss' | 'remote'
}

/**
 * 解析可直链下载地址，避免浏览器经 Node 整包缓冲。
 * 优先 OSS（与播放器同源 CDN，常可命中缓存），本地 /static 仅作回退。
 */
export async function resolveStaticMediaDownloadLink(
  staticPath: string,
  filename: string,
): Promise<MediaDownloadLink | null> {
  const normalized = assertSafeStaticMediaPath(staticPath)
  const safeName = sanitizeDownloadFilename(filename, path.basename(normalized))
  const absPath = getAbsolutePath(normalized)

  if (isOssConfigured()) {
    const objectKey = await findExistingOssObjectKey(normalized)
    if (objectKey) {
      return {
        url: signOssObjectKeyForDownload(objectKey, safeName),
        filename: safeName,
        source: 'oss',
      }
    }
  }

  if (fs.existsSync(absPath)) {
    return { url: `/${normalized}`, filename: safeName, source: 'local' }
  }

  return null
}

export async function resolveVideoGenerationDownloadLink(
  id: number,
  filename: string,
): Promise<MediaDownloadLink | null> {
  const [row] = db.select().from(schema.videoGenerations).where(eq(schema.videoGenerations.id, id)).all()
  if (!row) throw new Error('not found')

  const safeName = sanitizeDownloadFilename(filename, `video_${id}.mp4`)
  const localPath = String(row.localPath || '').trim().replace(/^\/+/, '')

  if (localPath.startsWith('static/')) {
    const link = await resolveStaticMediaDownloadLink(localPath, safeName)
    if (link) return link
  }

  const remote = String(row.videoUrl || '').trim()
  if (remote.startsWith('http://') || remote.startsWith('https://')) {
    return { url: remote, filename: safeName, source: 'remote' }
  }

  return null
}
