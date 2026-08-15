/** 橙盟 / 第三方 Seedance 2.0 9图过人脸（chengmeng.site/docu） */
export const CHENGMENT_DOC_URL = 'https://chengmeng.site/docu'
export const CHENGMENT_DISPLAY_NAME = '橙盟 Seedance 2.0 9图过人脸'

/** 橙盟官方 API 网关（稳定）；勿使用已下线的 cpolar 临时隧道 */
export const CHENGMENT_DEFAULT_BASE_URL = 'https://api.chengmeng.site'

/** 通道1 默认模型（首选列表第一项） */
export const CHENGMENT_DEFAULT_MODEL_ID = '91'
/** 旧版 group_id，新 API 创建任务已不再需要 */
export const CHENGMENT_DEFAULT_GROUP_ID = '18'

/** 历史线路（已不在通道1前台展示） */
export const CHENGMENG_SEEDANCE_2_0_MODEL_ID = '32'
/** @deprecated 曾用 70/77 */
export const CHENGMENG_LEGACY_MODEL_70 = '70'
export const CHENGMENG_LEGACY_MODEL_77 = '77'

/** 视频生成页模型选项 ID（写入 video_generations.model） */
export const CHENGMENG_VIDEO_MODELS = {
  /** 官转满血 · 9图线路1（当前默认） */
  LINE_91: '91',
  /** 官转 Fast */
  LINE_55: '55',
  /** 官转满血 */
  LINE_56: '56',
  /** 4图满血 */
  SEEDANCE_2_0: '32',
  /** 4图 Fast */
  SEEDANCE_2_0_FAST: '53',
  /** @deprecated 上游已下线 */
  LINE_90: '90',
  LINE_83: '83',
  LINE_71: '71',
  LINE_82: '82',
} as const

/** 通道1 前台开通线路（上游 model_id）；默认用户价 = 上游 + 2 元，固定价见 FIXED */
export const CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS = ['91', '56', '55', '53', '32'] as const

/** 指定线路固定用户积分价（按次；覆盖「上游+2元」自动价） */
export const CHENGMENG_CHANNEL1_FIXED_CREDIT_COST: Record<string, number> = {
  // 历史固定价（线路已下线，保留兼容旧任务展示）
  '90': 520,
}

export function resolveChengmengFixedCreditCost(modelId?: string | null): number | null {
  const id = String(modelId || '').trim()
  const cost = CHENGMENG_CHANNEL1_FIXED_CREDIT_COST[id]
  return cost != null && Number.isFinite(cost) && cost > 0 ? Math.floor(cost) : null
}

/** 通道1 当前线路默认分辨率（开通线路上游仅接受 720p） */
export const CHENGMENG_CHANNEL1_RESOLUTION = '720p'
/** 历史 480p 价（仅兼容旧 model 70/77） */
export const CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND = 0.32
export const CHENGMENG_CHANNEL1_720P_YUAN_PER_SECOND = 0.44

/** 按 model_id 选择发给橙盟的分辨率 */
export function resolveChengmengModelResolution(modelId?: string | null): string {
  const id = String(modelId || '').trim()
  // 旧满血低价档走 480p；当前通道1 保留线路均为 720p
  if (id === '70' || id === '77' || id === '31' || id === '49') return '480p'
  return '720p'
}

/** @deprecated 改用 CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS */
export const CHENGMENG_CHANNEL1_UI_MODEL_COUNT = CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS.length

/** 通道1 备用筛选：上游折算 15 秒成本上限（元）；首选线路不受此限制 */
export const CHENGMENG_CHANNEL1_MAX_UPSTREAM_YUAN_PER_15S = 5

/** 通道1 默认用户价（积分/条；上游价未知时回退） */
export const CHENGMENG_MODEL_70_CREDIT_COST = 750

/** 通道1 用户基准积分（上游价未知时回退） */
export const CHENGMENG_CHANNEL1_BASE_USER_CREDITS = 750

/** @deprecated 旧比例价封顶逻辑，已改为「本站 = 上游 + 2 元」 */
export const CHENGMENG_CHANNEL1_HIGH_TIER_THRESHOLD = 1000
/** @deprecated 见 HIGH_TIER_THRESHOLD */
export const CHENGMENG_CHANNEL1_HIGH_TIER_CAP = 950

const RETIRED_CHENGMENG_MODEL_IDS = new Set([
  '90', '83', '71', '82', '70', '77', '49', '31',
])

export function isChengmengChannel1PreferredModel(model?: string | null): boolean {
  const id = String(model || '').trim()
  return (CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS as readonly string[]).includes(id)
}

