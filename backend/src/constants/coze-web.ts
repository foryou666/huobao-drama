/** 扣子网页通道（S通道7）：Cookie / PAT → Coze Ark 兼容 Seedance 2.0 */

export const COZE_SITE_URL = 'https://www.coze.cn'
export const COZE_API_BASE_URL = 'https://api.coze.cn'
export const COZE_IMPERSONATE_PATH = '/api/permission_api/coze_web_app/impersonate_coze_user'

export const COZE_VIDEO_MODELS = {
  SEEDANCE_2_0_FAST: 'coze-video-seedance-2.0-fast',
  SEEDANCE_2_0: 'coze-video-seedance-2.0',
} as const

export const COZE_DEFAULT_VIDEO_MODEL = COZE_VIDEO_MODELS.SEEDANCE_2_0_FAST

export const COZE_ENABLED_VIDEO_MODELS = [
  COZE_VIDEO_MODELS.SEEDANCE_2_0_FAST,
  COZE_VIDEO_MODELS.SEEDANCE_2_0,
] as const

/** 上游方舟模型 ID（与 Coze Coding / Ark 一致） */
export const COZE_UPSTREAM_MODELS: Record<string, string> = {
  [COZE_VIDEO_MODELS.SEEDANCE_2_0_FAST]: 'doubao-seedance-2-0-fast-260128',
  [COZE_VIDEO_MODELS.SEEDANCE_2_0]: 'doubao-seedance-2-0-260128',
}

export const COZE_DURATION_BOUNDS = {
  min: 4,
  max: 15,
  defaultSec: 5,
} as const

export const COZE_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const
export const COZE_DEFAULT_ASPECT_RATIO = '16:9'

export const COZE_REF_LIMITS = {
  images: 9,
  audios: 3,
  videos: 3,
} as const

/** 本站按秒默认价（积分） */
export const COZE_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND = 50
export const COZE_SEEDANCE_2_0_CREDITS_PER_SECOND = 65

export function isCozeVideoModel(model?: string | null): boolean {
  return (COZE_ENABLED_VIDEO_MODELS as readonly string[]).includes(String(model || '').trim())
}

export function isCozeEnabledVideoModel(model?: string | null): boolean {
  return isCozeVideoModel(model)
}

export function resolveCozeUpstreamModel(model?: string | null): string {
  const id = String(model || COZE_DEFAULT_VIDEO_MODEL).trim()
  return COZE_UPSTREAM_MODELS[id] || COZE_UPSTREAM_MODELS[COZE_DEFAULT_VIDEO_MODEL]
}

export function resolveCozeVideoCreditAction(model?: string | null): string {
  const id = String(model || '').trim()
  if (id === COZE_VIDEO_MODELS.SEEDANCE_2_0) return 'video.generate.coze.seedance2'
  return 'video.generate.coze.seedance2_fast'
}

export function resolveCozeCreditCostDefault(model?: string | null): number {
  const id = String(model || '').trim()
  if (id === COZE_VIDEO_MODELS.SEEDANCE_2_0) return COZE_SEEDANCE_2_0_CREDITS_PER_SECOND
  return COZE_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND
}

export function cozeVideoModelLabel(model?: string | null): string {
  const id = String(model || '').trim()
  if (id === COZE_VIDEO_MODELS.SEEDANCE_2_0) return 'S 2.0'
  if (id === COZE_VIDEO_MODELS.SEEDANCE_2_0_FAST) return 'S 2.0 Fast'
  return id || 'S 2.0 Fast'
}

export function normalizeCozeDuration(duration?: number | null): number {
  const n = Math.round(Number(duration ?? COZE_DURATION_BOUNDS.defaultSec))
  if (!Number.isFinite(n)) return COZE_DURATION_BOUNDS.defaultSec
  return Math.min(COZE_DURATION_BOUNDS.max, Math.max(COZE_DURATION_BOUNDS.min, n))
}

export function normalizeCozeAspectRatio(ratio?: string | null, fallback = COZE_DEFAULT_ASPECT_RATIO): string {
  const r = String(ratio || '').trim()
  if ((COZE_ASPECT_RATIOS as readonly string[]).includes(r)) return r
  return fallback
}

export function resolveCozeApiBaseUrl(baseUrl?: string | null): string {
  const raw = String(baseUrl || '').trim().replace(/\/+$/, '')
  return raw || COZE_API_BASE_URL
}
