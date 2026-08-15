/**
 * 火山方舟 Ark 视频任务查询（通道2）
 * GET /api/v3/contents/generations/tasks
 * GET /api/v3/contents/generations/tasks/{id}
 */
import type { AIConfig } from './adapters/types.js'
import { joinProviderUrl } from './adapters/url.js'
import { SEEDANCE_ARK_BASE_URL } from '../constants/seedance.js'
import { extractVolcengineApiErrorMessage } from '../utils/volcengine-video-errors.js'

export interface VolcengineArkTaskDetail {
  taskId: string
  status: string
  model?: string | null
  duration?: number | null
  resolution?: string | null
  ratio?: string | null
  videoUrl: string | null
  completionTokens: number | null
  totalTokens: number | null
  promptTokens: number | null
  createdAt: string | null
  updatedAt: string | null
  error: string | null
  raw: Record<string, unknown>
}

function resolveBaseUrl(config: Pick<AIConfig, 'baseUrl'>) {
  const base = String(config.baseUrl || SEEDANCE_ARK_BASE_URL).trim().replace(/\/+$/, '')
  return base || SEEDANCE_ARK_BASE_URL
}

function pickUsageTokens(usage: unknown): {
  completionTokens: number | null
  totalTokens: number | null
  promptTokens: number | null
} {
  if (!usage || typeof usage !== 'object') {
    return { completionTokens: null, totalTokens: null, promptTokens: null }
  }
  const u = usage as Record<string, unknown>
  const num = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return {
    completionTokens: num(u.completion_tokens ?? u.completionTokens ?? u.output_tokens),
    totalTokens: num(u.total_tokens ?? u.totalTokens),
    promptTokens: num(u.prompt_tokens ?? u.promptTokens ?? u.input_tokens),
  }
}

function pickVideoUrl(json: Record<string, unknown>): string | null {
  const content = json.content
  if (content && typeof content === 'object') {
    const url = String((content as any).video_url || (content as any).videoUrl || '').trim()
    if (url) return url
  }
  const direct = String(json.video_url || (json as any).videoUrl || '').trim()
  return direct || null
}

function pickCreatedAt(json: Record<string, unknown>): string | null {
  const raw = json.created_at ?? json.createdAt ?? json.create_time ?? null
  if (raw == null) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000
    return new Date(ms).toISOString()
  }
  const s = String(raw).trim()
  return s || null
}

function parseArkTaskJson(json: Record<string, unknown>, fallbackId?: string): VolcengineArkTaskDetail {
  const usage = pickUsageTokens(json.usage)
  const errRaw = json.error
  const error = errRaw
    ? (extractVolcengineApiErrorMessage(
        typeof errRaw === 'string' ? errRaw : JSON.stringify(errRaw),
      ) || String((errRaw as any)?.message || ''))
    : null

  return {
    taskId: String(json.id || fallbackId || ''),
    status: String(json.status || ''),
    model: json.model != null ? String(json.model) : null,
    duration: Number.isFinite(Number(json.duration)) ? Number(json.duration) : null,
    resolution: json.resolution != null ? String(json.resolution) : null,
    ratio: json.ratio != null ? String(json.ratio) : (json.aspect_ratio != null ? String(json.aspect_ratio) : null),
    videoUrl: pickVideoUrl(json),
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    promptTokens: usage.promptTokens,
    createdAt: pickCreatedAt(json),
    updatedAt: pickCreatedAt({
      created_at: json.updated_at ?? json.updatedAt ?? json.finished_at,
    } as Record<string, unknown>),
    error: error || null,
    raw: json,
  }
}

async function arkGetJson(
  config: Pick<AIConfig, 'baseUrl' | 'apiKey'>,
  path: string,
): Promise<Record<string, unknown>> {
  const url = joinProviderUrl(resolveBaseUrl(config), '/api/v3', path)
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'application/json',
    },
  })
  const json = await resp.json().catch(() => ({})) as Record<string, unknown>
  if (!resp.ok) {
    const message = extractVolcengineApiErrorMessage(
      typeof json.error === 'string' ? json.error : JSON.stringify(json.error || json),
    ) || String((json as any)?.error?.message || json.message || `HTTP ${resp.status}`)
    throw new Error(message || '查询方舟任务失败')
  }
  return json
}

export async function fetchVolcengineArkTaskDetail(
  config: Pick<AIConfig, 'baseUrl' | 'apiKey'>,
  taskId: string,
): Promise<VolcengineArkTaskDetail | null> {
  const id = String(taskId || '').trim()
  if (!id) return null
  const json = await arkGetJson(config, `/contents/generations/tasks/${encodeURIComponent(id)}`)
  return parseArkTaskJson(json, id)
}

/** 列出方舟侧近期视频生成任务（含探测脚本直连产生的任务） */
export async function listVolcengineArkTasks(
  config: Pick<AIConfig, 'baseUrl' | 'apiKey'>,
  opts?: { pageSize?: number; pageNum?: number },
): Promise<{ total: number; items: VolcengineArkTaskDetail[] }> {
  const pageSize = Math.min(50, Math.max(1, Number(opts?.pageSize || 20) || 20))
  const pageNum = Math.max(1, Number(opts?.pageNum || 1) || 1)
  const qs = new URLSearchParams({
    page_size: String(pageSize),
    page_num: String(pageNum),
  })
  const json = await arkGetJson(config, `/contents/generations/tasks?${qs.toString()}`)
  const itemsRaw = Array.isArray(json.items)
    ? json.items
    : (Array.isArray(json.data) ? json.data : [])
  const items = itemsRaw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => parseArkTaskJson(item))
    .filter(item => item.taskId)
  const total = Number(json.total)
  return {
    total: Number.isFinite(total) ? total : items.length,
    items,
  }
}
