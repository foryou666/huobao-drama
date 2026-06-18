import {
  JIMENG_DEFAULT_VIDEO_MODEL,
  JIMENG_VIDEO_MODELS,
  JIMENG_VIDEO_CREDIT_COST,
  isJimengVideoModel,
  jimengVideoDurationBounds,
  jimengVideoModelLabel,
} from '../constants/jimeng-web.js'
import { hasJimengWebSession, maskJimengSessionId, getJimengWebSession } from '../services/jimeng-web-session.js'
import { validateJimengSession } from '../services/jimeng-web-client.js'

export function isJimengVideoRequest(body: Record<string, unknown>): boolean {
  if (body.jimeng === true || body.jimeng === 1 || body.jimeng === '1') return true
  return isJimengVideoModel(String(body.model || '')) && body.provider === 'jimeng_web'
}

export function listJimengVideoModelOptions() {
  const ids = [
    JIMENG_VIDEO_MODELS.V3_5_PRO,
    JIMENG_VIDEO_MODELS.V3_0_PRO,
    JIMENG_VIDEO_MODELS.V3_0,
    JIMENG_VIDEO_MODELS.V3_0_FAST,
    JIMENG_VIDEO_MODELS.SEEDANCE_2_0,
    JIMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST,
  ]
  return ids.map(id => {
    const bounds = jimengVideoDurationBounds(id)
    return {
      id,
      label: jimengVideoModelLabel(id),
      duration_min: bounds.min,
      duration_max: bounds.max,
      duration_default: bounds.defaultSec,
      duration_options: bounds.options,
      credit_cost_flat: JIMENG_VIDEO_CREDIT_COST,
      config_id: null,
    }
  })
}

export async function getJimengSessionStatus() {
  const session = getJimengWebSession()
  if (!session) {
    return {
      configured: false,
      valid: false,
      session_id_masked: null,
      label: null,
      updated_at: null,
    }
  }

  const valid = await validateJimengSession(session)
  return {
    configured: true,
    valid,
    session_id_masked: maskJimengSessionId(session.sessionId),
    label: session.label || null,
    updated_at: session.updatedAt || null,
    has_full_cookie: !!session.cookie,
  }
}

export function assertJimengSessionConfigured() {
  if (!hasJimengWebSession()) {
    throw new Error('即梦 Session 未配置，请管理员在「即梦视频」页粘贴浏览器 Cookie')
  }
}

export function resolveJimengDefaultModel(): string {
  return JIMENG_DEFAULT_VIDEO_MODEL
}
