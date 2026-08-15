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

export function isGrokVideoModel(model?: string | null): boolean {
  const normalized = String(model || '').trim().toLowerCase()
  if (!normalized) return false
  if (GROK_VIDEO_MODEL_IDS.some(id => id === normalized)) return true
  if (/^grok-video-\d/.test(normalized)) return true
  if (/^grok-imagine-video/.test(normalized)) return true
  return false
}

export function resolveGrokBillingSeconds(model?: string | null, duration?: number | null): number {
  const { min, max, defaultSec } = grokVideoDurationBounds(model)
  const parsed = Math.round(Number(duration ?? defaultSec))
  if (!Number.isFinite(parsed)) return defaultSec
  return Math.min(max, Math.max(min, parsed))
}

/** Pro 最长 10s，Max 最长 15s；Imagine / 启灵泽 1.x 默认 6–10s */
export function grokVideoDurationBounds(model?: string | null): GrokDurationBounds {
  const m = String(model || '').trim().toLowerCase()
  if (m.endsWith('-max') || m.includes('1080p')) {
    return { min: GROK_VIDEO_SECONDS_MIN, max: 15, defaultSec: 15 }
  }
  if (m.includes('imagine')) {
    return { min: 1, max: 15, defaultSec: 6 }
  }
  if (m === 'grok-video-1.0' || m === 'grok-video-1.5' || m.endsWith('-pro') || m.endsWith('-fast')) {
    return { min: GROK_VIDEO_SECONDS_MIN, max: 10, defaultSec: 10 }
  }
  return { min: GROK_VIDEO_SECONDS_MIN, max: 15, defaultSec: 6 }
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
    'grok-video-1.0': 'Grok Video 1.0',
    'grok-video-1.5': 'Grok Video 1.5',
    'grok-imagine-video': 'Grok Imagine Video',
    'grok-imagine-video-1.5': 'Grok Imagine 1.5',
    'grok-imagine-video-1.5-fast': 'Grok Imagine 1.5 Fast',
    'grok-imagine-video-1.5-1080p': 'Grok Imagine 1.5 1080p',
    'grok-imagine-video-1.5-preview': 'Grok Imagine 1.5 Preview',
  }
  return map[id] || id || 'Grok Video'
}
