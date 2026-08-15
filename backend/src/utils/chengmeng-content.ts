import { logTaskWarn } from './task-logger.js'
import { isOssConfigured, resolveMediaUrlForExternalApi } from './oss-upload.js'
import type { VideoContentRef } from './seedance-content.js'
import { parseVideoContentRefs } from './seedance-content.js'
import {
  CHENGMENT_DEFAULT_GROUP_ID,
  CHENGMENT_DEFAULT_MODEL_ID,
  CHENGMENT_DURATION_BOUNDS,
  CHENGMENT_PROMPT_MAX_LENGTH,
  isChengmengVideoModelId,
  remapChengmengChannel1ModelId,
  resolveChengmengModelResolution,
} from '../constants/chengmeng.js'
import { ensureApiTrimmedAudioPath } from './audio-trim.js'
import { normalizeVideoPromptFraming } from './video-prompt-framing.js'

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
export async function resolveChengmengMediaUrl(
  value: string | null | undefined,
  dramaId?: number | null,
): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw

  const staticPath = normalizeStaticPath(raw)
  if (staticPath) {
    if (isOssConfigured()) {
      return resolveMediaUrlForExternalApi(staticPath, dramaId)
    }
    const base = publicBaseUrl()
    if (base) return `${base}/${staticPath}`
    logTaskWarn('ChengmengVideo', 'missing-public-base-url', {
      path: staticPath,
      hint: '请配置 OSS（OSS_ACCESS_KEY_ID/SECRET）或 PUBLIC_BASE_URL',
    })
    return null
  }

  if (raw.startsWith('data:')) {
    logTaskWarn('ChengmengVideo', 'data-url-skipped', {
      hint: '第三方 Seedance 接口不支持 data URI，请配置 OSS 或 PUBLIC_BASE_URL',
    })
    return null
  }

  return raw
}

