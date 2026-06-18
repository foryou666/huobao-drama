import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { JIMENG_BASE_URL } from '../../constants/jimeng-web.js'
import { buildJimengCookie } from '../jimeng-web-client.js'
import { getJimengWebSession } from '../jimeng-web-session.js'
import { parseJimengHistoryStatus } from '../jimeng-web-client.js'

export class JimengWebVideoAdapter implements VideoProviderAdapter {
  provider = 'jimeng_web'

  buildGenerateRequest(_config: AIConfig, _record: VideoGenerationRecord): ProviderRequest {
    throw new Error('即梦视频使用专用提交流程')
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    const historyId = result?.aigc_data?.history_record_id || result?.history_record_id
    if (historyId) return { isAsync: true, taskId: String(historyId) }
    throw new Error('即梦未返回 history_record_id')
  }

  buildPollRequest(_config: AIConfig, taskId: string): ProviderRequest {
    const session = getJimengWebSession()
    if (!session) throw new Error('即梦 Session 未配置')

    return {
      url: `${JIMENG_BASE_URL}/mweb/v1/get_history_by_ids`,
      method: 'POST',
      headers: {
        Cookie: buildJimengCookie(session),
        'Content-Type': 'application/json',
      },
      body: { history_ids: [taskId] },
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const historyData = typeof result === 'object' && result
      ? Object.values(result).find(item => item && typeof item === 'object' && 'status' in (item as object))
      : null
    const parsed = parseJimengHistoryStatus(historyData)
    if (parsed.status === 'completed' && parsed.videoUrl) {
      return { status: 'completed', videoUrl: parsed.videoUrl }
    }
    if (parsed.status === 'failed') {
      return { status: 'failed', error: parsed.error || '即梦视频生成失败' }
    }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    const historyData = typeof result === 'object' && result
      ? Object.values(result).find(item => item && typeof item === 'object' && 'item_list' in (item as object))
      : null
    const itemList = (historyData as any)?.item_list
    if (!Array.isArray(itemList) || !itemList.length) return null
    const parsed = parseJimengHistoryStatus(historyData)
    return parsed.videoUrl || null
  }
}
