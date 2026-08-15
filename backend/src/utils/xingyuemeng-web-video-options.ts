import {
  XINGYUEMENG_DEFAULT_ASPECT_RATIO,
  XINGYUEMENG_DEFAULT_RESOLUTION,
  XINGYUEMENG_DEFAULT_VIDEO_MODEL,
  XINGYUEMENG_DURATION_BOUNDS,
  XINGYUEMENG_ENABLED_VIDEO_MODELS,
  XINGYUEMENG_REF_LIMITS,
  XINGYUEMENG_RESOLUTIONS,
  isXingyuemengVideoModel,
  normalizeXingyuemengResolution,
  resolveXingyuemengVideoCreditAction,
  xingyuemengVideoModelLabel,
} from '../constants/xingyuemeng-web.js'
import {
  getActiveXingyuemengSessionId,
  getXingyuemengWebSession,
  listXingyuemengWebSessions,
  toPublicXingyuemengSession,
} from '../services/xingyuemeng-web-session.js'
import { validateXingyuemengSession } from '../services/xingyuemeng-web-client.js'

export const XINGYUEMENG_SESSION_STYLE_PREFIX = 'xingyuemeng_session:'

export function encodeXingyuemengSessionStyle(sessionId: string, assetId?: string | null): string {
  const base = `${XINGYUEMENG_SESSION_STYLE_PREFIX}${String(sessionId || '').trim()}`
  const asset = String(assetId || '').trim()
  return asset ? `${base}|asset:${asset}` : base
}

export function parseXingyuemengSessionIdFromStyle(style?: string | null): string | null {
  const raw = String(style || '')
  if (!raw.startsWith(XINGYUEMENG_SESSION_STYLE_PREFIX)) return null
  const rest = raw.slice(XINGYUEMENG_SESSION_STYLE_PREFIX.length)
  const id = rest.split('|')[0]?.trim()
  return id || null
}

export function parseXingyuemengAssetIdFromStyle(style?: string | null): string | null {
  const m = String(style || '').match(/\|asset:([^|]+)/)
  return m?.[1]?.trim() || null
}

export function resolveXingyuemengSessionForStyle(style?: string | null) {
  const id = parseXingyuemengSessionIdFromStyle(style)
  return getXingyuemengWebSession(id)
}

export function isXingyuemengVideoRequest(body: Record<string, unknown>): boolean {
  if (body.xingyuemeng === true || body.xingyuemeng === 1 || body.xingyuemeng === '1') return true
  return isXingyuemengVideoModel(String(body.model || '')) && body.provider === 'xingyuemeng_web'
}

export function normalizeXingyuemengSubmitModel(body: Record<string, unknown>): string {
  const requested = String(body.model || XINGYUEMENG_DEFAULT_VIDEO_MODEL).trim()
  const resolved = isXingyuemengVideoModel(requested) ? requested : XINGYUEMENG_DEFAULT_VIDEO_MODEL
  body.model = resolved
  body.resolution = normalizeXingyuemengResolution(
    body.resolution != null ? String(body.resolution) : null,
  )
  return resolved
}

export function listXingyuemengVideoModelOptions() {
  return XINGYUEMENG_ENABLED_VIDEO_MODELS.map(id => {
    const action = resolveXingyuemengVideoCreditAction(id)
    return {
      id,
      label: xingyuemengVideoModelLabel(id),
      billing_unit: 'duration_resolution',
      credit_action: action,
      credit_cost_per_second: null,
      duration_min: XINGYUEMENG_DURATION_BOUNDS.min,
      duration_max: XINGYUEMENG_DURATION_BOUNDS.max,
      duration_default: XINGYUEMENG_DURATION_BOUNDS.defaultSec,
      resolutions: [...XINGYUEMENG_RESOLUTIONS],
      default_resolution: XINGYUEMENG_DEFAULT_RESOLUTION,
      ref_limits: { ...XINGYUEMENG_REF_LIMITS },
    }
  })
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
  return { images: images.size, videos: videos.size, audios: audios.size }
}

export function assertXingyuemengReferencesAllowed(body: Record<string, unknown>) {
  const counts = countRefsByType(body)
  if (counts.images > XINGYUEMENG_REF_LIMITS.images) {
    throw new Error(`S通道9最多 ${XINGYUEMENG_REF_LIMITS.images} 张参考图，当前 ${counts.images} 张`)
  }
  if (counts.videos > XINGYUEMENG_REF_LIMITS.videos) {
    throw new Error(`S通道9最多 ${XINGYUEMENG_REF_LIMITS.videos} 个参考视频，当前 ${counts.videos} 个`)
  }
  if (counts.audios > XINGYUEMENG_REF_LIMITS.audios) {
    throw new Error(`S通道9最多 ${XINGYUEMENG_REF_LIMITS.audios} 个参考音频，当前 ${counts.audios} 个`)
  }
}

export async function listXingyuemengSessionSummaries() {
  const activeId = getActiveXingyuemengSessionId()
  const items = []
  for (const session of listXingyuemengWebSessions()) {
    const valid = await validateXingyuemengSession(session)
    items.push({
      ...toPublicXingyuemengSession(session, activeId),
      valid,
    })
  }
  return items
}

export async function getXingyuemengSessionStatus() {
  const session = getXingyuemengWebSession()
  if (!session) {
    return { configured: false, valid: false, active_id: null }
  }
  const valid = await validateXingyuemengSession(session)
  return {
    configured: true,
    valid,
    active_id: getActiveXingyuemengSessionId(),
    ...toPublicXingyuemengSession(session),
  }
}

export function assertXingyuemengSessionConfigured() {
  if (!getXingyuemengWebSession()) {
    throw new Error('S通道9 未配置 Token，请管理员在设置中粘贴星月梦 xymai_token')
  }
}

export function resolveXingyuemengRequestModel(body: Record<string, unknown>): string {
  const requested = String(body.model || XINGYUEMENG_DEFAULT_VIDEO_MODEL).trim()
  return isXingyuemengVideoModel(requested) ? requested : XINGYUEMENG_DEFAULT_VIDEO_MODEL
}

export { XINGYUEMENG_DEFAULT_ASPECT_RATIO, XINGYUEMENG_DEFAULT_RESOLUTION }
