/** 剪映小云雀官方 Access Key API（xyq.jianying.com/api/biz/v1/skill/*） */

export const XYQ_BASE_URL = 'https://xyq.jianying.com'
export const XYQ_HOME_URL = `${XYQ_BASE_URL}/home`
export const XYQ_API_PATHS = {
  uploadFile: '/api/biz/v1/skill/upload_file',
  submitRun: '/api/biz/v1/skill/submit_run',
  getThread: '/api/biz/v1/skill/get_thread',
  /** 网页 Cookie 鉴权：查上游账号积分（Access Key 不支持） */
  userCredit: '/commerce/v1/benefits/user_credit',
  userCreditHistory: '/commerce/v1/benefits/user_credit_history',
  subscriptionUserInfo: '/commerce/v1/subscription/user_info',
} as const

/** 小云雀 Web commerce 签名参数（来自官网前端） */
export const XYQ_WEB_AID = '324442'
export const XYQ_WEB_PF = '7'
export const XYQ_WEB_APPVR = '8.4.0'
export const XYQ_WEB_SIGN_VER = '1'

export const XYQ_VIDEO_MODELS = {
  SEEDANCE_2_5: 'xyq-video-seedance-2.5',
  MINI_TRIAL: 'xyq-video-seedance-2.0-mini-trial',
  MINI: 'xyq-video-seedance-2.0-mini',
  FAST_VIP: 'xyq-video-seedance-2.0-fast',
  VIP: 'xyq-video-seedance-2.0',
} as const

export const XYQ_DEFAULT_VIDEO_MODEL = XYQ_VIDEO_MODELS.MINI_TRIAL

export const XYQ_ENABLED_VIDEO_MODELS = [
  XYQ_VIDEO_MODELS.SEEDANCE_2_5,
  XYQ_VIDEO_MODELS.MINI_TRIAL,
  XYQ_VIDEO_MODELS.MINI,
  XYQ_VIDEO_MODELS.FAST_VIP,
  XYQ_VIDEO_MODELS.VIP,
] as const

/** 上游网页展示名（仅展示；提交走 video_part_tool_param.model） */
export const XYQ_UPSTREAM_MODEL_LABELS: Record<string, string> = {
  [XYQ_VIDEO_MODELS.SEEDANCE_2_5]: 'Seedance 2.5',
  [XYQ_VIDEO_MODELS.MINI_TRIAL]: 'Seedance 2.0 Mini 体验版',
  [XYQ_VIDEO_MODELS.MINI]: 'Seedance 2.0 Mini',
  [XYQ_VIDEO_MODELS.FAST_VIP]: 'Seedance 2.0 Fast VIP',
  [XYQ_VIDEO_MODELS.VIP]: 'Seedance 2.0 VIP',
}

/**
 * 上游 video_part 直出模型 ID（非「创意助手」nest agent）。
 * 来自官网前端映射：seedance2.5* → Seedance_2.5；2.0 VIP 走 *_vision。
 */
export const XYQ_UPSTREAM_VIDEO_PART_MODEL_IDS: Record<string, string> = {
  [XYQ_VIDEO_MODELS.SEEDANCE_2_5]: 'Seedance_2.5',
  [XYQ_VIDEO_MODELS.MINI_TRIAL]: 'seedance2.0_mini_direct',
  [XYQ_VIDEO_MODELS.MINI]: 'seedance2.0_mini_direct',
  [XYQ_VIDEO_MODELS.FAST_VIP]: 'seedance2.0_fast_vision',
  [XYQ_VIDEO_MODELS.VIP]: 'seedance2.0_vision',
}

/** skill/submit_run 直出 Agent（对应官网工具栏模型生成，不是创意助手） */
export const XYQ_VIDEO_PART_AGENT = 'pippit_video_part_agent'

export const XYQ_DEFAULT_RESOLUTION = '720p'
export const XYQ_RESOLUTIONS = ['480p', '720p', '1080p'] as const

/** 2.0 档：5–15 秒按条；2.5：5–30 秒按秒 */
export const XYQ_DURATION_BOUNDS = {
  min: 5,
  max: 15,
  defaultSec: 10,
  options: [5, 10, 15],
} as const

export const XYQ_SEEDANCE_2_5_DURATION_BOUNDS = {
  min: 5,
  max: 30,
  defaultSec: 10,
  options: [5, 10, 15, 20, 25, 30],
} as const

export const XYQ_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const
export const XYQ_DEFAULT_ASPECT_RATIO = '16:9'

/** 本站按条默认价（积分）：S2.0A / S2.0B / Fast VIP / VIP */
export const XYQ_MINI_TRIAL_CREDIT_COST = 300
export const XYQ_MINI_CREDIT_COST = 500
export const XYQ_FAST_VIP_CREDIT_COST = 750
export const XYQ_VIP_CREDIT_COST = 900
/**
 * 本站按秒默认价（积分）：S 2.5 = 130
 * 依据：未打折上游约 780/30s ≈ 39 元成本 → 3900 本站积分/30s = 130 积分/秒（与通道4同价、不加价）。
 */
