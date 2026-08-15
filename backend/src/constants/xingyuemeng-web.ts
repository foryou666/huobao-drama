/** S通道9 · 星月梦（xingyuemeng.com）Bearer Token 网页通道 */

export const XINGYUEMENG_SITE_URL = 'https://xingyuemeng.com'
export const XINGYUEMENG_API_BASE = 'https://s1.xingyuemeng.com/api'

/** AES-CBC（与网页 axios 拦截器一致） */
export const XINGYUEMENG_AES_KEY = 'chloefuckityoall'
export const XINGYUEMENG_AES_IV = '9311019310287172'

/** 分镜视频资产 type = TYPE_CLIP */
export const XINGYUEMENG_ASSET_TYPE_CLIP = 5000

export const XINGYUEMENG_VIDEO_MODELS = {
  SEEDANCE_2_5: 'xingyuemeng-video-seedance-2.5',
  SEEDANCE_2_0_MINI: 'xingyuemeng-video-seedance-2.0-mini',
  SEEDANCE_2_0_FAST: 'xingyuemeng-video-seedance-2.0-fast',
  SEEDANCE_2_0_PRO: 'xingyuemeng-video-seedance-2.0-pro',
} as const

export const XINGYUEMENG_DEFAULT_VIDEO_MODEL = XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_PRO

export const XINGYUEMENG_ENABLED_VIDEO_MODELS = [
  XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_PRO,
  XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_5,
  XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST,
  XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI,
] as const

/** 上游 model_name（网页下拉 / estimate 识别名） */
export const XINGYUEMENG_UPSTREAM_MODEL_NAMES: Record<string, string> = {
  [XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_5]: 'Seedance 2.5',
  [XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI]: 'Seedance 2.0 Mini',
  [XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST]: 'Seedance 2.0 Fast',
  [XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_PRO]: 'Seedance 2.0 Pro',
}

export const XINGYUEMENG_DURATION_BOUNDS = {
  min: 4,
  max: 15,
  defaultSec: 5,
} as const

export const XINGYUEMENG_ASPECT_RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'] as const
export const XINGYUEMENG_DEFAULT_ASPECT_RATIO = '16:9'

export const XINGYUEMENG_RESOLUTIONS = ['480p', '720p'] as const
export const XINGYUEMENG_DEFAULT_RESOLUTION = '720p'

/** API 字段上限（Seedance 2.0 / 2.5） */
export const XINGYUEMENG_REF_LIMITS = {
  images: 9,
  audios: 3,
  videos: 3,
} as const

/**
 * 星月梦上游积分价表（来源：POST /v1/points/generation/estimate，不发任务）
 * 单位：上游积分（星月梦 1 元 = 10 积分）。本站仅开放 480p / 720p。
 * Seedance 2.5 为 token_calc，逐秒增量非固定，故按整段一口价落表。
 */
export const XINGYUEMENG_OFFICIAL_CREDITS: Record<string, Record<string, Record<number, number>>> = {
  [XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_5]: {
    '480p': { 4: 35, 5: 43, 6: 52, 7: 60, 8: 69, 9: 77, 10: 86, 11: 94, 12: 103, 13: 111, 14: 120, 15: 128 },
    '720p': { 4: 74, 5: 92, 6: 110, 7: 129, 8: 147, 9: 165, 10: 183, 11: 202, 12: 220, 13: 238, 14: 257, 15: 275 },
  },
  [XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI]: {
    '480p': { 4: 12, 5: 14, 6: 17, 7: 20, 8: 23, 9: 26, 10: 28, 11: 31, 12: 34, 13: 37, 14: 40, 15: 42 },
    '720p': { 4: 25, 5: 31, 6: 37, 7: 43, 8: 49, 9: 55, 10: 61, 11: 67, 12: 73, 13: 79, 14: 85, 15: 91 },
  },
  [XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST]: {
    '480p': { 4: 18, 5: 23, 6: 27, 7: 32, 8: 36, 9: 41, 10: 45, 11: 50, 12: 54, 13: 59, 14: 63, 15: 68 },
    '720p': { 4: 39, 5: 49, 6: 59, 7: 68, 8: 78, 9: 88, 10: 97, 11: 107, 12: 117, 13: 126, 14: 136, 15: 146 },
  },
  [XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_PRO]: {
    '480p': { 4: 23, 5: 28, 6: 34, 7: 40, 8: 45, 9: 51, 10: 56, 11: 62, 12: 68, 13: 73, 14: 79, 15: 84 },
    '720p': { 4: 49, 5: 61, 6: 73, 7: 85, 8: 97, 9: 109, 10: 121, 11: 133, 12: 145, 13: 157, 14: 169, 15: 181 },
  },
}

