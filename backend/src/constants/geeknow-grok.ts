/** GeekNow / xAI Grok 视频模型（与控制台一致） */
export const GROK_VIDEO_MODELS = {
  V1_5_PRO: 'grok-video-1.5-pro',
  V1_5_MAX: 'grok-video-1.5-max',
  V3_PRO: 'grok-video-3-pro',
  V3_MAX: 'grok-video-3-max',
} as const

export const GROK_VIDEO_MODEL_IDS = Object.values(GROK_VIDEO_MODELS)

export const GROK_VIDEO_DOC_URL = 'https://docs.geeknow.top/api-reference/videos/grok/overview'

/** 用户按次扣费（最低 750 积分，见 MIN_USER_VIDEO_CREDIT_COST） */
export const GROK_VIDEO_CREDIT_COST = 750

/** Grok 视频最短秒数（文档示例为 6，Pro/Max 允许在此范围内选择） */
export const GROK_VIDEO_SECONDS_MIN = 4

export interface GrokDurationBounds {
  min: number
  max: number
  defaultSec: number
}

/** Pro 最长 10s，Max 最长 15s（与 GeekNow 文档一致） */
export function grokVideoDurationBounds(model?: string | null): GrokDurationBounds {
  const m = String(model || '').trim().toLowerCase()
  if (m.endsWith('-max')) {
    return { min: GROK_VIDEO_SECONDS_MIN, max: 15, defaultSec: 15 }
  }
  if (m.endsWith('-pro')) {
    return { min: GROK_VIDEO_SECONDS_MIN, max: 10, defaultSec: 10 }
  }
  return { min: GROK_VIDEO_SECONDS_MIN, max: 15, defaultSec: 6 }
}

export function isGrokVideoModel(model?: string | null): boolean {
  const normalized = String(model || '').trim().toLowerCase()
  if (!normalized) return false
  return GROK_VIDEO_MODEL_IDS.some(id => id === normalized)
    || /^grok-video-\d/.test(normalized)
}

export function resolveGrokBillingSeconds(model?: string | null, duration?: number | null): number {
  const { min, max, defaultSec } = grokVideoDurationBounds(model)
  const parsed = Math.round(Number(duration ?? defaultSec))
  if (!Number.isFinite(parsed)) return defaultSec
  return Math.min(max, Math.max(min, parsed))
}

/** 工作台 9:16/16:9 → Grok aspect_ratio */
export function mapGrokAspectRatio(aspectRatio?: string | null): string {
  const ratio = String(aspectRatio || '').trim()
  if (ratio === '2:3' || ratio === '9:16' || ratio === 'portrait') return '2:3'
  if (ratio === '3:2' || ratio === '16:9' || ratio === 'landscape') return '3:2'
  if (ratio === '1:1') return '1:1'
  return '2:3'
}

export function normalizeGrokVideoSize(value?: string | null): string {
  const raw = String(value || '').trim().toUpperCase()
  if (raw === '1080P' || raw === '1080p') return '1080P'
  return '720P'
}

export function grokVideoModelLabel(modelId?: string | null): string {
  const id = String(modelId || '').trim()
  const map: Record<string, string> = {
    [GROK_VIDEO_MODELS.V1_5_PRO]: 'Grok 1.5 Pro',
    [GROK_VIDEO_MODELS.V1_5_MAX]: 'Grok 1.5 Max',
    [GROK_VIDEO_MODELS.V3_PRO]: 'Grok 3 Pro',
    [GROK_VIDEO_MODELS.V3_MAX]: 'Grok 3 Max',
  }
  return map[id] || id || 'Grok Video'
}
