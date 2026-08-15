import { db, schema } from '../db/index.js'
import { getConfigById } from '../services/ai.js'
import { isPlaceholderApiKey } from './official-volcengine-video.js'
import {
  GROK_VIDEO_MODEL_IDS,
  GROK_VIDEO_MODELS,
  grokVideoDurationBounds,
  grokVideoModelLabel,
  isGrokVideoModel,
} from '../constants/geeknow-grok.js'
import {
  findNarrationGrokChannelConfigRow,
  listNarrationGrokChannelOptions,
  resolveNarrationGrokConfigId,
} from './narration-grok-channels.js'

function isGeeknowProvider(provider?: string | null) {
  return String(provider || '').toLowerCase() === 'geeknow'
}

export function listGeeknowServiceConfigRows() {
  return db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(row => isGeeknowProvider(row.provider))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))
}

export function findGeeknowVideoConfigRow() {
  const rows = listGeeknowServiceConfigRows()
  return rows.find(row => row.serviceType === 'video' && row.isActive)
    || rows.find(row => row.serviceType === 'video')
    || null
}

/** 视频未单独配置时，复用 GeekNow 图片通道的 Base URL / Key */
export function findGeeknowImageConfigRow() {
  const rows = listGeeknowServiceConfigRows()
  return rows.find(row => row.serviceType === 'image' && row.isActive)
    || rows.find(row => row.serviceType === 'image')
    || null
}

export function findGeeknowGrokVideoConfigRow() {
  return findNarrationGrokChannelConfigRow('geeknow')
    || findGeeknowVideoConfigRow()
    || findGeeknowImageConfigRow()
}

export function isGeeknowConfigId(configId: unknown) {
  const id = Number(configId)
  if (!Number.isFinite(id)) return false
  return listGeeknowServiceConfigRows().some(row => row.id === id)
}

export function isGrokVideoRequest(body: Record<string, unknown>) {
  if (body.grok === true || body.grok === 1 || body.grok === '1') return true
  return isGrokVideoModel(String(body.model || ''))
}

export function resolveGrokVideoConfigId(body: Record<string, unknown>): number | null {
  if (!isGrokVideoRequest(body)) return null
  const model = String(body.model || '').trim()
  if (!isGrokVideoModel(model)) return null

  const channel = String(body.grok_channel || body.channel || '').trim()
  if (channel) {
    return resolveNarrationGrokConfigId({
      channel,
      model,
      config_id: body.config_id,
    })?.configId ?? null
  }

  if (body.config_id != null) {
    const id = Number(body.config_id)
    if (Number.isFinite(id)) {
      // 允许三通道任一已配置 ID
      const cfg = getConfigById(id, { includeInactive: true })
      if (cfg) return id
    }
  }

  return findGeeknowGrokVideoConfigRow()?.id ?? null
}

export function assertGeeknowGrokApiKey(config: { apiKey?: string | null; name?: string | null } | null | undefined) {
  if (!config || isPlaceholderApiKey(config.apiKey)) {
    const name = config?.name ? `「${config.name}」` : 'GeekNow 配置'
    throw new Error(`${name}的 API Key 未配置或无效，请在「设置 → AI 配置」中填写 GeekNow API Key`)
  }
}

export function getGeeknowGrokVideoConfig() {
  const row = findGeeknowGrokVideoConfigRow()
  return row ? getConfigById(row.id, { includeInactive: true }) : null
}

export function listGrokVideoModelOptions(configId?: number | null) {
  return listLegacyGeeknowGrokModels(configId)
}

export {
  GROK_VIDEO_MODEL_IDS,
  isGrokVideoModel,
  listNarrationGrokChannelOptions,
  resolveNarrationGrokConfigId,
  findNarrationGrokChannelConfigRow,
}

// keep local fallback used by Grok studio page when no channel specified
export function listLegacyGeeknowGrokModels(configId?: number | null) {
  return [
    { id: GROK_VIDEO_MODELS.V1_5_PRO, label: grokVideoModelLabel(GROK_VIDEO_MODELS.V1_5_PRO) },
    { id: GROK_VIDEO_MODELS.V1_5_MAX, label: grokVideoModelLabel(GROK_VIDEO_MODELS.V1_5_MAX) },
    { id: GROK_VIDEO_MODELS.V3_PRO, label: grokVideoModelLabel(GROK_VIDEO_MODELS.V3_PRO) },
    { id: GROK_VIDEO_MODELS.V3_MAX, label: grokVideoModelLabel(GROK_VIDEO_MODELS.V3_MAX) },
  ].map(item => {
    const bounds = grokVideoDurationBounds(item.id)
    return {
      ...item,
      config_id: configId ?? null,
      duration_min: bounds.min,
      duration_max: bounds.max,
      duration_default: bounds.defaultSec,
    }
  })
}
