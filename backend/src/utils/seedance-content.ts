import type { ProviderRequest } from '../services/adapters/types.js'
import { joinProviderUrl } from '../services/adapters/url.js'
import { isSeedance2Model, seedanceDurationBounds } from '../constants/seedance.js'
import type { AIConfig, VideoGenerationRecord } from '../services/adapters/types.js'
import { seedanceRatioRequestFields } from './video-aspect-ratio.js'
import { normalizeVideoPromptFraming } from './video-prompt-framing.js'

export type VideoContentRefType = 'image' | 'video' | 'audio'
export type VideoImageRole = 'first_frame' | 'last_frame' | 'reference_image'
export type VideoMediaRole = VideoImageRole | 'reference_video' | 'reference_audio'

/** 火山官方 Seedance 2.0 多模态 content[] 所需的 role 字段 */
export function seedanceMultimodalContentRole(ref: Pick<VideoContentRef, 'type' | 'role'>): VideoMediaRole | undefined {
  if (ref.type === 'image') {
    if (ref.role === 'first_frame' || ref.role === 'last_frame') return ref.role
    return 'reference_image'
  }
  if (ref.type === 'video') return 'reference_video'
  if (ref.type === 'audio') return 'reference_audio'
  return undefined
}

export interface VideoContentRef {
  type: VideoContentRefType
  url: string
  role?: VideoMediaRole | 'voice_reference'
  label?: string
}

export function parseVideoContentRefs(raw: string | null | undefined): VideoContentRef[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => ({
        type: item.type as VideoContentRefType,
        url: String(item.url || '').trim(),
        role: item.role,
        label: item.label,
      }))
      .filter(item => item.url && ['image', 'video', 'audio'].includes(item.type))
  } catch {
    return []
  }
}

/**
 * Seedance 2.0 官方写法：content[] 里传 image_url 等，文本用「图片1是…」「图片2是…」自然语言关联。
 * 工作台改为用户手写 @图片N；发送前剥掉 @，若完全没有编号引用则按 content_refs 自动补说明头。
 */
export function normalizeSeedance2PromptText(prompt: string): string {
  return String(prompt || '')
    .replace(/@图片\s*(\d+)/gi, '图片$1')
    .replace(/@图\s*(\d+)/gi, '图$1')
    .replace(/@Image\s*(\d+)/gi, '图片$1')
    .replace(/@视频\s*(\d+)/gi, '视频$1')
    .replace(/@音频\s*(\d+)/gi, '音频$1')
}

export function enrichPromptWithReferenceLabels(prompt: string, refs: VideoContentRef[]): string {
  const text = normalizeVideoPromptFraming(normalizeSeedance2PromptText(String(prompt || '').trim()))
  if (!refs.length) return text

  // 用户已手写 @图片N / 图片N是… 等编号引用时，保留原文（仅完成 @ → 自然语言）
  if (/图片\s*\d|图\s*\d|视频\s*\d|音频\s*\d/i.test(text)) {
    return text
  }

  const header = buildAutoReferenceHeader(refs)
  if (!header) return text
  return `${header}${text}`
}

function buildAutoReferenceHeader(refs: VideoContentRef[]) {
  let imageIdx = 0
  let videoIdx = 0
  let audioIdx = 0
  const lines: string[] = []
  for (const ref of refs) {
    if (ref.type === 'image') {
      if (ref.role === 'first_frame' || ref.role === 'last_frame') continue
      imageIdx += 1
      const assetTag = ref.url?.startsWith('asset://') ? ' [方舟素材]' : ''
      lines.push(`图片${imageIdx}是${ref.label || '参考图'}${assetTag}`)
    } else if (ref.type === 'video') {
      videoIdx += 1
      lines.push(`视频${videoIdx}（${ref.label || '参考视频'}）`)
    } else if (ref.type === 'audio') {
      audioIdx += 1
      lines.push(`音频${audioIdx}（${ref.label || '参考音频'}）`)
    }
  }
  if (!lines.length) return ''
  return [
    '【多模态参考】以下编号与本次请求上传顺序一致：',
    ...lines,
    '',
  ].join('\n')
}

export function buildSeedance2Content(prompt: string, refs: VideoContentRef[]) {
  const text = enrichPromptWithReferenceLabels(prompt, refs)
  const content: any[] = [{ type: 'text', text }]
  const seen = new Set<string>()

  for (const ref of refs) {
    const key = `${ref.type}:${ref.url}`
    if (seen.has(key)) continue
    seen.add(key)

    const role = seedanceMultimodalContentRole(ref)
    if (ref.type === 'image') {
      const item: any = { type: 'image_url', image_url: { url: ref.url } }
      if (role) item.role = role
      content.push(item)
      continue
    }
    if (ref.type === 'video') {
      const item: any = { type: 'video_url', video_url: { url: ref.url } }
      if (role) item.role = role
      content.push(item)
      continue
    }
    if (ref.type === 'audio') {
      const item: any = { type: 'audio_url', audio_url: { url: ref.url } }
      if (role) item.role = role
      content.push(item)
    }
  }

  return content
}

export function buildSeedance2GenerateRequest(
  config: AIConfig,
  record: VideoGenerationRecord,
  refs: VideoContentRef[],
): ProviderRequest {
  const model = record.model || config.model || ''
  const body: any = {
    model,
    content: buildSeedance2Content(record.prompt || '', refs),
    generate_audio: true,
    ...seedanceRatioRequestFields(record.aspectRatio, model, true, config.baseUrl),
    duration: normalizeSeedanceDuration(record.duration, model),
    watermark: false,
  }

  return {
    url: joinProviderUrl(config.baseUrl, '/api/v3', '/contents/generations/tasks'),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body,
  }
}

function normalizeSeedanceDuration(duration?: number | null, model?: string) {
  const { min, max, defaultSec } = seedanceDurationBounds(model)
  const parsed = Math.round(Number(duration || defaultSec))
  if (!Number.isFinite(parsed)) return defaultSec
  return Math.min(max, Math.max(min, parsed))
}

export function shouldUseSeedance2Multimodal(model?: string | null, refs?: VideoContentRef[]) {
  return isSeedance2Model(model) && !!refs?.length
}
