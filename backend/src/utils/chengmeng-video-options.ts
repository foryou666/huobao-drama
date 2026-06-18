import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  CHENGMENG_VIDEO_MODELS,
  CHENGMENT_DEFAULT_GROUP_ID,
  CHENGMENT_DEFAULT_MODEL_ID,
  CHENGMENT_DURATION_BOUNDS,
  CHENGMENT_DOC_URL,
  chengmengModelCreditAction,
  isChengmengDynamicCreditAction,
  isChengmengProvider,
} from '../constants/chengmeng.js'
import {
  CREDITS_PER_YUAN,
  VIDEO_BILLING_SECONDS,
} from '../constants/credit-actions.js'
import { getConfigById } from '../services/ai.js'
import { fetchChengmengVideoModels, type ChengmengRemoteModel } from '../services/chengmeng-client.js'
import { getActionCost, updateCreditPricing } from '../services/credits.js'
import { isPlaceholderApiKey } from './official-volcengine-video.js'

export interface ChengmengModelOption {
  id: string
  label: string
  description: string
  modelId: string
  groupId: string
  basePriceYuan: number | null
  unitLabel: string | null
  creditAction: string
  defaultOption?: boolean
}

let cachedRemoteModels: ChengmengModelOption[] | null = null
let cachedRemoteModelsAt = 0
const REMOTE_MODEL_CACHE_MS = 5 * 60 * 1000

export function listChengmengVideoConfigRows() {
  return db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.serviceType, 'video'))
    .all()
    .filter(row => isChengmengProvider(row.provider))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.id || 0) - (b.id || 0))
}

export function findChengmengVideoConfigRow() {
  const rows = listChengmengVideoConfigRows()
  return rows.find(row => row.isActive) || rows[0] || null
}

export function findChengmengVideoConfig() {
  const row = findChengmengVideoConfigRow()
  return row ? getConfigById(row.id, { includeInactive: true }) : null
}

export function resolveChengmengCreditAction(modelId?: string | null): string {
  return chengmengModelCreditAction(modelId)
}

export { isChengmengDynamicCreditAction, CHENGMENT_DOC_URL }

function resolveDefaultGroupId(model: ChengmengRemoteModel): string {
  const groups = Array.isArray(model.groups) ? model.groups : []
  const preferred = groups.find(item => item.is_default) || groups[0]
  return String(preferred?.group_id ?? CHENGMENT_DEFAULT_GROUP_ID).trim()
}

export function normalizeChengmengRemoteModels(raw: ChengmengRemoteModel[]): ChengmengModelOption[] {
  const seen = new Set<string>()
  const models: ChengmengModelOption[] = []
  for (const item of raw) {
    const id = String(item.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      label: String(item.name || item.code || `模型 ${id}`).trim(),
      description: String(item.description || '').trim(),
      modelId: id,
      groupId: resolveDefaultGroupId(item),
      basePriceYuan: Number.isFinite(Number(item.base_price)) ? Number(item.base_price) : null,
      unitLabel: item.unit_label ? String(item.unit_label) : null,
      creditAction: chengmengModelCreditAction(id),
      defaultOption: id === CHENGMENT_DEFAULT_MODEL_ID,
    })
  }
  if (models.length && !models.some(item => item.defaultOption)) {
    models[0].defaultOption = true
  }
  return models
}

function fallbackChengmengModelOptions(): ChengmengModelOption[] {
  return normalizeChengmengRemoteModels([
    {
      id: CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST,
      name: 'Seedance 2.0 Fast',
      description: '快速版',
      base_price: 8,
      unit_label: '元/次',
      groups: [{ group_id: CHENGMENT_DEFAULT_GROUP_ID, is_default: true }],
    },
    {
      id: CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0,
      name: 'Seedance 2.0',
      description: '标准版',
      base_price: 9,
      unit_label: '元/次',
      groups: [{ group_id: CHENGMENT_DEFAULT_GROUP_ID, is_default: true }],
    },
  ])
}

export async function loadChengmengVideoModelsFromProvider(
  config: { baseUrl?: string | null; apiKey?: string | null },
): Promise<ChengmengModelOption[]> {
  if (!config.apiKey || isPlaceholderApiKey(config.apiKey)) {
    return fallbackChengmengModelOptions()
  }
  const raw = await fetchChengmengVideoModels({
    baseUrl: config.baseUrl || undefined,
    apiKey: config.apiKey,
  })
  const models = normalizeChengmengRemoteModels(raw)
  return models.length ? models : fallbackChengmengModelOptions()
}

