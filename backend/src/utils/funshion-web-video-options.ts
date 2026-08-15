import {
  FUNSHION_DEFAULT_VIDEO_MODEL,
  FUNSHION_DURATION_BOUNDS,
  FUNSHION_ENABLED_VIDEO_MODELS,
  FUNSHION_REF_LIMITS,
  funshionResolutionsForModel,
  funshionVideoModelLabel,
  isFunshionVideoModel,
  normalizeFunshionClarity,
  resolveFunshionCreditCostDefault,
  resolveFunshionVideoCreditAction,
} from '../constants/funshion-web.js'
import { getActionCost } from '../services/credits.js'
import {
  getActiveFunshionSessionId,
  getFunshionWebSession,
  listFunshionWebSessions,
  toPublicFunshionSession,
} from '../services/funshion-web-session.js'
import { validateFunshionSession, fetchFunshionUserCoin } from '../services/funshion-web-client.js'

export const FUNSHION_SESSION_STYLE_PREFIX = 'funshion_session:'

export function encodeFunshionSessionStyle(sessionId: string): string {
  return `${FUNSHION_SESSION_STYLE_PREFIX}${String(sessionId || '').trim()}`
}

export function parseFunshionSessionIdFromStyle(style?: string | null): string | null {
  const raw = String(style || '')
  if (!raw.startsWith(FUNSHION_SESSION_STYLE_PREFIX)) return null
  const rest = raw.slice(FUNSHION_SESSION_STYLE_PREFIX.length)
  const id = rest.split('|')[0]?.trim()
  return id || null
}

export function resolveFunshionSessionForStyle(style?: string | null) {
  const id = parseFunshionSessionIdFromStyle(style)
  return getFunshionWebSession(id)
}

export function isFunshionVideoRequest(body: Record<string, unknown>): boolean {
  if (body.funshion === true || body.funshion === 1 || body.funshion === '1') return true
  return isFunshionVideoModel(String(body.model || '')) && body.provider === 'funshion_web'
}

export function normalizeFunshionSubmitModel(body: Record<string, unknown>): string {
  const requested = String(body.model || FUNSHION_DEFAULT_VIDEO_MODEL).trim()
  const resolved = isFunshionVideoModel(requested) ? requested : FUNSHION_DEFAULT_VIDEO_MODEL
  body.model = resolved
  body.resolution = normalizeFunshionClarity(
    body.resolution != null ? String(body.resolution) : null,
    undefined,
    resolved,
  )
  return resolved
}

export function listFunshionVideoModelOptions() {
  return FUNSHION_ENABLED_VIDEO_MODELS.map(id => {
    const action = resolveFunshionVideoCreditAction(id)
    const creditCostPerSecond = getActionCost(action, 1) || resolveFunshionCreditCostDefault(id)
    const resolutions = funshionResolutionsForModel(id)
    return {
      id,
      label: funshionVideoModelLabel(id),
      billing_unit: 'per_second',
      credit_action: action,
      credit_cost_per_second: creditCostPerSecond,
      duration_min: FUNSHION_DURATION_BOUNDS.min,
      duration_max: FUNSHION_DURATION_BOUNDS.max,
      duration_default: FUNSHION_DURATION_BOUNDS.defaultSec,
      resolutions,
      default_resolution: resolutions[0] || '480p',
      ref_limits: { ...FUNSHION_REF_LIMITS },
    }
  })
}

export function resolveFunshionRequestModel(body: Record<string, unknown>): string {
  const requested = String(body.model || FUNSHION_DEFAULT_VIDEO_MODEL).trim()
  return isFunshionVideoModel(requested) ? requested : FUNSHION_DEFAULT_VIDEO_MODEL
}

function countFunshionRefsByType(body: Record<string, unknown>) {
  const images = new Set<string>()
  const videos = new Set<string>()
  const audios = new Set<string>()

  const push = (bucket: Set<string>, value: unknown) => {
    const next = String(value || '').trim()
    if (next) bucket.add(next)
  }

  if (Array.isArray(body.reference_image_urls)) {
    body.reference_image_urls.forEach(item => push(images, item))
  }
  push(images, body.image_url)
  push(images, body.imageUrl)
  push(images, body.first_frame_url)
  push(images, body.firstFrameUrl)
  push(images, body.last_frame_url)
  push(images, body.lastFrameUrl)

  const refs = Array.isArray(body.content_refs) ? body.content_refs : []
  for (const item of refs) {
    const type = String((item as Record<string, unknown>)?.type || '').toLowerCase()
    const url = (item as Record<string, unknown>)?.url
    if (type === 'image') push(images, url)
    else if (type === 'video') push(videos, url)
    else if (type === 'audio') push(audios, url)
  }

  return {
    images: images.size,
    videos: videos.size,
    audios: audios.size,
  }
}

export function assertFunshionReferencesAllowed(body: Record<string, unknown>) {
  const counts = countFunshionRefsByType(body)
  if (counts.images > FUNSHION_REF_LIMITS.images) {
    throw new Error(`S通道8最多 ${FUNSHION_REF_LIMITS.images} 张参考图，当前 ${counts.images} 张`)
  }
  if (counts.videos > FUNSHION_REF_LIMITS.videos) {
    throw new Error(`S通道8最多 ${FUNSHION_REF_LIMITS.videos} 个参考视频，当前 ${counts.videos} 个`)
  }
  if (counts.audios > FUNSHION_REF_LIMITS.audios) {
    throw new Error(`S通道8最多 ${FUNSHION_REF_LIMITS.audios} 个参考音频，当前 ${counts.audios} 个`)
  }
}

export async function listFunshionSessionSummaries() {
  const activeId = getActiveFunshionSessionId()
  const items = []
  for (const session of listFunshionWebSessions()) {
    let valid = false
    let coinAmount: number | null = null
    let coinVip: number | null = null
    let coinPackage: number | null = null
    let coinGive: number | null = null
    let coinError: string | null = null
    try {
      const coin = await fetchFunshionUserCoin(session)
      valid = true
      coinAmount = coin.coinAmount
      coinVip = coin.coinVip
      coinPackage = coin.coinPackage
      coinGive = coin.coinGive
    } catch (err: any) {
      valid = await validateFunshionSession(session)
      coinError = String(err?.message || '查询余额失败').slice(0, 120)
    }
    items.push({
      ...toPublicFunshionSession(session, activeId),
      valid,
      coin_amount: coinAmount,
      coin_vip: coinVip,
      coin_package: coinPackage,
      coin_give: coinGive,
      coin_error: coinError,
    })
  }
  return items
}

export async function getFunshionSessionStatus() {
  const session = getFunshionWebSession()
  if (!session) {
    return { configured: false, valid: false, active_id: null }
  }
  const valid = await validateFunshionSession(session)
  return {
    configured: true,
    valid,
    active_id: getActiveFunshionSessionId(),
    ...toPublicFunshionSession(session),
  }
}

export function assertFunshionSessionConfigured() {
  if (!getFunshionWebSession()) {
    throw new Error('S通道8 未配置 Token，请管理员在设置中粘贴视频页 Authorization')
  }
}
