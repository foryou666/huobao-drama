/** S通道8 · 橙星梦工厂（mgc.funshion.com / ai.fun.tv）Bearer Token 网页通道 */

export const FUNSHION_SITE_URL = 'https://mgc.funshion.com'
export const FUNSHION_ALT_SITE_URL = 'https://ai.fun.tv'

export const FUNSHION_VIDEO_MODELS = {
  SEEDANCE_2_0_FAST: 'funshion-video-seedance-2.0-fast',
  SEEDANCE_2_0: 'funshion-video-seedance-2.0',
} as const

export const FUNSHION_DEFAULT_VIDEO_MODEL = FUNSHION_VIDEO_MODELS.SEEDANCE_2_0_FAST

export const FUNSHION_ENABLED_VIDEO_MODELS = [
  FUNSHION_VIDEO_MODELS.SEEDANCE_2_0_FAST,
  FUNSHION_VIDEO_MODELS.SEEDANCE_2_0,
] as const

/** 上游模型 value（与网页 VideoOptionsForm 一致） */
export const FUNSHION_UPSTREAM_MODELS: Record<string, string> = {
  [FUNSHION_VIDEO_MODELS.SEEDANCE_2_0_FAST]: 'doubao-2.0-fast',
  [FUNSHION_VIDEO_MODELS.SEEDANCE_2_0]: 'doubao-2.0',
}

export const FUNSHION_TAB_APP_CODE = 'n-image2video' as const
export const FUNSHION_TEXT2VIDEO_TAB = 'text2video' as const
export const FUNSHION_IMAGE2VIDEO_TAB = '2-image2video' as const

export function resolveFunshionTabAppCode(refCount: number): string {
  if (refCount <= 0) return FUNSHION_TEXT2VIDEO_TAB
  if (refCount === 1) return FUNSHION_IMAGE2VIDEO_TAB
  return FUNSHION_TAB_APP_CODE
}

export const FUNSHION_DURATION_BOUNDS = {
  min: 4,
  max: 15,
  defaultSec: 5,
} as const

export const FUNSHION_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const
export const FUNSHION_DEFAULT_ASPECT_RATIO = '9:16'
/**
 * 上游清晰度。
 * Seedance 2.0 Fast 在纯文生视频(t2v)下对高分辨率更严；默认用 480p。
 * 带参考图时仍可能允许 720p，故 Fast 保留 480/720 供对照；满血可到 1080p。
 */
export const FUNSHION_RESOLUTIONS = ['480p', '720p', '1080p'] as const
export const FUNSHION_FAST_RESOLUTIONS = ['480p', '720p'] as const
export const FUNSHION_DEFAULT_CLARITY = '480p'

/** 后处理超分（video-enhance）：固定 2K；上游可选 1080p/2k/4k */
export const FUNSHION_ENHANCE_CLARITY = '2k' as const
export const FUNSHION_ENHANCE_INSTANCE_TYPE = 'funshion_2k' as const
/** 上游 2k 约 4 星币；本站按次扣费默认值 */
export const FUNSHION_ENHANCE_2K_CREDIT_COST = 40

export const FUNSHION_REF_LIMITS = {
  images: 9,
  audios: 3,
  videos: 3,
} as const

export const FUNSHION_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND = 60
export const FUNSHION_SEEDANCE_2_0_CREDITS_PER_SECOND = 80

export function isFunshionVideoModel(model?: string | null): boolean {
  return (FUNSHION_ENABLED_VIDEO_MODELS as readonly string[]).includes(String(model || '').trim())
}

export function resolveFunshionUpstreamModel(model?: string | null): string {
  const id = String(model || FUNSHION_DEFAULT_VIDEO_MODEL).trim()
  return FUNSHION_UPSTREAM_MODELS[id] || FUNSHION_UPSTREAM_MODELS[FUNSHION_DEFAULT_VIDEO_MODEL]
}

export function resolveFunshionVideoCreditAction(model?: string | null): string {
  const id = String(model || '').trim()
  if (id === FUNSHION_VIDEO_MODELS.SEEDANCE_2_0) return 'video.generate.funshion.seedance2'
  return 'video.generate.funshion.seedance2_fast'
}

export function resolveFunshionCreditCostDefault(model?: string | null): number {
  const id = String(model || '').trim()
  if (id === FUNSHION_VIDEO_MODELS.SEEDANCE_2_0) return FUNSHION_SEEDANCE_2_0_CREDITS_PER_SECOND
  return FUNSHION_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND
}

export function funshionVideoModelLabel(model?: string | null): string {
  const id = String(model || '').trim()
  if (id === FUNSHION_VIDEO_MODELS.SEEDANCE_2_0) return 'S 2.0'
  if (id === FUNSHION_VIDEO_MODELS.SEEDANCE_2_0_FAST) return 'S 2.0 Fast'
  return id || 'S 2.0 Fast'
}

export function normalizeFunshionDuration(duration?: number | null): number {
  const n = Math.round(Number(duration ?? FUNSHION_DURATION_BOUNDS.defaultSec))
  if (!Number.isFinite(n)) return FUNSHION_DURATION_BOUNDS.defaultSec
  return Math.min(FUNSHION_DURATION_BOUNDS.max, Math.max(FUNSHION_DURATION_BOUNDS.min, n))
}

export function normalizeFunshionAspectRatio(
  ratio?: string | null,
  fallback = FUNSHION_DEFAULT_ASPECT_RATIO,
): string {
  const r = String(ratio || '').trim()
  if ((FUNSHION_ASPECT_RATIOS as readonly string[]).includes(r)) return r
  return fallback
}

export function normalizeFunshionClarity(
  resolution?: string | null,
  fallback = FUNSHION_DEFAULT_CLARITY,
  model?: string | null,
): string {
  const raw = String(resolution || '').trim().toLowerCase()
  let clarity = fallback
  if ((FUNSHION_RESOLUTIONS as readonly string[]).includes(raw as any)) clarity = raw
  else if (raw === '1080' || raw === '1920x1080') clarity = '1080p'
  else if (raw === '720' || raw === '1280x720') clarity = '720p'
  else if (raw === '480' || raw === '854x480' || raw === '640x480') clarity = '480p'

  const id = String(model || '').trim()
  const isFast = !id || id === FUNSHION_VIDEO_MODELS.SEEDANCE_2_0_FAST
    || id.includes('fast')
  if (isFast && !(FUNSHION_FAST_RESOLUTIONS as readonly string[]).includes(clarity as any)) {
    return FUNSHION_DEFAULT_CLARITY
  }
  return clarity
}

export function funshionResolutionsForModel(model?: string | null): string[] {
  const id = String(model || '').trim()
  if (id === FUNSHION_VIDEO_MODELS.SEEDANCE_2_0) return [...FUNSHION_RESOLUTIONS]
  return [...FUNSHION_FAST_RESOLUTIONS]
}

export function resolveFunshionApiBaseUrl(baseUrl?: string | null): string {
  const raw = String(baseUrl || '').trim().replace(/\/+$/, '')
  return raw || FUNSHION_SITE_URL
}

export function normalizeFunshionAuthHeader(raw?: string | null): string {
  let value = String(raw || '').trim()
  if (!value) return ''
  // 网页把 localStorage.token 原样写入 Authorization；允许用户只粘贴纯 token
  if (!/^bearer\s+/i.test(value) && !/\s/.test(value) && value.length > 20) {
    // 保持纯 token 也可；部分环境响应头自带 Bearer
    return value
  }
  return value
}