export const XYQ_SEEDANCE_2_5_CREDITS_PER_SECOND = 130

/**
 * 上游小云雀账号积分消耗（约）：同体系公开档位 × 时长，用于调度低余额赠送号。
 * Access Key 无提交前报价；以公开价作线性估算，略留余量避免撞额度不足。
 */
export const XYQ_UPSTREAM_CREDITS_PER_SECOND: Record<string, number> = {
  [XYQ_VIDEO_MODELS.SEEDANCE_2_5]: 26,
  [XYQ_VIDEO_MODELS.MINI_TRIAL]: 9,
  [XYQ_VIDEO_MODELS.MINI]: 9,
  [XYQ_VIDEO_MODELS.FAST_VIP]: 11,
  [XYQ_VIDEO_MODELS.VIP]: 14,
}

/** 估算余量（积分），避免边界低估 */
export const XYQ_UPSTREAM_CREDIT_ESTIMATE_BUFFER = 5

export function estimateXyqUpstreamCredits(model?: string | null, duration?: number | null): number {
  const id = String(model || XYQ_DEFAULT_VIDEO_MODEL).trim()
  const rate = XYQ_UPSTREAM_CREDITS_PER_SECOND[id] ?? 9
  const sec = normalizeXyqDuration(duration, id)
  return Math.ceil(sec * rate) + XYQ_UPSTREAM_CREDIT_ESTIMATE_BUFFER
}

/** Seedance 2.0 全能参考：9 图 + 3 音频 + 3 视频 */
export const XYQ_REF_LIMITS = {
  images: 9,
  audios: 3,
  videos: 3,
} as const

/**
 * Seedance 2.5：官方最多 50 个多模态参考（图/视频/音频合计）。
 * 本站按「图最多 50、音/视频各最多 3」放开，并额外限制合计 ≤ 50。
 */
export const XYQ_SEEDANCE_2_5_REF_LIMITS = {
  images: 50,
  audios: 3,
  videos: 3,
  maxTotal: 50,
} as const

export function xyqRefLimitsForModel(model?: string | null) {
  if (String(model || '').trim() === XYQ_VIDEO_MODELS.SEEDANCE_2_5) {
    return {
      images: XYQ_SEEDANCE_2_5_REF_LIMITS.images,
      audios: XYQ_SEEDANCE_2_5_REF_LIMITS.audios,
      videos: XYQ_SEEDANCE_2_5_REF_LIMITS.videos,
      maxTotal: XYQ_SEEDANCE_2_5_REF_LIMITS.maxTotal,
    }
  }
  return {
    images: XYQ_REF_LIMITS.images,
    audios: XYQ_REF_LIMITS.audios,
    videos: XYQ_REF_LIMITS.videos,
    maxTotal: null as number | null,
  }
}

export function isXyqVideoModel(model?: string | null): boolean {
  return (XYQ_ENABLED_VIDEO_MODELS as readonly string[]).includes(String(model || '').trim())
}

export function isXyqEnabledVideoModel(model?: string | null): boolean {
  return isXyqVideoModel(model)
}

/** S 2.5 按秒计费；其余 2.0 档仍按条 */
export function isXyqPerSecondBilling(model?: string | null): boolean {
  return String(model || '').trim() === XYQ_VIDEO_MODELS.SEEDANCE_2_5
}

export function xyqVideoModelLabel(model?: string | null): string {
  const id = String(model || '').trim()
  if (id === XYQ_VIDEO_MODELS.SEEDANCE_2_5) return 'S 2.5'
  if (id === XYQ_VIDEO_MODELS.MINI_TRIAL) return 'S2.0A'
  if (id === XYQ_VIDEO_MODELS.MINI) return 'S2.0B'
  if (id === XYQ_VIDEO_MODELS.FAST_VIP) return 'S 2.0 Fast VIP'
  if (id === XYQ_VIDEO_MODELS.VIP) return 'S 2.0 VIP'
  return XYQ_UPSTREAM_MODEL_LABELS[id] || id || 'S2.0A'
}

export function resolveXyqUpstreamModelLabel(model?: string | null): string {
  const id = String(model || XYQ_DEFAULT_VIDEO_MODEL).trim()
  return XYQ_UPSTREAM_MODEL_LABELS[id] || XYQ_UPSTREAM_MODEL_LABELS[XYQ_DEFAULT_VIDEO_MODEL]
}

/** video_part_tool_param.model 上游 ID */
export function resolveXyqUpstreamVideoPartModelId(model?: string | null): string {
  const id = String(model || XYQ_DEFAULT_VIDEO_MODEL).trim()
  return XYQ_UPSTREAM_VIDEO_PART_MODEL_IDS[id]
    || XYQ_UPSTREAM_VIDEO_PART_MODEL_IDS[XYQ_DEFAULT_VIDEO_MODEL]
}

