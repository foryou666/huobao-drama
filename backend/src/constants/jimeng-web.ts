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
  SEEDANCE_2_5: 'jimeng-video-seedance-2.5',
  SEEDANCE_2_0_FAST: 'jimeng-video-seedance-2.0-fast',
  SEEDANCE_2_0: 'jimeng-video-seedance-2.0',
  SEEDANCE_2_0_MINI: 'jimeng-video-seedance-2.0-mini',
} as const

export const JIMENG_DEFAULT_VIDEO_MODEL = JIMENG_VIDEO_MODELS.SEEDANCE_2_5

/** 通道4 前台展示：S 2.5 + Fast VIP + VIP */
export const JIMENG_ENABLED_VIDEO_MODELS = [
  JIMENG_VIDEO_MODELS.SEEDANCE_2_5,
  JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST,
  JIMENG_VIDEO_MODELS.SEEDANCE_2_0,
] as const

/** 即梦上游 model_req_key（来自 /mweb/v1/video_generate/get_common_config） */
export const JIMENG_UPSTREAM_MODELS = {
  /** Seedance 2.5 · 最强模型 */
  SEEDANCE_45_PRO: 'dreamina_seedance_45_pro',
  /** Seedance 2.0 Fast VIP · 会员专属通道 */
  SEEDANCE_40_VISION: 'dreamina_seedance_40_vision',
  /** Seedance 2.0 VIP · 会员专属通道 */
  SEEDANCE_40_PRO_VISION: 'dreamina_seedance_40_pro_vision',
  SEEDANCE_40_MINI: 'dreamina_seedance_40_mini',
} as const

/**
 * 前台模型 → 即梦上游 model_req_key（通道4 固定 omni_reference / unified_edit）
 * 以即梦 Web get_common_config 为准：
 * - Seedance 2.5 → dreamina_seedance_45_pro
 * - Seedance 2.0 Fast VIP → dreamina_seedance_40_vision
 * - Seedance 2.0 VIP → dreamina_seedance_40_pro_vision
 */
export const JIMENG_UPSTREAM_MODEL_MAP: Record<string, string> = {
  [JIMENG_VIDEO_MODELS.SEEDANCE_2_5]: JIMENG_UPSTREAM_MODELS.SEEDANCE_45_PRO,
  [JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST]: JIMENG_UPSTREAM_MODELS.SEEDANCE_40_VISION,
  [JIMENG_VIDEO_MODELS.SEEDANCE_2_0]: JIMENG_UPSTREAM_MODELS.SEEDANCE_40_PRO_VISION,
  [JIMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI]: JIMENG_UPSTREAM_MODELS.SEEDANCE_40_MINI,
}

/** 通道4 可选画幅（Web Seedance VIP / 2.5） */
export const JIMENG_ASPECT_RATIOS = ['16:9', '9:16'] as const
export const JIMENG_DEFAULT_ASPECT_RATIO = '9:16'

/** 即梦 Web 端 Seedance 2.0 全能参考上限（omni_reference） */
export const JIMENG_REF_LIMITS = {
  images: 9,
  audios: 3,
  videos: 3,
} as const

/**
 * Seedance 2.5（get_common_config.unified_edit_config）：
 * 文案「支持 50 个参考」= 合计；图 max_count=30，视频/音频各 10。
 */
export const JIMENG_SEEDANCE_2_5_REF_LIMITS = {
  images: 30,
  audios: 10,
  videos: 10,
  maxTotal: 50,
} as const

export const JIMENG_OMNI_MAX_TOTAL_REFS = 12
export const JIMENG_OMNI_MAX_TOTAL_AUDIO_SECONDS = 15
export const JIMENG_OMNI_MAX_TOTAL_VIDEO_SECONDS = 15.4

export const JIMENG_SEEDANCE_2_5_MAX_TOTAL_AUDIO_SECONDS = 30.2
export const JIMENG_SEEDANCE_2_5_MAX_TOTAL_VIDEO_SECONDS = 30.2

/**
 * 通道4 Seedance 2.5：无用户参考视频时静默附加的短视频（上游有参考视频会打折）。
 * @deprecated 请使用 utils/s25-discount-ref.ts
 */
export { S25_DISCOUNT_REF_VIDEO_PATH as JIMENG_S25_DISCOUNT_REF_VIDEO_PATH } from '../utils/s25-discount-ref.js'

/** 用户自带参考视频时，本站按标价 × 此倍率扣费（对应上游参考视频折扣档） */
export const SEEDANCE_25_USER_REF_VIDEO_MULTIPLIER = 0.7