/** 历史/已下线 model_id → 当前通道1 可用 id */
export function remapChengmengChannel1ModelId(model?: string | null): string {
  const id = String(model || '').trim()
  if (isChengmengChannel1PreferredModel(id)) return id
  // 旧 9 图 / 特价满血 → 当前 9 图官转满血线路1
  if (id === '90' || id === '83' || id === '71' || id === '82' || id === '70' || id === '77') {
    return CHENGMENG_VIDEO_MODELS.LINE_91
  }
  if (id === '31') return CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST
  if (id === '49') return CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0
  if (/^\d+$/.test(id)) return CHENGMENT_DEFAULT_MODEL_ID
  return CHENGMENT_DEFAULT_MODEL_ID
}

export function isChengmengVideoModelId(model?: string | null): boolean {
  const normalized = String(model || '').trim()
  if (!normalized) return false
  if (isChengmengChannel1PreferredModel(normalized)) return true
  if (RETIRED_CHENGMENG_MODEL_IDS.has(normalized)) return true
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

/** 默认参考上限（上游说明未标明时，按官转/9图全能参考回退） */
export const CHENGMENG_DEFAULT_REF_LIMITS = { images: 9, videos: 3, audios: 3 } as const

/**
 * 从上游 name/description 解析参考上限。
 * 例：「支持4图3视频1音频」「720p 仅支持9图」「特价-4图-满血」
 */
export function parseChengmengRefLimits(description?: string | null, name?: string | null) {
  const text = `${description || ''} ${name || ''}`
  const img = text.match(/(\d+)\s*图/)
  const vid = text.match(/(\d+)\s*视频/)
  const aud = text.match(/(\d+)\s*音频/)
  const onlyImages = /仅支持\s*\d+\s*图/.test(text) && !vid && !aud
  return {
    maxImages: img ? Math.max(0, Number(img[1]) || 0) : CHENGMENG_DEFAULT_REF_LIMITS.images,
    maxVideos: onlyImages
      ? 0
      : (vid ? Math.max(0, Number(vid[1]) || 0) : CHENGMENG_DEFAULT_REF_LIMITS.videos),
    maxAudios: onlyImages
      ? 0
      : (aud ? Math.max(0, Number(aud[1]) || 0) : CHENGMENG_DEFAULT_REF_LIMITS.audios),
  }
}

/** 线路展示用简短参考能力文案，如「4图3视频1音频」 */
export function formatChengmengRefLimitsHint(
  limits: { maxImages: number; maxVideos: number; maxAudios: number },
): string {
  const parts = [`${limits.maxImages}图`]
  if (limits.maxVideos > 0) parts.push(`${limits.maxVideos}视频`)
  if (limits.maxAudios > 0) parts.push(`${limits.maxAudios}音频`)
  else if (limits.maxVideos <= 0) parts.push('仅图')
  return parts.join('')
}

/** 橙盟参考图：单张 ≤20MB，分辨率 720–2160px（docu） */
export const CHENGMENT_REF_IMAGE_MAX_BYTES = 18 * 1024 * 1024
export const CHENGMENT_REF_IMAGE_MAX_WIDTH = 1920
export const CHENGMENT_REF_IMAGE_MAX_HEIGHT = 1920
export const CHENGMENT_REF_IMAGE_QUALITY = 78
/** 本地原图超过此阈值时，即使已有 OSS 映射也重新压缩上传 */
export const CHENGMENT_REF_IMAGE_REUPLOAD_BYTES = 4 * 1024 * 1024

/** 仅作 UI「建议」参考；橙盟文档未规定 prompt 字数上限，本站不再硬拦 */
export const CHENGMENT_PROMPT_MAX_LENGTH = 2000
/** @deprecated 同 CHENGMENT_PROMPT_MAX_LENGTH，仅建议值 */
export const CHENGMENT_PROMPT_RECOMMENDED_LENGTH = CHENGMENT_PROMPT_MAX_LENGTH

export function isChengmengProvider(provider?: string | null): boolean {
  return String(provider || '').toLowerCase() === 'chengmeng'
}

/** 每个橙盟 model_id 对应一条积分定价项（53/32 沿用历史 action；71 为动态键） */
export function chengmengModelCreditAction(modelId?: string | null): string {
  const id = String(modelId || CHENGMENT_DEFAULT_MODEL_ID).trim()
  // 历史别名：32 / 49 → 满血按次；53 → Fast 按次（兼容旧定价 action）
  if (id === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0 || id === '49') {
    return 'video.generate.chengmeng_seedance2'
  }
  if (id === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST) {
    return 'video.generate.chengmeng'
  }
  // 其余一律独立 action，避免 70 等按秒线路覆盖 53 的按次定价
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
