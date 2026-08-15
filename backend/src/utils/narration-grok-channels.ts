import { db, schema } from '../db/index.js'
import { getConfigById } from '../services/ai.js'
import { isPlaceholderApiKey } from './official-volcengine-video.js'
import {
  getNarrationGrokChannelDef,
  NARRATION_GROK_CHANNELS,
  type NarrationGrokChannelId,
} from '../constants/narration-grok-channels.js'
import {
  grokVideoDurationBounds,
  grokVideoModelLabel,
  isGrokVideoModel,
} from '../constants/geeknow-grok.js'

export function listNarrationGrokChannelOptions() {
  // 解说漫通道选择：不展示启灵泽（Grok 成本过高）
  return NARRATION_GROK_CHANNELS
    .filter(channel => channel.id !== 'qilingze')
    .map((channel) => {
    const row = findNarrationGrokChannelConfigRow(channel.id)
    const configured = !!(row && row.apiKey && !isPlaceholderApiKey(row.apiKey) && row.isActive)
    return {
      id: channel.id,
      label: channel.label,
      provider: channel.provider,
      default_model: channel.defaultModel,
      models: channel.models.map((m) => {
        const bounds = grokVideoDurationBounds(m.id)
        return {
          id: m.id,
          label: m.label || grokVideoModelLabel(m.id),
          duration_min: bounds.min,
          duration_max: bounds.max,
          duration_default: bounds.defaultSec,
        }
      }),
      config_id: row?.id ?? null,
      configured,
      base_url: row?.baseUrl || null,
    }
  })
}

export function findNarrationGrokChannelConfigRow(channelId?: string | null) {
  const channel = getNarrationGrokChannelDef(channelId)
  const rows = db.select().from(schema.aiServiceConfigs).all()
    .filter(row => row.serviceType === 'image' || row.serviceType === 'video')
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))

  const match = (row: typeof rows[number]) => {
    if (channel.baseUrlIncludes && String(row.baseUrl || '').includes(channel.baseUrlIncludes)) return true
    if (channel.nameIncludes && String(row.name || '').includes(channel.nameIncludes)) return true
    return String(row.provider || '').toLowerCase() === channel.provider
  }

  return rows.find(row => row.isActive && match(row))
    || rows.find(row => match(row))
    || null
}

export function resolveNarrationGrokConfigId(opts: {
  channel?: string | null
  model?: string | null
  config_id?: unknown
}): { channel: NarrationGrokChannelId; configId: number; model: string; provider: string } | null {
  const channel = getNarrationGrokChannelDef(opts.channel)
  const model = String(opts.model || '').trim() || channel.defaultModel
  const allowed = channel.models.some(m => m.id === model) || isGrokVideoModel(model)
  if (!allowed) return null

  if (opts.config_id != null) {
    const id = Number(opts.config_id)
    if (Number.isFinite(id)) {
      const cfg = getConfigById(id, { includeInactive: true })
      if (cfg) {
        return {
          channel: channel.id,
          configId: id,
          model,
          provider: String(cfg.provider || channel.provider),
        }
      }
    }
  }

  const row = findNarrationGrokChannelConfigRow(channel.id)
  if (!row?.id) return null
  return {
    channel: channel.id,
    configId: row.id,
    model,
    provider: String(row.provider || channel.provider),
  }
}

export function assertNarrationGrokApiKey(
  config: { apiKey?: string | null; name?: string | null } | null | undefined,
  channelLabel?: string,
) {
  if (!config || isPlaceholderApiKey(config.apiKey)) {
    const name = config?.name
      ? `「${config.name}」`
      : (channelLabel ? `${channelLabel} 配置` : 'Grok 上游配置')
    throw new Error(`${name}的 API Key 未配置或无效，请在「设置 → AI 配置」中填写`)
  }
}

export { NARRATION_GROK_CHANNELS, getNarrationGrokChannelDef, isGrokVideoModel }
