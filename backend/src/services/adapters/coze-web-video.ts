import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'

export class CozeWebVideoAdapter implements VideoProviderAdapter {
  provider = 'coze_web'

  buildGenerateRequest(_config: AIConfig, _record: VideoGenerationRecord): ProviderRequest {
    throw new Error('扣子视频使用专用提交流程')
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const taskId = result?.id || result?.task_id
    if (taskId) return { isAsync: true, taskId: String(taskId) }
    throw new Error('扣子未返回任务 ID')
  }

  buildPollRequest(_config: AIConfig, _taskId: string): ProviderRequest {
    throw new Error('扣子视频使用专用轮询流程')
  }

  parsePollResponse(_result: any): VideoPollResponse {
    return { status: 'processing' }
  }

  extractVideoUrl(_result: any): string | null {
    return null
  }
}
