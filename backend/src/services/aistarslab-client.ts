import type { AIConfig } from './adapters/types.js'
import { joinProviderUrl } from './adapters/url.js'
import { AISTARSLAB_DEFAULT_BASE_URL, AISTARSLAB_OPENAPI_CONFIG_PATH } from '../constants/aistarslab.js'

export interface AistarslabApiEnvelope<T = unknown> {
  code?: number | string
  msg?: string
  message?: string
  data?: T
}

function resolveBaseUrl(config: Pick<AIConfig, 'baseUrl'>) {
  let base = String(config.baseUrl || AISTARSLAB_DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  if (base.endsWith('/api')) base = base.slice(0, -4)
  return base
}

export async function fetchAistarslabJson<T = unknown>(
  config: Pick<AIConfig, 'baseUrl' | 'apiKey'>,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = joinProviderUrl(resolveBaseUrl(config), '', path)
  const headers = new Headers(init.headers ?? {})
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${config.apiKey}`)
  }
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }

  const resp = await fetch(url, { ...init, headers })
  const json = await resp.json().catch(() => ({})) as AistarslabApiEnvelope<T>
  const code = json?.code
  if (!resp.ok || (code != null && code !== 0 && code !== '0')) {
    const message = String(json?.msg || json?.message || `HTTP ${resp.status}`).trim()
    throw new Error(message || '视频服务请求失败')
  }
  return (json?.data ?? json) as T
}

export async function fetchAistarslabVideoConfig(config: { baseUrl?: string | null; apiKey?: string | null }) {
  return fetchAistarslabJson(config as Pick<AIConfig, 'baseUrl' | 'apiKey'>, AISTARSLAB_OPENAPI_CONFIG_PATH, { method: 'GET' })
}
