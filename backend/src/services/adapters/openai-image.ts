/**
 * OpenAI DALL-E / GPT Image 图片生成 Adapter
 * - 文生图: /v1/images/generations
 * - 参考图编辑 (gpt-image-*): /v1/images/edits (multipart)
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
import { normalizeImageSize } from '../../utils/image-size.js'
import { parseDataUrl } from '../../utils/storage.js'

function resolveModel(record: ImageGenerationRecord, config: AIConfig): string {
  return String(record.model || config.model || 'dall-e-3')
}

function isGptImageModel(model: string): boolean {
  // 花镜 Image-2 不支持 /v1/images/edits，仅 gpt-image* 走编辑接口
  return /gpt-image|chatgpt-image/i.test(model)
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

function referenceToUploadBlob(ref: string): { blob: Blob; filename: string } | null {
  const parsed = parseDataUrl(String(ref || ''))
  if (!parsed) return null
  const ext = parsed.mimeType.includes('jpeg') || parsed.mimeType.includes('jpg')
    ? 'jpg'
    : parsed.mimeType.includes('webp')
      ? 'webp'
      : 'png'
  const buffer = Buffer.from(parsed.data, 'base64')
  return {
    blob: new Blob([buffer], { type: parsed.mimeType }),
    filename: `reference.${ext}`,
  }
}

function buildEditFormData(record: ImageGenerationRecord, config: AIConfig): FormData {
  const model = resolveModel(record, config)
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', String(record.prompt || ''))
  const refs = parseReferenceImages(record.referenceImages)
  // 有参考图时按原图尺寸输出；文生图编辑才用剧集预设尺寸
  const size = normalizeImageSize(record.size)
  if (size && refs.length) form.append('size', size)

  for (const ref of refs.slice(0, 16)) {
    const file = referenceToUploadBlob(ref)
    if (file) form.append('image', file.blob, file.filename)
  }
  return form
}

export class OpenAIImageAdapter implements ImageProviderAdapter {
  provider = 'openai'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = resolveModel(record, config)
    const refs = parseReferenceImages(record.referenceImages)

    if (refs.length && isGptImageModel(model)) {
      return {
        url: joinProviderUrl(config.baseUrl, '/v1', '/images/edits'),
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: buildEditFormData(record, config),
      }
    }

    const size = normalizeImageSize(record.size)
    const body: any = {
      model,
      prompt: record.prompt,
      size,
      n: 1,
      response_format: 'url',
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/images/generations'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): ImageGenResponse {
    const asyncStatus = String(result.status || '').toLowerCase()
    if (result.task_id || (result.id && ['queued', 'processing', 'pending', 'running'].includes(asyncStatus))) {
      return { isAsync: true, taskId: result.task_id || result.id }
    }
    const imageUrl = result.data?.[0]?.url || result.url
    if (imageUrl) {
      return { isAsync: false, imageUrl }
    }
    const b64 = result.data?.[0]?.b64_json
    if (b64) {
      return { isAsync: false, imageUrl: undefined }
    }
    throw new Error('No image URL in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/images/task/${taskId}`),
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): ImagePollResponse {
    if (result.status === 'completed') {
      return {
        status: 'completed',
        imageUrl: result.image_url || result.data?.[0]?.url || null,
      }
    }
    if (result.status === 'failed') {
      return { status: 'failed', error: result.error?.message || 'Generation failed' }
    }
    return { status: result.status || 'processing' }
  }

  extractImageUrl(result: any): string | null {
    return result.data?.[0]?.url || result.image_url || null
  }

  extractImageBase64(result: any): { data: string; mimeType: string } | null {
    const b64 = result.data?.[0]?.b64_json
    if (b64) {
      return { data: b64, mimeType: 'image/png' }
    }
    return null
  }
}
