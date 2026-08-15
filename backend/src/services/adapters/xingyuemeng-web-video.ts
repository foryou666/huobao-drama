import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'

export class XingyuemengWebVideoAdapter implements VideoProviderAdapter {
  provider = 'xingyuemeng_web'

  buildGenerateRequest(_config: AIConfig, _record: VideoGenerationRecord): ProviderRequest {
    throw new Error('星月梦视频使用专用提交流程')
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const taskId = result?.taskId || result?.task_id || result?.id
    if (taskId) return { isAsync: true, taskId: String(taskId) }
    throw new Error('星月梦未返回任务 ID')
  }

  buildPollRequest(_config: AIConfig, _taskId: string): ProviderRequest {
    throw new Error('星月梦视频使用专用轮询流程')
  }

  parsePollResponse(_result: any): VideoPollResponse {
    return { status: 'processing' }
  }

  extractVideoUrl(_result: any): string | null {
    return null
  }
}
