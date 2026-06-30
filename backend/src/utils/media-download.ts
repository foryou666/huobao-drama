import fs, { createReadStream } from 'fs'

import path from 'path'

import { Readable } from 'stream'

import type { Readable as ReadableStreamType } from 'stream'

import { eq } from 'drizzle-orm'

import { getAbsolutePath } from './storage.js'

import {

  getOssReadStream,

  isOssConfigured,

  resolveOssObjectKeyCandidates,

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



/** 打开 static 逻辑路径的读取流：线上优先 OSS，本地仅作开发回退 */

export async function openMediaReadStream(staticPath: string): Promise<{ stream: ReadableStreamType; source: 'local' | 'oss' }> {

  const normalized = assertSafeStaticMediaPath(staticPath)

  const absPath = getAbsolutePath(normalized)



  if (!shouldPreferLocalStaticPath(normalized)) {

    const ossStream = await openOssReadStreamForStaticPath(normalized)

    if (ossStream) return { stream: ossStream, source: 'oss' }

  } else if (fs.existsSync(absPath)) {

    return { stream: createReadStream(absPath), source: 'local' }

  }



  const ossStream = await openOssReadStreamForStaticPath(normalized)

  if (ossStream) return { stream: ossStream, source: 'oss' }



  if (fs.existsSync(absPath)) {

    return { stream: createReadStream(absPath), source: 'local' }

  }



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


