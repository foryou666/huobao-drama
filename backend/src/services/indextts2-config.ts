import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import type { AIConfig } from './ai.js'
import { isGradioIndexTts2Url, normalizeGradioBase } from './adapters/indextts2-gradio.js'
import { logActivity } from './activity.js'
import type { AuthUser } from '../middleware/auth.js'

export const INDEXTTS2_CONFIG_NAME = 'IndexTTS2 配音'

export function isIndexTts2Provider(provider?: string | null) {
  const p = String(provider || '').toLowerCase()
  return p === 'indextts2' || p === 'tts2'
}

function parseSettings(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function rowToConfig(row: typeof schema.aiServiceConfigs.$inferSelect): AIConfig {
  const models = row.model ? JSON.parse(row.model) : []
  const settings = parseSettings(row.settings)
  const baseUrl = String(row.baseUrl || '').trim()
  return {
    id: row.id,
    provider: row.provider || 'indextts2',
    baseUrl,
    apiKey: row.apiKey || '',
    model: models[0] || '',
    models,
    settings: {
      ...settings,
      default_voice: settings.default_voice || models[0] || 'voice_01',
      response_format: settings.response_format || 'wav',
      use_full_url: settings.use_full_url ?? !isGradioIndexTts2Url(baseUrl),
    },
  }
}

function findIndexTts2Row() {
  return db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'audio'))
    .all()
    .filter(row => isIndexTts2Provider(row.provider))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || null
}

function envFallbackConfig(): AIConfig | null {
  const apiUrl = (
    process.env.INDEXTTS2_API_URL
    || process.env.TTS2_API_URL
    || process.env.TTS2_BASE_URL
    || ''
  ).trim()
  if (!apiUrl) return null

  const defaultVoice = process.env.INDEXTTS2_VOICE || process.env.TTS2_VOICE || 'voice_01'
  return {
    id: 0,
    provider: 'indextts2',
    baseUrl: apiUrl,
    apiKey: process.env.INDEXTTS2_API_KEY || process.env.TTS2_API_KEY || '',
    model: defaultVoice,
    models: [defaultVoice],
    settings: {
      default_voice: defaultVoice,
      response_format: process.env.INDEXTTS2_FORMAT || 'wav',
      use_full_url: !isGradioIndexTts2Url(apiUrl),
    },
  }
}

export function resolveIndexTts2RuntimeConfig(configId?: number | null): AIConfig {
  if (configId) {
    const [row] = db.select().from(schema.aiServiceConfigs)
      .where(eq(schema.aiServiceConfigs.id, configId))
      .all()
    if (row && isIndexTts2Provider(row.provider)) {
      return rowToConfig(row)
    }
  }

  const row = findIndexTts2Row()
  if (row?.isActive) {
    return rowToConfig(row)
  }

  const envConfig = envFallbackConfig()
  if (envConfig) return envConfig

  throw new Error(
    'IndexTTS2 未配置：请在「设置 → AI 服务 → IndexTTS2 配音」填写 API 地址，'
    + '或设置环境变量 INDEXTTS2_API_URL',
  )
}

export function getIndexTts2AdminConfig() {
  const row = findIndexTts2Row()
  const envConfig = envFallbackConfig()
  const active = row?.isActive ? rowToConfig(row) : envConfig

  return {
    configured: !!(row?.isActive && row.baseUrl) || !!envConfig,
    source: row?.isActive && row.baseUrl ? 'database' : (envConfig ? 'env' : 'none'),
    id: row?.id || null,
    is_active: row?.isActive ?? false,
    base_url: row?.baseUrl || envConfig?.baseUrl || '',
    api_key: row?.apiKey ? '********' : (envConfig?.apiKey ? '********' : ''),
    default_voice: String(
      (row?.isActive ? parseSettings(row.settings).default_voice : null)
      || envConfig?.settings?.default_voice
      || 'voice_01',
    ),
    response_format: String(
      (row?.isActive ? parseSettings(row.settings).response_format : null)
      || envConfig?.settings?.response_format
      || 'wav',
    ),
    is_gradio: isGradioIndexTts2Url(active?.baseUrl || ''),
    env_fallback: envConfig?.baseUrl || '',
  }
}

