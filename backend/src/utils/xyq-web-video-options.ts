import {
  XYQ_DEFAULT_VIDEO_MODEL,
  XYQ_ENABLED_VIDEO_MODELS,
  isXyqPerSecondBilling,
  isXyqVideoModel,
  resolveXyqCreditCostDefault,
  resolveXyqVideoCreditAction,
  xyqRefLimitsForModel,
  xyqVideoDurationBounds,
  xyqVideoModelLabel,
} from '../constants/xyq-web.js'
import {
  getActiveXyqSessionId,
  getXyqWebSession,
  hasXyqWebSession,
  listXyqWebSessions,
  maskXyqAccessKey,
  toPublicXyqSession,
} from '../services/xyq-web-session.js'
import { getXyqUserCredit, validateXyqSession } from '../services/xyq-web-client.js'

export const XYQ_SESSION_STYLE_PREFIX = 'xyq_key:'

export function formatXyqSessionStyle(sessionId: string): string {
  return `${XYQ_SESSION_STYLE_PREFIX}${String(sessionId || '').trim()}`
}

export function parseXyqSessionIdFromStyle(style?: string | null): string | null {
  const raw = String(style || '').trim()
  if (!raw.startsWith(XYQ_SESSION_STYLE_PREFIX)) return null
  const id = raw.slice(XYQ_SESSION_STYLE_PREFIX.length).trim()
  return id || null
}

export function resolveXyqSessionForStyle(style?: string | null) {
  const id = parseXyqSessionIdFromStyle(style)
  return getXyqWebSession(id || undefined)
}

export async function listXyqSessionSummaries() {
  const store = listXyqWebSessions()
  const activeId = getActiveXyqSessionId()
  return Promise.all(store.map(async (session) => {
    const valid = await validateXyqSession(session)
    const credits = valid ? await getXyqUserCredit(session) : null
    return {
      ...toPublicXyqSession(session, activeId),
      valid,
      gift_credit: credits?.giftCredit ?? null,
      free_credit: credits?.freeCredit ?? null,
      purchase_credit: credits?.purchaseCredit ?? null,
      vip_credit: credits?.vipCredit ?? null,
      total_credit: credits?.totalCredit ?? null,
      credit_expire_at: credits?.creditExpireAt ?? null,
      credit_expire_at_iso: credits?.creditExpireAtIso ?? null,
    }
  }))
}

export function isXyqVideoRequest(body: Record<string, unknown>): boolean {
  if (body.xyq === true || body.xyq === 1 || body.xyq === '1') return true
  return isXyqVideoModel(String(body.model || '')) && body.provider === 'xyq_web'
}

export function listXyqVideoModelOptions() {
  return XYQ_ENABLED_VIDEO_MODELS.map(id => {
    const bounds = xyqVideoDurationBounds(id)
    const creditAction = resolveXyqVideoCreditAction(id)
    const perSecond = isXyqPerSecondBilling(id)
    const unitCost = resolveXyqCreditCostDefault(id)
    const refLimits = xyqRefLimitsForModel(id)
    return {
      id,
      label: xyqVideoModelLabel(id),
      duration_min: bounds.min,
      duration_max: bounds.max,
      duration_default: bounds.defaultSec,
      duration_options: bounds.options,
      credit_action: creditAction,
      billing_unit: perSecond ? 'second' : 'flat',
      credit_cost_flat: perSecond ? null : unitCost,
      credit_cost_per_second: perSecond ? unitCost : null,
      ref_limits: {
        images: refLimits.images,
        audios: refLimits.audios,
        videos: refLimits.videos,
        max_total: refLimits.maxTotal,
      },
      config_id: null,
    }
  })
}

export async function getXyqSessionStatus(sessionId?: string | null) {
  const session = getXyqWebSession(sessionId || undefined)
  if (!session) {
    return {
      configured: false,
      valid: false,
      id: null,
      access_key_masked: null,
      label: null,
      updated_at: null,
    }
  }
  const valid = await validateXyqSession(session)
  return {
    configured: true,
    valid,
    id: session.id,
    access_key_masked: maskXyqAccessKey(session.accessKey),
    label: session.label || null,
    updated_at: session.updatedAt || null,
    is_active: session.id === getActiveXyqSessionId(),
  }
}

export function assertXyqSessionConfigured() {
  if (!hasXyqWebSession()) {
    throw new Error('S通道5 Access Key 未配置，请联系管理员')
  }
}

export function resolveXyqDefaultModel(): string {
  return XYQ_DEFAULT_VIDEO_MODEL
}

export function normalizeXyqSubmitModel(body: Record<string, unknown>): string {
  const requested = String(body.model || XYQ_DEFAULT_VIDEO_MODEL).trim()
  const resolved = isXyqVideoModel(requested) ? requested : XYQ_DEFAULT_VIDEO_MODEL
  body.model = resolved
  return resolved
}

function countRefsByType(body: Record<string, unknown>) {
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

export function assertXyqReferencesAllowed(body: Record<string, unknown>) {
  const model = String(body.model || XYQ_DEFAULT_VIDEO_MODEL).trim()
  const limits = xyqRefLimitsForModel(model)
  const counts = countRefsByType(body)
  if (counts.images > limits.images) {
    throw new Error(`S通道5最多 ${limits.images} 张参考图，当前 ${counts.images} 张`)
  }
  if (counts.videos > limits.videos) {
    throw new Error(`S通道5最多 ${limits.videos} 个参考视频，当前 ${counts.videos} 个`)
  }
  if (counts.audios > limits.audios) {
    throw new Error(`S通道5最多 ${limits.audios} 个参考音频，当前 ${counts.audios} 个`)
  }
  if (limits.maxTotal != null) {
    const total = counts.images + counts.videos + counts.audios
    if (total > limits.maxTotal) {
      throw new Error(`S 2.5 参考素材合计最多 ${limits.maxTotal} 个（图+视频+音频），当前 ${total} 个`)
    }
  }
}
