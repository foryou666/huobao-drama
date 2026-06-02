import { logTaskWarn } from './task-logger.js'
import type { VideoContentRef } from './seedance-content.js'
import { parseVideoContentRefs } from './seedance-content.js'
import { CHENGMENT_DEFAULT_GROUP_ID, CHENGMENT_DEFAULT_MODEL_ID, CHENGMENT_DURATION_BOUNDS } from '../constants/chengmeng.js'

function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
}

function normalizeStaticPath(value: string): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('/static/')) return raw.slice(1)
  if (raw.startsWith('static/')) return raw
  return null
}

/** 第三方任务接口只接受可公网访问的 http(s) URL */
export async function resolveChengmengMediaUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw

  const staticPath = normalizeStaticPath(raw)
  if (staticPath) {
    const base = publicBaseUrl()
    if (base) return `${base}/${staticPath}`
    logTaskWarn('ChengmengVideo', 'missing-public-base-url', {
      path: staticPath,
      hint: '设置 PUBLIC_BASE_URL 后第三方网关才能拉取本地参考图',
    })
    return null
  }

  if (raw.startsWith('data:')) {
    logTaskWarn('ChengmengVideo', 'data-url-skipped', {
      hint: '第三方 Seedance 接口不支持 data URI，请配置 PUBLIC_BASE_URL 或使用公网图片 URL',
    })
    return null
  }

  return raw
}

export async function normalizeChengmengContentRefs(raw: string | null | undefined): Promise<VideoContentRef[]> {
  const refs = parseVideoContentRefs(raw)
  const normalized = await Promise.all(
    refs.map(async (ref) => {
      const url = await resolveChengmengMediaUrl(ref.url)
      return url ? { ...ref, url } : null
    }),
  )
  return normalized.filter((item): item is VideoContentRef => !!item)
}

export async function normalizeChengmengReferenceUrls(raw: string | null | undefined): Promise<string[]> {
  if (!raw?.trim()) return []
  let refs: string[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    refs = []
  }
  const normalized = await Promise.all(
    Array.from(new Set(refs.map(item => String(item || '').trim()).filter(Boolean)))
      .map(item => resolveChengmengMediaUrl(item)),
  )
  return normalized.filter((item): item is string => !!item)
}

export function normalizeChengmengDuration(duration?: number | null): number {
  const { min, max, defaultSec } = CHENGMENT_DURATION_BOUNDS
  const parsed = Math.round(Number(duration || defaultSec))
  if (!Number.isFinite(parsed)) return defaultSec
  return Math.min(max, Math.max(min, parsed))
}

export function aspectRatioToOrientation(aspectRatio?: string | null): 'landscape' | 'portrait' {
  const ratio = normalizeChengmengAspectRatio(aspectRatio)
  if (ratio === '9:16' || ratio === '3:4') return 'portrait'
  return 'landscape'
}

const CHENGMENT_ASPECT_RATIOS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'])

/** 橙盟 values.aspect_ratio 仅接受固定比例，不接受 adaptive */
export function normalizeChengmengAspectRatio(aspectRatio?: string | null, fallback = '16:9'): string {
  const ratio = String(aspectRatio || '').trim()
  if (CHENGMENT_ASPECT_RATIOS.has(ratio)) return ratio
  if (ratio === 'portrait') return '9:16'
  if (ratio === 'landscape') return '16:9'
  if (ratio === 'adaptive') return CHENGMENT_ASPECT_RATIOS.has(fallback) ? fallback : '16:9'
  return CHENGMENT_ASPECT_RATIOS.has(fallback) ? fallback : '16:9'
}

/**
 * 文档要求 prompt 内用 @图片1 / @素材1 关联资源；
 * 工作台仍用「图片1是…」描述，发送前自动补 @ 标签。
 */
export function buildChengmengPrompt(prompt: string, imageCount: number, videoCount: number): string {
  let text = String(prompt || '').trim()
  text = text
    .replace(/@图片\s*(\d+)/gi, '图片$1')
    .replace(/@素材\s*(\d+)/gi, '素材$1')

  const imageTags = Array.from({ length: imageCount }, (_, i) => `@图片${i + 1}`)
  const videoTags = Array.from({ length: videoCount }, (_, i) => `@素材${i + 1}`)
  const tags = [...imageTags, ...videoTags]
  const prefix = tags.join(' ')
  const merged = prefix ? `${prefix} ${text}`.trim() : text
  return merged.slice(0, 1500)
}

export function collectChengmengImages(refs: VideoContentRef[], extraUrls: string[] = []): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const push = (url?: string | null) => {
    const next = String(url || '').trim()
    if (!next || seen.has(next)) return
    seen.add(next)
    urls.push(next)
  }

  for (const ref of refs) {
    if (ref.type !== 'image') continue
    if (ref.role === 'first_frame' || ref.role === 'last_frame') continue
    push(ref.url)
  }
  for (const url of extraUrls) push(url)
  return urls.slice(0, 9)
}

export function collectChengmengVideos(refs: VideoContentRef[]): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (ref.type !== 'video') continue
    const next = String(ref.url || '').trim()
    if (!next || seen.has(next)) continue
    seen.add(next)
    urls.push(next)
  }
  return urls.slice(0, 3)
}

export function collectChengmengAudios(refs: VideoContentRef[]): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (ref.type !== 'audio') continue
    const next = String(ref.url || '').trim()
    if (!next || seen.has(next)) continue
    seen.add(next)
    urls.push(next)
  }
  return urls.slice(0, 3)
}

export function normalizeChengmengResolution(value?: string | null): string {
  const resolution = String(value || '').trim().toLowerCase()
  if (resolution === '480p' || resolution === '720p' || resolution === '1080p') return resolution
  return '720p'
}

export type ChengmengVideoMode = 'references' | 'frames'

export function parseChengmengModelIds(config: { model?: string; models?: string[] }) {
  const models = config.models?.length
    ? config.models
    : config.model
      ? [config.model]
      : []
  return {
    modelId: String(models[0] || CHENGMENT_DEFAULT_MODEL_ID),
    groupId: String(models[1] || CHENGMENT_DEFAULT_GROUP_ID),
  }
}
