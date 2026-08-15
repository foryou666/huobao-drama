import type { AIConfig } from './adapters/types.js'
import { joinProviderUrl } from './adapters/url.js'
import {
  AISTARSLAB_DEFAULT_BASE_URL,
  AISTARSLAB_OPENAPI_ACCOUNT_CREDITS_PATH,
  AISTARSLAB_OPENAPI_CONFIG_PATH,
  AISTARSLAB_OPENAPI_TASK_DETAIL_PATH,
} from '../constants/aistarslab.js'

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

export async function fetchAistarslabAccountCredits(
  config: { baseUrl?: string | null; apiKey?: string | null },
): Promise<{ credits: number }> {
  const data = await fetchAistarslabJson<Record<string, unknown>>(
    config as Pick<AIConfig, 'baseUrl' | 'apiKey'>,
    AISTARSLAB_OPENAPI_ACCOUNT_CREDITS_PATH,
    { method: 'GET' },
  )
  return { credits: Number(data?.credits ?? data?.credit ?? 0) || 0 }
}

export interface AistarslabUpstreamTaskDetail {
  taskId: string
  channel: string | null
  model: string | null
  status: number | string | null
  progress: number | null
  costCredits: number | null
  seconds: number | null
  prompt: string
  errorMessage: string | null
  createdAt: string | null
  updatedAt: string | null
  completedAt: string | null
}

function mapAistarslabTaskDetail(raw: any): AistarslabUpstreamTaskDetail | null {
  const taskId = String(raw?.taskId || raw?.task_id || '').trim()
  if (!taskId) return null
  return {
    taskId,
    channel: raw?.channel != null ? String(raw.channel) : null,
    model: raw?.model != null ? String(raw.model) : null,
    status: raw?.status ?? null,
    progress: Number.isFinite(Number(raw?.progress)) ? Number(raw.progress) : null,
    costCredits: Number.isFinite(Number(raw?.costCredits ?? raw?.cost_credits))
      ? Number(raw?.costCredits ?? raw?.cost_credits)
      : null,
    seconds: Number.isFinite(Number(raw?.seconds ?? raw?.duration))
      ? Number(raw?.seconds ?? raw?.duration)
      : null,
    prompt: String(raw?.prompt || '').trim(),
    errorMessage: raw?.errorMessage != null || raw?.error_message != null
      ? String(raw?.errorMessage ?? raw?.error_message)
      : null,
    createdAt: raw?.createdAt || raw?.created_at || null,
    updatedAt: raw?.updatedAt || raw?.updated_at || null,
    completedAt: raw?.completedAt || raw?.completed_at || null,
  }
}

export async function fetchAistarslabTaskDetail(
  config: { baseUrl?: string | null; apiKey?: string | null },
  taskId: string,
): Promise<AistarslabUpstreamTaskDetail | null> {
  const id = String(taskId || '').trim()
  if (!id) return null
  const path = `${AISTARSLAB_OPENAPI_TASK_DETAIL_PATH}?taskId=${encodeURIComponent(id)}`
  const data = await fetchAistarslabJson(
    config as Pick<AIConfig, 'baseUrl' | 'apiKey'>,
    path,
    { method: 'GET' },
  )
  const record = Array.isArray(data) ? data[0] : data
  return mapAistarslabTaskDetail(record)
}