export function normalizeXyqResolution(resolution?: string | null): string {
  const raw = String(resolution || '').trim().toLowerCase()
  if ((XYQ_RESOLUTIONS as readonly string[]).includes(raw)) return raw
  if (raw === '720' || raw === 'hd') return '720p'
  if (raw === '1080' || raw === 'fhd') return '1080p'
  if (raw === '480' || raw === 'sd') return '480p'
  return XYQ_DEFAULT_RESOLUTION
}

export type XyqVideoPartAsset = {
  asset_id: string
  url?: string
  name?: string
}

/** 构建 skill/submit_run 的 video_part_tool_param（直出，禁止创意助手） */
export function buildXyqVideoPartToolParam(input: {
  model?: string | null
  prompt: string
  duration?: number | null
  aspectRatio?: string | null
  resolution?: string | null
  images?: XyqVideoPartAsset[]
  videos?: XyqVideoPartAsset[]
  audios?: XyqVideoPartAsset[]
}): Record<string, unknown> {
  return {
    prompt: String(input.prompt || '').trim(),
    model: resolveXyqUpstreamVideoPartModelId(input.model),
    duration_sec: normalizeXyqDuration(input.duration, input.model),
    ratio: normalizeXyqAspectRatio(input.aspectRatio),
    resolution: normalizeXyqResolution(input.resolution),
    language: 'zh',
    images: Array.isArray(input.images) ? input.images : [],
    videos: Array.isArray(input.videos) ? input.videos : [],
    audios: Array.isArray(input.audios) ? input.audios : [],
    imitation_videos: [],
  }
}

export function resolveXyqVideoCreditAction(model?: string | null): string {
  const id = String(model || '').trim()
  if (id === XYQ_VIDEO_MODELS.SEEDANCE_2_5) return 'video.generate.xyq.seedance25'
  if (id === XYQ_VIDEO_MODELS.MINI) return 'video.generate.xyq.mini'
  if (id === XYQ_VIDEO_MODELS.FAST_VIP) return 'video.generate.xyq.seedance2_fast'
  if (id === XYQ_VIDEO_MODELS.VIP) return 'video.generate.xyq.seedance2'
  return 'video.generate.xyq.mini_trial'
}

export function resolveXyqCreditCostDefault(model?: string | null): number {
  const id = String(model || '').trim()
  if (id === XYQ_VIDEO_MODELS.SEEDANCE_2_5) return XYQ_SEEDANCE_2_5_CREDITS_PER_SECOND
  if (id === XYQ_VIDEO_MODELS.MINI) return XYQ_MINI_CREDIT_COST
  if (id === XYQ_VIDEO_MODELS.FAST_VIP) return XYQ_FAST_VIP_CREDIT_COST
  if (id === XYQ_VIDEO_MODELS.VIP) return XYQ_VIP_CREDIT_COST
  return XYQ_MINI_TRIAL_CREDIT_COST
}

export function xyqVideoDurationBounds(model?: string | null) {
  if (String(model || '').trim() === XYQ_VIDEO_MODELS.SEEDANCE_2_5) {
    return {
      min: XYQ_SEEDANCE_2_5_DURATION_BOUNDS.min,
      max: XYQ_SEEDANCE_2_5_DURATION_BOUNDS.max,
      defaultSec: XYQ_SEEDANCE_2_5_DURATION_BOUNDS.defaultSec,
      options: [...XYQ_SEEDANCE_2_5_DURATION_BOUNDS.options],
    }
  }
  return {
    min: XYQ_DURATION_BOUNDS.min,
    max: XYQ_DURATION_BOUNDS.max,
    defaultSec: XYQ_DURATION_BOUNDS.defaultSec,
    options: [...XYQ_DURATION_BOUNDS.options],
  }
}

export function normalizeXyqDuration(duration?: number | null, model?: string | null): number {
  const bounds = xyqVideoDurationBounds(model)
  const n = Math.round(Number(duration ?? bounds.defaultSec))
  if (!Number.isFinite(n)) return bounds.defaultSec
  if ((bounds.options as number[]).includes(n)) return n
  return Math.min(bounds.max, Math.max(bounds.min, n))
}

export function normalizeXyqAspectRatio(ratio?: string | null, fallback = XYQ_DEFAULT_ASPECT_RATIO): string {
  const r = String(ratio || '').trim()
  if ((XYQ_ASPECT_RATIOS as readonly string[]).includes(r)) return r
  return fallback
}

/**
 * skill/submit_run 的 message 字段。
 * 直出路径参数已在 video_part_tool_param，这里只放用户提示词，避免 nest/创意助手话术误触发。
 */
export function buildXyqSubmitMessage(input: {
  model?: string | null
  prompt: string
  duration?: number | null
  aspectRatio?: string | null
  hasAssets?: boolean
}): string {
  return String(input.prompt || '').trim() || '生成视频'
}
