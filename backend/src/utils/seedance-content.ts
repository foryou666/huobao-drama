import type { ProviderRequest } from '../services/adapters/types.js'
import { joinProviderUrl } from '../services/adapters/url.js'
import { isSeedance2Model, seedanceDurationBounds } from '../constants/seedance.js'
import type { AIConfig, VideoGenerationRecord } from '../services/adapters/types.js'

export type VideoContentRefType = 'image' | 'video' | 'audio'
export type VideoImageRole = 'first_frame' | 'last_frame' | 'reference_image'

export interface VideoContentRef {
  type: VideoContentRefType
  url: string
  role?: VideoImageRole
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
 * 不要使用 @图片 / @Image1 这类标签语法（工作台内部旧稿可能带 @，发送前会剥掉）。
 */
export function normalizeSeedance2PromptText(prompt: string): string {
  return String(prompt || '')
    .replace(/@图片\s*(\d+)/gi, '图片$1')
    .replace(/@Image\s*(\d+)/gi, '图片$1')
    .replace(/@视频\s*(\d+)/gi, '视频$1')
    .replace(/@音频\s*(\d+)/gi, '音频$1')
}

export function enrichPromptWithReferenceLabels(prompt: string, refs: VideoContentRef[]): string {
  const text = normalizeSeedance2PromptText(String(prompt || '').trim())
  if (!refs.length) return text

  if (/图片\s*\d|视频\s*\d|音频\s*\d/i.test(text)) {
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

    if (ref.type === 'image') {
      const item: any = { type: 'image_url', image_url: { url: ref.url } }
      if (ref.role) item.role = ref.role
      content.push(item)
      continue
    }
    if (ref.type === 'video') {
      content.push({ type: 'video_url', video_url: { url: ref.url } })
      continue
    }
    if (ref.type === 'audio') {
      content.push({ type: 'audio_url', audio_url: { url: ref.url } })
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
    ratio: record.aspectRatio || 'adaptive',
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
