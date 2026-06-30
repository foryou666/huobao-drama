/** 即梦 Web 端（jimeng.jianying.com）视频生成常量
 * 通道4 使用 Session 模拟登录 + Playwright 签名，协议以 Web 端为准，
 * 勿直接套用 jimeng-api 的 model/benefit 映射（40 / 40_pro 为旧档非 VIP vision）。
 */

export const JIMENG_BASE_URL = 'https://jimeng.jianying.com'
export const JIMENG_VIDEO_REFERER = 'https://jimeng.jianying.com/ai-tool/generate?type=video'

export const JIMENG_ASSISTANT_ID = 513695
export const JIMENG_PLATFORM_CODE = '7'
export const JIMENG_VERSION_CODE = '8.4.0'
export const JIMENG_DRAFT_VERSION = '3.3.9'
export const JIMENG_WEB_VERSION = '7.5.0'
export const JIMENG_DA_VERSION = '3.3.9'

export const JIMENG_VIDEO_MODELS = {
  SEEDANCE_2_0_FAST: 'jimeng-video-seedance-2.0-fast',
  SEEDANCE_2_0: 'jimeng-video-seedance-2.0',
  SEEDANCE_2_0_MINI: 'jimeng-video-seedance-2.0-mini',
} as const

export const JIMENG_DEFAULT_VIDEO_MODEL = JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST

/** 通道4 前台展示的两档 VIP 模型（Fast VIP 在前，与默认选中一致） */
export const JIMENG_ENABLED_VIDEO_MODELS = [
  JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST,
  JIMENG_VIDEO_MODELS.SEEDANCE_2_0,
] as const

/** 即梦上游 model_req_key（来自 /mweb/v1/video_generate/get_common_config） */
export const JIMENG_UPSTREAM_MODELS = {
  /** Seedance 2.0 Fast VIP · 会员专属通道 */
  SEEDANCE_40_VISION: 'dreamina_seedance_40_vision',
  /** Seedance 2.0 VIP · 会员专属通道 */
  SEEDANCE_40_PRO_VISION: 'dreamina_seedance_40_pro_vision',
  SEEDANCE_40_MINI: 'dreamina_seedance_40_mini',
} as const

/**
 * 前台模型 → 即梦上游 model_req_key（通道4 固定 omni_reference / unified_edit）
 * 以即梦 Web get_common_config 为准（非 jimeng-api 旧映射）：
 * - Seedance 2.0 Fast VIP → dreamina_seedance_40_vision
 * - Seedance 2.0 VIP → dreamina_seedance_40_pro_vision
 */
export const JIMENG_UPSTREAM_MODEL_MAP: Record<string, string> = {
  [JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST]: JIMENG_UPSTREAM_MODELS.SEEDANCE_40_VISION,
  [JIMENG_VIDEO_MODELS.SEEDANCE_2_0]: JIMENG_UPSTREAM_MODELS.SEEDANCE_40_PRO_VISION,
  [JIMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI]: JIMENG_UPSTREAM_MODELS.SEEDANCE_40_MINI,
}

/** 通道4 可选画幅（Web Seedance 2.0 VIP / Fast VIP） */
export const JIMENG_ASPECT_RATIOS = ['16:9', '9:16'] as const
export const JIMENG_DEFAULT_ASPECT_RATIO = '9:16'

/** 即梦 Web 端全能参考上限（omni_reference） */
export const JIMENG_REF_LIMITS = {
  images: 9,
  audios: 3,
  videos: 3,
} as const

export const JIMENG_OMNI_MAX_TOTAL_REFS = 12
export const JIMENG_OMNI_MAX_TOTAL_AUDIO_SECONDS = 15
export const JIMENG_OMNI_MAX_TOTAL_VIDEO_SECONDS = 15.4

export const JIMENG_DRAFT_VERSION_OMNI = '3.3.9'

/** Web 端 commercial_config.default.benefit_type（720p，来自 get_common_config） */
export const JIMENG_OMNI_BENEFIT_TYPE_PRO = 'seedance_20_pro_720p_output'
export const JIMENG_OMNI_BENEFIT_TYPE_FAST = 'seedance_20_fast_720p_output'
export const JIMENG_OMNI_BENEFIT_TYPE_MINI = 'seedance_20_mini_720p_output'
/** @deprecated jimeng-api 旧 omni benefit，Web Session 不使用 */
export const JIMENG_OMNI_BENEFIT_TYPE = 'dreamina_video_seedance_20_video_add'