export function applySeedance25UserRefVideoDiscount(baseCost: number, hasUserRefVideo: boolean): number {
  const base = Math.max(0, Math.floor(Number(baseCost) || 0))
  if (!hasUserRefVideo || base <= 0) return base
  return Math.max(1, Math.round(base * SEEDANCE_25_USER_REF_VIDEO_MULTIPLIER))
}

export const JIMENG_DRAFT_VERSION_OMNI = '3.3.9'

/** Web 端 commercial_config.default.benefit_type（720p，来自 get_common_config） */
export const JIMENG_OMNI_BENEFIT_TYPE_PRO = 'seedance_20_pro_720p_output'
export const JIMENG_OMNI_BENEFIT_TYPE_FAST = 'seedance_20_fast_720p_output'
export const JIMENG_OMNI_BENEFIT_TYPE_MINI = 'seedance_20_mini_720p_output'
export const JIMENG_OMNI_BENEFIT_TYPE_2_5 = 'seedance_25_720p_output'
/** @deprecated jimeng-api 旧 omni benefit，Web Session 不使用 */
export const JIMENG_OMNI_BENEFIT_TYPE = 'dreamina_video_seedance_20_video_add'

export function formatJimengRefLimitsHint(model?: string | null): string {
  const limits = jimengRefLimitsForModel(model)
  const base = `${limits.images}图 ${limits.audios}音 ${limits.videos}视频`
  if (limits.maxTotal != null) return `${base}（合计≤${limits.maxTotal}）`
  return base
}

/**
 * Fast VIP：标价 60 积分/秒 · 促销 8 折 = 48；VIP：80；VIP+参考视频：130；S 2.5：130
 *
 * VIP 调价依据（8189元/季 · 54600积分/月 → ≈0.05元/上游积分）：
 * - 无参考视频：上游约 14 积分/秒（15s=210）→ 成本 ≈¥0.70/秒 → 本站 80 积分/秒
 * - 有用户参考视频：上游约 22–26 积分/秒（4s=98、5s=112、6s=154）→ 成本 ≈¥1.25/秒 → 本站 130 积分/秒
 *
 * Fast：跟进上游折扣，本站标价 60 × 0.8 = 48 积分/秒（前端划线展示标价）。
 * S 2.5：未打折上游约 288/30s × 0.05 → 约 ¥14.4；本站 130×30=3900；用户自带参考视频另见 0.7 折。
 */
/** Fast VIP 划线标价（促销前） */
export const JIMENG_SEEDANCE_2_0_FAST_LIST_CREDIT_COST = 60
/** Fast VIP 促销折扣（8 折） */
export const JIMENG_SEEDANCE_2_0_FAST_DISCOUNT_MULTIPLIER = 0.8
/** Fast VIP 实收单价（标价 × 8 折） */
export const JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST = Math.round(
  JIMENG_SEEDANCE_2_0_FAST_LIST_CREDIT_COST * JIMENG_SEEDANCE_2_0_FAST_DISCOUNT_MULTIPLIER,
)
export const JIMENG_SEEDANCE_2_0_CREDIT_COST = 80
/** Seedance 2.0 VIP · 含用户参考视频时的秒单价 */
export const JIMENG_SEEDANCE_2_0_WITH_REF_VIDEO_CREDIT_COST = 130
/** @deprecated 已改为「有参考视频按 130/秒」；保留常量避免外部引用报错 */
export const JIMENG_SEEDANCE_2_0_MIN_CREDIT_COST = 0
/** VIP 有参考视频相对无参考视频的倍率（130/80） */
export const JIMENG_SEEDANCE_2_0_REF_VIDEO_MULTIPLIER =
  JIMENG_SEEDANCE_2_0_WITH_REF_VIDEO_CREDIT_COST / JIMENG_SEEDANCE_2_0_CREDIT_COST
export const JIMENG_SEEDANCE_2_5_CREDIT_COST = 130
/** @deprecated 兼容旧统称；默认按 Fast VIP 实收单价 */
export const JIMENG_CREDITS_PER_SECOND = JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST
/** @deprecated 兼容旧定价项 */
export const JIMENG_VIDEO_CREDIT_COST = JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST

export function isJimengSeedance25Model(model?: string | null): boolean {
  return String(model || '').trim().toLowerCase() === JIMENG_VIDEO_MODELS.SEEDANCE_2_5
}

/** 是否通道4 Seedance 2.0 Fast VIP */
export function isJimengSeedance20FastModel(model?: string | null): boolean {
  return String(model || '').trim().toLowerCase() === JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST
}

