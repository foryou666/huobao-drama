import type { VideoContentRef } from './seedance-content.js'
import { parseVideoContentRefs } from './seedance-content.js'
import { normalizeVideoPromptFraming } from './video-prompt-framing.js'
import { ensureApiTrimmedAudioPath } from './audio-trim.js'
import {
  AISTARSLAB_DURATION_BOUNDS,
  normalizeAistarslabAspectRatio,
  normalizeAistarslabDuration,
  normalizeAistarslabModelSlug,
} from '../constants/aistarslab.js'
import { resolveChengmengMediaUrl } from './chengmeng-content.js'

export { normalizeAistarslabAspectRatio, normalizeAistarslabDuration }
export const resolveAistarslabMediaUrl = resolveChengmengMediaUrl

export async function normalizeAistarslabContentRefs(
  raw: string | null | undefined,
  dramaId?: number | null,
): Promise<VideoContentRef[]> {
  const refs = parseVideoContentRefs(raw)
  const normalized = await Promise.all(
    refs.map(async (ref) => {
      let localPath = ref.url
      if (ref.type === 'audio') {
        localPath = await ensureApiTrimmedAudioPath(ref.url)
      }
      const url = await resolveAistarslabMediaUrl(localPath, dramaId)
      return url ? { ...ref, url } : null
    }),
  )
  return normalized.filter((item): item is VideoContentRef => !!item)
}

export async function normalizeAistarslabReferenceUrls(
  raw: string | null | undefined,
  dramaId?: number | null,
): Promise<string[]> {
  if (!raw?.trim()) return []
  let refs: string[] = []
  try {
    refs = JSON.parse(raw)
  } catch {
    refs = []
  }
  const normalized = await Promise.all(
    Array.from(new Set(refs.map(item => String(item || '').trim()).filter(Boolean)))
      .map(item => resolveAistarslabMediaUrl(item, dramaId)),
  )
  return normalized.filter((item): item is string => !!item)
}

function collectImages(refs: VideoContentRef[], extraUrls: string[] = []): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const push = (url?: string | null) => {
    const next = String(url || '').trim()
    const key = next.replace(/^\/+/, '').split('?')[0].toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    urls.push(next)
  }
  for (const ref of refs) {
    if (ref.type !== 'image') continue
    if (ref.role === 'first_frame' || ref.role === 'last_frame') continue
    push(ref.url)
  }
  for (const url of extraUrls) push(url)
  return urls
}

function collectVideos(refs: VideoContentRef[]): string[] {
  return refs.filter(ref => ref.type === 'video').map(ref => ref.url).filter(Boolean)
}

function collectAudios(refs: VideoContentRef[]): string[] {
  return refs.filter(ref => ref.type === 'audio').map(ref => ref.url).filter(Boolean)
}

function buildTagPrefix(imageCount: number, videoCount: number, audioCount: number): string {
  const tags = [
    ...Array.from({ length: imageCount }, (_, i) => `@图片${i + 1}`),
    ...Array.from({ length: videoCount }, (_, i) => `@视频${i + 1}`),
    ...Array.from({ length: audioCount }, (_, i) => `@音频${i + 1}`),
  ]
  return tags.length ? `${tags.join(' ')} ` : ''
}

/** 文档要求 prompt 内保留 @图片N / @视频N / @音频N */
export function buildAistarslabPrompt(
  prompt: string,
  imageCount: number,
  videoCount: number,
  audioCount: number,
): string {
  const text = normalizeVideoPromptFraming(String(prompt || '').trim())
  const prefix = buildTagPrefix(imageCount, videoCount, audioCount)
  if (!prefix) return text
  if (/@[图片视频音频]\s*\d/i.test(text)) return text
  return `${prefix}${text}`.trim()
}

export function resolveAistarslabModeType(input: {
  referenceMode?: string | null
  imageCount: number
  videoCount: number
  hasFirstLast: boolean
}): 'text2video' | 'image2video' | 'frames2video' {
  if (input.hasFirstLast || input.referenceMode === 'first_last') return 'frames2video'
  if (input.imageCount > 0 || input.videoCount > 0) return 'image2video'
  return 'text2video'
}

