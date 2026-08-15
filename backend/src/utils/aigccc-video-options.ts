import { db, schema } from '../db/index.js'
import { getConfigById } from '../services/ai.js'
import { isPlaceholderApiKey } from './official-volcengine-video.js'
import { getActionCost } from '../services/credits.js'
import {
  AIGCCC_DEFAULT_MODE,
  AIGCCC_DURATION_BOUNDS,
  AIGCCC_MINI_CREDIT_COST,
  AIGCCC_MODES,
  AIGCCC_PRO_CREDIT_COST,
  AIGCCC_REF_LIMITS,
  aigcccModeCreditAction,
  aigcccModeLabel,
  isAigcccProvider,
  isAigcccVideoModel,
  normalizeAigcccMode,
  type AigcccMode,
} from '../constants/aigccc.js'

export { isAigcccVideoModel, normalizeAigcccMode }

export function listAigcccVideoConfigRows() {
  return db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(row => row.serviceType === 'video' && isAigcccProvider(row.provider))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))
}

export function findAigcccVideoConfigRow() {
  const rows = listAigcccVideoConfigRows()
  return rows.find(row => row.isActive) || rows[0] || null
}

export function findAigcccVideoConfig() {
  const row = findAigcccVideoConfigRow()
  return row ? getConfigById(row.id, { includeInactive: true }) : null
}

export function isAigcccConfigId(configId: unknown) {
  const id = Number(configId)
  if (!Number.isFinite(id)) return false
  return listAigcccVideoConfigRows().some(row => row.id === id)
}

export function isAigcccVideoRequest(body: Record<string, unknown>) {
  if (body.aigccc === true || body.aigccc === 1 || body.aigccc === '1') return true
  if (!isAigcccVideoModel(String(body.model || ''))) return false
  // 已显式带了其它通道 config_id（如通道1）时，勿按 model 名误判为 S通道6
  if (body.config_id != null && !isAigcccConfigId(body.config_id)) return false
  return true
}

export function resolveAigcccVideoConfigId(body: Record<string, unknown>): number | null {
  if (!isAigcccVideoRequest(body)) return null
  if (body.config_id != null) {
    const id = Number(body.config_id)
    if (Number.isFinite(id) && isAigcccConfigId(id)) return id
  }
  return findAigcccVideoConfigRow()?.id ?? null
}

export function assertAigcccApiKey(config: { apiKey?: string | null; name?: string | null } | null | undefined) {
  if (!config || isPlaceholderApiKey(config.apiKey)) {
    const name = config?.name ? `「${config.name}」` : 'S通道6 配置'
    throw new Error(`${name}的 API Key 未配置或无效，请在「设置 → AI 配置」中填写 API Key`)
  }
}

export function resolveAigcccCreditAction(model?: string | null) {
  return aigcccModeCreditAction(model)
}

export function resolveAigcccUserCreditCost(model?: string | null): number {
  const action = resolveAigcccCreditAction(model)
  const cost = getActionCost(action)
  if (Number.isFinite(cost) && cost >= 0) return Math.round(cost)
  return normalizeAigcccMode(model) === AIGCCC_MODES.PRO
    ? AIGCCC_PRO_CREDIT_COST
    : AIGCCC_MINI_CREDIT_COST
}

export function listAigcccModeOptions() {
  const modes: AigcccMode[] = [AIGCCC_MODES.MINI, AIGCCC_MODES.PRO]
  return modes.map((mode) => {
    const cost = resolveAigcccUserCreditCost(mode)
    return {
      id: mode,
      label: aigcccModeLabel(mode),
      credit_cost: cost,
      description: mode === AIGCCC_MODES.PRO
        ? `S2.0满血 · ${cost} 积分/条`
        : `S2.0 fast · ${cost} 积分/条`,
    }
  })
}

export function getAigcccVideoOptionsPayload() {
  const row = findAigcccVideoConfigRow()
  const configured = !!(row && row.apiKey && !isPlaceholderApiKey(row.apiKey) && row.isActive)
  return {
    configured,
    config_id: row?.id ?? null,
    provider: 'aigccc',
    default_mode: AIGCCC_DEFAULT_MODE,
    duration_min: AIGCCC_DURATION_BOUNDS.min,
    duration_max: AIGCCC_DURATION_BOUNDS.max,
    duration_default: AIGCCC_DURATION_BOUNDS.defaultSec,
    ref_limits: AIGCCC_REF_LIMITS,
    models: listAigcccModeOptions(),
  }
}