export async function normalizeChengmengContentRefs(raw: string | null | undefined): Promise<VideoContentRef[]> {
  const refs = parseVideoContentRefs(raw)
  const normalized = await Promise.all(
    refs.map(async (ref) => {
      let localPath = ref.url
      if (ref.type === 'audio') {
        localPath = await ensureApiTrimmedAudioPath(ref.url)
      }
      const url = await resolveChengmengMediaUrl(localPath)
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

export { CHENGMENT_PROMPT_MAX_LENGTH }

/** 音色 → 音频（保留已有 @） */
export function normalizeChengmengAudioLabels(prompt: string): string {
  return String(prompt || '')
    .replace(/@音色\s*(\d+)/gi, '@音频$1')
    .replace(/(?<!@)音色\s*(\d+)/gi, '音频$1')
}

/**
 * 上游识别 @图片N / @素材N / @音频N。
 * 保留用户手写的 @；把正文里的「图片1是…」等补成 @；前端 @视频N 映射为橙盟 @素材N。
 */
export function ensureChengmengAtMentions(prompt: string): string {
  return normalizeChengmengAudioLabels(prompt)
    .replace(/@视频\s*(\d+)/gi, '@素材$1')
    .replace(/(?<!@)图片\s*(\d+)/gi, '@图片$1')
    .replace(/(?<!@)素材\s*(\d+)/gi, '@素材$1')
    .replace(/(?<!@)视频\s*(\d+)/gi, '@素材$1')
    .replace(/(?<!@)音频\s*(\d+)/gi, '@音频$1')
}

function formatVoicePromptLabel(label?: string | null): string {
  const raw = String(label || '').trim()
  if (!raw) return '参考音色的声音'
  if (/的声音$/.test(raw)) return raw
  return `${raw.replace(/的声音$/, '')}的声音`
}

function buildChengmengAudioHeader(refs: VideoContentRef[], prompt: string): string {
  const audios = refs.filter(ref => ref.type === 'audio')
  if (!audios.length) return ''
  const normalizedPrompt = ensureChengmengAtMentions(prompt)
  if (/@?音频\s*\d/i.test(normalizedPrompt)) return ''
  const lines = audios.map((ref, index) => `@音频${index + 1}是${formatVoicePromptLabel(ref.label)}`)
  return `${lines.join('，')}。`
}

export function buildChengmengTagPrefix(imageCount: number, videoCount: number, audioCount = 0) {
  const imageTags = Array.from({ length: Math.max(0, imageCount) }, (_, i) => `@图片${i + 1}`)
  const videoTags = Array.from({ length: Math.max(0, videoCount) }, (_, i) => `@素材${i + 1}`)
  const audioTags = Array.from({ length: Math.max(0, audioCount) }, (_, i) => `@音频${i + 1}`)
  const tags = [...imageTags, ...videoTags, ...audioTags]
  return tags.length ? `${tags.join(' ')} ` : ''
}

export function estimateChengmengPromptLength(prompt: string, imageCount: number, videoCount = 0, audioCount = 0) {
  const text = ensureChengmengAtMentions(String(prompt || '').trim())
  const hasMentions = /@(?:图片|素材|音频)\s*\d/i.test(text)
  const prefixLen = hasMentions ? 0 : buildChengmengTagPrefix(imageCount, videoCount, audioCount).length
  return prefixLen + text.length
}

export function formatChengmengPromptOverLimitMessage(
  sendLength: number,
  limit = CHENGMENT_PROMPT_MAX_LENGTH,
): string {
  const over = Math.max(0, sendLength - limit)
  return `视频提示词约 ${sendLength} 字符（含 @图片N 前缀），已超过建议 ${limit} 字符（超出 ${over}）。上游未规定硬上限，仍可提交，但过长可能影响生成质量。`
}

/** 橙盟未规定字数硬上限；保留函数兼容旧调用，不再抛错 */
export function assertChengmengPromptLength(
  _prompt: string,
  _imageCount: number,
  _videoCount = 0,
  _audioCount = 0,
): void {
  /* no-op */
}

/** 与橙盟 adapter 一致：估算 @ 标签前缀所需的图片/素材/音频数量 */
export function resolveChengmengPromptMediaCounts(input: {
  prompt?: string | null
  referenceMode?: string | null
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string[] | null
  contentRefs?: VideoContentRef[] | null
}): { imageCount: number; videoCount: number; audioCount: number } {
  const refs = input.contentRefs || []
  const videos = collectChengmengVideos(refs)
  const audios = collectChengmengAudios(refs)
  const useFramesMode = input.referenceMode === 'first_last'
    && !!(input.firstFrameUrl || input.lastFrameUrl)
  if (useFramesMode) return { imageCount: 0, videoCount: videos.length, audioCount: audios.length }

  const extraImages: string[] = []
  if (!refs.length) {
    if (input.referenceMode === 'single' && input.imageUrl) {
      extraImages.push(input.imageUrl)
    } else if (input.referenceMode === 'multiple' && input.referenceImageUrls?.length) {
      extraImages.push(...input.referenceImageUrls)
    }
  }
  return {
    imageCount: collectChengmengImages(refs, extraImages).length,
    videoCount: videos.length,
    audioCount: audios.length,
  }
}

const CHENGMENT_TRUNC_NOTE = `…（已达视频生成 ${CHENGMENT_PROMPT_MAX_LENGTH} 字符上限，后续镜头未发送）`

export function truncateChengmengPromptBody(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  if (maxLen <= CHENGMENT_TRUNC_NOTE.length + 8) {
    return text.slice(0, Math.max(0, maxLen)).trimEnd()
  }

  const budget = maxLen - CHENGMENT_TRUNC_NOTE.length
  const marker = '【镜头'
  const shots: number[] = []
  let pos = 0
  while (pos < text.length) {
    const idx = text.indexOf(marker, pos)
    if (idx < 0) break
    shots.push(idx)
    pos = idx + marker.length
  }

  let best = ''
  for (let i = 0; i < shots.length; i++) {
    const end = i + 1 < shots.length ? shots[i + 1] : text.length
    const chunk = text.slice(0, end).trimEnd()
    if (chunk.length <= budget) best = chunk
    else break
  }

  if (best && best.length < text.length) {
    return `${best}${CHENGMENT_TRUNC_NOTE}`
  }

  return `${text.slice(0, budget).trimEnd()}${CHENGMENT_TRUNC_NOTE}`
}

/**
 * 橙盟用 @图片N / @素材N / @音频N 关联素材。
 * 保留前端手写的 @；把「图片1是…」等补成 @；仅当正文完全没有 @ 引用时，才按素材数量补前缀。
 */
export function buildChengmengPrompt(
  prompt: string,
  imageCount: number,
  videoCount: number,
  audioCount = 0,
  contentRefs: VideoContentRef[] = [],
): string {
  const withMentions = ensureChengmengAtMentions(prompt)
  const audioHeader = buildChengmengAudioHeader(contentRefs, withMentions)
  const mergedPrompt = audioHeader
    ? `${audioHeader}${withMentions}`.trim()
    : withMentions
  const text = normalizeVideoPromptFraming(ensureChengmengAtMentions(mergedPrompt)).trim()
  // 注意：不能用 /@[图片素材音频]/ —— 字符类只匹配单字，匹配不到「@图片1」
  if (/@(?:图片|素材|音频)\s*\d/i.test(text)) return text
  const prefix = buildChengmengTagPrefix(imageCount, videoCount, audioCount)
  return prefix ? `${prefix}${text}`.trim() : text
}

export function collectChengmengImages(refs: VideoContentRef[], extraUrls: string[] = []): string[] {
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

/** 发给橙盟 API 的分辨率：按 model_id（32/53/71→720p；旧 70/77→480p） */
export function resolveChengmengApiResolution(
  modelId: string,
  _settingsResolution?: string | null,
): string {
  return resolveChengmengModelResolution(modelId || CHENGMENT_DEFAULT_MODEL_ID)
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

/** 任务级 model 覆盖（视频生成页从 /api/models 同步的 model_id） */
export function resolveChengmengModelIds(
  config: { model?: string; models?: string[] },
  modelOverride?: string | null,
) {
  const override = String(modelOverride || '').trim()
  if (isChengmengVideoModelId(override)) {
    return {
      modelId: remapChengmengChannel1ModelId(override),
      groupId: CHENGMENT_DEFAULT_GROUP_ID,
    }
  }
  const parsed = parseChengmengModelIds(config)
  return {
    modelId: remapChengmengChannel1ModelId(parsed.modelId),
    groupId: parsed.groupId || CHENGMENT_DEFAULT_GROUP_ID,
  }
}