/**
 * 上游积分 → 本站积分：
 * 星月梦 1 元 = 10 积分；本站 1 元 = 100 积分 → 本站扣费 = 上游积分 × 10
 */
export const XINGYUEMENG_UPSTREAM_TO_USER_CREDIT_RATIO = 10

/** @deprecated 兼容旧命名；实际扣费走 resolveXingyuemengUserCreditCost */
export const XINGYUEMENG_PRO_CREDITS_480P = Object.fromEntries(
  Object.entries(XINGYUEMENG_OFFICIAL_CREDITS[XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_PRO]!['480p']!)
    .map(([sec, pts]) => [Number(sec), pts * XINGYUEMENG_UPSTREAM_TO_USER_CREDIT_RATIO]),
) as Record<number, number>

/** 管理端展示用参考值（默认 5s / 480p，已换算为本站积分） */
export const XINGYUEMENG_SEEDANCE_2_5_CREDITS_PER_SECOND =
  XINGYUEMENG_OFFICIAL_CREDITS[XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_5]!['480p']![5]!
  * XINGYUEMENG_UPSTREAM_TO_USER_CREDIT_RATIO
export const XINGYUEMENG_SEEDANCE_2_0_PRO_CREDITS_PER_SECOND =
  XINGYUEMENG_OFFICIAL_CREDITS[XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_PRO]!['480p']![5]!
  * XINGYUEMENG_UPSTREAM_TO_USER_CREDIT_RATIO
export const XINGYUEMENG_SEEDANCE_2_0_MINI_CREDITS_PER_SECOND =
  XINGYUEMENG_OFFICIAL_CREDITS[XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI]!['480p']![5]!
  * XINGYUEMENG_UPSTREAM_TO_USER_CREDIT_RATIO
export const XINGYUEMENG_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND =
  XINGYUEMENG_OFFICIAL_CREDITS[XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST]!['480p']![5]!
  * XINGYUEMENG_UPSTREAM_TO_USER_CREDIT_RATIO

function lookupUpstreamPoints(modelId: string, resolution: string, durationSec: number): number {
  const byModel = XINGYUEMENG_OFFICIAL_CREDITS[modelId]
    || XINGYUEMENG_OFFICIAL_CREDITS[XINGYUEMENG_DEFAULT_VIDEO_MODEL]!
  const byRes = byModel[resolution] || byModel['720p'] || byModel['480p']!
  return byRes[durationSec]
    ?? byRes[XINGYUEMENG_DURATION_BOUNDS.defaultSec]
    ?? byRes[4]
    ?? 1
}

function upstreamPointsToUserCredits(upstreamPoints: number): number {
  return Math.max(1, Math.round(Number(upstreamPoints) * XINGYUEMENG_UPSTREAM_TO_USER_CREDIT_RATIO))
}

/** 构建 4–15s × 各清晰度的完整价表（本站积分，供前端展示） */
export function buildXingyuemengCreditCostMatrix(model?: string | null): Record<string, Record<number, number>> {
  const id = String(model || XINGYUEMENG_DEFAULT_VIDEO_MODEL).trim()
  const matrix: Record<string, Record<number, number>> = {}
  for (const res of XINGYUEMENG_RESOLUTIONS) {
    const byDuration: Record<number, number> = {}
    for (let sec = XINGYUEMENG_DURATION_BOUNDS.min; sec <= XINGYUEMENG_DURATION_BOUNDS.max; sec++) {
      byDuration[sec] = upstreamPointsToUserCredits(lookupUpstreamPoints(id, res, sec))
    }
    matrix[res] = byDuration
  }
  return matrix
}

