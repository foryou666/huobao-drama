import type { AIConfig } from './adapters/types.js'
import { joinProviderUrl } from './adapters/url.js'
import { CHENGMENT_DEFAULT_BASE_URL } from '../constants/chengmeng.js'

export interface ChengmengApiEnvelope<T = unknown> {
  code?: number | string
  message?: string
  data?: T
}

export interface ChengmengRemoteModelGroup {
  group_id: number | string
  name?: string
  is_default?: boolean
}

export interface ChengmengRemoteModel {
  id: string
  code?: string
  name?: string
  description?: string
  model_type?: string
  pricing_type?: string
  base_price?: number
  unit_label?: string
  capabilities?: Record<string, boolean>
  groups?: ChengmengRemoteModelGroup[]
}

function resolveBaseUrl(config: { baseUrl?: string | null }) {
  return String(config.baseUrl || CHENGMENT_DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
}

export async function fetchChengmengJson<T = unknown>(
  config: { baseUrl?: string | null; apiKey: string },
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = joinProviderUrl(resolveBaseUrl(config), '', path)
  const headers = new Headers(init.headers ?? {})
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${config.apiKey}`)
  }
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')

  const resp = await fetch(url, { ...init, headers })
  const json = await resp.json().catch(() => ({})) as ChengmengApiEnvelope<T>
  const code = json?.code
  if (!resp.ok || (code != null && code !== 0 && code !== '0')) {
    const message = String(json?.message || `HTTP ${resp.status}`).trim()
    throw new Error(message || '橙盟 API 请求失败')
  }
  return (json?.data ?? json) as T
}

export async function fetchChengmengVideoModels(
  config: { baseUrl?: string | null; apiKey: string },
): Promise<ChengmengRemoteModel[]> {
  const data = await fetchChengmengJson<ChengmengRemoteModel[] | ChengmengRemoteModel>(
    config,
    '/api/models',
    { method: 'GET' },
  )
  return Array.isArray(data) ? data : (data ? [data] : [])
}