export function formatJimengRefLimitsHint(): string {
  const { images, audios, videos } = JIMENG_REF_LIMITS
  return `${images}图 ${audios}音 ${videos}视频`
}

export const JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST = 0
export const JIMENG_SEEDANCE_2_0_CREDIT_COST = 0
/** @deprecated 兼容旧定价项 */
export const JIMENG_VIDEO_CREDIT_COST = JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST

export function isJimengVideoModel(model?: string | null): boolean {
  const normalized = String(model || '').trim().toLowerCase()
  return normalized.startsWith('jimeng-video-')
    || Object.values(JIMENG_VIDEO_MODELS).includes(normalized as typeof JIMENG_VIDEO_MODELS[keyof typeof JIMENG_VIDEO_MODELS])
}

export function isJimengEnabledVideoModel(model?: string | null): boolean {
  const normalized = String(model || '').trim().toLowerCase()
  return (JIMENG_ENABLED_VIDEO_MODELS as readonly string[]).includes(normalized)
}

export function resolveJimengInternalModel(model?: string | null): string {
  const normalized = String(model || JIMENG_DEFAULT_VIDEO_MODEL).trim().toLowerCase()
  return JIMENG_UPSTREAM_MODEL_MAP[normalized]
    || JIMENG_UPSTREAM_MODEL_MAP[JIMENG_DEFAULT_VIDEO_MODEL]
}

export function jimengVideoModelLabel(modelId?: string | null): string {
  const normalized = String(modelId || '').trim().toLowerCase()
  const labels: Record<string, string> = {
    [JIMENG_VIDEO_MODELS.SEEDANCE_2_0]: 'Seedance 2.0 VIP',
    [JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST]: 'Seedance 2.0 Fast VIP',
    [JIMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI]: 'Seedance 2.0 Mini',
  }
  return labels[normalized] || normalized
}

export function jimengVideoDurationBounds(model?: string | null): { min: number; max: number; defaultSec: number; options: number[] } {
  const internal = resolveJimengInternalModel(model)
  if (internal.includes('40_mini')) {
    return { min: 5, max: 12, defaultSec: 5, options: [5, 8, 10, 12] }
  }
  if (internal.includes('40_pro') || internal.includes('40')) {
    return { min: 4, max: 15, defaultSec: 5, options: [4, 5, 8, 10, 15] }
  }
  return { min: 4, max: 15, defaultSec: 5, options: [4, 5, 8, 10, 15] }
}

export function resolveJimengBillingSeconds(model?: string | null, duration?: number | null): number {
  const { min, max, defaultSec } = jimengVideoDurationBounds(model)
  const parsed = Math.round(Number(duration ?? defaultSec))
  if (!Number.isFinite(parsed)) return defaultSec
  return Math.min(max, Math.max(min, parsed))
}

export function getJimengVideoBenefitType(internalModel: string): string {
  if (internalModel.includes('40_pro')) return JIMENG_OMNI_BENEFIT_TYPE_PRO
  if (internalModel.includes('40_mini')) return JIMENG_OMNI_BENEFIT_TYPE_MINI
  if (internalModel.includes('40')) return JIMENG_OMNI_BENEFIT_TYPE_FAST
  return JIMENG_OMNI_BENEFIT_TYPE_FAST
}

/** omni_reference / unified_edit 模式 benefit_type（Web Session 720p 默认档） */
export function getJimengOmniBenefitType(internalModel: string): string {
  return getJimengVideoBenefitType(internalModel)
}

export function normalizeJimengAspectRatio(value?: string | null, fallback = JIMENG_DEFAULT_ASPECT_RATIO): string {
  const raw = String(value || fallback).trim()
  return (JIMENG_ASPECT_RATIOS as readonly string[]).includes(raw) ? raw : fallback
}

export function resolveJimengVideoCreditAction(model?: string | null): string {
  const normalized = String(model || '').trim().toLowerCase()
  if (normalized === JIMENG_VIDEO_MODELS.SEEDANCE_2_0) {
    return 'video.generate.jimeng.seedance2'
  }
  return 'video.generate.jimeng.seedance2_fast'
}

/**
 * 规范化通道4 提交模型 ID（仅补默认值；Fast VIP / VIP 两档均保留用户选择）。
 */
export function resolveJimengSubmitModel(model?: string | null): string {
  const normalized = String(model || '').trim().toLowerCase()
  if ((JIMENG_ENABLED_VIDEO_MODELS as readonly string[]).includes(normalized)) {
    return normalized
  }
  return JIMENG_DEFAULT_VIDEO_MODEL
}
