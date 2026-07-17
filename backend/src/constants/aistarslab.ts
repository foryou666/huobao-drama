/** AIStartLab Seedance 2.0 — 官方 OpenAPI 协议（见平台 OpenAPI 视频生成接口文档） */
export const AISTARSLAB_DEFAULT_BASE_URL = 'https://api.video.aistarslab.com'
export const AISTARSLAB_DOC_URL = 'https://my.feishu.cn/wiki/JP5HwMT3Vi67HDkpxgbcgQWVnYd'
export const AISTARSLAB_SITE_URL = 'https://video.aistarslab.com'

/** OpenAPI 查询线路/模型配置 GET /openapi/video/task/config */
export const AISTARSLAB_OPENAPI_CONFIG_PATH = '/openapi/video/task/config'
/** OpenAPI 创建任务 POST /openapi/video/task/v2 */
export const AISTARSLAB_OPENAPI_CREATE_PATH = '/openapi/video/task/v2'
/** OpenAPI 单条查询 GET /openapi/video/task/status?taskId= */
export const AISTARSLAB_OPENAPI_STATUS_PATH = '/openapi/video/task/status'
/** OpenAPI 批量查询 POST /openapi/video/task/status/batch */
export const AISTARSLAB_OPENAPI_STATUS_BATCH_PATH = '/openapi/video/task/status/batch'

export const AISTARSLAB_DEFAULT_CHANNEL = '12'
export const AISTARSLAB_DEFAULT_MODEL = 'seedance-2.0-720p-fast'

export const AISTARSLAB_DURATION_BOUNDS = { min: 4, max: 15, defaultSec: 15 }

export const AISTARSLAB_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const

/** 无 config 接口时的默认扣费（720P 推荐 Fast · 15 秒） */
export const AISTARSLAB_DEFAULT_CREDIT_COST = 750

export const AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER = 1.5

/** 用户售价相对上游参考价的默认倍率 */
export const AISTARSLAB_USER_PRICE_MULTIPLIER = 1.5

/**
 * 通道3 同步/展示规则：线路最长时长下上游参考价超过此值的不同步、不展示（积分）
 * 见 filterAistarslabConfigForSync、syncAistarslabChannelsFromProvider
 */
export const AISTARSLAB_SYNC_MAX_UPSTREAM_CREDITS = 500
/** @deprecated 与 AISTARSLAB_SYNC_MAX_UPSTREAM_CREDITS 相同 */
export const AISTARSLAB_MAX_UPSTREAM_DISPLAY_CREDITS = AISTARSLAB_SYNC_MAX_UPSTREAM_CREDITS

/** 通道3 上游线路同步规则（sync 脚本与 API 拉取时自动应用） */
export const AISTARSLAB_SYNC_RULES = [
  '仅同步 Seedance 2.0 模型（不同步 Grok / Gemini）',
  `上游参考价（线路最长时长）≤ ${AISTARSLAB_SYNC_MAX_UPSTREAM_CREDITS} 积分`,
] as const

export function aistarslabModelCreditAction(channel?: string | null, model?: string | null): string {
  const ch = String(channel || AISTARSLAB_DEFAULT_CHANNEL).trim()
  const slug = String(model || AISTARSLAB_DEFAULT_MODEL).trim().replace(/\./g, '-')
  return `video.generate.aistarslab.${ch}.${slug}`
}

export function isAistarslabPerModelCreditAction(action?: string | null): boolean {
  return /^video\.generate\.aistarslab\.\d+\.[a-z0-9-]+$/i.test(String(action || '').trim())
}

export function isAistarslabProvider(provider?: string | null): boolean {
  return String(provider || '').trim().toLowerCase() === 'aistarslab'
}

export function isAistarslabVideoModel(model?: string | null): boolean {
  const normalized = String(model || '').trim().toLowerCase()
  if (!normalized) return false
  const slug = normalized.includes(':') ? normalized.split(':').pop()! : normalized
  return slug.startsWith('seedance-2.0-') || slug.startsWith('seedance-2.0')
}

/** Grok / Gemini 等非 Seedance 模型，不参与通道3 同步 */
export function isAistarslabExcludedSyncModel(model?: string | null): boolean {
  const id = normalizeAistarslabModelSlug(model).toLowerCase()
  return id.includes('grok') || id.includes('gemini')
}

