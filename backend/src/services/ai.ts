/**
 * AI 服务抽象层 — 从数据库配置中获取 provider 和 API key
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { buildJimengVirtualConfig } from './jimeng-web-video.js'
import { buildXyqVirtualConfig } from './xyq-web-video.js'
import { buildCozeVirtualConfig } from './coze-web-video.js'
import { buildFunshionVirtualConfig } from './funshion-web-video.js'
import { buildDoubaoTrainingVirtualConfig } from './doubao-training-video.js'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'
import {
  APIMART_DEFAULT_BASE_URL,
  APIMART_NARRATION_TEXT_MODEL,
  apimartSettingsWithDefaultMirrors,
} from '../constants/apimart.js'

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

  if (
    provider === 'openai'
    || provider === 'openrouter'
    || provider === 'chatfire'
    || provider === 'geeknow'
    || provider === 'qilingze'
    || provider === 'apimart'
  ) {
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

/**
 * 解说漫专用文本配置：优先 APIMart ChatGPT（不影响全局 Agent 文本通道）。
 * 若尚未单独配置 text/apimart，则复用 APIMart 图片通道的 Key + 解说默认模型。
 */
export function getNarrationTextConfig(): AIConfig {
  const apimartTextRows = db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(r => r.serviceType === 'text' && String(r.provider || '').toLowerCase() === 'apimart' && r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))

  if (apimartTextRows[0]) {
    const config = rowToAIConfig(apimartTextRows[0])
    if (!config.model) {
      config.model = APIMART_NARRATION_TEXT_MODEL
      config.models = [APIMART_NARRATION_TEXT_MODEL]
    }
    logTaskProgress('AIConfig', 'narration-text-config-selected', {
      configId: config.id,
      provider: config.provider,
      model: config.model,
      source: 'apimart-text',
    })
    return config
  }

  const image = getApimartImageConfig()
  if (image?.apiKey) {
    const config: AIConfig = {
      provider: 'apimart',
      baseUrl: image.baseUrl || APIMART_DEFAULT_BASE_URL,
      apiKey: image.apiKey,
      model: APIMART_NARRATION_TEXT_MODEL,
      models: [APIMART_NARRATION_TEXT_MODEL],
      settings: image.settings || apimartSettingsWithDefaultMirrors(),
    }
    logTaskProgress('AIConfig', 'narration-text-config-selected', {
      provider: config.provider,
      model: config.model,
      source: 'apimart-image-key',
    })
    return config
  }

  logTaskWarn('AIConfig', 'narration-text-fallback-global', {})
  return getTextConfig()
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
  if (provider === 'xyq_web') {
    return buildXyqVirtualConfig()
  }
  if (provider === 'coze_web') {
    return buildCozeVirtualConfig()
  }
  if (provider === 'funshion_web') {
    return buildFunshionVirtualConfig()
  }
  if (provider === 'doubao_training') {
    return buildDoubaoTrainingVirtualConfig()
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

/** 图片任务轮询/恢复时使用：按 provider 匹配配置（含已停用） */
export function resolveImageTaskConfig(record: {
  provider?: string | null
}): AIConfig | null {
  const provider = String(record.provider || '').trim()
  if (!provider) return getActiveConfig('image')
  const rows = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'image'))
    .all()
    .filter(r => r.provider === provider)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))
  const match = rows.find(r => r.isActive) || rows[0]
  return match ? rowToAIConfig(match) : getActiveConfig('image')
}

function listActiveImageConfigsByProvider(provider: string): AIConfig[] {
  return db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(r => r.serviceType === 'image' && r.provider === provider && r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))
    .map(rowToAIConfig)
}

/** 启灵泽图片通道（nano-banana-2 专用上游，成本低于 APIMart） */
export function getQilingzeImageConfig(): AIConfig | null {
  return listActiveImageConfigsByProvider('qilingze')[0] || null
}

/** APIMart 图片通道（gpt-image-2 等） */
export function getApimartImageConfig(): AIConfig | null {
  return listActiveImageConfigsByProvider('apimart')[0] || null
}

/** 图片主通道失败时，取 GeekNow 图片配置作为备用 */
export function getGeeknowImageFallbackConfig(excludeProvider?: string | null): AIConfig | null {
  const exclude = String(excludeProvider || '').toLowerCase()
  if (exclude === 'geeknow') return null
  const rows = db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(r => r.serviceType === 'image' && r.provider === 'geeknow' && r.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))
  const row = rows[0]
  return row ? rowToAIConfig(row) : null
}

/** 橙盟余额不足时，取其它橙盟视频配置作为备用 Key（优先高 priority / 新 id） */
export function listChengmengVideoFallbackConfigs(excludeConfigId?: number | null): AIConfig[] {
  const exclude = Number(excludeConfigId)
  return db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(r => r.serviceType === 'video' && r.provider === 'chengmeng')
    .filter(r => !Number.isFinite(exclude) || r.id !== exclude)
    .filter(r => String(r.apiKey || '').trim() && r.apiKey !== '********')
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))
    .map(rowToAIConfig)
}

/** @deprecated 使用 listChengmengVideoFallbackConfigs + 鉴权校验 */
export function getFallbackChengmengVideoConfig(excludeConfigId?: number | null): AIConfig | null {
  return listChengmengVideoFallbackConfigs(excludeConfigId)[0] || null
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
