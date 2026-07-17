/**
 * APIMart 图片生成 Adapter
 * - 文生图 / 图生图: POST /v1/images/generations（异步 task_id）
 * - 轮询: GET /v1/tasks/{task_id}
 * @see https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation.md
 */
import type {
  ImageProviderAdapter,
  ProviderRequest,
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
} from './types'
import { joinProviderUrl } from './url'
import {
  APIMART_DEFAULT_BASE_URL,
  APIMART_PRESET_PIXEL_TO_RATIO,
  parseApimartResolution,
  parseApimartResolutionFromSettings,
  type ApimartImageResolution,
} from '../../constants/apimart.js'

const APIMART_RATIOS: Array<{ label: string; value: number }> = [
  { label: '1:1', value: 1 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '5:4', value: 5 / 4 },
  { label: '4:5', value: 4 / 5 },
  { label: '2:1', value: 2 },
  { label: '1:2', value: 0.5 },
  { label: '3:1', value: 3 },
  { label: '1:3', value: 1 / 3 },
  { label: '21:9', value: 21 / 9 },
  { label: '9:21', value: 9 / 21 },
]

function resolveModel(record: ImageGenerationRecord, config: AIConfig): string {
  const model = String(record.model || config.model || 'gpt-image-2')
  if (/gpt-image/i.test(model)) return 'gpt-image-2'
  return model
}

function parseReferenceImages(raw?: string | null): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

export function mapApimartImageSize(
  size?: string | null,
  defaultResolution: ApimartImageResolution = '1k',
): { size: string; resolution: ApimartImageResolution } {
  const fallback = { size: '1:1', resolution: defaultResolution }
  const raw = String(size || '').trim()
  if (!raw) return fallback

  if (/^\d+:\d+$/.test(raw)) {
    return { size: raw, resolution: defaultResolution }
  }

  const presetRatio = APIMART_PRESET_PIXEL_TO_RATIO[raw.toLowerCase()]
  if (presetRatio) {
    return { size: presetRatio, resolution: defaultResolution }
  }

  const match = /^(\d+)\s*x\s*(\d+)$/i.exec(raw)
  if (!match) return fallback

  const width = Number(match[1])
  const height = Number(match[2])
  if (!width || !height) return fallback

  const ratio = width / height
  let best = APIMART_RATIOS[0]
  let bestDiff = Number.POSITIVE_INFINITY
  for (const item of APIMART_RATIOS) {
    const diff = Math.abs(Math.log(ratio / item.value))
    if (diff < bestDiff) {
      bestDiff = diff
      best = item
    }
  }

  return {
    size: best.label,
    resolution: defaultResolution,
  }
}

function extractTaskId(result: any): string | null {
  const fromArray = result?.data?.[0]?.task_id
  if (fromArray) return String(fromArray)
  const direct = result?.data?.task_id || result?.task_id
  return direct ? String(direct) : null
}

function extractImageUrlFromResult(result: any): string | null {
  const data = result?.data || result
  const images = data?.result?.images
  if (!Array.isArray(images) || !images.length) return null
  const urlField = images[0]?.url
  if (Array.isArray(urlField)) return urlField[0] || null
  return typeof urlField === 'string' ? urlField : null
}

export class ApimartImageAdapter implements ImageProviderAdapter {
  provider = 'apimart'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = resolveModel(record, config)
    // quality 字段承载单次请求分辨率（1k/2k/4k）；未传时回退配置默认
    const resolution = parseApimartResolution(record.quality)
      || parseApimartResolutionFromSettings(config.settings)
    const mapped = mapApimartImageSize(record.size, resolution)
    const refs = parseReferenceImages(record.referenceImages)

    const body: Record<string, unknown> = {
      model,
      prompt: String(record.prompt || ''),
      size: mapped.size,
      resolution: mapped.resolution,
      n: 1,
    }

    if (refs.length) {
      body.image_urls = refs.slice(0, 16)
    }

    return {
      url: joinProviderUrl(config.baseUrl || APIMART_DEFAULT_BASE_URL, '/v1', '/images/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const taskId = extractTaskId(result)
    if (taskId) return { isAsync: true, taskId }

    const imageUrl = extractImageUrlFromResult(result)
    if (imageUrl) return { isAsync: false, imageUrl }

    const err = result?.error?.message || result?.message
    if (err) throw new Error(String(err))
    throw new Error('No task_id or image URL in APIMart response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const pollUrl = new URL(
      joinProviderUrl(config.baseUrl || APIMART_DEFAULT_BASE_URL, '/v1', `/tasks/${taskId}`),
    )
    pollUrl.searchParams.set('language', 'zh')
    return {
      url: pollUrl.toString(),
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    const data = result?.data || result
    const status = String(data?.status || '').toLowerCase()

    if (status === 'completed') {
      return {
        status: 'completed',
        imageUrl: extractImageUrlFromResult(result) || undefined,
      }
    }

    if (status === 'failed' || status === 'cancelled') {
      const err = data?.error?.message || data?.error || result?.error?.message || 'Generation failed'
      return { status: 'failed', error: String(err) }
    }

    if (status === 'submitted' || status === 'pending') {
      return { status: 'pending' }
    }

    return { status: 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return extractImageUrlFromResult(result)
  }

  extractImageBase64(): { data: string; mimeType: string } | null {
    return null
  }
}
