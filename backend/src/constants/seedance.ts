/** 火山方舟 Seedance 视频模型 ID（与官方文档一致） */
export const SEEDANCE_MODELS = {
  V1_5_PRO: 'doubao-seedance-1-5-pro-251215',
  V2_0: 'doubao-seedance-2-0-260128',
  V2_0_FAST: 'doubao-seedance-2-0-fast-260128',
  /** Seedance 2.0 Mini（2026-06-15 方舟上线） */
  V2_0_MINI: 'doubao-seedance-2-0-mini-260615',
  /** Seedance 2.5（2026-08-07 API 上线） */
  V2_5: 'doubao-seedance-2-5-260628',
} as const

export const SEEDANCE_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com'

/** 影光工场推荐一键配置使用的 ChatFire 火山统一网关（与文本/图片/音频一致） */
export const SEEDANCE_CHATFIRE_BASE_URL = 'https://api.chatfire.site/volcengine'

export const SEEDANCE_DOC_URL = 'https://www.volcengine.com/docs/82379/1520757?lang=zh'

/** Seedance 2.x 分辨率（方舟 `resolution` 字段） */
export const SEEDANCE_RESOLUTIONS = {
  P480: '480p',
  P720: '720p',
  P1080: '1080p',
} as const

export type SeedanceResolution = typeof SEEDANCE_RESOLUTIONS[keyof typeof SEEDANCE_RESOLUTIONS]

/** 通道2 默认模型：Fast；分辨率默认 480p */
export const OFFICIAL_CHANNEL2_LOCKED_MODEL = SEEDANCE_MODELS.V2_0_FAST
export const OFFICIAL_CHANNEL2_DEFAULT_MODEL = SEEDANCE_MODELS.V2_0_FAST
export const OFFICIAL_CHANNEL2_MINI_MODEL = SEEDANCE_MODELS.V2_0_MINI
export const OFFICIAL_CHANNEL2_STANDARD_MODEL = SEEDANCE_MODELS.V2_0
export const OFFICIAL_CHANNEL2_V25_MODEL = SEEDANCE_MODELS.V2_5
export const OFFICIAL_CHANNEL2_LOCKED_RESOLUTION: SeedanceResolution = SEEDANCE_RESOLUTIONS.P480

/** 通道2 Seedance 2.5 参考素材上限（与方舟/即梦 2.5 对齐） */
export const OFFICIAL_SEEDANCE_2_5_REF_LIMITS = {
  images: 30,
  audios: 10,
  videos: 10,
  maxTotal: 50,
} as const

/** 通道2 Fast 可选高分辨率（超分=720p）的用户名白名单 */
export const OFFICIAL_CHANNEL2_HD_USERNAMES = new Set(['wangbing'])

/** @deprecated 通道2 Seedance 2.0 已全员开放；保留空集避免外部引用报错 */
export const OFFICIAL_CHANNEL2_STANDARD_USERNAMES = new Set<string>()

/** 前端展示：仅 480p / 720p 两档 */
export const OFFICIAL_CHANNEL2_RESOLUTION_CHOICES = [
  { id: SEEDANCE_RESOLUTIONS.P480, label: '480p' },
  { id: SEEDANCE_RESOLUTIONS.P720, label: '720p' },
] as const

export function canSelectOfficialChannel2Hd(
  username?: string | null,
  role?: string | null,
): boolean {
  if (String(role || '').trim().toLowerCase() === 'admin') return true
  return OFFICIAL_CHANNEL2_HD_USERNAMES.has(String(username || '').trim().toLowerCase())
}

/** 通道2 Seedance 2.0（标准版）全员可选 */
export function canSelectOfficialChannel2Standard(
  _username?: string | null,
  _role?: string | null,
): boolean {
  return true
}

/** 默认 Fast；全员可选 2.5 / Mini / 标准版 Seedance 2.0 */
export function resolveOfficialChannel2Model(
  requested?: string | null,
  _username?: string | null,
  _role?: string | null,
): string {
  const value = String(requested || '').trim()
  if (value === OFFICIAL_CHANNEL2_V25_MODEL) return OFFICIAL_CHANNEL2_V25_MODEL
  if (value === OFFICIAL_CHANNEL2_MINI_MODEL) return OFFICIAL_CHANNEL2_MINI_MODEL
  if (value === OFFICIAL_CHANNEL2_STANDARD_MODEL) return OFFICIAL_CHANNEL2_STANDARD_MODEL
  if (value === OFFICIAL_CHANNEL2_DEFAULT_MODEL) return OFFICIAL_CHANNEL2_DEFAULT_MODEL
  return OFFICIAL_CHANNEL2_DEFAULT_MODEL
}

/**
 * 通道2 全员可选 480p / 720p（与通道9 价表对齐；不再按白名单锁死）。
 * Mini / Fast 最高 720p；标准版 / 2.5 若请求更高清也回落到 720p。
 */
export function resolveOfficialChannel2Resolution(
  requested?: string | null,
  _username?: string | null,
  _role?: string | null,
  _model?: string | null,
): SeedanceResolution {
  const value = String(requested || '').trim().toLowerCase()
  if (value === SEEDANCE_RESOLUTIONS.P720) return SEEDANCE_RESOLUTIONS.P720
  return SEEDANCE_RESOLUTIONS.P480
}

