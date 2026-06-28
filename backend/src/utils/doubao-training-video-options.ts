import {
  DOUBAO_TRAINING_ASPECT_RATIOS,
  DOUBAO_TRAINING_DEFAULT_ASPECT_RATIO,
  DOUBAO_TRAINING_DAILY_QUOTA,
  DOUBAO_TRAINING_DEFAULT_DURATION,
  DOUBAO_TRAINING_DOC_URL,
  DOUBAO_TRAINING_DURATION_OPTIONS,
  DOUBAO_TRAINING_OVERLAY_TEXT,
  DOUBAO_TRAINING_REF_LIMITS,
  DOUBAO_TRAINING_VIDEO_MODEL,
  isDoubaoTrainingVideoModel,
  normalizeDoubaoTrainingAspectRatio,
  normalizeDoubaoTrainingDuration,
} from '../constants/doubao-training.js'
import {
  getActiveDoubaoTrainingSessionId,
  getDoubaoTrainingSession,
  hasDoubaoTrainingSession,
  listDoubaoTrainingSessions,
  toPublicDoubaoTrainingSession,
} from '../services/doubao-training-session.js'
import { validateDoubaoTrainingSession } from '../services/doubao-training-client.js'
import {
  getDoubaoSessionRemainingQuota,
  listDoubaoSessionQuotaSummaries,
} from '../utils/doubao-training-quota.js'
import { getTrainingOverlayText } from '../utils/training-video-overlay.js'

export const DOUBAO_TRAINING_SESSION_STYLE_PREFIX = 'doubao_training_session:'

export function formatDoubaoTrainingSessionStyle(sessionId: string): string {
  return `${DOUBAO_TRAINING_SESSION_STYLE_PREFIX}${String(sessionId || '').trim()}`
}

export function parseDoubaoTrainingSessionIdFromStyle(style?: string | null): string | null {
  const raw = String(style || '').trim()
  if (!raw.startsWith(DOUBAO_TRAINING_SESSION_STYLE_PREFIX)) return null
  const id = raw.slice(DOUBAO_TRAINING_SESSION_STYLE_PREFIX.length).trim()
  return id || null
}

export function resolveDoubaoTrainingSessionForStyle(style?: string | null) {
  const id = parseDoubaoTrainingSessionIdFromStyle(style)
  return getDoubaoTrainingSession(id || undefined)
}

export function isDoubaoTrainingVideoRequest(body: Record<string, unknown>): boolean {
  if (body.doubao_training === true || body.doubao_training === 1 || body.doubao_training === '1') return true
  if (body.training === true || body.training === 1 || body.training === '1') return true
  return isDoubaoTrainingVideoModel(String(body.model || '')) && body.provider === 'doubao_training'
}

export function assertDoubaoTrainingSessionConfigured() {
  if (!hasDoubaoTrainingSession()) {
    throw new Error('豆包培训 Session 未配置，请联系管理员在「设置 → 豆包培训 Session」中添加')
  }
}

export async function listDoubaoTrainingSessionSummaries() {
  const sessions = listDoubaoTrainingSessions()
  const activeId = getActiveDoubaoTrainingSessionId()
  const quotaMap = new Map(
    listDoubaoSessionQuotaSummaries(sessions.map(item => item.id)).map(item => [item.session_id, item]),
  )
  const items = []
  for (const session of sessions) {
    const valid = await validateDoubaoTrainingSession(session)
    items.push({
      ...toPublicDoubaoTrainingSession(session, activeId),
      valid,
      quota: quotaMap.get(session.id) || {
        session_id: session.id,
        used_today: 0,
        remaining_today: DOUBAO_TRAINING_DAILY_QUOTA,
        daily_quota: DOUBAO_TRAINING_DAILY_QUOTA,
      },
    })
  }
  return items
}

export function pickDoubaoTrainingSessionWithQuota(preferredId?: string | null) {
  const sessions = listDoubaoTrainingSessions()
  if (!sessions.length) return null

  const preferred = preferredId
    ? sessions.find(item => item.id === preferredId || item.sessionId === preferredId)
    : null
  const ordered = preferred
    ? [preferred, ...sessions.filter(item => item.id !== preferred.id)]
    : sessions

  for (const session of ordered) {
    if (getDoubaoSessionRemainingQuota(session.id) > 0) return session
  }
  return null
}

export function listDoubaoTrainingModelOptions() {
  return [{
    id: DOUBAO_TRAINING_VIDEO_MODEL,
    label: 'Seedance 2.0 Fast（培训）',
    duration_min: DOUBAO_TRAINING_DURATION_OPTIONS[0],
    duration_max: DOUBAO_TRAINING_DURATION_OPTIONS[DOUBAO_TRAINING_DURATION_OPTIONS.length - 1],
    duration_default: DOUBAO_TRAINING_DEFAULT_DURATION,
    duration_options: [...DOUBAO_TRAINING_DURATION_OPTIONS],
    credit_action: 'video.generate.doubao_training',
    credit_cost_flat: 0,
    config_id: null,
    default_option: true,
  }]
}

export function getDoubaoTrainingOptionsPayload() {
  const sessions = listDoubaoTrainingSessions()
  const hasValid = sessions.length > 0
  return {
    available: hasValid,
    session_configured: hasValid,
    doc_url: DOUBAO_TRAINING_DOC_URL,
    overlay_text: getTrainingOverlayText(),
    default_overlay_text: DOUBAO_TRAINING_OVERLAY_TEXT,
    daily_quota: DOUBAO_TRAINING_DAILY_QUOTA,
    models: listDoubaoTrainingModelOptions(),
    default_model: DOUBAO_TRAINING_VIDEO_MODEL,
    aspect_ratios: [...DOUBAO_TRAINING_ASPECT_RATIOS],
    default_aspect_ratio: DOUBAO_TRAINING_DEFAULT_ASPECT_RATIO,
    ref_limits: DOUBAO_TRAINING_REF_LIMITS,
    ref_limits_hint: `${DOUBAO_TRAINING_REF_LIMITS.images}图（可选）`,
    proxy_configured: !!(process.env.DOUBAO_TRAINING_PROXY_URL || process.env.DOUBAO2API_URL),
  }
}

export {
  isDoubaoTrainingVideoModel,
  normalizeDoubaoTrainingAspectRatio,
  normalizeDoubaoTrainingDuration,
}