export async function getChengmengVideoModelOptions(
  config?: { baseUrl?: string | null; apiKey?: string | null } | null,
  options?: { refresh?: boolean },
): Promise<ChengmengModelOption[]> {
  const now = Date.now()
  if (!options?.refresh && cachedRemoteModels && now - cachedRemoteModelsAt < REMOTE_MODEL_CACHE_MS) {
    return cachedRemoteModels
  }
  const row = findChengmengVideoConfigRow()
  const source = config || row
  if (!source?.apiKey || isPlaceholderApiKey(source.apiKey)) {
    cachedRemoteModels = fallbackChengmengModelOptions()
    cachedRemoteModelsAt = now
    return cachedRemoteModels
  }
  try {
    cachedRemoteModels = await loadChengmengVideoModelsFromProvider(source)
    cachedRemoteModelsAt = now
    return cachedRemoteModels
  } catch {
    cachedRemoteModels = fallbackChengmengModelOptions()
    cachedRemoteModelsAt = now
    return cachedRemoteModels
  }
}

export function isChengmengVideoModelAllowed(
  modelId?: string | null,
  allowedModels?: ChengmengModelOption[] | null,
): boolean {
  const normalized = String(modelId || '').trim()
  if (!normalized) return false
  const allowed = allowedModels?.length
    ? allowedModels
    : cachedRemoteModels?.length
      ? cachedRemoteModels
      : fallbackChengmengModelOptions()
  return allowed.some(item => item.id === normalized)
}

function legacyCreditCostForModel(modelId: string): number | null {
  if (modelId === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST) {
    return getActionCost('video.generate.chengmeng', 1)
  }
  if (modelId === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0) {
    return getActionCost('video.generate.chengmeng_seedance2', 1)
  }
  return null
}

function defaultCreditCostForModel(model: ChengmengModelOption): number {
  const legacy = legacyCreditCostForModel(model.id)
  if (legacy != null && legacy > 0) return legacy
  if (model.basePriceYuan != null && model.basePriceYuan > 0) {
    return Math.max(1, Math.round(model.basePriceYuan * CREDITS_PER_YUAN))
  }
  return 800
}

function pricingDescriptionForModel(model: ChengmengModelOption, cost: number): string {
  const upstream = model.basePriceYuan != null && model.basePriceYuan > 0
    ? `上游约 ${model.basePriceYuan} 元/条`
    : '上游按次计费'
  return `seedance通道1 · 橙盟 model_id=${model.id} / group_id=${model.groupId}（${VIDEO_BILLING_SECONDS} 秒/条，${upstream}，默认 ${cost} 积分/条）`
}

/** 确保每个上游模型在积分管理中都有可编辑的定价项 */
export function ensureChengmengModelCreditPricing(models: ChengmengModelOption[]) {
  for (const model of models) {
    const action = chengmengModelCreditAction(model.id)
    const [existing] = db.select().from(schema.creditPricing)
      .where(eq(schema.creditPricing.action, action))
      .all()
    if (existing) continue

    const cost = defaultCreditCostForModel(model)
    updateCreditPricing(
      action,
      cost,
      `橙盟 ${model.label}`,
      pricingDescriptionForModel(model, cost),
    )
  }
}

export function listChengmengModelOptionsForApi(
  models: ChengmengModelOption[],
  configId: number | null,
) {
  ensureChengmengModelCreditPricing(models)
  return models.map(item => ({
    id: item.id,
    label: item.label,
    description: item.description,
    model_id: item.modelId,
    group_id: item.groupId,
    base_price_yuan: item.basePriceYuan,
    unit_label: item.unitLabel,
    config_id: configId,
    billing_unit: 'flat',
    billing_seconds: VIDEO_BILLING_SECONDS,
    duration_min: CHENGMENT_DURATION_BOUNDS.min,
    duration_max: CHENGMENT_DURATION_BOUNDS.max,
    duration_default: CHENGMENT_DURATION_BOUNDS.defaultSec,
    credit_action: item.creditAction,
    credit_cost: getActionCost(item.creditAction, 1),
    credit_cost_flat: getActionCost(item.creditAction, 1),
    default_option: !!item.defaultOption,
  }))
}
