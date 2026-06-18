/**
 * AI 服务抽象层 — 从数据库配置中获取 provider 和 API key
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { buildJimengVirtualConfig } from './jimeng-web-video.js'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'

export type ServiceType = 'text' | 'image' | 'video' | 'audio'

export interface AIConfig {
  id?: number
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  models?: string[]
  settings?: Record<string, unknown>
}

function rowToAIConfig(row: typeof schema.aiServiceConfigs.$inferSelect): AIConfig {
  const models = row.model ? JSON.parse(row.model) : []
  let settings: Record<string, unknown> | undefined
  if (row.settings) {
    try {
      settings = JSON.parse(row.settings)
    } catch {
      settings = undefined
    }
  }
  return {
    id: row.id,
    provider: row.provider || '',
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    model: models[0] || '',
    models,
    settings,
  }
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
  return rowToAIConfig(active)
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

export function getConfigById(id: number, options?: { includeInactive?: boolean }): AIConfig | null {
  const [row] = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, id)).all()
  if (!row || (!row.isActive && !options?.includeInactive)) {
    logTaskWarn('AIConfig', 'config-by-id-missing', { configId: id, includeInactive: !!options?.includeInactive })
    return null
  }
  logTaskProgress('AIConfig', 'config-by-id-selected', {
    configId: id,
    provider: row.provider,
    model: rowToAIConfig(row).model,
    serviceType: row.serviceType,
    includeInactive: !!options?.includeInactive,
  })
  return rowToAIConfig(row)
}

/** 视频任务轮询/恢复时使用：优先任务创建时的 config_id（含已停用配置） */
export function resolveVideoTaskConfig(record: {
  configId?: number | null
  provider?: string | null
}): AIConfig | null {
  if (record.configId) {
    const stored = getConfigById(record.configId, { includeInactive: true })
    if (stored) return stored
  }
  const provider = String(record.provider || '').trim()
  if (provider === 'jimeng_web') {
    return buildJimengVirtualConfig()
  }
  if (!provider) return getActiveConfig('video')
  const rows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'video'))
    .all()
    .filter(r => r.provider === provider)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))
  const match = rows.find(r => r.isActive) || rows[0]
  return match ? rowToAIConfig(match) : getActiveConfig('video')
}

/** 橙盟余额不足时，取另一条视频配置作为备用 Key（通常为新账号） */
export function getFallbackChengmengVideoConfig(excludeConfigId?: number | null): AIConfig | null {
  const exclude = Number(excludeConfigId)
  const rows = db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(r => r.serviceType === 'video' && r.provider === 'chengmeng')
    .filter(r => !Number.isFinite(exclude) || r.id !== exclude)
    .sort((a, b) => (b.id || 0) - (a.id || 0))
  const row = rows[0]
  return row ? rowToAIConfig(row) : null
}

/** 备用 Key 接管后，将其设为唯一启用的橙盟视频配置 */
export function promoteChengmengVideoConfig(configId: number) {
  const ts = new Date().toISOString()
  const rows = db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(r => r.serviceType === 'video' && r.provider === 'chengmeng')
  for (const row of rows) {
    db.update(schema.aiServiceConfigs)
      .set({ isActive: row.id === configId, updatedAt: ts })
      .where(eq(schema.aiServiceConfigs.id, row.id))
      .run()
  }
  logTaskProgress('AIConfig', 'chengmeng-config-promoted', { configId })
}
