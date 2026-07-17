/** 豆包培训通道：免费练手 · 对齐官网 create-video 的 Seedance 2.0 Fast / Mini */

export const DOUBAO_TRAINING_BASE_URL = 'https://www.doubao.com'
export const DOUBAO_TRAINING_DOC_URL = 'https://www.doubao.com/chat/create-video'
export const DOUBAO_TRAINING_CREATE_VIDEO_URL = `${DOUBAO_TRAINING_BASE_URL}/chat/create-video`

/** 内部模型 ID（provider=doubao_training） */
export const DOUBAO_TRAINING_MODELS = {
  /** 官网「Seedance 2.0 Mini」· 日常生成 / 免费额度 */
  MINI: 'doubao-seedance-2.0-mini-training',
  /** 官网「Seedance 2.0 Fast」· 快速出片 */
  FAST: 'doubao-seedance-2.0-fast-training',
} as const

export type DoubaoTrainingModelId =
  typeof DOUBAO_TRAINING_MODELS[keyof typeof DOUBAO_TRAINING_MODELS]

/** 默认 Mini（与官网免费额度默认一致） */
export const DOUBAO_TRAINING_DEFAULT_MODEL = DOUBAO_TRAINING_MODELS.MINI
/** @deprecated 用 DOUBAO_TRAINING_DEFAULT_MODEL / DOUBAO_TRAINING_MODELS */
export const DOUBAO_TRAINING_VIDEO_MODEL = DOUBAO_TRAINING_DEFAULT_MODEL
/** @deprecated */
export const DOUBAO_TRAINING_VIDEO_MODEL_LEGACY_FAST = DOUBAO_TRAINING_MODELS.FAST

/** 写入豆包网页协议的官网展示名 */
export const DOUBAO_TRAINING_UPSTREAM_LABELS: Record<DoubaoTrainingModelId, string> = {
  [DOUBAO_TRAINING_MODELS.MINI]: 'Seedance 2.0 Mini',
  [DOUBAO_TRAINING_MODELS.FAST]: 'Seedance 2.0 Fast',
}

export const DOUBAO_TRAINING_ENABLED_MODELS: readonly DoubaoTrainingModelId[] = [
  DOUBAO_TRAINING_MODELS.FAST,
  DOUBAO_TRAINING_MODELS.MINI,
]

export const DOUBAO_TRAINING_DAILY_QUOTA = 5
export const DOUBAO_TRAINING_OVERLAY_TEXT = '内部培训专用'

export const DOUBAO_TRAINING_ASPECT_RATIOS = ['9:16', '16:9'] as const
export const DOUBAO_TRAINING_DEFAULT_ASPECT_RATIO = '16:9'
export const DOUBAO_TRAINING_DURATION_OPTIONS = [5, 10] as const
export const DOUBAO_TRAINING_DEFAULT_DURATION = 5

export const DOUBAO_TRAINING_REF_LIMITS = {
  images: 1,
  audios: 0,
  videos: 0,
} as const

export function isDoubaoTrainingVideoModel(model?: string | null): boolean {
  const id = String(model || '').trim()
  return (DOUBAO_TRAINING_ENABLED_MODELS as readonly string[]).includes(id)
}

export function normalizeDoubaoTrainingModel(model?: string | null): DoubaoTrainingModelId {
  const id = String(model || '').trim()
  if ((DOUBAO_TRAINING_ENABLED_MODELS as readonly string[]).includes(id)) {
    return id as DoubaoTrainingModelId
  }
  return DOUBAO_TRAINING_DEFAULT_MODEL
}

export function resolveDoubaoTrainingUpstreamLabel(model?: string | null): string {
  const id = normalizeDoubaoTrainingModel(model)
  return DOUBAO_TRAINING_UPSTREAM_LABELS[id]
}

export function doubaoTrainingModelLabel(model?: string | null): string {
  const id = normalizeDoubaoTrainingModel(model)
  if (id === DOUBAO_TRAINING_MODELS.FAST) return 'Seedance 2.0 Fast'
  return 'Seedance 2.0 Mini'
}

export function normalizeDoubaoTrainingAspectRatio(value?: string | null): string {
  const raw = String(value || '').trim()
  if ((DOUBAO_TRAINING_ASPECT_RATIOS as readonly string[]).includes(raw)) return raw
  return DOUBAO_TRAINING_DEFAULT_ASPECT_RATIO
}

export function normalizeDoubaoTrainingDuration(value?: number | null): number {
  const n = Number(value)
  if (DOUBAO_TRAINING_DURATION_OPTIONS.includes(n as 5 | 10)) return n
  return DOUBAO_TRAINING_DEFAULT_DURATION
}