export function resolveAistarslabReferenceMode(referenceMode?: string | null): 'reference-to-video' | 'first-last-frame' {
  return referenceMode === 'first_last' ? 'first-last-frame' : 'reference-to-video'
}

function onlyPublicUrls(urls: string[]): string[] {
  return urls.filter(url => /^https?:\/\//i.test(String(url || '').trim()))
}

function resolveAistarslabResolution(model: string): string {
  const id = String(model || '').trim().toLowerCase()
  if (id.includes('480')) return '480p'
  return '720p'
}

function collectReferenceImages(input: {
  referenceMode?: string | null
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string[] | null
  contentRefs?: VideoContentRef[] | null
}): { images: string[]; videos: string[]; audios: string[]; useFirstLast: boolean } {
  const refs = input.contentRefs || []
  const useFirstLast = input.referenceMode === 'first_last'
    && !!(input.firstFrameUrl || input.lastFrameUrl)

  let images: string[] = []
  const videos = onlyPublicUrls(collectVideos(refs))
  const audios = onlyPublicUrls(collectAudios(refs))

  if (useFirstLast) {
    images = onlyPublicUrls([input.firstFrameUrl, input.lastFrameUrl].filter(Boolean).map(String))
  } else {
    const extraImages: string[] = []
    const refsHaveImages = refs.some(ref =>
      ref.type === 'image' && ref.role !== 'first_frame' && ref.role !== 'last_frame',
    )
    if (!refsHaveImages) {
      if (input.referenceMode === 'single' && input.imageUrl) {
        extraImages.push(input.imageUrl)
      }
      if (input.referenceImageUrls?.length) {
        extraImages.push(...input.referenceImageUrls)
      }
    }
    images = onlyPublicUrls(collectImages(refs, extraImages))
  }

  return { images, videos, audios, useFirstLast }
}

/** OpenAPI POST /openapi/video/task/v2 请求体（官方推荐协议） */
export function buildAistarslabOpenApiTaskPayload(input: {
  channel: string
  model: string
  prompt: string
  seconds: number
  aspectRatio: string
  referenceMode?: string | null
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string[] | null
  contentRefs?: VideoContentRef[] | null
}): Record<string, unknown> {
  const channel = String(input.channel).trim()
  const model = normalizeAistarslabModelSlug(input.model)
  const seconds = normalizeAistarslabDuration(input.seconds)
  const size = normalizeAistarslabAspectRatio(input.aspectRatio)
  const resolution = resolveAistarslabResolution(model)
  const { images, videos, audios, useFirstLast } = collectReferenceImages(input)
  const imageCount = useFirstLast ? 0 : images.length
  const modeType = resolveAistarslabModeType({
    referenceMode: input.referenceMode,
    imageCount,
    videoCount: videos.length,
    hasFirstLast: useFirstLast,
  })

  const body: Record<string, unknown> = {
    channel,
    model,
    resolution,
    prompt: buildAistarslabPrompt(input.prompt, imageCount, videos.length, audios.length),
    seconds,
    size,
    modeType,
  }

  if (images.length) body.images = images
  if (videos.length) body.videos = videos
  if (audios.length) body.audios = audios

  if (!useFirstLast && (images.length || videos.length || audios.length) === 0 && (input.contentRefs?.length ?? 0) > 0) {
    throw new Error('参考素材无法转为公网 URL，请检查 OSS 配置（backend/.env 中的 OSS_ACCESS_KEY_ID/SECRET）')
  }
  if (modeType !== 'text2video' && !images.length && !videos.length && !audios.length) {
    throw new Error('参考素材无法转为公网 URL，请检查 OSS 配置（backend/.env 中的 OSS_ACCESS_KEY_ID/SECRET）')
  }

  return body
}

/** @deprecated 使用 buildAistarslabOpenApiTaskPayload */
export const buildAistarslabNewApiTaskPayload = buildAistarslabOpenApiTaskPayload

/** @deprecated 使用 buildAistarslabOpenApiTaskPayload */
export const buildAistarslabTaskPayload = buildAistarslabOpenApiTaskPayload

export { AISTARSLAB_DURATION_BOUNDS }
