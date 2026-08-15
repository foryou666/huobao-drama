/**
 * AIGC Seedance 2.0 视频生成
 * 文档: https://share.note.youdao.com/s/5qdoOfj2
 * POST /api/external/v1/video/task/create
 * POST /api/external/v1/video/task/status
 * Header: ApiKey: <key>
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
import { buildAigcccTaskPayload } from '../../utils/aigccc-content.js'
import {
  AIGCCC_CREATE_PATH,
  AIGCCC_DEFAULT_BASE_URL,
  AIGCCC_STATUS_PATH,
  normalizeAigcccMode,
} from '../../constants/aigccc.js'
import {
  sanitizeUserFacingProviderError,
  UPSTREAM_BALANCE_SHORTAGE_USER_MESSAGE,
} from '../../utils/provider-error-sanitize.js'

function resolveBaseUrl(config: AIConfig) {
  return String(config.baseUrl || AIGCCC_DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
}

function authHeaders(config: AIConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ApiKey: String(config.apiKey || ''),
  }
}

export class AigcccVideoAdapter implements VideoProviderAdapter {
  provider = 'aigccc'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const refs = parseVideoContentRefs(record.referencePayload)
    let referenceImageUrls: string[] | null = null
    if (record.referenceImageUrls) {
      try {
        referenceImageUrls = JSON.parse(record.referenceImageUrls)
      } catch {
        referenceImageUrls = null
      }
    }

    const body = buildAigcccTaskPayload({
      mode: normalizeAigcccMode(record.model),
      prompt: record.prompt || '',
      seconds: record.duration ?? 15,
      aspectRatio: record.aspectRatio || '9:16',
      resolution: (config.settings as any)?.resolution || '720p',
      referenceMode: record.referenceMode,
      imageUrl: record.imageUrl,
      firstFrameUrl: record.firstFrameUrl,
      lastFrameUrl: record.lastFrameUrl,
      referenceImageUrls,
      contentRefs: refs,
    })

    return {
      url: joinProviderUrl(resolveBaseUrl(config), '', AIGCCC_CREATE_PATH),
      method: 'POST',
      headers: authHeaders(config),
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const code = result?.code
    if (code != null && code !== 0 && code !== '0') {
      const raw = String(result?.message || result?.msg || '创建视频任务失败')
      if (/远程提交失败/.test(raw)) {
        throw new Error(UPSTREAM_BALANCE_SHORTAGE_USER_MESSAGE)
      }
      throw new Error(sanitizeUserFacingProviderError(raw))
    }
    const data = result?.data ?? result
    const taskId = data?.task_id ?? data?.taskId ?? data?.id
    if (taskId == null || String(taskId).trim() === '') {
      throw new Error('视频任务未返回 task_id')
    }
    return { isAsync: true, taskId: String(taskId) }
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(resolveBaseUrl(config), '', AIGCCC_STATUS_PATH),
      method: 'POST',
      headers: authHeaders(config),
      body: { task_id: String(taskId).trim() },
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const code = result?.code
    if (code != null && code !== 0 && code !== '0') {
      return {
        status: 'failed',
        error: sanitizeUserFacingProviderError(String(result?.message || result?.msg || '查询任务失败')),
      }
    }
    const data = result?.data ?? result
    const status = String(data?.status || '').trim().toLowerCase()
    const videoUrl = String(data?.video_url || data?.videoUrl || '').trim()
    const error = String(data?.error || data?.error_message || data?.errorMessage || '').trim()

    if (status === 'succeeded' || status === 'success' || status === 'completed') {
      return { status: 'completed', videoUrl: videoUrl || undefined }
    }
    if (status === 'failed' || status === 'failure' || status === 'error') {
      return { status: 'failed', error: sanitizeUserFacingProviderError(error || '视频生成失败') }
    }
    if (status === 'running' || status === 'processing' || status === 'in_progress') {
      return { status: 'processing' }
    }
    if (videoUrl) return { status: 'completed', videoUrl }
    return { status: 'pending' }
  }

  extractVideoUrl(result: any): string | null {
    const data = result?.data ?? result
    return data?.video_url || data?.videoUrl || null
  }
}
