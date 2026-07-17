import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { logActivity } from './activity.js'
import type { AuthUser } from '../middleware/auth.js'

export const SUBTITLE_REMOVER_CONFIG_NAME = '去字幕 API'

export interface SubtitleRemoverConfig {
  baseUrl: string
  apiKey: string
  source: 'database' | 'env' | 'none'
  isActive: boolean
  id: number | null
}

function findConfigRow() {
  return db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'video'))
    .all()
    .filter(row => String(row.provider || '').toLowerCase() === 'subtitle_remover')
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || null
}

function envConfig(): SubtitleRemoverConfig | null {
  const baseUrl = (
    process.env.SUBTITLE_REMOVER_API_URL
    || process.env.VSR_API_URL
    || ''
  ).trim().replace(/\/+$/, '')
  if (!baseUrl) return null
  return {
    baseUrl,
    apiKey: process.env.SUBTITLE_REMOVER_API_KEY || process.env.VSR_API_KEY || '',
    source: 'env',
    isActive: true,
    id: null,
  }
}

export function resolveSubtitleRemoverConfig(): SubtitleRemoverConfig {
  const row = findConfigRow()
  if (row?.isActive && row.baseUrl) {
    return {
      baseUrl: row.baseUrl.replace(/\/+$/, ''),
      apiKey: row.apiKey || '',
      source: 'database',
      isActive: true,
      id: row.id,
    }
  }
  const env = envConfig()
  if (env) return env
  throw new Error(
    '去字幕服务未配置：请在「设置 → AI 服务 → 去字幕 API」填写本机 VSR 地址，'
    + '或设置环境变量 SUBTITLE_REMOVER_API_URL',
  )
}

export function getSubtitleRemoverAdminConfig() {
  const row = findConfigRow()
  const env = envConfig()
  const active = row?.isActive && row.baseUrl ? row : null
  return {
    configured: !!(active?.baseUrl || env?.baseUrl),
    source: active ? 'database' : (env ? 'env' : 'none'),
    id: row?.id || null,
    is_active: row?.isActive ?? false,
    base_url: active?.baseUrl || env?.baseUrl || '',
    api_key: active?.apiKey ? '********' : (env?.apiKey ? '********' : ''),
    env_fallback: env?.baseUrl || '',
  }
}

export function saveSubtitleRemoverAdminConfig(input: {
  base_url: string
  api_key?: string
  is_active?: boolean
}, user: AuthUser) {
  const baseUrl = String(input.base_url || '').trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('请填写去字幕 API 地址')

  const ts = now()
  const existing = findConfigRow()
  const apiKeyInput = String(input.api_key || '').trim()
  const isActive = input.is_active !== false

  if (existing) {
    const updates: Record<string, unknown> = {
      baseUrl,
      isActive,
      updatedAt: ts,
    }
    if (apiKeyInput && apiKeyInput !== '********') {
      updates.apiKey = apiKeyInput
    }
    db.update(schema.aiServiceConfigs)
      .set(updates)
      .where(eq(schema.aiServiceConfigs.id, existing.id))
      .run()
  } else {
    db.insert(schema.aiServiceConfigs).values({
      serviceType: 'video',
      provider: 'subtitle_remover',
      name: SUBTITLE_REMOVER_CONFIG_NAME,
      baseUrl,
      apiKey: apiKeyInput && apiKeyInput !== '********' ? apiKeyInput : '',
      model: JSON.stringify([]),
      priority: 50,
      isActive,
      createdAt: ts,
      updatedAt: ts,
    }).run()
  }

  logActivity(user, {
    action: 'settings.subtitle_remover.update',
    summary: '更新去字幕 API 配置',
    resourceType: 'ai_config',
  })

  return getSubtitleRemoverAdminConfig()
}

export async function probeSubtitleRemoverApi(baseUrl: string, apiKey?: string) {
  const url = `${baseUrl.replace(/\/+$/, '')}/health`
  const headers: Record<string, string> = {}
  if (apiKey && apiKey !== '********') {
    headers.Authorization = `Bearer ${apiKey}`
  }
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
  const text = await resp.text()
  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text.slice(0, 240) }
  }
  return {
    ok: resp.ok,
    reachable: resp.ok || resp.status < 500,
    status: resp.status,
    url,
    message: resp.ok ? 'VSR API 可访问' : `HTTP ${resp.status}`,
    vsr_ready: data.vsr_ready,
    response: data,
  }
}
