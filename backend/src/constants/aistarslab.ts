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
/** OpenAPI 账户积分余额 GET /openapi/account/credits */
export const AISTARSLAB_OPENAPI_ACCOUNT_CREDITS_PATH = '/openapi/account/credits'
/** OpenAPI 单任务详情（含 costCredits）GET /openapi/video/task?taskId= */
export const AISTARSLAB_OPENAPI_TASK_DETAIL_PATH = '/openapi/video/task'

/** 通道3 前台开通线路（优先展示；上游有则只上这些） */
export const AISTARSLAB_CHANNEL3_PREFERRED_CHANNEL_IDS = ['50', '53', '48'] as const

export const AISTARSLAB_DEFAULT_CHANNEL = '50'
export const AISTARSLAB_DEFAULT_MODEL = 'seedance-2.0-fast'

export function isAistarslabChannel3Preferred(channel?: string | null): boolean {
  const id = String(channel || '').trim()
  return (AISTARSLAB_CHANNEL3_PREFERRED_CHANNEL_IDS as readonly string[]).includes(id)
}

export const AISTARSLAB_DURATION_BOUNDS = { min: 4, max: 15, defaultSec: 15 }

/** 历史参考：部分线路 OpenAPI 曾校验 at most 1500；本站不再截断/拦截，交由上游校验 */
export const AISTARSLAB_PROMPT_MAX_LENGTH = 1500

/** 默认参考素材上限（线路描述未标明时回退） */
export const AISTARSLAB_DEFAULT_REF_LIMITS = { images: 9, videos: 3, audios: 3 } as const

export const AISTARSLAB_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const

/** 无 config 接口时的默认扣费（720P 推荐 Fast · 15 秒） */
export const AISTARSLAB_DEFAULT_CREDIT_COST = 750

export const AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER = 1.5

/**
 * @deprecated 已改为：本站 = 上游 + 2 元
 * 保留常量以免旧脚本引用报错
 */
export const AISTARSLAB_USER_PRICE_MULTIPLIER = 1.5

/**
 * 通道3 同步/展示规则：线路最长时长下上游参考价超过此值的不同步、不展示（积分）
 * 见 filterAistarslabConfigForSync、syncAistarslabChannelsFromProvider
 */
export const AISTARSLAB_SYNC_MAX_UPSTREAM_CREDITS = 2000
/** @deprecated 与 AISTARSLAB_SYNC_MAX_UPSTREAM_CREDITS 相同 */
export const AISTARSLAB_MAX_UPSTREAM_DISPLAY_CREDITS = AISTARSLAB_SYNC_MAX_UPSTREAM_CREDITS

/** 通道3 上游线路同步规则（sync 脚本与 API 拉取时自动应用） */
export const AISTARSLAB_SYNC_RULES = [
  `优先同步开通线路 ${AISTARSLAB_CHANNEL3_PREFERRED_CHANNEL_IDS.join(' / ')}（50 限时特价、53 极速优选、48 专线）`,
  '无开通线路时回退：仅「（新）」Seedance 2.0（不同步旧线路 / Grok / Gemini / 非首选限时特价）',
  `上游参考价（线路最长时长）≤ ${AISTARSLAB_SYNC_MAX_UPSTREAM_CREDITS} 积分`,
  '用户价：本站 = 上游 + 2 元；按秒线路按秒扣费',
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

/** 线路标题/描述含 Grok、Gemini 时整线不同步；非首选的「限时特价」仍排除 */
export function isAistarslabExcludedSyncChannel(
  title?: string | null,
  description?: string | null,
  channel?: string | null,
): boolean {
  const text = `${title || ''} ${description || ''}`
  const lower = text.toLowerCase()
  if (/\bgrok\b/.test(lower) || /\bgemini\b/.test(lower)) return true
  // 开通线路（如 50）允许上架；其它「限时特价」仍排除（曾有横屏出竖屏问题）
  if (/限时特价/.test(text) && !isAistarslabChannel3Preferred(channel)) return true
  return false
}

/** 当前代线路：标题含「（新）」；旧 480P/720P 推荐线不同步到前台 */
export function isAistarslabCurrentGenerationChannel(title?: string | null): boolean {
  return /（新）/.test(String(title || ''))
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

/** 从线路描述解析参考上限，如「最多9图/0视频/0音频」「最多4图」 */
export function parseAistarslabRefLimits(description?: string | null, title?: string | null) {
  const text = `${description || ''} ${title || ''}`
  const img = text.match(/最多\s*(\d+)\s*图/)
  const vid = text.match(/(\d+)\s*视频/)
  const aud = text.match(/(\d+)\s*音频/)
  return {
    maxImages: img ? Math.max(0, Number(img[1]) || 0) : AISTARSLAB_DEFAULT_REF_LIMITS.images,
    maxVideos: vid ? Math.max(0, Number(vid[1]) || 0) : AISTARSLAB_DEFAULT_REF_LIMITS.videos,
    maxAudios: aud ? Math.max(0, Number(aud[1]) || 0) : AISTARSLAB_DEFAULT_REF_LIMITS.audios,
  }
}

/** 本站固定按 720p 提交；OpenAPI 有时只给 480p 单价，这里用官网 720p 价覆盖计费 */
export const AISTARSLAB_FORCE_RESOLUTION = '720p'

/**
 * 官网 720p 上游积分/秒（OpenAPI creditsPerSecond 对部分线路是 480p 价）
 * 53 极速优选、48 专线 —— 与上游站点分档一致
 */
export const AISTARSLAB_720P_CREDITS_PER_SECOND: Record<string, Record<string, number>> = {
  '53': {
    'seedance-2.0-fast': 38,
    'seedance-2.0': 46,
  },
  '48': {
    'seedance-2.0-fast': 50,
    'seedance-2.0': 58,
  },
}

export function resolveAistarslab720pCreditsPerSecond(
  channel?: string | null,
  model?: string | null,
  fallback?: number | null,
): number | null {
  const ch = String(channel || '').trim()
  const slug = normalizeAistarslabModelSlug(model).toLowerCase()
  const mapped = AISTARSLAB_720P_CREDITS_PER_SECOND[ch]?.[slug]
  if (mapped != null && mapped > 0) return mapped
  const n = Number(fallback)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 在上游允许的 resolutions 中选一个；本站固定优先 720p */
export function pickAistarslabResolution(
  model?: string | null,
  allowedResolutions?: string[] | null,
): string {
  const allowed = (allowedResolutions || [])
    .map(item => String(item || '').trim().toLowerCase())
    .filter(Boolean)
  if (allowed.includes(AISTARSLAB_FORCE_RESOLUTION)) return AISTARSLAB_FORCE_RESOLUTION
  if (allowed.length === 1) return allowed[0]!
  if (allowed.includes('480p')) return '480p'
  if (allowed.length) return allowed[0]!
  const id = String(model || '').trim().toLowerCase()
  if (id.includes('480')) return '480p'
  return AISTARSLAB_FORCE_RESOLUTION
}

/** @deprecated 本站不再截断通道三 prompt；保留函数以免旧调用报错 */
export function clampAistarslabPrompt(prompt: string, _maxLength = AISTARSLAB_PROMPT_MAX_LENGTH): string {
  return String(prompt || '')
}
