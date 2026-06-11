/** 橙盟 / 第三方 Seedance 2.0 9图过人脸（chengmeng.site/docu） */
export const CHENGMENT_DOC_URL = 'https://chengmeng.site/docu'
export const CHENGMENT_DISPLAY_NAME = '橙盟 Seedance 2.0 9图过人脸'

/** 橙盟官方 API 网关（稳定）；勿使用已下线的 cpolar 临时隧道 */
export const CHENGMENT_DEFAULT_BASE_URL = 'https://api.chengmeng.site'

export const CHENGMENT_DEFAULT_MODEL_ID = '31'
export const CHENGMENT_DEFAULT_GROUP_ID = '15'

export const CHENGMENT_DURATION_BOUNDS = { min: 5, max: 15, defaultSec: 15 }

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

/** 橙盟 API 返回余额/额度不足时，用于自动切换备用 Key */
export function isChengmengBalanceError(message?: string | null): boolean {
  const text = String(message || '').toLowerCase()
  if (!text) return false
  return /余额|额度|次数|用完|不足|充值|insufficient|quota|balance|exceed|limit|depleted|no\s*credit/.test(text)
}
