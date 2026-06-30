/**
 * 文件存储工具 — 下载远程文件到本地
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import { v4 as uuid } from 'uuid'
import { ensureThumbnail, isImageStaticPath } from './thumbnail.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

export interface StaticFileSaveOptions {
  dramaId?: number | null
  /** 默认 true：写入本地后尝试同步 OSS */
  syncOss?: boolean
}

async function maybeSyncToOss(relative: string, opts?: StaticFileSaveOptions) {
  if (opts?.syncOss === false) return
  try {
    const { trySyncStaticToOss } = await import('./oss-entity-sync.js')
    await trySyncStaticToOss(relative, opts?.dramaId)
  } catch {
    /* OSS 同步失败不影响主流程，本地文件已保留 */
  }
}

/**
 * 下载远程文件到本地存储
 */
export async function downloadFile(
  url: string,
  subDir: string,
  opts?: StaticFileSaveOptions,
): Promise<string> {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })

  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`)

  const buffer = Buffer.from(await resp.arrayBuffer())
  const ext = resolveDownloadExt(url, resp, buffer, subDir)
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  fs.writeFileSync(filePath, buffer)

  const relative = `static/${subDir}/${filename}`
  if (isImageStaticPath(relative)) {
    await ensureThumbnail(relative).catch(() => {})
  }
  await maybeSyncToOss(relative, opts)
  return relative
}

/**
 * 保存上传的文件
 */
export async function saveUploadedFile(
  data: ArrayBuffer,
  subDir: string,
  originalName: string,
  opts?: StaticFileSaveOptions,
): Promise<string> {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })

  const ext = path.extname(originalName) || '.bin'
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  fs.writeFileSync(filePath, Buffer.from(data))
  const relative = `static/${subDir}/${filename}`
  if (isImageStaticPath(relative)) {
    await ensureThumbnail(relative).catch(() => {})
  }
  await maybeSyncToOss(relative, opts)
  return relative
}

function getExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname)
    if (ext && ext.length <= 5) return ext
  } catch {}
  return ''
}

function extFromContentType(contentType: string): string {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase()
  const map: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/mp4': '.m4a',
  }
  return map[ct] || ''
}

function extFromMagic(buffer: Buffer, subDir: string): string {
  if (buffer.length < 12) return ''
  if (buffer.slice(4, 8).toString('ascii') === 'ftyp') return '.mp4'
  if (buffer.slice(0, 3).toString('ascii') === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return '.mp3'
  }
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF') {
    if (subDir === 'audio') return '.wav'
    if (subDir === 'videos') return '.webm'
  }
  if (buffer.slice(0, 8).toString('ascii') === '\x89PNG\r\n\x1a\n') return '.png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg'
  if (buffer.slice(0, 4).toString('ascii') === 'GIF8') return '.gif'
  return ''
}

function defaultExtForSubDir(subDir: string): string {
  if (subDir === 'videos') return '.mp4'
  if (subDir === 'images') return '.png'
  if (subDir === 'audio') return '.mp3'
  return '.bin'
}

function resolveDownloadExt(url: string, resp: Response, buffer: Buffer, subDir: string): string {
  const fromUrl = getExtFromUrl(url)
  if (fromUrl) return fromUrl

  const fromMime = extFromContentType(resp.headers.get('content-type') || '')
  if (fromMime) return fromMime

  const fromMagic = extFromMagic(buffer, subDir)
  if (fromMagic) return fromMagic

  return defaultExtForSubDir(subDir)
}

/**
 * 获取本地文件的绝对路径
 */
export function getAbsolutePath(relativePath: string): string {
  const normalized = String(relativePath || '').trim().replace(/^\/+/, '')
  if (normalized === 'static' || normalized === 'static/') {
    return STORAGE_ROOT
  }
  if (normalized.startsWith('static/')) {
    return path.join(STORAGE_ROOT, '..', normalized)
  }
  return path.join(STORAGE_ROOT, normalized)
}

/**
 * 保存 Base64 编码的图片数据到本地存储
 * 用于 Gemini 等只返回 base64 数据的厂商
 */
export async function saveBase64Image(
  base64Data: string,
  mimeType: string,
  subDir: string,
  opts?: StaticFileSaveOptions,
): Promise<string> {
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })

  // 从 mimeType 推断文件扩展名
  const ext = mimeTypeToExt(mimeType)
  const filename = `${uuid()}${ext}`
  const filePath = path.join(dir, filename)

  const buffer = Buffer.from(base64Data, 'base64')
  fs.writeFileSync(filePath, buffer)

  const relative = `static/${subDir}/${filename}`
  if (isImageStaticPath(relative)) {
    await ensureThumbnail(relative).catch(() => {})
  }
  await maybeSyncToOss(relative, opts)
  return relative
}

export async function readLocalImageDimensions(relativePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const normalized = String(relativePath || '').trim().replace(/^\/+/, '')
    if (!normalized.startsWith('static/')) return null
    const filePath = getAbsolutePath(normalized)
    if (!fs.existsSync(filePath)) return null
    const meta = await sharp(filePath).metadata()
    if (!meta.width || !meta.height) return null
    return { width: meta.width, height: meta.height }
  } catch {
    return null
  }
}

export function readImageAsDataUrl(relativePath: string): string {
  const filePath = getAbsolutePath(relativePath)
  const buffer = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = extToMimeType(ext)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

export interface CompressImageOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  maxBytes?: number
}

const IMAGE_FILE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])

export function isLocalImageFile(absPath: string): boolean {
  return IMAGE_FILE_EXTS.has(path.extname(absPath).toLowerCase())
}

/** 压缩本地图片为 JPEG，供第三方 API / OSS 上传使用 */
export async function compressLocalImageFile(
  absPath: string,
  options: CompressImageOptions = {},
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isLocalImageFile(absPath)) return null
  if (!fs.existsSync(absPath)) return null

  const maxWidth = options.maxWidth ?? 1920
  const maxHeight = options.maxHeight ?? 1920
  let quality = options.quality ?? 78
  const maxBytes = options.maxBytes ?? 18 * 1024 * 1024

  let lastBuffer: Buffer | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    const resized = sharp(absPath).rotate().resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    const metadata = await resized.metadata()
    const output = metadata.hasAlpha
      ? await resized.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer()
      : await resized.jpeg({ quality, mozjpeg: true }).toBuffer()
    lastBuffer = output
    if (output.length <= maxBytes) {
      return { buffer: output, contentType: 'image/jpeg' }
    }
    quality = Math.max(48, quality - 14)
  }

  return lastBuffer
    ? { buffer: lastBuffer, contentType: 'image/jpeg' }
    : null
}

export async function readImageAsCompressedDataUrl(
  relativePath: string,
  options: CompressImageOptions = {},
): Promise<string> {
  const filePath = getAbsolutePath(relativePath)
  const maxWidth = options.maxWidth ?? 768
  const maxHeight = options.maxHeight ?? 768
  const quality = options.quality ?? 68

  const compressed = await compressLocalImageFile(filePath, {
    maxWidth,
    maxHeight,
    quality,
    maxBytes: options.maxBytes,
  })
  if (!compressed) throw new Error(`无法压缩图片: ${relativePath}`)
  const mimeType = compressed.contentType
  return `data:${mimeType};base64,${compressed.buffer.toString('base64')}`
}

export function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null
  return {
    mimeType: match[1],
    data: match[2],
  }
}

function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  return map[mimeType] || '.png'
}

function extToMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
  }
  return map[ext] || 'application/octet-stream'
}

export function readFileAsDataUrl(relativePath: string, maxBytes = 5 * 1024 * 1024): string | null {
  const localPath = relativePath.startsWith('/static/')
    ? relativePath.slice(1)
    : relativePath.startsWith('static/')
      ? relativePath
      : `static/${relativePath}`
  const filePath = getAbsolutePath(localPath)
  if (!fs.existsSync(filePath)) return null
  const stat = fs.statSync(filePath)
  if (stat.size > maxBytes) return null
  const buffer = fs.readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const mimeType = extToMimeType(ext)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}