/** 通道2 默认 480p（Fast 资源包更省 token） */
export const SEEDANCE_DEFAULT_RESOLUTION: SeedanceResolution = SEEDANCE_RESOLUTIONS.P480

/** 按模型返回可选分辨率：Mini/Fast 最高 720p；2.5/标准版支持到 1080p */
export function seedanceResolutionsForModel(model?: string | null): SeedanceResolution[] {
  if (isSeedance2MiniModel(model) || isSeedance2FastModel(model)) {
    return [SEEDANCE_RESOLUTIONS.P480, SEEDANCE_RESOLUTIONS.P720]
  }
  if (isSeedance25Model(model) || isSeedance2Model(model)) {
    return [SEEDANCE_RESOLUTIONS.P480, SEEDANCE_RESOLUTIONS.P720, SEEDANCE_RESOLUTIONS.P1080]
  }
  return [SEEDANCE_RESOLUTIONS.P480, SEEDANCE_RESOLUTIONS.P720]
}

export function normalizeSeedanceResolution(
  raw?: string | null,
  model?: string | null,
): SeedanceResolution {
  const allowed = seedanceResolutionsForModel(model)
  const value = String(raw || '').trim().toLowerCase()
  if (allowed.includes(value as SeedanceResolution)) return value as SeedanceResolution
  return allowed.includes(SEEDANCE_DEFAULT_RESOLUTION)
    ? SEEDANCE_DEFAULT_RESOLUTION
    : allowed[0]
}

/** 火山方舟 Seedance 2.x 官方价：元 / 百万 output tokens（按是否含视频输入分档） */
export const SEEDANCE_YUAN_PER_MILLION_TOKENS = {
  V2_0_NO_VIDEO: 46,
  V2_0_WITH_VIDEO: 28,
  V2_0_FAST_NO_VIDEO: 37,
  V2_0_FAST_WITH_VIDEO: 22,
  /** Mini：0.023 / 0.014 元/千 tokens → 23 / 14 元/百万 */
  V2_0_MINI_NO_VIDEO: 23,
  V2_0_MINI_WITH_VIDEO: 14,
} as const

/** Seedance 2.0 / 2.0 Fast / Mini（不含 2.5） */
export function isSeedance2Model(model?: string | null): boolean {
  const m = (model || '').toLowerCase()
  if (m.includes('seedance-2-5') || m.includes('seedance-2.5')) return false
  return m.includes('seedance-2-0') || m.includes('seedance-2.0')
}

export function isSeedance2FastModel(model?: string | null): boolean {
  const m = (model || '').toLowerCase()
  return m.includes('seedance-2-0-fast') || m.includes('seedance-2.0-fast')
}

export function isSeedance2MiniModel(model?: string | null): boolean {
  const m = (model || '').toLowerCase()
  return m.includes('seedance-2-0-mini') || m.includes('seedance-2.0-mini')
}

/** Seedance 2.5 */
export function isSeedance25Model(model?: string | null): boolean {
  const m = (model || '').toLowerCase()
  return m.includes('seedance-2-5') || m.includes('seedance-2.5')
}

/** 方舟 Seedance 2.x 多模态族（2.0 / 2.5） */
export function isSeedance2FamilyModel(model?: string | null): boolean {
  return isSeedance2Model(model) || isSeedance25Model(model)
}

/** 按官方价估算单次任务费用（元）；tokens 通常取 usage.completion_tokens / total_tokens */
export function estimateSeedanceYuanFromTokens(
  model?: string | null,
  tokens?: number | null,
  hasVideoInput = false,
): number | null {
  const n = Number(tokens)
  if (!Number.isFinite(n) || n <= 0) return null
  const mini = isSeedance2MiniModel(model)
  const fast = isSeedance2FastModel(model)
  let rate: number
  if (mini) {
    rate = hasVideoInput
      ? SEEDANCE_YUAN_PER_MILLION_TOKENS.V2_0_MINI_WITH_VIDEO
      : SEEDANCE_YUAN_PER_MILLION_TOKENS.V2_0_MINI_NO_VIDEO
  } else if (fast) {
    rate = hasVideoInput
      ? SEEDANCE_YUAN_PER_MILLION_TOKENS.V2_0_FAST_WITH_VIDEO
      : SEEDANCE_YUAN_PER_MILLION_TOKENS.V2_0_FAST_NO_VIDEO
  } else {
    rate = hasVideoInput
      ? SEEDANCE_YUAN_PER_MILLION_TOKENS.V2_0_WITH_VIDEO
      : SEEDANCE_YUAN_PER_MILLION_TOKENS.V2_0_NO_VIDEO
  }
  return Math.round((n / 1_000_000) * rate * 10000) / 10000
}

/** 按模型返回 API 允许的时长范围（秒） */
export function seedanceDurationBounds(model?: string | null): { min: number; max: number; defaultSec: number } {
  if (isSeedance25Model(model)) {
    return { min: 4, max: 30, defaultSec: 10 }
  }
  if (isSeedance2MiniModel(model) || isSeedance2FastModel(model) || isSeedance2Model(model)) {
    return { min: 4, max: 15, defaultSec: 5 }
  }
  return { min: 4, max: 12, defaultSec: 5 }
}