/** 是否通道4 Seedance 2.0 VIP（不含 Fast/Mini） */
export function isJimengSeedance20VipModel(model?: string | null): boolean {
  return String(model || '').trim().toLowerCase() === JIMENG_VIDEO_MODELS.SEEDANCE_2_0
}

/**
 * 通道4 本站应收积分。
 * @param unitCost 可选：credit_pricing 中无参考视频时的单价（积分/秒）
 * @param hasUserRefVideo 是否含用户参考视频（VIP 上游会加价）
 */
export function resolveJimengUserCreditCost(
  model?: string | null,
  duration?: number | null,
  unitCost?: number | null,
  hasUserRefVideo = false,
): number {
  const secs = resolveJimengBillingSeconds(model, duration)
  let rate: number
  if (isJimengSeedance20VipModel(model)) {
    const base = unitCost != null && Number.isFinite(Number(unitCost)) && Number(unitCost) > 0
      ? Math.floor(Number(unitCost))
      : JIMENG_SEEDANCE_2_0_CREDIT_COST
    if (hasUserRefVideo) {
      // 管理员若改过 VIP 单价，按 130/80 同比上浮
      rate = Math.max(
        1,
        Math.round(base * (JIMENG_SEEDANCE_2_0_WITH_REF_VIDEO_CREDIT_COST / JIMENG_SEEDANCE_2_0_CREDIT_COST)),
      )
    } else {
      rate = base
    }
  } else {
    rate = unitCost != null && Number.isFinite(Number(unitCost)) && Number(unitCost) > 0
      ? Math.floor(Number(unitCost))
      : resolveJimengCreditsPerSecond(model)
  }
  return Math.max(1, Math.round(rate * secs))
}

export function jimengRefLimitsForModel(model?: string | null) {
  if (isJimengSeedance25Model(model)) {
    return {
      images: JIMENG_SEEDANCE_2_5_REF_LIMITS.images,
      audios: JIMENG_SEEDANCE_2_5_REF_LIMITS.audios,
      videos: JIMENG_SEEDANCE_2_5_REF_LIMITS.videos,
      maxTotal: JIMENG_SEEDANCE_2_5_REF_LIMITS.maxTotal as number | null,
    }
  }
  return {
    images: JIMENG_REF_LIMITS.images,
    audios: JIMENG_REF_LIMITS.audios,
    videos: JIMENG_REF_LIMITS.videos,
    maxTotal: JIMENG_OMNI_MAX_TOTAL_REFS as number | null,
  }
}

export function resolveJimengCreditsPerSecond(model?: string | null): number {
  const normalized = String(model || '').trim().toLowerCase()
  if (normalized === JIMENG_VIDEO_MODELS.SEEDANCE_2_5) return JIMENG_SEEDANCE_2_5_CREDIT_COST
  if (normalized === JIMENG_VIDEO_MODELS.SEEDANCE_2_0) return JIMENG_SEEDANCE_2_0_CREDIT_COST
  return JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST
}

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
    [JIMENG_VIDEO_MODELS.SEEDANCE_2_5]: 'S 2.5',
    [JIMENG_VIDEO_MODELS.SEEDANCE_2_0]: 'Seedance 2.0 VIP',
    [JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST]: 'Seedance 2.0 Fast VIP',
    [JIMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI]: 'Seedance 2.0 Mini',
  }
  return labels[normalized] || normalized
}

export function jimengVideoDurationBounds(model?: string | null): { min: number; max: number; defaultSec: number; options: number[] } {
  if (isJimengSeedance25Model(model)) {
    const options: number[] = []
    for (let sec = 4; sec <= 30; sec += 1) options.push(sec)
    return { min: 4, max: 30, defaultSec: 10, options }
  }
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
  if (internalModel.includes('45_pro') || internalModel.includes('seedance_45')) {
    return JIMENG_OMNI_BENEFIT_TYPE_2_5
  }
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
  if (normalized === JIMENG_VIDEO_MODELS.SEEDANCE_2_5) {
    return 'video.generate.jimeng.seedance25'
  }
  if (normalized === JIMENG_VIDEO_MODELS.SEEDANCE_2_0) {
    return 'video.generate.jimeng.seedance2'
  }
  return 'video.generate.jimeng.seedance2_fast'
}

/**
 * 规范化通道4 提交模型 ID（仅补默认值；保留用户选择）。
 */
export function resolveJimengSubmitModel(model?: string | null): string {
  const normalized = String(model || '').trim().toLowerCase()
  if ((JIMENG_ENABLED_VIDEO_MODELS as readonly string[]).includes(normalized)) {
    return normalized
  }
  return JIMENG_DEFAULT_VIDEO_MODEL
}
