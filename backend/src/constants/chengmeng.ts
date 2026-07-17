/** 橙盟 / 第三方 Seedance 2.0 9图过人脸（chengmeng.site/docu） */
export const CHENGMENT_DOC_URL = 'https://chengmeng.site/docu'
export const CHENGMENT_DISPLAY_NAME = '橙盟 Seedance 2.0 9图过人脸'

/** 橙盟官方 API 网关（稳定）；勿使用已下线的 cpolar 临时隧道 */
export const CHENGMENT_DEFAULT_BASE_URL = 'https://api.chengmeng.site'

/** 上游默认且唯一接通：9 图满血线路1 · 480p（model_id=70，实价 0.32 元/秒） */
export const CHENGMENT_DEFAULT_MODEL_ID = '70'
/** 旧版 group_id，新 API 创建任务已不再需要 */
export const CHENGMENT_DEFAULT_GROUP_ID = '18'

/** @deprecated 线路2（77，480p 同价）已停用，通道1只保留 70 */
export const CHENGMENG_SEEDANCE_2_0_MODEL_ID = '77'

/** 视频生成页模型选项 ID（写入 video_generations.model） */
export const CHENGMENG_VIDEO_MODELS = {
  SEEDANCE_2_0_FAST: CHENGMENT_DEFAULT_MODEL_ID,
  SEEDANCE_2_0: CHENGMENG_SEEDANCE_2_0_MODEL_ID,
} as const

/** 通道1 前台只接通 480p 低价档（model 70）；不再暴露 77 / 720p·1080p */
export const CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS = [
  CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST,
] as const

/** 通道1 一律走 480p（实测 0.32 元/秒；720p=0.44、1080p≈0.78） */
export const CHENGMENG_CHANNEL1_RESOLUTION = '480p'
export const CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND = 0.32

/** @deprecated 改用 CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS */
export const CHENGMENG_CHANNEL1_UI_MODEL_COUNT = CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS.length

/** 通道1 备用筛选：上游折算 15 秒成本上限（元）；首选线路不受此限制 */
export const CHENGMENG_CHANNEL1_MAX_UPSTREAM_YUAN_PER_15S = 5

/** 通道1 模型 70（480p）：用户价（积分/条；受全局视频保底 750 约束） */
export const CHENGMENG_MODEL_70_CREDIT_COST = 750

/** 通道1 其他线路比例价基准（已不再展示，保留兼容） */
export const CHENGMENG_CHANNEL1_BASE_USER_CREDITS = 750

/** 通道1 比例价超过此值时，统一按 HIGH_TIER_CAP 计费 */
export const CHENGMENG_CHANNEL1_HIGH_TIER_THRESHOLD = 1000
export const CHENGMENG_CHANNEL1_HIGH_TIER_CAP = 950

const LEGACY_CHENGMENG_MODEL_IDS = new Set(['53', '32', '31', '49'])

export function isChengmengVideoModelId(model?: string | null): boolean {
  const normalized = String(model || '').trim()
  if (!normalized) return false
  if (normalized === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST
    || normalized === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0) return true
  if (LEGACY_CHENGMENG_MODEL_IDS.has(normalized)) return true
  return /^\d+$/.test(normalized)
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

/** 每个橙盟 model_id 对应一条积分定价项（70/77 沿用历史 action；49/53/32 为别名） */
export function chengmengModelCreditAction(modelId?: string | null): string {
  const id = String(modelId || CHENGMENT_DEFAULT_MODEL_ID).trim()
  if (id === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0 || id === '49' || id === '32') {
    return 'video.generate.chengmeng_seedance2'
  }
  if (id === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST || id === '53' || id === '31') {
    return 'video.generate.chengmeng'
  }
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
