/** 橙盟 / 第三方 Seedance 2.0 9图过人脸（chengmeng.site/docu） */
export const CHENGMENT_DOC_URL = 'https://chengmeng.site/docu'
export const CHENGMENT_DISPLAY_NAME = '橙盟 Seedance 2.0 9图过人脸'

/** 橙盟官方 API 网关（稳定）；勿使用已下线的 cpolar 临时隧道 */
export const CHENGMENT_DEFAULT_BASE_URL = 'https://api.chengmeng.site'

export const CHENGMENT_DEFAULT_MODEL_ID = '53'
export const CHENGMENT_DEFAULT_GROUP_ID = '15'

/** 橙盟 Seedance 2.0 标准版（视频生成页可选） */
export const CHENGMENG_SEEDANCE_2_0_MODEL_ID = '32'

/** 视频生成页模型选项 ID（写入 video_generations.model） */
export const CHENGMENG_VIDEO_MODELS = {
  SEEDANCE_2_0_FAST: CHENGMENT_DEFAULT_MODEL_ID,
  SEEDANCE_2_0: CHENGMENG_SEEDANCE_2_0_MODEL_ID,
} as const

export function isChengmengVideoModelId(model?: string | null): boolean {
  const normalized = String(model || '').trim()
  return normalized === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST
    || normalized === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0
}

export function isChengmengSeedance2StandardModel(model?: string | null): boolean {
  return String(model || '').trim() === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0
}

export const CHENGMENT_DURATION_BOUNDS = { min: 4, max: 15, defaultSec: 15 }

/** 橙盟参考音频：最多 3 条，总时长 ≤15 秒（Seedance 2.0 / 9图） */
export const CHENGMENT_AUDIO_MAX_TOTAL_SECONDS = 15
/** 发给 API 前每条参考音频自动裁剪到此秒数（取开头片段） */
export const CHENGMENT_AUDIO_MAX_CLIP_SECONDS = 3

/** 橙盟参考图：单张 ≤20MB，分辨率 720–2160px（docu） */
export const CHENGMENT_REF_IMAGE_MAX_BYTES = 18 * 1024 * 1024
export const CHENGMENT_REF_IMAGE_MAX_WIDTH = 1920
export const CHENGMENT_REF_IMAGE_MAX_HEIGHT = 1920
export const CHENGMENT_REF_IMAGE_QUALITY = 78
/** 本地原图超过此阈值时，即使已有 OSS 映射也重新压缩上传 */
export const CHENGMENT_REF_IMAGE_REUPLOAD_BYTES = 4 * 1024 * 1024

/** 视频生成发送上限：2000 字符（含 @图片N 前缀；与 JS 字符串 length 一致） */
export const CHENGMENT_PROMPT_MAX_LENGTH = 2000

export function isChengmengProvider(provider?: string | null): boolean {
  return String(provider || '').toLowerCase() === 'chengmeng'
}

/** 每个橙盟 model_id 对应一条积分定价项（53/32 沿用历史 action 键） */
export function chengmengModelCreditAction(modelId?: string | null): string {
  const id = String(modelId || CHENGMENT_DEFAULT_MODEL_ID).trim()
  if (id === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0) return 'video.generate.chengmeng_seedance2'
  if (id === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST) return 'video.generate.chengmeng'
  return `video.generate.chengmeng.${id}`
}

export function isChengmengDynamicCreditAction(action: string): boolean {
  return /^video\.generate\.chengmeng\.\d+$/.test(String(action || '').trim())
}

/** 橙盟 API 返回余额/额度不足时，用于自动切换备用 Key */
export function isChengmengBalanceError(message?: string | null): boolean {
  const text = String(message || '').toLowerCase()
  if (!text) return false
  return /余额|额度|次数|用完|不足|充值|insufficient|quota|balance|exceed|limit|depleted|no\s*credit/.test(text)
}
