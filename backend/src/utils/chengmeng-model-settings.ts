import { getAppMeta, setAppMeta } from '../db/index.js'
import { CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS, CHENGMENG_VIDEO_MODELS } from '../constants/chengmeng.js'
import { now } from './response.js'

export const CHENGMENT_MODEL_ENABLED_META_KEY = 'chengmeng_model_enabled'
const CHANNEL1_PREFERRED_ENABLE_MIGRATION_KEY = 'chengmeng_channel1_preferred_55_56_v2'

/** 从积分 action 解析橙盟 model_id（含 53/32 历史键） */
export function parseChengmengModelFromCreditAction(action?: string | null): string | null {
  const key = String(action || '').trim()
  if (key === 'video.generate.chengmeng') return CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST
  if (key === 'video.generate.chengmeng_seedance2') return CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0
  const m = key.match(/^video\.generate\.chengmeng\.(\d+)$/i)
  return m?.[1] ?? null
}

export function isChengmengModelCreditAction(action?: string | null): boolean {
  return parseChengmengModelFromCreditAction(action) != null
}

export function getChengmengModelEnabledMap(): Record<string, boolean> {
  const raw = getAppMeta(CHENGMENT_MODEL_ENABLED_META_KEY)
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
export function isChengmengModelEnabled(modelId?: string | null): boolean {
  const key = String(modelId || '').trim()
  if (!key) return true
  const map = getChengmengModelEnabledMap()
  if (!(key in map)) return true
  return map[key] !== false
}

export function setChengmengModelEnabled(modelId: string, enabled: boolean) {
  const key = String(modelId || '').trim()
  if (!key) return
  const map = getChengmengModelEnabledMap()
  map[key] = enabled !== false
  setAppMeta(CHENGMENT_MODEL_ENABLED_META_KEY, JSON.stringify(map))
}

/** 通道1 开通 55/56（官转），其余首选保持开启 */
export function migrateChengmengChannel1PreferredEnableIfNeeded() {
  if (getAppMeta(CHANNEL1_PREFERRED_ENABLE_MIGRATION_KEY)) return
  const map = getChengmengModelEnabledMap()
  for (const id of CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS) map[id] = true
  setAppMeta(CHENGMENT_MODEL_ENABLED_META_KEY, JSON.stringify(map))
  setAppMeta(CHANNEL1_PREFERRED_ENABLE_MIGRATION_KEY, now())
}

export function filterEnabledChengmengModels<T extends { id: string }>(models: T[]): T[] {
  return models.filter(item => isChengmengModelEnabled(item.id))
}
