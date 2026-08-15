/**
 * Seedance 参考图尺寸校验（官方规范：宽高均需在 300–6000 像素内）
 * 用于提交前拦截，避免上游审核失败后再退款。
 */
import sharp from 'sharp'
import { readLocalImageDimensions } from './storage.js'

export const SEEDANCE_REF_IMAGE_MIN_PX = 300
export const SEEDANCE_REF_IMAGE_MAX_PX = 6000

function normalizeRefPath(raw: unknown): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

/** 按 content_refs / 参考图字段收集图片 URL，顺序与前台「图N」一致 */
export function collectSeedanceReferenceImageUrls(body: Record<string, unknown>): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const push = (value: unknown) => {
    const next = normalizeRefPath(value)
    if (!next || seen.has(next)) return
    // 跳过被 JSON 拆坏的残片
    if (next.startsWith('[') || next.startsWith('{') || next.endsWith(']') || next.endsWith('}')) return
    seen.add(next)
    urls.push(next)
  }

  const refs = Array.isArray(body.content_refs) ? body.content_refs : []
  for (const item of refs) {
    const row = item as Record<string, unknown>
    const type = String(row?.type || 'image').toLowerCase()
    if (type !== 'image') continue
    push(row?.url || row?.image_url)
  }

  if (Array.isArray(body.reference_image_urls)) {
    for (const item of body.reference_image_urls) push(item)
  }
  push(body.image_url)
  push(body.imageUrl)
  push(body.first_frame_url)
  push(body.firstFrameUrl)
  push(body.last_frame_url)
  push(body.lastFrameUrl)

  return urls
}

async function readImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
  const raw = String(url || '').trim()
  if (!raw) return null

  if (/^https?:\/\//i.test(raw)) {
    try {
      const resp = await fetch(raw)
      if (!resp.ok) return null
      const buf = Buffer.from(await resp.arrayBuffer())
      const meta = await sharp(buf).metadata()
      if (!meta.width || !meta.height) return null
      return { width: meta.width, height: meta.height }
    } catch {
      return null
    }
  }

  const local = raw.replace(/^\/+/, '')
  if (local.startsWith('static/')) {
    return readLocalImageDimensions(local)
  }
  return null
}

function formatDimIssue(index: number, url: string, width: number, height: number): string {
  const name = url.split('/').pop() || url
  const badW = width < SEEDANCE_REF_IMAGE_MIN_PX || width > SEEDANCE_REF_IMAGE_MAX_PX
  const badH = height < SEEDANCE_REF_IMAGE_MIN_PX || height > SEEDANCE_REF_IMAGE_MAX_PX
  const which = badW && badH ? '宽高' : badW ? '宽度' : '高度'
  return (
    `参考图${index}（${name}）${which}不符合要求：需在 ${SEEDANCE_REF_IMAGE_MIN_PX}–${SEEDANCE_REF_IMAGE_MAX_PX} 像素内，`
    + `当前 ${width}×${height}`
  )
}

/**
 * 校验 body 中参考图尺寸。找不到本地文件/读不到尺寸时跳过该项（避免误拦远程暂不可达资源）。
 */
export async function assertSeedanceReferenceImageDimensions(body: Record<string, unknown>) {
  const urls = collectSeedanceReferenceImageUrls(body)
  if (!urls.length) return

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!
    const dims = await readImageDimensions(url)
    if (!dims) continue
    const { width, height } = dims
    if (
      width < SEEDANCE_REF_IMAGE_MIN_PX
      || height < SEEDANCE_REF_IMAGE_MIN_PX
      || width > SEEDANCE_REF_IMAGE_MAX_PX
      || height > SEEDANCE_REF_IMAGE_MAX_PX
    ) {
      throw new Error(formatDimIssue(i + 1, url, width, height))
    }
  }
}
