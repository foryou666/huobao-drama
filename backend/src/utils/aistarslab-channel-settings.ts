import { getAppMeta, setAppMeta } from '../db/index.js'

export const AISTARSLAB_CHANNEL_ENABLED_META_KEY = 'aistarslab_channel_enabled'

export function parseAistarslabChannelFromCreditAction(action?: string | null): string | null {
  const m = String(action || '').match(/^video\.generate\.aistarslab\.(\d+)\./i)
  return m?.[1] ?? null
}

export function getAistarslabChannelEnabledMap(): Record<string, boolean> {
  const raw = getAppMeta(AISTARSLAB_CHANNEL_ENABLED_META_KEY)
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      out[String(key)] = value !== false
    }
    return out
  } catch {
    return {}
  }
}

/** 未配置时默认启用 */
export function isAistarslabChannelEnabled(channel?: string | null): boolean {
  const key = String(channel || '').trim()
  if (!key) return true
  const map = getAistarslabChannelEnabledMap()
  if (!(key in map)) return true
  return map[key] !== false
}

export function setAistarslabChannelEnabled(channel: string, enabled: boolean) {
  const key = String(channel || '').trim()
  if (!key) return
  const map = getAistarslabChannelEnabledMap()
  map[key] = enabled !== false
  setAppMeta(AISTARSLAB_CHANNEL_ENABLED_META_KEY, JSON.stringify(map))
}

export function filterEnabledAistarslabChannels<T extends { channel: string }>(channels: T[]): T[] {
  return channels.filter(item => isAistarslabChannelEnabled(item.channel))
}

export function applyAistarslabChannelVisibility<T extends { channels: Array<{ channel: string }> }>(config: T): T {
  return {
    ...config,
    channels: filterEnabledAistarslabChannels(config.channels),
  }
}

export function listAistarslabChannelSettings(channels: Array<{ channel: string; title?: string; description?: string }>) {
  const enabledMap = getAistarslabChannelEnabledMap()
  return channels.map(channel => ({
    channel: channel.channel,
    title: channel.title,
    description: channel.description,
    enabled: enabledMap[channel.channel] !== false,
  }))
}
