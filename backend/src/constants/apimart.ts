import type { AIConfig } from '../services/adapters/types.js'

/**
 * 解说漫实体抽取 / 画面 Prompt 推理默认模型。
 * gpt-5.6-terra：5.6 中档，约 gpt-5.5 一半单价，适合长剧本 JSON 推理。
 */
export const APIMART_NARRATION_TEXT_MODEL = 'gpt-5.6-terra'

/** 生产环境默认可达入口（api.apimart.ai 在部分机房超时） */
export const APIMART_DEFAULT_BASE_URL = 'https://api.apib.ai'

/** 官方主站，保留为最后备用 */
export const APIMART_LEGACY_BASE_URL = 'https://api.apimart.ai'

/** @deprecated 使用 APIMART_DEFAULT_BASE_URL */
export const APIMART_PRIMARY_BASE_URL = APIMART_DEFAULT_BASE_URL

/** APIMart 官方备用 API 域名（与主站 api.apimart.ai 等价） */
export const APIMART_MIRROR_HOSTS = ['apib.ai', 'aiuxu.com', 'aishuch.com'] as const

export function apimartBaseUrlFromHost(host: string): string {
  const h = String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  if (!h) return APIMART_DEFAULT_BASE_URL
  if (h.startsWith('api.')) return `https://${h}`
  return `https://api.${h}`
}

/** 除默认入口外的备用 API 地址 */
export const APIMART_DEFAULT_MIRROR_BASE_URLS = [
  'https://api.aiuxu.com',
  'https://api.aishuch.com',
  APIMART_LEGACY_BASE_URL,
]

export function isApimartProvider(provider?: string | null): boolean {
  return String(provider || '').toLowerCase() === 'apimart'
}

/** APIMart 默认输出档位（1k 成本更低；可在 ai_service_configs.settings 覆盖） */
export const APIMART_DEFAULT_IMAGE_RESOLUTION = '1k' as const

export type ApimartImageResolution = '1k' | '2k' | '4k'

/** 工作台/剧集预设像素 → APIMart 比例（勿按边长推断 2k） */
export const APIMART_PRESET_PIXEL_TO_RATIO: Record<string, string> = {
  '1080x1920': '9:16',
  '1920x1080': '16:9',
  '1080x1440': '3:4',
  '1440x1080': '4:3',
}

export function parseApimartResolution(raw?: string | null): ApimartImageResolution | null {
  const value = String(raw || '').trim().toLowerCase()
  if (value === '1k' || value === '2k' || value === '4k') return value
  return null
}

/** 工作台可选分辨率（不含 4k） */
export const STUDIO_IMAGE_RESOLUTIONS = ['1k', '2k'] as const
export type StudioImageResolution = typeof STUDIO_IMAGE_RESOLUTIONS[number]

export function parseStudioImageResolution(raw?: string | null): StudioImageResolution | null {
  const value = String(raw || '').trim().toLowerCase()
  if (value === '1k' || value === '2k') return value
  return null
}

export function parseApimartResolutionFromSettings(settings?: Record<string, unknown> | null): ApimartImageResolution {
  const raw = settings?.default_resolution ?? settings?.defaultResolution ?? settings?.resolution
  return parseApimartResolution(String(raw || '')) || APIMART_DEFAULT_IMAGE_RESOLUTION
}

function pushUniqueBase(ordered: string[], url?: string | null) {
  const normalized = String(url || '').trim().replace(/\/+$/, '')
  if (!normalized) return
  const withScheme = /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`
  if (!ordered.includes(withScheme)) ordered.push(withScheme)
}

/** 主域名优先，其次配置中的镜像，最后内置备用域名 */
export function listApimartApiBases(config: Pick<AIConfig, 'baseUrl' | 'settings'>): string[] {
  const ordered: string[] = []
  pushUniqueBase(ordered, config.baseUrl || APIMART_DEFAULT_BASE_URL)

  const settings = config.settings || {}
  const mirrorUrls = settings.mirror_base_urls ?? settings.mirrorBaseUrls
  if (Array.isArray(mirrorUrls)) {
    for (const item of mirrorUrls) pushUniqueBase(ordered, String(item))
  }

  const mirrorHosts = settings.mirror_hosts ?? settings.mirrorHosts
  if (Array.isArray(mirrorHosts)) {
    for (const host of mirrorHosts) pushUniqueBase(ordered, apimartBaseUrlFromHost(String(host)))
  }

  for (const mirror of APIMART_DEFAULT_MIRROR_BASE_URLS) pushUniqueBase(ordered, mirror)
  return ordered
}

export function isRetryableApimartFetchError(error: unknown): boolean {
  const err = error as { message?: string; code?: string; cause?: { code?: string } }
  const code = String(err?.cause?.code || err?.code || '').toUpperCase()
  if ([
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
  ].includes(code)) {
    return true
  }
  const message = String(err?.message || error || '').toLowerCase()
  return /fetch failed|timeout|timed out|network|connect|unreachable|econn/i.test(message)
}

export function isRetryableApimartHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export function apimartSettingsWithDefaultMirrors(): Record<string, unknown> {
  return {
    mirror_hosts: [...APIMART_MIRROR_HOSTS],
    mirror_base_urls: [APIMART_DEFAULT_BASE_URL, ...APIMART_DEFAULT_MIRROR_BASE_URLS],
  }
}
