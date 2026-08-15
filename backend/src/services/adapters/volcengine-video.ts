/**
 * 火山引擎 Seedance 视频生成 Adapter
 * 端点: /api/v3/contents/generations/tasks (注意 /api/v3 前缀)
 * 响应: { id: "task-xxx" } -> 轮询获取状态
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
import { seedanceDurationBounds, SEEDANCE_MODELS, normalizeSeedanceResolution, isSeedance2FamilyModel } from '../../constants/seedance.js'
import {
  buildSeedance2GenerateRequest,
  parseVideoContentRefs,
  shouldUseSeedance2Multimodal,
} from '../../utils/seedance-content.js'
import { seedanceRatioRequestFields } from '../../utils/video-aspect-ratio.js'
import { extractVolcengineApiErrorMessage, formatVolcengineVideoError } from '../../utils/volcengine-video-errors.js'

export class VolcEngineVideoAdapter implements VideoProviderAdapter {
  provider = 'volcengine'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || SEEDANCE_MODELS.V1_5_PRO
    const contentRefs = parseVideoContentRefs(record.referencePayload)
    if (shouldUseSeedance2Multimodal(model, contentRefs)) {
      return buildSeedance2GenerateRequest(config, record, contentRefs)
    }

    const content: any[] = [{ type: 'text', text: record.prompt || '' }]

    // 添加参考图
    if (record.referenceMode === 'single' && record.imageUrl) {
      content.push({ type: 'image_url', image_url: { url: record.imageUrl } })
    } else if (record.referenceMode === 'first_last') {
      if (record.firstFrameUrl) {
        content.push({ type: 'image_url', image_url: { url: record.firstFrameUrl }, role: 'first_frame' })
      }
      if (record.lastFrameUrl) {
        content.push({ type: 'image_url', image_url: { url: record.lastFrameUrl }, role: 'last_frame' })
      }
    } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
      try {
        const refs = JSON.parse(record.referenceImageUrls)
        for (const url of refs) {
          content.push({ type: 'image_url', image_url: { url } })
        }
      } catch {}
    }

    const hasReferenceMedia = content.some(item => item.type === 'image_url')
    const body: any = {
      model,
      content,
      generate_audio: true,
      ...seedanceRatioRequestFields(record.aspectRatio, model, hasReferenceMedia, config.baseUrl),
      duration: this.normalizeDuration(record.duration, model),
      watermark: false,
    }
    if (isSeedance2FamilyModel(model)) {
      body.resolution = normalizeSeedanceResolution(record.resolution, model)
    }

    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', '/contents/generations/tasks'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    if (result.id) {
      return { isAsync: true, taskId: result.id }
    }
    // 同步返回
    const videoUrl = result.video_url || result.content?.video_url || result.data?.video_url
    if (videoUrl) {
      return { isAsync: false, videoUrl }
    }
    throw new Error('No task_id or video_url in response')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', `/contents/generations/tasks/${taskId}`),
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  buildCancelRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v3', `/contents/generations/tasks/${taskId}`),
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = String(result.status || '').toLowerCase()
    if (status === 'succeeded' || status === 'success' || status === 'completed') {
      const videoUrl = result.content?.video_url
        || result.video_url
        || result.output?.video_url
        || result.data?.video_url
      return {
        status: 'completed',
        videoUrl,
      }
    }
    if (status === 'failed' || status === 'error') {
      const raw = extractVolcengineApiErrorMessage(
        typeof result.error === 'string' ? result.error : JSON.stringify(result.error || result),
      ) || String(result.error?.message || result.message || 'Video generation failed')
      return { status: 'failed', error: formatVolcengineVideoError(raw, this.provider) }
    }
    if (status === 'cancelled' || status === 'canceled') {
      return { status: 'cancelled', error: '任务已取消' }
    }
    if (status === 'expired') {
      return { status: 'expired', error: '任务已过期' }
    }
    if (status === 'queued' || status === 'pending' || status === 'submitted') {
      return { status: 'pending' }
    }
    if (status === 'running' || status === 'processing') {
      return { status: 'processing' }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result.video_url || result.content?.video_url || result.data?.video_url || null
  }

  private normalizeDuration(duration?: number | null, model?: string): number {
    const { min, max, defaultSec } = seedanceDurationBounds(model)
    const parsed = Math.round(Number(duration || defaultSec))
    if (!Number.isFinite(parsed)) return defaultSec
    return Math.min(max, Math.max(min, parsed))
  }
}
