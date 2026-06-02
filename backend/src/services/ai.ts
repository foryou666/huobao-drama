/**
 * AI 服务抽象层 — 从数据库配置中获取 provider 和 API key
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'

export type ServiceType = 'text' | 'image' | 'video' | 'audio'

export interface AIConfig {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  models?: string[]
  settings?: Record<string, unknown>
}

export function getTextProviderBaseUrl(config: AIConfig) {
  const provider = config.provider.toLowerCase()

  if (provider === 'openai' || provider === 'openrouter' || provider === 'chatfire' || provider === 'geeknow') {
    return joinProviderUrl(config.baseUrl, '/v1', '')
  }

  if (provider === 'volcengine') {
    return joinProviderUrl(config.baseUrl, '/api/v3', '')
  }

  if (provider === 'ali' || provider.startsWith('ali-')) {
    const base = (config.baseUrl || '').replace(/\/+$/, '')
    // 百炼 OpenAI 兼容模式：Base URL 已含 compatible-mode/v1，直接使用
    if (base.includes('/compatible-mode')) {
      return base.endsWith('/v1') ? base : joinProviderUrl(base, '/v1', '')
    }
    // 仅填写 dashscope 域名时，默认走兼容模式（文本 Agent 使用 createOpenAI）
    if (/dashscope[^/]*\.aliyuncs\.com$/i.test(base)) {
      return joinProviderUrl(base, '/compatible-mode/v1', '')
    }
    return joinProviderUrl(config.baseUrl, '/api/v1', '')
  }

  return config.baseUrl
}

export function getActiveConfig(serviceType: ServiceType): AIConfig | null {
  const rows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, serviceType))
    .all()
    .filter(r => r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0)) // 高优先级优先

  const active = rows[0]
  if (!active) {
    logTaskWarn('AIConfig', 'active-config-missing', { serviceType })
    return null
  }

  const models = active.model ? JSON.parse(active.model) : []
  logTaskProgress('AIConfig', 'active-config-selected', {
    serviceType,
    configId: active.id,
    provider: active.provider,
    model: models[0] || '',
    priority: active.priority,
  })
  let settings: Record<string, unknown> | undefined
  if (active.settings) {
    try {
      settings = JSON.parse(active.settings)
    } catch {
      settings = undefined
    }
  }
  return {
    provider: active.provider || '',
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    model: models[0] || '',
    models,
    settings,
  }
}

export function getTextConfig(): AIConfig {
  const config = getActiveConfig('text')
  if (!config) throw new Error('No active text AI config')
  return config
}

export function getAudioConfig(): AIConfig {
  const config = getActiveConfig('audio')
  if (!config) throw new Error('No active audio AI config — 请在设置中添加音频服务')
  return config
}

export function getAudioConfigById(id?: number | null): AIConfig {
  if (id) {
    const config = getConfigById(id)
    if (config) return config
  }
  return getAudioConfig()
}

export function getConfigById(id: number): AIConfig | null {
  const [row] = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id)).all()
  if (!row || !row.isActive) {
    logTaskWarn('AIConfig', 'config-by-id-missing', { configId: id })
    return null
  }
  const models = row.model ? JSON.parse(row.model) : []
  logTaskProgress('AIConfig', 'config-by-id-selected', {
    configId: id,
    provider: row.provider,
    model: models[0] || '',
    serviceType: row.serviceType,
  })
  let settings: Record<string, unknown> | undefined
  if (row.settings) {
    try {
      settings = JSON.parse(row.settings)
    } catch {
      settings = undefined
    }
  }
  return {
    provider: row.provider || '',
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: models[0] || '',
    models,
    settings,
  }
}
