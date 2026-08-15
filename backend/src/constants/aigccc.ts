/** AIGC Seedance 2.0 — https://www.aigccc666.com/ */
export const AIGCCC_DEFAULT_BASE_URL = 'https://www.aigccc666.com'
export const AIGCCC_CREATE_PATH = '/api/external/v1/video/task/create'
export const AIGCCC_STATUS_PATH = '/api/external/v1/video/task/status'
/** 上游未开放独立余额接口；账户剩余积分在任务 status 的 remaining_credits 字段 */

export const AIGCCC_DURATION_BOUNDS = { min: 4, max: 15, defaultSec: 15 } as const
export const AIGCCC_REF_LIMITS = { images: 9, videos: 3, audios: 3 } as const
export const AIGCCC_ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const
export const AIGCCC_RESOLUTIONS = ['480p', '720p', '1080p'] as const

export const AIGCCC_MODES = {
  MINI: 'mini',
  PRO: 'pro',
} as const

export type AigcccMode = (typeof AIGCCC_MODES)[keyof typeof AIGCCC_MODES]

export const AIGCCC_DEFAULT_MODE: AigcccMode = AIGCCC_MODES.MINI

/** 本站默认按条积分（上游积分制不同，管理员可在设置里改） */
export const AIGCCC_MINI_CREDIT_COST = 480
export const AIGCCC_PRO_CREDIT_COST = 620

export function isAigcccProvider(provider?: string | null): boolean {
  return String(provider || '').trim().toLowerCase() === 'aigccc'
}

export function normalizeAigcccMode(mode?: string | null): AigcccMode {
  const raw = String(mode || '').trim().toLowerCase()
  if (raw === 'pro' || raw === 'full') return AIGCCC_MODES.PRO
  // 本站内部档位仍记 mini；上游 create 接口实际要 fast（见 toAigcccUpstreamMode）
  if (raw === 'min' || raw === 'mini' || raw === 'fast') return AIGCCC_MODES.MINI
  return AIGCCC_DEFAULT_MODE
}

/** 发给上游的 mode：fast / pro（传 mini/min 会立即返回「远程提交失败」） */
export function toAigcccUpstreamMode(mode?: string | null): 'fast' | 'pro' {
  return normalizeAigcccMode(mode) === AIGCCC_MODES.PRO ? 'pro' : 'fast'
}

export function isAigcccVideoModel(model?: string | null): boolean {
  const raw = String(model || '').trim().toLowerCase()
  if (!raw) return false
  if (raw === 'mini' || raw === 'min' || raw === 'fast' || raw === 'pro') return true
  return raw.startsWith('aigccc-') || raw.startsWith('seedance-aigccc')
}

export function aigcccModeLabel(mode?: string | null): string {
  const m = normalizeAigcccMode(mode)
  return m === AIGCCC_MODES.PRO ? 'S2.0满血' : 'S2.0 fast'
}

export function aigcccModeCreditAction(mode?: string | null): string {
  const m = normalizeAigcccMode(mode)
  return m === AIGCCC_MODES.PRO
    ? 'video.generate.aigccc.pro'
    : 'video.generate.aigccc.mini'
}

export function normalizeAigcccAspectRatio(value?: string | null): string {
  const raw = String(value || '').trim()
  if ((AIGCCC_ASPECT_RATIOS as readonly string[]).includes(raw)) return raw
  return '9:16'
}

export function normalizeAigcccDuration(value?: number | null): number {
  const n = Math.round(Number(value ?? AIGCCC_DURATION_BOUNDS.defaultSec))
  if (!Number.isFinite(n)) return AIGCCC_DURATION_BOUNDS.defaultSec
  return Math.min(AIGCCC_DURATION_BOUNDS.max, Math.max(AIGCCC_DURATION_BOUNDS.min, n))
}

export function normalizeAigcccResolution(value?: string | null): string {
  const raw = String(value || '').trim().toLowerCase()
  if ((AIGCCC_RESOLUTIONS as readonly string[]).includes(raw)) return raw
  return '720p'
}
