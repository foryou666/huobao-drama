import type { VideoContentRef } from './seedance-content.js'
import { parseVideoContentRefs } from './seedance-content.js'
import { normalizeVideoPromptFraming } from './video-prompt-framing.js'
import { ensureApiTrimmedAudioPath } from './audio-trim.js'
import { resolveChengmengMediaUrl } from './chengmeng-content.js'
import {
  AIGCCC_DURATION_BOUNDS,
  AIGCCC_REF_LIMITS,
  normalizeAigcccAspectRatio,
  normalizeAigcccDuration,
  normalizeAigcccResolution,
  toAigcccUpstreamMode,
} from '../constants/aigccc.js'

export const resolveAigcccMediaUrl = resolveChengmengMediaUrl
export { AIGCCC_DURATION_BOUNDS }

export async function normalizeAigcccContentRefs(
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
      const url = await resolveAigcccMediaUrl(localPath, dramaId)
      return url ? { ...ref, url } : null
    }),
  )
  return normalized.filter((item): item is VideoContentRef => !!item)
}

export async function normalizeAigcccReferenceUrls(
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
      .map(item => resolveAigcccMediaUrl(item, dramaId)),
  )
  return normalized.filter((item): item is string => !!item)
}

function onlyPublicUrls(urls: string[]): string[] {
  return urls.filter(url => /^https?:\/\//i.test(String(url || '').trim()))
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

function collectByType(refs: VideoContentRef[], type: 'video' | 'audio'): string[] {
  return refs.filter(ref => ref.type === type).map(ref => ref.url).filter(Boolean)
}

function buildTagPrefix(imageCount: number, videoCount: number, audioCount: number): string {
  const tags = [
    ...Array.from({ length: imageCount }, (_, i) => `@图片${i + 1}`),
    ...Array.from({ length: videoCount }, (_, i) => `@视频${i + 1}`),
    ...Array.from({ length: audioCount }, (_, i) => `@音频${i + 1}`),
  ]
  return tags.length ? `${tags.join(' ')} ` : ''
}

function ensureAigcccAtMentions(prompt: string): string {
  return String(prompt || '')
    .replace(/@音色\s*(\d+)/gi, '@音频$1')
    .replace(/(?<!@)音色\s*(\d+)/gi, '@音频$1')
    .replace(/(?<!@)图片\s*(\d+)/gi, '@图片$1')
    .replace(/(?<!@)视频\s*(\d+)/gi, '@视频$1')
    .replace(/(?<!@)素材\s*(\d+)/gi, '@视频$1')
    .replace(/(?<!@)音频\s*(\d+)/gi, '@音频$1')
}

export function buildAigcccPrompt(
  prompt: string,
  imageCount: number,
  videoCount: number,
  audioCount: number,
): string {
  const text = normalizeVideoPromptFraming(ensureAigcccAtMentions(prompt)).trim()
  if (/@(?:图片|视频|音频)\s*\d/i.test(text)) return text
  const prefix = buildTagPrefix(imageCount, videoCount, audioCount)
  return prefix ? `${prefix}${text}`.trim() : text
}

function toUrlObjects(urls: string[]): Array<{ url: string }> {
  return urls.map(url => ({ url }))
}

/** POST /api/external/v1/video/task/create */
export function buildAigcccTaskPayload(input: {
  mode?: string | null
  prompt: string
  seconds: number
  aspectRatio: string
  resolution?: string | null
  referenceMode?: string | null
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string[] | null
  contentRefs?: VideoContentRef[] | null
}): Record<string, unknown> {
  const refs = input.contentRefs || []
  const useFirstLast = input.referenceMode === 'first_last'
    && !!(input.firstFrameUrl || input.lastFrameUrl)

  let images: string[] = []
  const videos = onlyPublicUrls(collectByType(refs, 'video')).slice(0, AIGCCC_REF_LIMITS.videos)
  const audios = onlyPublicUrls(collectByType(refs, 'audio')).slice(0, AIGCCC_REF_LIMITS.audios)

  if (useFirstLast) {
    images = onlyPublicUrls([input.firstFrameUrl, input.lastFrameUrl].filter(Boolean).map(String))
  } else {
    const extraImages: string[] = []
    const refsHaveImages = refs.some(ref =>
      ref.type === 'image' && ref.role !== 'first_frame' && ref.role !== 'last_frame',
    )
    if (!refsHaveImages) {
      if (input.referenceMode === 'single' && input.imageUrl) extraImages.push(input.imageUrl)
      if (input.referenceImageUrls?.length) extraImages.push(...input.referenceImageUrls)
    }
    images = onlyPublicUrls(collectImages(refs, extraImages)).slice(0, AIGCCC_REF_LIMITS.images)
  }

  if (!images.length) {
    throw new Error('该通道至少需要 1 张参考图（公网 URL）。本地图会自动转 OSS，请确认 OSS 已配置')
  }
  if (images.length > AIGCCC_REF_LIMITS.images) {
    throw new Error(`最多支持 ${AIGCCC_REF_LIMITS.images} 张参考图`)
  }

  const prompt = buildAigcccPrompt(input.prompt, images.length, videos.length, audios.length)
  const body: Record<string, unknown> = {
    prompt,
    mode: toAigcccUpstreamMode(input.mode),
    images: toUrlObjects(images),
    resolution: normalizeAigcccResolution(input.resolution),
    ratio: normalizeAigcccAspectRatio(input.aspectRatio),
    duration: normalizeAigcccDuration(input.seconds),
  }
  if (videos.length) body.videos = toUrlObjects(videos)
  if (audios.length) body.audios = toUrlObjects(audios)
  return body
}
