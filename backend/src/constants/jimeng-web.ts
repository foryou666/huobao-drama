/** 即梦 Web 端（jimeng.jianying.com）视频生成常量 */

export const JIMENG_BASE_URL = 'https://jimeng.jianying.com'
export const JIMENG_VIDEO_REFERER = 'https://jimeng.jianying.com/ai-tool/generate?type=video'

export const JIMENG_ASSISTANT_ID = 513695
export const JIMENG_PLATFORM_CODE = '7'
export const JIMENG_VERSION_CODE = '8.4.0'
export const JIMENG_DRAFT_VERSION = '3.3.9'
export const JIMENG_WEB_VERSION = '7.5.0'
export const JIMENG_DA_VERSION = '3.3.9'

export const JIMENG_VIDEO_MODELS = {
  V3_5_PRO: 'jimeng-video-3.5-pro',
  V3_0_PRO: 'jimeng-video-3.0-pro',
  V3_0: 'jimeng-video-3.0',
  V3_0_FAST: 'jimeng-video-3.0-fast',
  SEEDANCE_2_0: 'jimeng-video-seedance-2.0',
  SEEDANCE_2_0_FAST: 'jimeng-video-seedance-2.0-fast',
} as const

export const JIMENG_DEFAULT_VIDEO_MODEL = JIMENG_VIDEO_MODELS.V3_5_PRO

/** 内部 model_req_key 映射（国内站） */
export const JIMENG_VIDEO_MODEL_MAP: Record<string, string> = {
  [JIMENG_VIDEO_MODELS.SEEDANCE_2_0]: 'dreamina_seedance_40_pro',
  [JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST]: 'dreamina_seedance_40',
  [JIMENG_VIDEO_MODELS.V3_5_PRO]: 'dreamina_ic_generate_video_model_vgfm_3.5_pro',
  [JIMENG_VIDEO_MODELS.V3_0_PRO]: 'dreamina_ic_generate_video_model_vgfm_3.0_pro',
  [JIMENG_VIDEO_MODELS.V3_0]: 'dreamina_ic_generate_video_model_vgfm_3.0',
  [JIMENG_VIDEO_MODELS.V3_0_FAST]: 'dreamina_ic_generate_video_model_vgfm_3.0_fast',
}

export const JIMENG_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'] as const

export const JIMENG_VIDEO_CREDIT_COST = 0

export function isJimengVideoModel(model?: string | null): boolean {
  const normalized = String(model || '').trim().toLowerCase()
  return normalized.startsWith('jimeng-video-')
    || Object.values(JIMENG_VIDEO_MODELS).includes(normalized as typeof JIMENG_VIDEO_MODELS[keyof typeof JIMENG_VIDEO_MODELS])
}

export function resolveJimengInternalModel(model?: string | null): string {
  const normalized = String(model || JIMENG_DEFAULT_VIDEO_MODEL).trim()
  return JIMENG_VIDEO_MODEL_MAP[normalized] || JIMENG_VIDEO_MODEL_MAP[JIMENG_DEFAULT_VIDEO_MODEL]
}

export function jimengVideoModelLabel(modelId?: string | null): string {
  const normalized = String(modelId || '').trim()
  const labels: Record<string, string> = {
    [JIMENG_VIDEO_MODELS.V3_5_PRO]: '即梦 Video 3.5 Pro',
    [JIMENG_VIDEO_MODELS.V3_0_PRO]: '即梦 Video 3.0 Pro',
    [JIMENG_VIDEO_MODELS.V3_0]: '即梦 Video 3.0',
    [JIMENG_VIDEO_MODELS.V3_0_FAST]: '即梦 Video 3.0 Fast',
    [JIMENG_VIDEO_MODELS.SEEDANCE_2_0]: '即梦 Seedance 2.0',
    [JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST]: '即梦 Seedance 2.0 Fast',
  }
  return labels[normalized] || normalized
}

export function jimengVideoDurationBounds(model?: string | null): { min: number; max: number; defaultSec: number; options: number[] } {
  const internal = resolveJimengInternalModel(model)
  if (internal.includes('40_pro') || (internal.includes('40') && !internal.includes('40_pro'))) {
    return { min: 4, max: 15, defaultSec: 5, options: [4, 5, 8, 10, 15] }
  }
  if (internal.includes('3.5_pro')) {
    return { min: 5, max: 12, defaultSec: 5, options: [5, 10, 12] }
  }
  return { min: 5, max: 10, defaultSec: 5, options: [5, 10] }
}

export function resolveJimengBillingSeconds(model?: string | null, duration?: number | null): number {
  const { min, max, defaultSec } = jimengVideoDurationBounds(model)
  const parsed = Math.round(Number(duration ?? defaultSec))
  if (!Number.isFinite(parsed)) return defaultSec
  return Math.min(max, Math.max(min, parsed))
}

export function getJimengVideoBenefitType(internalModel: string): string {
  if (internalModel.includes('40_pro')) return 'dreamina_video_seedance_20_pro'
  if (internalModel.includes('40')) return 'dreamina_seedance_20_fast'
  if (internalModel.includes('3.5_pro')) return 'dreamina_video_seedance_15_pro'
  if (internalModel.includes('3.5')) return 'dreamina_video_seedance_15'
  return 'basic_video_operation_vgfm_v_three'
}

export function normalizeJimengAspectRatio(value?: string | null, fallback = '16:9'): string {
  const raw = String(value || fallback).trim()
  return (JIMENG_ASPECT_RATIOS as readonly string[]).includes(raw) ? raw : fallback
}
