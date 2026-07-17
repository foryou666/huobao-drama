import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  CHENGMENG_VIDEO_MODELS,
  CHENGMENT_DEFAULT_GROUP_ID,
  CHENGMENT_DEFAULT_MODEL_ID,
  CHENGMENT_DURATION_BOUNDS,
  CHENGMENT_DOC_URL,
  CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS,
  CHENGMENG_CHANNEL1_MAX_UPSTREAM_YUAN_PER_15S,
  CHENGMENG_CHANNEL1_BASE_USER_CREDITS,
  CHENGMENG_CHANNEL1_HIGH_TIER_THRESHOLD,
  CHENGMENG_CHANNEL1_HIGH_TIER_CAP,
  CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND,
  CHENGMENG_CHANNEL1_RESOLUTION,
  CHENGMENG_MODEL_70_CREDIT_COST,
  chengmengModelCreditAction,
  isChengmengDynamicCreditAction,
  isChengmengProvider,
} from '../constants/chengmeng.js'
import {
  VIDEO_BILLING_SECONDS,
} from '../constants/credit-actions.js'
import { getConfigById } from '../services/ai.js'
import { fetchChengmengVideoModels, type ChengmengRemoteModel } from '../services/chengmeng-client.js'
import { getActionCost, updateCreditPricing } from '../services/credits.js'
import { filterEnabledChengmengModels } from './chengmeng-model-settings.js'
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

/** 将上游单价折算为 15 秒成本（元）：元/次按次计，元/秒 × 15。通道1 catalog 价常为 720p，按 480p 实价覆盖。 */
export function resolveChengmengUpstreamYuanPer15Seconds(model: Pick<ChengmengModelOption, 'id' | 'basePriceYuan' | 'unitLabel'>): number | null {
  if (String(model.id || '').trim() === CHENGMENT_DEFAULT_MODEL_ID) {
    return CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND * VIDEO_BILLING_SECONDS
  }
  const price = model.basePriceYuan
  if (price == null || !Number.isFinite(price) || price <= 0) return null
  const unit = String(model.unitLabel || '').trim()
  if (unit.includes('秒')) {
    return price * VIDEO_BILLING_SECONDS
  }
  return price
}

export function isChengmengModelWithinChannel1UpstreamBudget(
  model: Pick<ChengmengModelOption, 'id' | 'basePriceYuan' | 'unitLabel'>,
  maxYuan = CHENGMENG_CHANNEL1_MAX_UPSTREAM_YUAN_PER_15S,
): boolean {
  const cost = resolveChengmengUpstreamYuanPer15Seconds(model)
  if (cost == null || cost <= 0) return false
  return cost <= maxYuan
}

function markChannel1DefaultOption(models: ChengmengModelOption[]): ChengmengModelOption[] {
  const next = models.map(item => ({
    ...item,
    defaultOption: item.id === CHENGMENT_DEFAULT_MODEL_ID,
  }))
  if (next.length && !next.some(item => item.defaultOption)) {
    next[0]!.defaultOption = true
  }
  return next
}

/** 通道1 页面：只对接 70（480p）；找不到时再按预算回退 */
export function pickChengmengChannel1UiModels(models: ChengmengModelOption[]): ChengmengModelOption[] {
  const enabled = filterEnabledChengmengModels(models)
  const byId = new Map(enabled.map(item => [item.id, item]))
  const preferred = CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS
    .map(id => byId.get(id))
    .filter((item): item is ChengmengModelOption => !!item)
    .map(item => ({
      ...item,
      label: item.id === CHENGMENT_DEFAULT_MODEL_ID ? '9图-满血' : item.label,
      description: item.id === CHENGMENT_DEFAULT_MODEL_ID
        ? '9 图全能参考 · 满血线路'
        : item.description,
      basePriceYuan: item.id === CHENGMENT_DEFAULT_MODEL_ID
        ? CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND
        : item.basePriceYuan,
      unitLabel: item.id === CHENGMENT_DEFAULT_MODEL_ID ? '元/秒' : item.unitLabel,
    }))
  if (preferred.length) {
    return markChannel1DefaultOption(preferred)
  }
  const budgeted = enabled
    .filter(item => isChengmengModelWithinChannel1UpstreamBudget(item))
    .map(item => ({ ...item }))
  if (!budgeted.length) return []
  return markChannel1DefaultOption(budgeted)
}

