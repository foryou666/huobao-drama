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
  buildChengmengPrompt,
  collectChengmengAudios,
  collectChengmengImages,
  collectChengmengVideos,
  normalizeChengmengAspectRatio,
  normalizeChengmengDuration,
  normalizeChengmengResolution,
  parseChengmengModelIds,
  type ChengmengVideoMode,
} from '../../utils/chengmeng-content.js'
import { parseVideoContentRefs } from '../../utils/seedance-content.js'

export class ChengmengVideoAdapter implements VideoProviderAdapter {
  provider = 'chengmeng'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const { modelId, groupId } = parseChengmengModelIds(config)
    const refs = parseVideoContentRefs(record.referencePayload)
    const settings = config.settings || {}
    const aspectRatio = normalizeChengmengAspectRatio(record.aspectRatio)
    const duration = normalizeChengmengDuration(record.duration)
    const resolution = normalizeChengmengResolution(settings.resolution as string | undefined)

    const videos = collectChengmengVideos(refs)
    const audios = collectChengmengAudios(refs)
    const useFramesMode = record.referenceMode === 'first_last'
      && !!(record.firstFrameUrl || record.lastFrameUrl)

    let mode: ChengmengVideoMode = useFramesMode ? 'frames' : 'references'
    let images: string[] = []
    const values: Record<string, unknown> = {
      mode,
      aspect_ratio: aspectRatio,
      duration,
      resolution,
    }

    if (mode === 'frames') {
      if (record.firstFrameUrl) values.first_frame = record.firstFrameUrl
      if (record.lastFrameUrl) values.last_frame = record.lastFrameUrl
    } else {
      const extraImages: string[] = []
      if (record.referenceMode === 'single' && record.imageUrl) {
        extraImages.push(record.imageUrl)
      } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
        try {
          extraImages.push(...JSON.parse(record.referenceImageUrls))
        } catch {}
      }
      images = collectChengmengImages(refs, extraImages)
      if (videos.length) values.videos = videos
      if (audios.length) values.audioUrls = audios
    }

    const body: Record<string, unknown> = {
      model_id: modelId,
      group_id: groupId,
      prompt: buildChengmengPrompt(
        record.prompt || '',
        mode === 'references' ? images.length : 0,
        videos.length,
      ),
      values,
    }

    if (mode === 'references' && images.length) body.images = images
    if (mode === 'references' && !images.length && !videos.length && !audios.length) {
      throw new Error('参考素材无法转为公网 URL，请检查 OSS 配置（backend/.env 中的 OSS_ACCESS_KEY_ID/SECRET）')
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
