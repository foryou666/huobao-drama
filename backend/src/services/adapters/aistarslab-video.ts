/**
 * Seedance VIP — 官方 OpenAPI 协议
 * POST /openapi/video/task/v2
 * GET  /openapi/video/task/status?taskId=
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'
import { parseVideoContentRefs } from '../../utils/seedance-content.js'
import { buildAistarslabOpenApiTaskPayload } from '../../utils/aistarslab-content.js'
import {
  AISTARSLAB_DEFAULT_BASE_URL,
  AISTARSLAB_DEFAULT_CHANNEL,
  AISTARSLAB_DEFAULT_MODEL,
  AISTARSLAB_OPENAPI_CREATE_PATH,
  AISTARSLAB_OPENAPI_STATUS_PATH,
  normalizeAistarslabAspectRatio,
  normalizeAistarslabModelSlug,
} from '../../constants/aistarslab.js'
import { sanitizeUserFacingProviderError } from '../../utils/provider-error-sanitize.js'

function resolveBaseUrl(config: AIConfig) {
  let base = String(config.baseUrl || AISTARSLAB_DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  if (base.endsWith('/api')) base = base.slice(0, -4)
  return base
}

function resolveChannel(config: AIConfig, record: VideoGenerationRecord & { providerChannel?: string | null }) {
  const fromRecord = String(record.providerChannel || '').trim()
  if (fromRecord) return fromRecord
  const fromSettings = String((config.settings as any)?.channel || '').trim()
  if (fromSettings) return fromSettings
  return AISTARSLAB_DEFAULT_CHANNEL
}

function resolveModel(config: AIConfig, record: VideoGenerationRecord) {
  return normalizeAistarslabModelSlug(record.model || config.model || AISTARSLAB_DEFAULT_MODEL)
}

function unwrapTaskRecord(result: any) {
  if (Array.isArray(result)) return result[0]
  if (Array.isArray(result?.data)) return result.data[0]
  return result?.data ?? result
}

function mapOpenApiTaskStatus(record: any): VideoPollResponse {
  const data = record && typeof record === 'object' ? record : {}
  const outputUrl = String(data.outputUrl ?? data.output_url ?? data.video_url ?? '').trim()
  const errorMessage = String(data.errorMessage ?? data.error_message ?? '').trim()
  const errorCode = String(data.errorCode ?? data.error_code ?? '').trim()
  const statusRaw = data.status
  const statusNum = Number(statusRaw)
  const statusText = String(statusRaw ?? '').trim().toLowerCase()

  if (statusNum === 4 || statusText === 'failed' || statusText === 'failure') {
    return { status: 'failed', error: sanitizeUserFacingProviderError(errorMessage || '视频生成失败') }
  }
  if (statusNum === 3 || statusText === 'success' || statusText === 'completed') {
    return { status: 'completed', videoUrl: outputUrl || undefined }
  }
  if (statusNum === 1 || statusNum === 2 || statusNum === 5
    || statusText === 'pending' || statusText === 'processing' || statusText === 'transferring'
    || statusText === 'in_progress') {
    return { status: statusNum === 1 ? 'pending' : 'processing' }
  }
  if (errorMessage || errorCode) {
    return { status: 'failed', error: sanitizeUserFacingProviderError(errorMessage || errorCode) }
  }
  if (outputUrl) return { status: 'completed', videoUrl: outputUrl }
  return { status: 'processing' }
}

export class AistarslabVideoAdapter implements VideoProviderAdapter {
  provider = 'aistarslab'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord & { providerChannel?: string | null }): ProviderRequest {
    const refs = parseVideoContentRefs(record.referencePayload)
    let referenceImageUrls: string[] | null = null
    if (record.referenceImageUrls) {
      try {
        referenceImageUrls = JSON.parse(record.referenceImageUrls)
      } catch {
        referenceImageUrls = null
      }
    }

    const body = buildAistarslabOpenApiTaskPayload({
      channel: resolveChannel(config, record),
      model: resolveModel(config, record),
      prompt: record.prompt || '',
      seconds: record.duration ?? 15,
      aspectRatio: normalizeAistarslabAspectRatio(record.aspectRatio),
      referenceMode: record.referenceMode,
      imageUrl: record.imageUrl,
      firstFrameUrl: record.firstFrameUrl,
      lastFrameUrl: record.lastFrameUrl,
      referenceImageUrls,
      contentRefs: refs,
    })

    return {
      url: joinProviderUrl(resolveBaseUrl(config), '', AISTARSLAB_OPENAPI_CREATE_PATH),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const errMsg = result?.error?.message || result?.msg || result?.message
    const code = result?.code
    if (result?.error || (code != null && code !== 0 && code !== '0')) {
      throw new Error(sanitizeUserFacingProviderError(String(errMsg || '创建视频任务失败')))
    }
    const data = result?.data ?? result
    const pollKey = data?.taskId ?? data?.task_id ?? data?.id
    if (pollKey == null || String(pollKey).trim() === '') {
      throw new Error('视频任务未返回 ID')
    }
    return { isAsync: true, taskId: String(pollKey) }
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    const base = joinProviderUrl(resolveBaseUrl(config), '', AISTARSLAB_OPENAPI_STATUS_PATH)
    const url = `${base}?taskId=${encodeURIComponent(String(taskId).trim())}`
    return {
      url,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const code = result?.code
    if (code != null && code !== 0 && code !== '0') {
      return { status: 'failed', error: sanitizeUserFacingProviderError(String(result?.msg || result?.message || '查询任务失败')) }
    }
    return mapOpenApiTaskStatus(unwrapTaskRecord(result))
  }

  extractVideoUrl(result: any): string | null {
    const data = unwrapTaskRecord(result)
    return data?.outputUrl || data?.output_url || data?.video_url || null
  }
}