function fallbackChengmengModelOptions(): ChengmengModelOption[] {
  return normalizeChengmengRemoteModels([
    {
      id: CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST,
      name: '9图-满血',
      description: '9 图全能参考 · 满血线路',
      base_price: CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND,
      unit_label: '元/秒',
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
      ? pickChengmengChannel1UiModels(cachedRemoteModels)
      : pickChengmengChannel1UiModels(fallbackChengmengModelOptions())
  return allowed.some(item => item.id === normalized)
}

function defaultCreditCostForModel(model: ChengmengModelOption, minUpstreamYuan: number | null): number {
  if (model.id === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST) {
    return CHENGMENG_MODEL_70_CREDIT_COST
  }
  return computeChengmengUserCreditCost(model, minUpstreamYuan)
}

function resolveMinUpstreamYuanForChannel1(models: ChengmengModelOption[]): number | null {
  const pool = pickChengmengChannel1UiModels(models)
  const costs = (pool.length ? pool : models)
    .map(item => resolveChengmengUpstreamYuanPer15Seconds(item))
    .filter((value): value is number => value != null && value > 0)
  if (!costs.length) return null
  return Math.min(...costs)
}

/** 本站用户积分：750 起步，按上游 15 秒成本比例缩放；超过 1000 则按 950 */
export function computeChengmengUserCreditCost(
  model: Pick<ChengmengModelOption, 'id' | 'basePriceYuan' | 'unitLabel'>,
  minUpstreamYuan: number | null,
  baseCredits = CHENGMENG_CHANNEL1_BASE_USER_CREDITS,
): number {
  const upstream = resolveChengmengUpstreamYuanPer15Seconds(model)
  if (upstream == null || minUpstreamYuan == null || minUpstreamYuan <= 0) {
    return baseCredits
  }
  const scaled = Math.round(baseCredits * (upstream / minUpstreamYuan))
  let cost = Math.max(baseCredits, scaled)
  if (cost > CHENGMENG_CHANNEL1_HIGH_TIER_THRESHOLD) {
    cost = CHENGMENG_CHANNEL1_HIGH_TIER_CAP
  }
  return cost
}

function pricingDescriptionForModel(
  model: ChengmengModelOption,
  cost: number,
  minUpstreamYuan: number | null,
): string {
  if (model.id === CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST) {
    return `seedance通道1 · 橙盟 model_id=${model.id}（${VIDEO_BILLING_SECONDS} 秒/条，上游 ${CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND} 元/秒 ≈ ${CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND * VIDEO_BILLING_SECONDS} 元/条；本站固定 ${CHENGMENG_MODEL_70_CREDIT_COST} 积分/条）`
  }
  const upstream = resolveChengmengUpstreamYuanPer15Seconds(model)
  const upstreamText = upstream != null && upstream > 0
    ? `${upstream} 元/15秒`
    : '上游按次计费'
  const ratioText = upstream != null && minUpstreamYuan != null && minUpstreamYuan > 0
    ? `，比例 ${(upstream / minUpstreamYuan).toFixed(2)}×`
    : ''
  return `seedance通道1 · 橙盟 model_id=${model.id}（${VIDEO_BILLING_SECONDS} 秒/条，上游 ${upstreamText}${ratioText}；本站 ${CHENGMENG_CHANNEL1_BASE_USER_CREDITS} 积分起步，超 ${CHENGMENG_CHANNEL1_HIGH_TIER_THRESHOLD} 按 ${CHENGMENG_CHANNEL1_HIGH_TIER_CAP}，当前 ${cost} 积分/条）`
}

/** 同步每个上游模型的积分定价（750 起步，按上游 15 秒成本比例） */
export function syncChengmengModelCreditPricing(models: ChengmengModelOption[]) {
  if (!models.length) return
  const minUpstreamYuan = resolveMinUpstreamYuanForChannel1(models)
  for (const model of models) {
    const action = chengmengModelCreditAction(model.id)
    const cost = defaultCreditCostForModel(model, minUpstreamYuan)
    updateCreditPricing(
      action,
      cost,
      `橙盟 ${model.label}`,
      pricingDescriptionForModel(model, cost, minUpstreamYuan),
    )
  }
}

/** @deprecated 请使用 syncChengmengModelCreditPricing */
export function ensureChengmengModelCreditPricing(models: ChengmengModelOption[]) {
  syncChengmengModelCreditPricing(models)
}

export function listChengmengModelOptionsForApi(
  models: ChengmengModelOption[],
  configId: number | null,
) {
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
