import { db, schema } from '../db/index.js'
import { SEEDANCE_MODELS } from '../constants/seedance.js'

const OFFICIAL_SEEDANCE_MODEL_IDS = [SEEDANCE_MODELS.V2_0, SEEDANCE_MODELS.V2_0_FAST] as const

export function isOfficialSeedanceModel(model: unknown) {
  return OFFICIAL_SEEDANCE_MODEL_IDS.includes(String(model || '') as typeof OFFICIAL_SEEDANCE_MODEL_IDS[number])
}

export function isOfficialVideoRequest(body: Record<string, unknown>) {
  if (body.official === true || body.official === 1 || body.official === '1') return true
  return isOfficialSeedanceModel(body.model)
}

export function listOfficialVolcengineConfigRows() {
  return db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(r => r.serviceType === 'video' && r.provider === 'volcengine')
    .filter(r => String(r.baseUrl || '').includes('ark.cn-beijing.volces.com'))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))
}

export function parseConfigModelIds(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : [String(parsed)]
  } catch {
    return [String(raw)]
  }
}

export function findOfficialVolcengineConfigRow() {
  const rows = listOfficialVolcengineConfigRows()
  return rows.find(r => r.isActive) || rows[0] || null
}

export function findOfficialVolcengineConfigForModel(model?: string | null) {
  const normalized = String(model || '').trim()
  const rows = listOfficialVolcengineConfigRows()
  if (!rows.length) return null
  if (normalized) {
    const matched = rows.find(row => parseConfigModelIds(row.model).includes(normalized))
    if (matched) return matched
  }
  return findOfficialVolcengineConfigRow()
}

export function isOfficialVolcengineConfigId(configId: unknown) {
  const id = Number(configId)
  if (!Number.isFinite(id)) return false
  return listOfficialVolcengineConfigRows().some(r => r.id === id)
}

/** 官方页请求：锁定火山方舟 config，忽略剧集/全局默认橙盟配置 */
export function resolveOfficialVideoConfigId(body: Record<string, unknown>): number | null {
  if (!isOfficialVideoRequest(body)) return null
  const model = String(body.model || '').trim()
  if (!isOfficialSeedanceModel(model)) return null

  if (body.config_id != null) {
    const id = Number(body.config_id)
    if (Number.isFinite(id) && isOfficialVolcengineConfigId(id)) return id
  }

  return findOfficialVolcengineConfigForModel(model)?.id ?? null
}

const PLACEHOLDER_API_KEY_MARKERS = [
  'REPLACE_WITH_YOUR_KEY',
  'YOUR_API_KEY',
  'your-api-key',
  '请填写',
  'placeholder',
]

export function isPlaceholderApiKey(apiKey?: string | null): boolean {
  const key = String(apiKey || '').trim()
  if (!key || key === '********') return true
  const upper = key.toUpperCase()
  return PLACEHOLDER_API_KEY_MARKERS.some(marker => upper.includes(marker.toUpperCase()))
}

export function assertOfficialVolcengineApiKey(config: { apiKey?: string | null; name?: string | null } | null | undefined) {
  if (!config || isPlaceholderApiKey(config.apiKey)) {
    const name = config?.name ? `「${config.name}」` : '火山方舟 Seedance 视频配置'
    throw new Error(`${name}的 API Key 未配置或无效，请管理员在「设置 → AI 配置」中填入火山方舟控制台生成的 API Key`)
  }
}