/** S通道9 用户扣费：上游 estimate × 10（对齐本站 1:100） */
export function resolveXingyuemengUserCreditCost(
  model?: string | null,
  duration?: number | null,
  resolution?: string | null,
): number {
  const id = String(model || XINGYUEMENG_DEFAULT_VIDEO_MODEL).trim()
  const sec = normalizeXingyuemengDuration(duration)
  const res = normalizeXingyuemengResolution(resolution)
  return upstreamPointsToUserCredits(lookupUpstreamPoints(id, res, sec))
}

export function isXingyuemengVideoModel(model?: string | null): boolean {
  return (XINGYUEMENG_ENABLED_VIDEO_MODELS as readonly string[]).includes(String(model || '').trim())
}

export function resolveXingyuemengUpstreamModelName(model?: string | null): string {
  const id = String(model || XINGYUEMENG_DEFAULT_VIDEO_MODEL).trim()
  return XINGYUEMENG_UPSTREAM_MODEL_NAMES[id]
    || XINGYUEMENG_UPSTREAM_MODEL_NAMES[XINGYUEMENG_DEFAULT_VIDEO_MODEL]
}

export function resolveXingyuemengVideoCreditAction(model?: string | null): string {
  const id = String(model || '').trim()
  if (id === XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_5) return 'video.generate.xingyuemeng.seedance2_5'
  if (id === XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI) return 'video.generate.xingyuemeng.seedance2_mini'
  if (id === XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST) return 'video.generate.xingyuemeng.seedance2_fast'
  return 'video.generate.xingyuemeng.seedance2_pro'
}

export function resolveXingyuemengCreditCostDefault(model?: string | null): number {
  return resolveXingyuemengUserCreditCost(
    model,
    XINGYUEMENG_DURATION_BOUNDS.defaultSec,
    XINGYUEMENG_DEFAULT_RESOLUTION,
  )
}

export function xingyuemengVideoModelLabel(model?: string | null): string {
  const id = String(model || '').trim()
  if (id === XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_5) return 'S 2.5'
  if (id === XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI) return 'S 2.0 Mini'
  if (id === XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST) return 'S 2.0 Fast'
  if (id === XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_PRO) return 'S 2.0 Pro'
  return id || 'S 2.0 Pro'
}

export function normalizeXingyuemengDuration(duration?: number | null): number {
  const n = Math.round(Number(duration ?? XINGYUEMENG_DURATION_BOUNDS.defaultSec))
  if (!Number.isFinite(n)) return XINGYUEMENG_DURATION_BOUNDS.defaultSec
  return Math.min(XINGYUEMENG_DURATION_BOUNDS.max, Math.max(XINGYUEMENG_DURATION_BOUNDS.min, n))
}

export function normalizeXingyuemengAspectRatio(
  ratio?: string | null,
  fallback = XINGYUEMENG_DEFAULT_ASPECT_RATIO,
): string {
  const r = String(ratio || '').trim()
  if ((XINGYUEMENG_ASPECT_RATIOS as readonly string[]).includes(r as any)) return r
  return fallback
}

export function normalizeXingyuemengResolution(
  resolution?: string | null,
  fallback = XINGYUEMENG_DEFAULT_RESOLUTION,
): string {
  const raw = String(resolution || '').trim().toLowerCase()
  if (raw === '480p' || raw === '480' || raw === '854x480' || raw === '640x480') return '480p'
  if (raw === '720p' || raw === '720' || raw === '1280x720') return '720p'
  // 1080p / 4k 已下架：非法或高清档一律回落到 720p
  if (raw === '1080p' || raw === '1080' || raw === '1920x1080' || raw === '4k' || raw === '2160p') {
    return '720p'
  }
  if ((XINGYUEMENG_RESOLUTIONS as readonly string[]).includes(raw as any)) return raw
  return fallback
}

export function resolveXingyuemengApiBaseUrl(baseUrl?: string | null): string {
  const raw = String(baseUrl || '').trim().replace(/\/+$/, '')
  return raw || XINGYUEMENG_API_BASE
}

export function normalizeXingyuemengToken(raw?: string | null): string {
  let value = String(raw || '').trim()
  if (!value) return ''
  value = value.replace(/^bearer\s+/i, '').trim()
  return value
}

export function resolveXingyuemengVideoMode(refCount: number): string {
  return refCount > 0 ? 'multi_image_video' : 'text_to_video'
}
