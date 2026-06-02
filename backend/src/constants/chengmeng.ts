/** 橙盟 / 第三方 Seedance 2.0 9图过人脸（chengmeng.site/docu） */
export const CHENGMENT_DOC_URL = 'https://chengmeng.site/docu'
export const CHENGMENT_DISPLAY_NAME = '橙盟 Seedance 2.0 9图过人脸'

/** 橙盟官方 API 网关（稳定）；勿使用已下线的 cpolar 临时隧道 */
export const CHENGMENT_DEFAULT_BASE_URL = 'https://api.chengmeng.site'

export const CHENGMENT_DEFAULT_MODEL_ID = '31'
export const CHENGMENT_DEFAULT_GROUP_ID = '15'

export const CHENGMENT_DURATION_BOUNDS = { min: 5, max: 15, defaultSec: 15 }

export function isChengmengProvider(provider?: string | null): boolean {
  return String(provider || '').toLowerCase() === 'chengmeng'
}
