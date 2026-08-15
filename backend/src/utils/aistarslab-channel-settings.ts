import { getAppMeta, setAppMeta } from '../db/index.js'
import {
  AISTARSLAB_CHANNEL3_PREFERRED_CHANNEL_IDS,
  AISTARSLAB_MAX_UPSTREAM_DISPLAY_CREDITS,
} from '../constants/aistarslab.js'
import { filterAistarslabConfigForDisplay } from './aistarslab-video-options.js'
import { now } from './response.js'

export const AISTARSLAB_CHANNEL_ENABLED_META_KEY = 'aistarslab_channel_enabled'
const CHANNEL3_PREFERRED_ENABLE_MIGRATION_KEY = 'aistarslab_channel3_preferred_50_53_48_v1'

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

/** 通道3 前台改为开通 50/53/48 */
export function migrateAistarslabChannel3PreferredEnableIfNeeded() {
  if (getAppMeta(CHANNEL3_PREFERRED_ENABLE_MIGRATION_KEY)) return
  const map = getAistarslabChannelEnabledMap()
  for (const id of ['47', '49']) map[id] = false
  for (const id of AISTARSLAB_CHANNEL3_PREFERRED_CHANNEL_IDS) map[id] = true
  setAppMeta(AISTARSLAB_CHANNEL_ENABLED_META_KEY, JSON.stringify(map))
  setAppMeta(CHANNEL3_PREFERRED_ENABLE_MIGRATION_KEY, now())
}

export function filterEnabledAistarslabChannels<T extends { channel: string }>(channels: T[]): T[] {
  return channels.filter(item => isAistarslabChannelEnabled(item.channel))
}

export function applyAistarslabChannelVisibility<T extends { channels: Array<{ channel: string }> }>(config: T): T {
  const displayFiltered = filterAistarslabConfigForDisplay(config as any, AISTARSLAB_MAX_UPSTREAM_DISPLAY_CREDITS)
  return {
    ...displayFiltered,
    channels: filterEnabledAistarslabChannels(displayFiltered.channels),
  } as unknown as T
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