/** 是否满足通道3 上游同步条件（Seedance 且非 Grok/Gemini） */
export function isAistarslabSyncEligibleModel(model?: string | null): boolean {
  return isAistarslabVideoModel(model) && !isAistarslabExcludedSyncModel(model)
}

/** 线路标题/描述含 Grok、Gemini 时整线不同步 */
export function isAistarslabExcludedSyncChannel(title?: string | null, description?: string | null): boolean {
  const text = `${title || ''} ${description || ''}`.toLowerCase()
  return /\bgrok\b/.test(text) || /\bgemini\b/.test(text)
}

export function normalizeAistarslabDuration(duration?: number | null): number {
  const { min, max, defaultSec } = AISTARSLAB_DURATION_BOUNDS
  const parsed = Math.round(Number(duration ?? defaultSec))
  if (!Number.isFinite(parsed)) return defaultSec
  return Math.min(max, Math.max(min, parsed))
}

export function normalizeAistarslabAspectRatio(aspectRatio?: string | null, fallback = '9:16'): string {
  const ratio = String(aspectRatio || '').trim().replace(/\s+/g, '')
  if ((AISTARSLAB_ASPECT_RATIOS as readonly string[]).includes(ratio)) return ratio
  if (ratio === 'portrait' || ratio === '2:3' || ratio === '9:16') return '9:16'
  if (ratio === 'landscape' || ratio === '3:2' || ratio === '16:9') return '16:9'
  if (ratio === 'adaptive') return fallback === '9:16' ? '9:16' : '16:9'
  // OpenAPI 兼容历史 WxH 尺寸：720x1280 → 9:16
  const wxh = ratio.match(/^(\d+)\s*[xX*×]\s*(\d+)$/)
  if (wxh) {
    const w = Number(wxh[1])
    const h = Number(wxh[2])
    if (w > 0 && h > 0) {
      if (h > w) return '9:16'
      if (w > h) return '16:9'
      return '1:1'
    }
  }
  return fallback
}

/** 配置接口 model 编码（不含 channel 前缀） */
export function normalizeAistarslabModelSlug(model?: string | null): string {
  const raw = String(model || '').trim()
  if (!raw) return AISTARSLAB_DEFAULT_MODEL
  if (raw.includes(':')) return raw.split(':').pop()?.trim() || AISTARSLAB_DEFAULT_MODEL
  return raw
}

export function aistarslabModelLabel(modelId?: string | null): string {
  const id = normalizeAistarslabModelSlug(modelId).toLowerCase()
  if (id.includes('fast')) return 'Seedance 2.0 Fast VIP'
  if (id.includes('seedance-2.0')) return 'Seedance 2.0 VIP'
  return modelId || 'Seedance 2.0'
}

/** 用户可见文案：去除上游标题/描述中的人民币价格提示（如「3元/4元」） */
export function sanitizeAistarslabUserFacingText(text?: string | null): string {
  let value = String(text ?? '').trim()
  if (!value) return value
  // （3元/4元）、（约 5 元）、(10元/条) 等
  value = value.replace(/[（(][^）)]*?\d+(?:\.\d+)?\s*元[^）)]*?[）)]/gu, '')
  // 独立的 3元/4元、10元 等
  value = value.replace(/\d+(?:\.\d+)?\s*元(?:\s*[\/／]\s*\d+(?:\.\d+)?\s*元)?/gu, '')
  value = value.replace(/[-—·]+\s*$/u, '').replace(/\s{2,}/gu, ' ').trim()
  return value || String(text ?? '').trim()
}

/** 用户可见线路名：去掉上游标题中的 480P（如「480P-推荐1」→「推荐1」） */
export function sanitizeAistarslabChannelTitle(title?: string | null): string {
  const original = String(title ?? '').trim()
  let value = sanitizeAistarslabUserFacingText(original)
  if (!value) return original
  // 勿向用户展示 480P / 480p 分辨率字样
  value = value.replace(/480\s*[Pp]/g, '')
  value = value.replace(/[-—_·]{2,}/g, '-')
  value = value.replace(/^[-—_·\s]+|[-—_·\s]+$/g, '')
  value = value.replace(/\s{2,}/g, ' ').trim()
  return value || original
}
