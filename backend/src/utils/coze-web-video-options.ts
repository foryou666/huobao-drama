import {
  COZE_DEFAULT_VIDEO_MODEL,
  COZE_ENABLED_VIDEO_MODELS,
  COZE_REF_LIMITS,
  cozeVideoModelLabel,
  isCozeVideoModel,
  normalizeCozeDuration,
  resolveCozeCreditCostDefault,
  resolveCozeVideoCreditAction,
  COZE_DURATION_BOUNDS,
} from '../constants/coze-web.js'
import {
  getActiveCozeSessionId,
  getCozeWebSession,
  hasCozeWebSession,
  listCozeWebSessions,
  toPublicCozeSession,
} from '../services/coze-web-session.js'
import { validateCozeSession } from '../services/coze-web-client.js'

export const COZE_SESSION_STYLE_PREFIX = 'coze_session:'

export function formatCozeSessionStyle(sessionId: string): string {
  return `${COZE_SESSION_STYLE_PREFIX}${String(sessionId || '').trim()}`
}

export function parseCozeSessionIdFromStyle(style?: string | null): string | null {
  const raw = String(style || '').trim()
  if (!raw.startsWith(COZE_SESSION_STYLE_PREFIX)) return null
  const id = raw.slice(COZE_SESSION_STYLE_PREFIX.length).trim()
  return id || null
}

export function resolveCozeSessionForStyle(style?: string | null) {
  const id = parseCozeSessionIdFromStyle(style)
  return getCozeWebSession(id || undefined)
}

export async function listCozeSessionSummaries() {
  const store = listCozeWebSessions()
  const activeId = getActiveCozeSessionId()
  return Promise.all(store.map(async (session) => {
    const valid = await validateCozeSession(session)
    return {
      ...toPublicCozeSession(session, activeId),
      valid,
    }
  }))
}

export function isCozeVideoRequest(body: Record<string, unknown>): boolean {
  if (body.coze === true || body.coze === 1 || body.coze === '1') return true
  return isCozeVideoModel(String(body.model || '')) && body.provider === 'coze_web'
}

export function listCozeVideoModelOptions() {
  return COZE_ENABLED_VIDEO_MODELS.map(id => {
    const creditAction = resolveCozeVideoCreditAction(id)
    const unitCost = resolveCozeCreditCostDefault(id)
    return {
      id,
      label: cozeVideoModelLabel(id),
      duration_min: COZE_DURATION_BOUNDS.min,
      duration_max: COZE_DURATION_BOUNDS.max,
      duration_default: COZE_DURATION_BOUNDS.defaultSec,
      duration_options: null,
      credit_action: creditAction,
      billing_unit: 'second',
      credit_cost_flat: null,
      credit_cost_per_second: unitCost,
      ref_limits: {
        images: COZE_REF_LIMITS.images,
        audios: COZE_REF_LIMITS.audios,
        videos: COZE_REF_LIMITS.videos,
        max_total: null,
      },
      config_id: null,
    }
  })
}

export async function getCozeSessionStatus(sessionId?: string | null) {
  const session = getCozeWebSession(sessionId || undefined)
  if (!session) {
    return {
      configured: false,
      valid: false,
      id: null,
      cookie_masked: null,
      api_key_masked: null,
      label: null,
      updated_at: null,
    }
  }
  const valid = await validateCozeSession(session)
  return {
    configured: true,
    valid,
    ...toPublicCozeSession(session, getActiveCozeSessionId()),
  }
}

export function assertCozeSessionConfigured() {
  if (!hasCozeWebSession()) {
    throw new Error('S通道7 未配置，请联系管理员在设置中添加扣子 Cookie 或 PAT')
  }
}

export function normalizeCozeSubmitModel(body: Record<string, unknown>): string {
  const requested = String(body.model || COZE_DEFAULT_VIDEO_MODEL).trim()
  const resolved = isCozeVideoModel(requested) ? requested : COZE_DEFAULT_VIDEO_MODEL
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

export function assertCozeReferencesAllowed(body: Record<string, unknown>) {
  const counts = countRefsByType(body)
  if (counts.images > COZE_REF_LIMITS.images) {
    throw new Error(`S通道7最多 ${COZE_REF_LIMITS.images} 张参考图，当前 ${counts.images} 张`)
  }
  if (counts.videos > COZE_REF_LIMITS.videos) {
    throw new Error(`S通道7最多 ${COZE_REF_LIMITS.videos} 个参考视频，当前 ${counts.videos} 个`)
  }
  if (counts.audios > COZE_REF_LIMITS.audios) {
    throw new Error(`S通道7最多 ${COZE_REF_LIMITS.audios} 个参考音频，当前 ${counts.audios} 个`)
  }
}

export function resolveCozeDefaultModel(): string {
  return COZE_DEFAULT_VIDEO_MODEL
}

export { normalizeCozeDuration }