export function saveIndexTts2AdminConfig(input: {
  base_url: string
  api_key?: string
  default_voice?: string
  response_format?: string
  is_active?: boolean
}, user: AuthUser) {
  const baseUrl = normalizeGradioBase(String(input.base_url || '').trim())
  if (!baseUrl) throw new Error('请填写 IndexTTS2 API 地址')

  const defaultVoice = String(input.default_voice || 'voice_01').trim() || 'voice_01'
  const responseFormat = String(input.response_format || 'wav').trim() || 'wav'
  const settings = {
    default_voice: defaultVoice,
    response_format: responseFormat,
    use_full_url: !isGradioIndexTts2Url(baseUrl),
  }

  const ts = now()
  const existing = findIndexTts2Row()
  const apiKeyInput = String(input.api_key || '').trim()
  const isActive = input.is_active !== false

  if (existing) {
    const updates: Record<string, unknown> = {
      baseUrl,
      model: JSON.stringify([defaultVoice]),
      settings: JSON.stringify(settings),
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

    logActivity(user, {
      action: 'settings.tts_config.update',
      summary: '更新 IndexTTS2 配音 API 配置',
      resourceType: 'ai_config',
      resourceId: existing.id,
    })

    return getIndexTts2AdminConfig()
  }

  const res = db.insert(schema.aiServiceConfigs).values({
    serviceType: 'audio',
    provider: 'indextts2',
    name: INDEXTTS2_CONFIG_NAME,
    baseUrl,
    apiKey: apiKeyInput && apiKeyInput !== '********' ? apiKeyInput : '',
    model: JSON.stringify([defaultVoice]),
    priority: 110,
    isActive,
    settings: JSON.stringify(settings),
    createdAt: ts,
    updatedAt: ts,
  }).run()

  logActivity(user, {
    action: 'settings.tts_config.create',
    summary: '创建 IndexTTS2 配音 API 配置',
    resourceType: 'ai_config',
    resourceId: Number(res.lastInsertRowid),
  })

  return getIndexTts2AdminConfig()
}

export async function probeIndexTts2Api(baseUrl: string) {
  const normalized = normalizeGradioBase(baseUrl)
  if (!normalized) throw new Error('API 地址为空')

  const probeUrl = isGradioIndexTts2Url(normalized)
    ? normalized
    : normalized

  const resp = await fetch(probeUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(20_000),
  })
  const text = await resp.text()
  const reachable = resp.ok || resp.status === 405 || resp.status === 404
  const looksLikeGradio = /gradio|gen_single|Gradio/i.test(text)

  let message = reachable
    ? (resp.ok ? '端点可访问' : `端点已响应（HTTP ${resp.status}）`)
    : `端点未按预期响应（HTTP ${resp.status}）`
  if (isGradioIndexTts2Url(normalized) && looksLikeGradio) {
    message = `${message}，检测到 Gradio 部署`
  }

  return {
    ok: resp.ok,
    reachable,
    status: resp.status,
    url: probeUrl,
    is_gradio: isGradioIndexTts2Url(normalized),
    message,
    response_preview: text.slice(0, 240),
  }
}

let statusCache: { at: number; payload: IndexTts2ServerStatus } | null = null
const STATUS_CACHE_MS = 15_000

export interface IndexTts2ServerStatus {
  /** online | offline | unconfigured */
  state: 'online' | 'offline' | 'unconfigured'
  online: boolean
  configured: boolean
  reachable: boolean
  label: string
  detail: string
  checked_at: string
  http_status?: number | null
}

/** 面向普通用户的 TTS 服务器开机/关机状态（带短缓存） */
export async function getIndexTts2ServerStatus(opts?: { force?: boolean }): Promise<IndexTts2ServerStatus> {
  const nowMs = Date.now()
  if (!opts?.force && statusCache && nowMs - statusCache.at < STATUS_CACHE_MS) {
    return statusCache.payload
  }

  const admin = getIndexTts2AdminConfig()
  const checkedAt = new Date().toISOString()

  if (!admin.configured || !admin.base_url) {
    const payload: IndexTts2ServerStatus = {
      state: 'unconfigured',
      online: false,
      configured: false,
      reachable: false,
      label: '当前 TTS 服务器未配置，暂停使用',
      detail: '请联系管理员在「设置 → AI 服务」配置 IndexTTS2',
      checked_at: checkedAt,
      http_status: null,
    }
    statusCache = { at: nowMs, payload }
    return payload
  }

  try {
    const probe = await probeIndexTts2Api(admin.base_url)
    if (probe.reachable) {
      const payload: IndexTts2ServerStatus = {
        state: 'online',
        online: true,
        configured: true,
        reachable: true,
        label: '当前 TTS 服务器已开机，正常使用',
        detail: probe.message,
        checked_at: checkedAt,
        http_status: probe.status,
      }
      statusCache = { at: nowMs, payload }
      return payload
    }
    const payload: IndexTts2ServerStatus = {
      state: 'offline',
      online: false,
      configured: true,
      reachable: false,
      label: '当前 TTS 服务器已关机。如需使用配音功能，请向管理员申请开机。',
      detail: '如需使用配音功能，请向管理员申请开机。',
      checked_at: checkedAt,
      http_status: probe.status,
    }
    statusCache = { at: nowMs, payload }
    return payload
  } catch (err: any) {
    const payload: IndexTts2ServerStatus = {
      state: 'offline',
      online: false,
      configured: true,
      reachable: false,
      label: '当前 TTS 服务器已关机。如需使用配音功能，请向管理员申请开机。',
      detail: err?.message || '无法连接 TTS 服务器',
      checked_at: checkedAt,
      http_status: null,
    }
    statusCache = { at: nowMs, payload }
    return payload
  }
}
