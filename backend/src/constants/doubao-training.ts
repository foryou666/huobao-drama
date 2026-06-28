/** 豆包培训通道（通道5）：免费练手 · Seedance 2.0 Fast */
export const DOUBAO_TRAINING_BASE_URL = 'https://www.doubao.com'
export const DOUBAO_TRAINING_DOC_URL = 'https://www.doubao.com/chat/create-video'

export const DOUBAO_TRAINING_VIDEO_MODEL = 'doubao-seedance-2.0-fast-training'

export const DOUBAO_TRAINING_DAILY_QUOTA = 5
export const DOUBAO_TRAINING_OVERLAY_TEXT = '内部培训专用'

export const DOUBAO_TRAINING_ASPECT_RATIOS = ['9:16', '16:9'] as const
export const DOUBAO_TRAINING_DEFAULT_ASPECT_RATIO = '9:16'
export const DOUBAO_TRAINING_DURATION_OPTIONS = [5, 10] as const
export const DOUBAO_TRAINING_DEFAULT_DURATION = 5

export const DOUBAO_TRAINING_REF_LIMITS = {
  images: 1,
  audios: 0,
  videos: 0,
} as const

export function isDoubaoTrainingVideoModel(model?: string | null): boolean {
  return String(model || '').trim() === DOUBAO_TRAINING_VIDEO_MODEL
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
