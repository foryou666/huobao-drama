import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'

export class XyqWebVideoAdapter implements VideoProviderAdapter {
  provider = 'xyq_web'

  buildGenerateRequest(_config: AIConfig, _record: VideoGenerationRecord): ProviderRequest {
    throw new Error('小云雀视频使用专用提交流程')
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const threadId = result?.thread_id || result?.run?.thread_id
    const runId = result?.run_id || result?.run?.run_id
    if (threadId && runId) return { isAsync: true, taskId: `${threadId}|${runId}` }
    throw new Error('小云雀未返回 thread_id/run_id')
  }

  buildPollRequest(_config: AIConfig, _taskId: string): ProviderRequest {
    throw new Error('小云雀视频使用专用轮询流程')
  }

  parsePollResponse(_result: any): VideoPollResponse {
    return { status: 'processing' }
  }

  extractVideoUrl(_result: any): string | null {
    return null
  }
}
