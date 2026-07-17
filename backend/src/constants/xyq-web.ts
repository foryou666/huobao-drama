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
  MINI_TRIAL: 'xyq-video-seedance-2.0-mini-trial',
  MINI: 'xyq-video-seedance-2.0-mini',
  FAST_VIP: 'xyq-video-seedance-2.0-fast',
  VIP: 'xyq-video-seedance-2.0',
} as const

export const XYQ_DEFAULT_VIDEO_MODEL = XYQ_VIDEO_MODELS.MINI_TRIAL

export const XYQ_ENABLED_VIDEO_MODELS = [
  XYQ_VIDEO_MODELS.MINI_TRIAL,
  XYQ_VIDEO_MODELS.MINI,
  XYQ_VIDEO_MODELS.FAST_VIP,
  XYQ_VIDEO_MODELS.VIP,
] as const

/** 上游网页展示名（写入 message，交给小云雀 Agent 选模） */
export const XYQ_UPSTREAM_MODEL_LABELS: Record<string, string> = {
  [XYQ_VIDEO_MODELS.MINI_TRIAL]: 'Seedance 2.0 Mini 体验版',
  [XYQ_VIDEO_MODELS.MINI]: 'Seedance 2.0 Mini',
  [XYQ_VIDEO_MODELS.FAST_VIP]: 'Seedance 2.0 Fast VIP',
  [XYQ_VIDEO_MODELS.VIP]: 'Seedance 2.0 VIP',
}

export const XYQ_DURATION_BOUNDS = {
  min: 5,
  max: 15,
  defaultSec: 10,
  options: [5, 10, 15],
} as const

export const XYQ_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const
export const XYQ_DEFAULT_ASPECT_RATIO = '16:9'

/** 本站按条默认价（积分）：S2.0A / S2.0B / Fast VIP / VIP */
export const XYQ_MINI_TRIAL_CREDIT_COST = 300
export const XYQ_MINI_CREDIT_COST = 500
export const XYQ_FAST_VIP_CREDIT_COST = 750
export const XYQ_VIP_CREDIT_COST = 900

/**
 * 上游小云雀账号积分消耗（约）：同体系公开档位 × 时长，用于调度低余额赠送号。
 * Access Key 无提交前报价；以公开价作线性估算，略留余量避免撞额度不足。
 */
export const XYQ_UPSTREAM_CREDITS_PER_SECOND: Record<string, number> = {
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
  const sec = normalizeXyqDuration(duration)
  return Math.ceil(sec * rate) + XYQ_UPSTREAM_CREDIT_ESTIMATE_BUFFER
}

export const XYQ_REF_LIMITS = {
  images: 6,
  audios: 0,
  videos: 1,
} as const

export function isXyqVideoModel(model?: string | null): boolean {
  return (XYQ_ENABLED_VIDEO_MODELS as readonly string[]).includes(String(model || '').trim())
}

export function isXyqEnabledVideoModel(model?: string | null): boolean {
  return isXyqVideoModel(model)
}

export function xyqVideoModelLabel(model?: string | null): string {
  const id = String(model || '').trim()
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

export function resolveXyqVideoCreditAction(model?: string | null): string {
  const id = String(model || '').trim()
  if (id === XYQ_VIDEO_MODELS.MINI) return 'video.generate.xyq.mini'
  if (id === XYQ_VIDEO_MODELS.FAST_VIP) return 'video.generate.xyq.seedance2_fast'
  if (id === XYQ_VIDEO_MODELS.VIP) return 'video.generate.xyq.seedance2'
  return 'video.generate.xyq.mini_trial'
}

export function resolveXyqCreditCostDefault(model?: string | null): number {
  const id = String(model || '').trim()
  if (id === XYQ_VIDEO_MODELS.MINI) return XYQ_MINI_CREDIT_COST
  if (id === XYQ_VIDEO_MODELS.FAST_VIP) return XYQ_FAST_VIP_CREDIT_COST
  if (id === XYQ_VIDEO_MODELS.VIP) return XYQ_VIP_CREDIT_COST
  return XYQ_MINI_TRIAL_CREDIT_COST
}

export function xyqVideoDurationBounds(_model?: string | null) {
  return {
    min: XYQ_DURATION_BOUNDS.min,
    max: XYQ_DURATION_BOUNDS.max,
    defaultSec: XYQ_DURATION_BOUNDS.defaultSec,
    options: [...XYQ_DURATION_BOUNDS.options],
  }
}

export function normalizeXyqDuration(duration?: number | null): number {
  const allowed = XYQ_DURATION_BOUNDS.options as readonly number[]
  const n = Math.round(Number(duration ?? XYQ_DURATION_BOUNDS.defaultSec))
  if (allowed.includes(n)) return n
  return XYQ_DURATION_BOUNDS.defaultSec
}

export function normalizeXyqAspectRatio(ratio?: string | null, fallback = XYQ_DEFAULT_ASPECT_RATIO): string {
  const r = String(ratio || '').trim()
  if ((XYQ_ASPECT_RATIOS as readonly string[]).includes(r)) return r
  return fallback
}

export function buildXyqSubmitMessage(input: {
  model?: string | null
  prompt: string
  duration?: number | null
  aspectRatio?: string | null
  hasAssets?: boolean
}): string {
  const modelLabel = resolveXyqUpstreamModelLabel(input.model)
  const duration = normalizeXyqDuration(input.duration)
  const ratio = normalizeXyqAspectRatio(input.aspectRatio)
  const prompt = String(input.prompt || '').trim()
  const assetHint = input.hasAssets
    ? '请参考我上传的素材（asset），'
    : ''
  return [
    `请使用「${modelLabel}」模型，时长 ${duration} 秒，画面比例 ${ratio}，`,
    `${assetHint}直接生成一条视频，不要追问确认、不要额外澄清。`,
    '',
    '用户需求：',
    prompt,
  ].join('')
}
