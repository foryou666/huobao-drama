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

export interface ChengmengUserBalance {
  availableBalance: number
  frozenBalance: number
  totalRecharge: number
  totalSpent: number
}

export async function fetchChengmengUserBalance(
  config: { baseUrl?: string | null; apiKey: string },
): Promise<ChengmengUserBalance> {
  const data = await fetchChengmengJson<Record<string, unknown>>(config, '/api/user/balance', { method: 'GET' })
  return {
    availableBalance: Number(data?.available_balance ?? data?.availableBalance ?? 0),
    frozenBalance: Number(data?.frozen_balance ?? data?.frozenBalance ?? 0),
    totalRecharge: Number(data?.total_recharge ?? data?.totalRecharge ?? 0),
    totalSpent: Number(data?.total_spent ?? data?.totalSpent ?? 0),
  }
}

export interface ChengmengUpstreamTask {
  taskNo: string
  modelId: string | null
  status: string | null
  estimatedCost: number | null
  actualCost: number | null
  prompt: string
  errorMessage: string | null
  createdAt: string | null
  finishedAt: string | null
}

export interface ChengmengTaskListResult {
  list: ChengmengUpstreamTask[]
  total: number
  page: number
  pageSize: number
}

export async function fetchChengmengTasks(
  config: { baseUrl?: string | null; apiKey: string },
  opts?: { page?: number; pageSize?: number },
): Promise<ChengmengTaskListResult> {
  const page = Math.max(1, Number(opts?.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(opts?.pageSize) || 20))
  const data = await fetchChengmengJson<Record<string, unknown>>(
    config,
    `/api/tasks?page=${page}&page_size=${pageSize}`,
    { method: 'GET' },
  )
  const rawList = Array.isArray(data?.list) ? data.list : []
  const list: ChengmengUpstreamTask[] = rawList.map((item: any) => ({
    taskNo: String(item?.task_no || item?.taskNo || '').trim(),
    modelId: item?.model_id != null ? String(item.model_id) : (item?.modelId != null ? String(item.modelId) : null),
    status: item?.status != null ? String(item.status) : null,
    estimatedCost: Number.isFinite(Number(item?.estimated_cost ?? item?.estimatedCost))
      ? Number(item?.estimated_cost ?? item?.estimatedCost)
      : null,
    actualCost: Number.isFinite(Number(item?.actual_cost ?? item?.actualCost))
      ? Number(item?.actual_cost ?? item?.actualCost)
      : null,
    prompt: String(item?.prompt || '').trim(),
    errorMessage: item?.error_message != null || item?.errorMessage != null
      ? String(item?.error_message ?? item?.errorMessage)
      : null,
    createdAt: item?.created_at || item?.createdAt || null,
    finishedAt: item?.finished_at || item?.finishedAt || null,
  })).filter(item => item.taskNo)

  return {
    list,
    total: Number(data?.total ?? list.length) || list.length,
    page: Number(data?.page ?? page) || page,
    pageSize: Number(data?.page_size ?? data?.pageSize ?? pageSize) || pageSize,
  }
}
