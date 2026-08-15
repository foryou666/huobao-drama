import type { AIConfig } from './adapters/types.js'
import { joinProviderUrl } from './adapters/url.js'
import {
  AIGCCC_DEFAULT_BASE_URL,
  AIGCCC_STATUS_PATH,
} from '../constants/aigccc.js'

export interface AigcccApiEnvelope<T = unknown> {
  code?: number | string
  msg?: string
  message?: string
  data?: T
  trace_id?: string
  traceId?: string
}

function resolveBaseUrl(config: Pick<AIConfig, 'baseUrl'>) {
  return String(config.baseUrl || AIGCCC_DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ApiKey: String(apiKey || ''),
  }
}

export async function fetchAigcccJson<T = unknown>(
  config: Pick<AIConfig, 'baseUrl' | 'apiKey'>,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = joinProviderUrl(resolveBaseUrl(config), '', path)
  const headers = new Headers(init.headers ?? {})
  const apiKey = String(config.apiKey || '')
  if (!headers.has('ApiKey') && apiKey) headers.set('ApiKey', apiKey)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }

  const resp = await fetch(url, { ...init, headers })
  const json = await resp.json().catch(() => ({})) as AigcccApiEnvelope<T>
  const code = json?.code
  if (!resp.ok || (code != null && code !== 0 && code !== '0')) {
    const message = String(json?.msg || json?.message || `HTTP ${resp.status}`).trim()
    throw new Error(message || 'S通道6 请求失败')
  }
  return (json?.data ?? json) as T
}

export interface AigcccUpstreamTaskStatus {
  taskId: string
  status: string | null
  videoUrl: string | null
  error: string | null
  duration: number | null
  usedCredits: number | null
  remainingCredits: number | null
  usage: unknown
}

/** 查询任务状态；成功时 data 常带 remaining_credits（账户剩余）与 used_credits（本任务消耗）。 */
export async function fetchAigcccTaskStatus(
  config: { baseUrl?: string | null; apiKey?: string | null },
  taskId: string,
): Promise<AigcccUpstreamTaskStatus | null> {
  const id = String(taskId || '').trim()
  if (!id) return null
  const data = await fetchAigcccJson<Record<string, unknown>>(
    config as Pick<AIConfig, 'baseUrl' | 'apiKey'>,
    AIGCCC_STATUS_PATH,
    {
      method: 'POST',
      headers: authHeaders(String(config.apiKey || '')),
      body: JSON.stringify({ task_id: id }),
    },
  )
  const used = Number(data?.used_credits ?? data?.usedCredits)
  const remaining = Number(data?.remaining_credits ?? data?.remainingCredits)
  return {
    taskId: String(data?.task_id ?? data?.taskId ?? id),
    status: data?.status != null ? String(data.status) : null,
    videoUrl: data?.video_url || data?.videoUrl
      ? String(data?.video_url ?? data?.videoUrl)
      : null,
    error: data?.error != null ? String(data.error) : null,
    duration: Number.isFinite(Number(data?.duration)) ? Number(data.duration) : null,
    usedCredits: Number.isFinite(used) ? used : null,
    remainingCredits: Number.isFinite(remaining) ? remaining : null,
    usage: data?.usage ?? null,
  }
}

/**
 * 通道6无独立余额接口：借最近一条可查任务的 status.remaining_credits 作为当前余额。
 */
export async function fetchAigcccAccountCreditsViaTask(
  config: { baseUrl?: string | null; apiKey?: string | null },
  recentTaskIds: string[],
): Promise<{ credits: number; via_task_id: string | null }> {
  for (const taskId of recentTaskIds) {
    try {
      const detail = await fetchAigcccTaskStatus(config, taskId)
      if (detail?.remainingCredits != null) {
        return { credits: detail.remainingCredits, via_task_id: detail.taskId }
      }
    } catch {
      // try next
    }
  }
  throw new Error('暂无可用任务可查询余额（上游余额来自任务状态 remaining_credits）')
}
