import type { VideoContentRef } from './seedance-content.js'
import { parseVideoContentRefs } from './seedance-content.js'
import { normalizeVideoPromptFraming } from './video-prompt-framing.js'
import { ensureApiTrimmedAudioPath } from './audio-trim.js'
import {
  AISTARSLAB_DURATION_BOUNDS,
  AISTARSLAB_DEFAULT_REF_LIMITS,
  normalizeAistarslabAspectRatio,
  normalizeAistarslabDuration,
  normalizeAistarslabModelSlug,
  pickAistarslabResolution,
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

/** 保留用户 @；把「图片1是…」补成 @图片1，避免再整表刷前缀 */
function ensureAistarslabAtMentions(prompt: string): string {
  return String(prompt || '')
    .replace(/@音色\s*(\d+)/gi, '@音频$1')
    .replace(/(?<!@)音色\s*(\d+)/gi, '@音频$1')
    .replace(/(?<!@)图片\s*(\d+)/gi, '@图片$1')
    .replace(/(?<!@)视频\s*(\d+)/gi, '@视频$1')
    .replace(/(?<!@)素材\s*(\d+)/gi, '@视频$1')
    .replace(/(?<!@)音频\s*(\d+)/gi, '@音频$1')
}

/** 文档要求 prompt 内保留 @图片N / @视频N / @音频N；已有引用则不再全量补前缀 */
export function buildAistarslabPrompt(
  prompt: string,
  imageCount: number,
  videoCount: number,
  audioCount: number,
): string {
  const text = normalizeVideoPromptFraming(ensureAistarslabAtMentions(prompt)).trim()
  if (/@(?:图片|视频|音频)\s*\d/i.test(text)) return text
  const prefix = buildTagPrefix(imageCount, videoCount, audioCount)
  return prefix ? `${prefix}${text}`.trim() : text
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
  /** 上游模型允许的分辨率列表；缺省时按模型名启发式 */
  allowedResolutions?: string[] | null
  maxImages?: number | null
  maxVideos?: number | null
  maxAudios?: number | null
}): Record<string, unknown> {
  const channel = String(input.channel).trim()
  const model = normalizeAistarslabModelSlug(input.model)
  const seconds = normalizeAistarslabDuration(input.seconds)
  const size = normalizeAistarslabAspectRatio(input.aspectRatio)
  const resolution = pickAistarslabResolution(model, input.allowedResolutions)
  const { images, videos, audios, useFirstLast } = collectReferenceImages(input)
  const maxImages = input.maxImages == null ? AISTARSLAB_DEFAULT_REF_LIMITS.images : Number(input.maxImages)
  const maxVideos = input.maxVideos == null ? AISTARSLAB_DEFAULT_REF_LIMITS.videos : Number(input.maxVideos)
  const maxAudios = input.maxAudios == null ? AISTARSLAB_DEFAULT_REF_LIMITS.audios : Number(input.maxAudios)

  if (!useFirstLast && images.length > maxImages) {
    throw new Error(`当前线路最多支持 ${maxImages} 张参考图，当前 ${images.length} 张，请减少后重试`)
  }
  if (videos.length > maxVideos) {
    throw new Error(`当前线路最多支持 ${maxVideos} 个参考视频，当前 ${videos.length} 个，请减少后重试`)
  }
  if (audios.length > maxAudios) {
    throw new Error(`当前线路最多支持 ${maxAudios} 条参考音频，当前 ${audios.length} 条，请减少后重试`)
  }

  const imageCount = useFirstLast ? 0 : images.length
  const modeType = resolveAistarslabModeType({
    referenceMode: input.referenceMode,
    imageCount,
    videoCount: videos.length,
    hasFirstLast: useFirstLast,
  })

  const prompt = buildAistarslabPrompt(input.prompt, imageCount, videos.length, audios.length)

  const body: Record<string, unknown> = {
    channel,
    model,
    resolution,
    prompt,
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
