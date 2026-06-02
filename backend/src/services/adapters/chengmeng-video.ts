/**
 * 橙盟 Seedance 2.0 9图过人脸
 * 文档: https://chengmeng.site/docu
 * POST /api/tasks  ·  GET /api/tasks/:taskNo
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
import {
  aspectRatioToOrientation,
  buildChengmengPrompt,
  collectChengmengImages,
  collectChengmengVideos,
  normalizeChengmengDuration,
  parseChengmengModelIds,
} from '../../utils/chengmeng-content.js'
import { parseVideoContentRefs } from '../../utils/seedance-content.js'

export class ChengmengVideoAdapter implements VideoProviderAdapter {
  provider = 'chengmeng'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const { modelId, groupId } = parseChengmengModelIds(config)
    const refs = parseVideoContentRefs(record.referencePayload)
    const extraImages: string[] = []

    if (record.referenceMode === 'single' && record.imageUrl) {
      extraImages.push(record.imageUrl)
    } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
      try {
        extraImages.push(...JSON.parse(record.referenceImageUrls))
      } catch {}
    } else if (record.referenceMode === 'first_last') {
      if (record.firstFrameUrl) extraImages.push(record.firstFrameUrl)
      if (record.lastFrameUrl) extraImages.push(record.lastFrameUrl)
    }

    const images = collectChengmengImages(refs, extraImages)
    const videos = collectChengmengVideos(refs)
    const settings = config.settings || {}
    const size = String(settings.size || 'large')
    const watermark = settings.watermark === true

    const body: Record<string, unknown> = {
      model_id: modelId,
      group_id: groupId,
      prompt: buildChengmengPrompt(record.prompt || '', images.length, videos.length),
      duration: normalizeChengmengDuration(record.duration),
      aspectRatio: 'adaptive',
      values: {
        orientation: aspectRatioToOrientation(record.aspectRatio),
        aspectRatio: 'adaptive',
        size,
        watermark,
      },
    }

    if (images.length) body.images = images
    if (videos.length) {
      body.values = { ...(body.values as Record<string, unknown>), videos }
    }

    return {
      url: joinProviderUrl(config.baseUrl, '', '/api/tasks'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    if (result?.code !== 0) {
      throw new Error(result?.message || '创建视频任务失败')
    }
    const taskNo = result?.data?.task_no
    if (!taskNo) throw new Error('No task_no in response')
    return { isAsync: true, taskId: String(taskNo) }
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '', `/api/tasks/${encodeURIComponent(taskId)}`),
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    if (result?.code !== 0) {
      return { status: 'failed', error: result?.message || '查询任务失败' }
    }
    const data = result?.data || {}
    const status = String(data.status || 'pending').toLowerCase()

    if (status === 'completed' || status === 'success') {
      const videoUrl = data.result_url || data.download_url || null
      return { status: 'completed', videoUrl }
    }
    if (status === 'failed' || status === 'error') {
      return { status: 'failed', error: data.error_message || data.message || 'Video generation failed' }
    }
    if (status === 'cancelled') {
      return { status: 'failed', error: '任务已取消' }
    }
    if (status === 'running') return { status: 'processing' }
    return { status: 'pending' }
  }

  extractVideoUrl(result: any): string | null {
    return result?.data?.result_url || result?.data?.download_url || null
  }
}
