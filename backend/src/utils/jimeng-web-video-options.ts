import {
  JIMENG_DEFAULT_VIDEO_MODEL,
  JIMENG_ENABLED_VIDEO_MODELS,
  JIMENG_OMNI_MAX_TOTAL_REFS,
  JIMENG_REF_LIMITS,
  JIMENG_SEEDANCE_2_0_CREDIT_COST,
  JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST,
  isJimengVideoModel,
  jimengVideoDurationBounds,
  jimengVideoModelLabel,
  resolveJimengVideoCreditAction,
  resolveJimengSubmitModel,
} from '../constants/jimeng-web.js'
import { hasJimengWebSession, maskJimengSessionId, getJimengWebSession, listJimengWebSessions, getActiveJimengSessionId, toPublicJimengSession } from '../services/jimeng-web-session.js'
import { validateJimengSession, getJimengUserCredit } from '../services/jimeng-web-client.js'

export const JIMENG_SESSION_STYLE_PREFIX = 'jimeng_session:'

export function formatJimengSessionStyle(sessionId: string): string {
  return `${JIMENG_SESSION_STYLE_PREFIX}${String(sessionId || '').trim()}`
}

export function parseJimengSessionIdFromStyle(style?: string | null): string | null {
  const raw = String(style || '').trim()
  if (!raw.startsWith(JIMENG_SESSION_STYLE_PREFIX)) return null
  const id = raw.slice(JIMENG_SESSION_STYLE_PREFIX.length).trim()
  return id || null
}

export function resolveJimengSessionForStyle(style?: string | null) {
  const id = parseJimengSessionIdFromStyle(style)
  return getJimengWebSession(id || undefined)
}

export async function listJimengSessionSummaries() {
  const store = listJimengWebSessions()
  const activeId = getActiveJimengSessionId()
  return Promise.all(store.map(async (session) => {
    const valid = await validateJimengSession(session)
    const credits = valid ? await getJimengUserCredit(session) : null
    return {
      ...toPublicJimengSession(session, activeId),
      valid,
      gift_credit: credits?.giftCredit ?? null,
      purchase_credit: credits?.purchaseCredit ?? null,
      vip_credit: credits?.vipCredit ?? null,
      total_credit: credits?.totalCredit ?? null,
      credit_expire_at: credits?.creditExpireAt ?? null,
      credit_expire_at_iso: credits?.creditExpireAtIso ?? null,
    }
  }))
}

export function isJimengVideoRequest(body: Record<string, unknown>): boolean {
  if (body.jimeng === true || body.jimeng === 1 || body.jimeng === '1') return true
  return isJimengVideoModel(String(body.model || '')) && body.provider === 'jimeng_web'
}

export function listJimengVideoModelOptions() {
  return JIMENG_ENABLED_VIDEO_MODELS.map(id => {
    const bounds = jimengVideoDurationBounds(id)
    const creditAction = resolveJimengVideoCreditAction(id)
    return {
      id,
      label: jimengVideoModelLabel(id),
      duration_min: bounds.min,
      duration_max: bounds.max,
      duration_default: bounds.defaultSec,
      duration_options: bounds.options,
      credit_action: creditAction,
      credit_cost_flat: creditAction === 'video.generate.jimeng.seedance2'
        ? JIMENG_SEEDANCE_2_0_CREDIT_COST
        : JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST,
      config_id: null,
    }
  })
}

export async function getJimengSessionStatus(sessionId?: string | null) {
  const session = getJimengWebSession(sessionId || undefined)
  if (!session) {
    return {
      configured: false,
      valid: false,
      id: null,
      session_id_masked: null,
      label: null,
      updated_at: null,
    }
  }

  const valid = await validateJimengSession(session)
  return {
    configured: true,
    valid,
    id: session.id,
    session_id_masked: maskJimengSessionId(session.sessionId),
    label: session.label || null,
    updated_at: session.updatedAt || null,
    has_full_cookie: !!session.cookie,
    is_active: session.id === getActiveJimengSessionId(),
  }
}

export function assertJimengSessionConfigured() {
  if (!hasJimengWebSession()) {
    throw new Error('即梦 Session 未配置，请管理员在「设置 → AI 服务 → 即梦 Session」中配置')
  }
}

export function resolveJimengDefaultModel(): string {
  return JIMENG_DEFAULT_VIDEO_MODEL
}

export function normalizeJimengSubmitModel(body: Record<string, unknown>): string {
  const requested = String(body.model || '').trim().toLowerCase()
  const resolved = resolveJimengSubmitModel(requested)
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

export function assertJimengReferencesAllowed(body: Record<string, unknown>) {
  const counts = countRefsByType(body)
  const total = counts.images + counts.videos + counts.audios

  if (counts.images > JIMENG_REF_LIMITS.images) {
    throw new Error(`即梦通道4最多 ${JIMENG_REF_LIMITS.images} 张参考图，当前 ${counts.images} 张`)
  }
  if (counts.videos > JIMENG_REF_LIMITS.videos) {
    throw new Error(`即梦通道4最多 ${JIMENG_REF_LIMITS.videos} 个参考视频，当前 ${counts.videos} 个`)
  }
  if (counts.audios > JIMENG_REF_LIMITS.audios) {
    throw new Error(`即梦通道4最多 ${JIMENG_REF_LIMITS.audios} 个参考音频，当前 ${counts.audios} 个`)
  }
  if (total > JIMENG_OMNI_MAX_TOTAL_REFS) {
    throw new Error(`即梦通道4参考素材总数不能超过 ${JIMENG_OMNI_MAX_TOTAL_REFS} 个（9图+3音+3视频）`)
  }
}
