/** 火山方舟 Seedance 视频模型 ID（与官方文档一致） */
export const SEEDANCE_MODELS = {
  V1_5_PRO: 'doubao-seedance-1-5-pro-251215',
  V2_0: 'doubao-seedance-2-0-260128',
  V2_0_FAST: 'doubao-seedance-2-0-fast-260128',
} as const

export const SEEDANCE_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com'

/** 红果推荐一键配置使用的 ChatFire 火山统一网关（与文本/图片/音频一致） */
export const SEEDANCE_CHATFIRE_BASE_URL = 'https://api.chatfire.site/volcengine'

export const SEEDANCE_DOC_URL = 'https://www.volcengine.com/docs/82379/1520757?lang=zh'

export function isSeedance2Model(model?: string | null): boolean {
  const m = (model || '').toLowerCase()
  return m.includes('seedance-2-0') || m.includes('seedance-2.0')
}

/** 按模型返回 API 允许的时长范围（秒） */
export function seedanceDurationBounds(model?: string | null): { min: number; max: number; defaultSec: number } {
  if (isSeedance2Model(model)) {
    return { min: 4, max: 15, defaultSec: 15 }
  }
  return { min: 4, max: 12, defaultSec: 5 }
}
