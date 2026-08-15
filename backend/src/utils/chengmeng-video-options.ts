import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import {
  CHENGMENT_DEFAULT_GROUP_ID,
  CHENGMENT_DEFAULT_MODEL_ID,
  CHENGMENT_DURATION_BOUNDS,
  CHENGMENT_DOC_URL,
  CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS,
  CHENGMENG_CHANNEL1_MAX_UPSTREAM_YUAN_PER_15S,
  CHENGMENG_CHANNEL1_BASE_USER_CREDITS,
  CHENGMENG_CHANNEL1_720P_YUAN_PER_SECOND,
  chengmengModelCreditAction,
  formatChengmengRefLimitsHint,
  isChengmengChannel1PreferredModel,
  isChengmengDynamicCreditAction,
  isChengmengProvider,
  parseChengmengRefLimits,
  resolveChengmengFixedCreditCost,
} from '../constants/chengmeng.js'
import {
  VIDEO_BILLING_SECONDS,
  computeUserCreditsFromUpstreamYuan,
} from '../constants/credit-actions.js'
import { getConfigById } from '../services/ai.js'
import { fetchChengmengVideoModels, type ChengmengRemoteModel } from '../services/chengmeng-client.js'
import { getActionCost, updateCreditPricing } from '../services/credits.js'
import { filterEnabledChengmengModels } from './chengmeng-model-settings.js'
import { isPlaceholderApiKey } from './official-volcengine-video.js'
import { normalizeChengmengDuration } from './chengmeng-content.js'

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

export function isChengmengConfigId(configId: unknown) {
  const id = Number(configId)
  if (!Number.isFinite(id)) return false
  return listChengmengVideoConfigRows().some(row => row.id === id)
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

/** 上游按秒（元/秒）→ 本站也按秒；元/次 → 本站按次 */
export function isChengmengPerSecondBilling(
  model?: Pick<ChengmengModelOption, 'unitLabel'> | null,
): boolean {
  return String(model?.unitLabel || '').includes('秒')
}

/** 将上游单价折算为 15 秒成本（元）：元/次按次计，元/秒 × 15 */
export function resolveChengmengUpstreamYuanPer15Seconds(model: Pick<ChengmengModelOption, 'id' | 'basePriceYuan' | 'unitLabel'>): number | null {
  const price = model.basePriceYuan
  if (price == null || !Number.isFinite(price) || price <= 0) {
    if (isChengmengChannel1PreferredModel(model.id)) {
      return CHENGMENG_CHANNEL1_720P_YUAN_PER_SECOND * VIDEO_BILLING_SECONDS
    }
    return null
  }
  if (isChengmengPerSecondBilling(model)) {
    return price * VIDEO_BILLING_SECONDS
  }
  return price
}

export function findChengmengModelOption(modelId?: string | null): ChengmengModelOption | null {
  const id = String(modelId || '').trim()
  if (!id) return null
  const pool = cachedRemoteModels?.length
    ? pickChengmengChannel1UiModels(cachedRemoteModels)
    : pickChengmengChannel1UiModels(fallbackChengmengModelOptions())
  return pool.find(item => item.id === id)
    || (cachedRemoteModels || []).find(item => item.id === id)
    || null
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

const CHANNEL1_UI_LABELS: Record<string, { label: string }> = {
  '91': { label: '官转满血 · 线路1' },
  '56': { label: '官转满血' },
  '55': { label: '官转 Fast' },
  '53': { label: 'Seedance 2.0 Fast' },
  '32': { label: 'Seedance 2.0' },
  '90': { label: '限时特价满血（已下线）' },
  '83': { label: '线路 83（已下线）' },
  '71': { label: '线路 71（已下线）' },
  '82': { label: '线路 82（已下线）' },
}

/** 去掉上游价格、推荐话术，只保留能力说明（勿向用户暴露上游单价） */
export function sanitizeChengmengChannel1Description(
  raw?: string | null,
  hint = '',
): string {
  let text = String(raw || '').trim()
  if (!text) return hint ? `支持${hint}` : ''

  text = text
    .replace(/\d+(?:\.\d+)?\s*元\s*(?:[/／]\s*)?(?:一)?(?:秒|条|次)?/gi, ' ')
    .replace(/\d+(?:\.\d+)?\s*[/／]\s*秒/gi, ' ')
    .replace(/(?:上游|成本|售价|定价|报价)\s*[:：]?\s*\d+(?:\.\d+)?\s*元?/gi, ' ')
    .replace(/推荐[!！]*/g, ' ')
    .replace(/[!！]{2,}/g, ' ')
    .replace(/[，,、；;]\s*(?=[，,、；;]|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[，,、；;\s]+|[，,、；;\s]+$/g, '')
    .trim()

  // 洗完只剩空壳时，回退到参考能力提示
  if (!text || /^[\s.。…·-]*$/.test(text)) {
    return hint ? `支持${hint}` : ''
  }
  return text
}

function enrichChengmengChannel1Model(item: ChengmengModelOption): ChengmengModelOption {
  const ui = CHANNEL1_UI_LABELS[item.id]
  const limits = parseChengmengRefLimits(item.description, item.label)
  const hint = formatChengmengRefLimitsHint(limits)
  const baseLabel = ui?.label || item.label
  const label = hint && !baseLabel.includes(`${limits.maxImages}图`)
    ? `${baseLabel}（${hint}）`
    : baseLabel
  // 9 图官转满血：强制能力说明，避免上游文案残留价格
  const description = item.id === '91'
    ? (hint ? `支持${hint} · 720p · 过人脸满血` : '支持9图3音频 · 720p · 过人脸满血')
    : (sanitizeChengmengChannel1Description(item.description, hint) || `支持${hint}`)
  return {
    ...item,
    label,
    description,
  }
}

/** 通道1 页面：只保留开通线路；有上游数据时不回退已下线线路 */
export function pickChengmengChannel1UiModels(models: ChengmengModelOption[]): ChengmengModelOption[] {
  const enabled = filterEnabledChengmengModels(models)
  const byId = new Map(enabled.map(item => [item.id, item]))
  const hasUpstream = enabled.length > 0
  const fallbackById = new Map(fallbackChengmengModelOptions().map(item => [item.id, item]))
  const preferred = CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS
    .map((id) => {
      const item = byId.get(id) || (!hasUpstream ? fallbackById.get(id) : undefined)
      return item ? enrichChengmengChannel1Model(item) : null
    })
    .filter((item): item is ChengmengModelOption => !!item)
  if (preferred.length) {
    return markChannel1DefaultOption(preferred)
  }
  if (hasUpstream) {
    return markChannel1DefaultOption(enabled.map(enrichChengmengChannel1Model))
  }
  return markChannel1DefaultOption(fallbackChengmengModelOptions().map(enrichChengmengChannel1Model))
}

function fallbackChengmengModelOptions(): ChengmengModelOption[] {
  const FALLBACK_PRICE: Record<string, { price: number; unit: string }> = {
    '91': { price: 0.52, unit: '元/秒' },
    '55': { price: 0.48, unit: '元/秒' },
    '56': { price: 0.58, unit: '元/秒' },
    '53': { price: 3.6, unit: '元/次' },
    '32': { price: 4.5, unit: '元/次' },
  }
  return normalizeChengmengRemoteModels(
    CHENGMENG_CHANNEL1_PREFERRED_MODEL_IDS.map((id, index) => {
      const ui = CHANNEL1_UI_LABELS[id]
      const pricing = FALLBACK_PRICE[id] || {
        price: CHENGMENG_CHANNEL1_720P_YUAN_PER_SECOND,
        unit: '元/秒',
      }
      const fallbackDesc = id === '91'
        ? '支持9图3音频 · 720p · 过人脸满血'
        : id === '32' || id === '53'
          ? '支持4图3视频1音频'
          : id === '55' || id === '56'
            ? '官转 · 过人脸 · 参考能力以线路说明为准'
            : '官转 · 参考能力以线路说明为准'
      return {
        id,
        name: ui?.label || `模型 ${id}`,
        description: fallbackDesc,
        base_price: pricing.price,
        unit_label: pricing.unit,
        groups: [{ group_id: CHENGMENT_DEFAULT_GROUP_ID, is_default: index === 0 }],
      }
    }),
  )
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

function defaultCreditCostForModel(model: ChengmengModelOption): number {
  const fixed = resolveChengmengFixedCreditCost(model.id)
  if (fixed != null) return fixed
  if (isChengmengPerSecondBilling(model)) {
    return defaultChengmengUserCreditsPerSecond(model) || 1
  }
  return computeChengmengUserCreditCost(model)
}

/** 本站用户积分（按条/15秒参考价）：固定价优先，否则上游 + 2 元 */
export function computeChengmengUserCreditCost(
  model: Pick<ChengmengModelOption, 'id' | 'basePriceYuan' | 'unitLabel'>,
  _minUpstreamYuan?: number | null,
  _baseCredits = CHENGMENG_CHANNEL1_BASE_USER_CREDITS,
): number {
  const fixed = resolveChengmengFixedCreditCost(model.id)
  if (fixed != null) return fixed
  const upstream = resolveChengmengUpstreamYuanPer15Seconds(model)
  return computeUserCreditsFromUpstreamYuan(upstream)
}

/** 按秒线路的用户单价（积分/秒；+2 元摊入 15 秒） */
export function defaultChengmengUserCreditsPerSecond(
  model: Pick<ChengmengModelOption, 'id' | 'basePriceYuan' | 'unitLabel'>,
): number | null {
  if (resolveChengmengFixedCreditCost(model.id) != null) return null
  if (!isChengmengPerSecondBilling(model)) return null
  const total15 = computeChengmengUserCreditCost(model)
  return Math.max(1, Math.round(total15 / VIDEO_BILLING_SECONDS))
}

function pricingDescriptionForModel(
  model: ChengmengModelOption,
  cost: number,
  perSecond = false,
): string {
  const fixed = resolveChengmengFixedCreditCost(model.id)
  if (fixed != null) {
    return `seedance通道1 · 橙盟 model_id=${model.id}（本站固定 ${fixed} 积分/条）`
  }
  if (perSecond) {
    const yuanPerSec = model.basePriceYuan != null && model.basePriceYuan > 0
      ? model.basePriceYuan
      : CHENGMENG_CHANNEL1_720P_YUAN_PER_SECOND
    return `seedance通道1 · 橙盟 model_id=${model.id}（上游 ${yuanPerSec} 元/秒；本站按秒=上游+2元摊入；当前约 ${cost} 积分/秒）`
  }
  const upstream = resolveChengmengUpstreamYuanPer15Seconds(model)
  const upstreamText = upstream != null && upstream > 0
    ? `${upstream.toFixed(2)} 元/次`
    : '上游按次计费'
  return `seedance通道1 · 橙盟 model_id=${model.id}（上游 ${upstreamText}；本站=上游+2元；当前 ${cost} 积分/条）`
}

/** 同步每个上游模型的积分定价（固定价优先；否则上游+2元；按秒线路存积分/秒） */
export function syncChengmengModelCreditPricing(models: ChengmengModelOption[]) {
  if (!models.length) return
  for (const model of models) {
    const action = chengmengModelCreditAction(model.id)
    const fixed = resolveChengmengFixedCreditCost(model.id)
    const perSecond = fixed == null && isChengmengPerSecondBilling(model)
    const cost = defaultCreditCostForModel(model)
    updateCreditPricing(
      action,
      cost,
      `橙盟 ${model.label}${perSecond ? '（按秒）' : ''}`,
      pricingDescriptionForModel(model, cost, perSecond),
    )
  }
}

/** @deprecated 请使用 syncChengmengModelCreditPricing */
export function ensureChengmengModelCreditPricing(models: ChengmengModelOption[]) {
  syncChengmengModelCreditPricing(models)
}

/** 通道1 用户实际扣费：固定价优先；按秒 = 单价×时长；按次 = 整条价 */
export function resolveChengmengUserCreditCost(
  modelId?: string | null,
  duration?: number | null,
): number {
  const fixed = resolveChengmengFixedCreditCost(modelId)
  if (fixed != null) return fixed

  const model = findChengmengModelOption(modelId)
    || (modelId
      ? ({
          id: String(modelId),
          basePriceYuan: null,
          unitLabel: null,
        } as ChengmengModelOption)
      : null)
  const action = chengmengModelCreditAction(modelId)
  const seconds = normalizeChengmengDuration(duration)

  if (model && isChengmengPerSecondBilling(model)) {
    const storedRate = getActionCost(action, 1)
    const rate = storedRate > 0
      ? storedRate
      : (defaultChengmengUserCreditsPerSecond(model) || 0)
    if (rate > 0) return Math.max(1, Math.round(rate * seconds))
    return computeChengmengUserCreditCost(model)
  }

  const stored = getActionCost(action, 1)
  if (stored > 0) return stored
  return model ? computeChengmengUserCreditCost(model) : computeUserCreditsFromUpstreamYuan(null)
}

export function listChengmengModelOptionsForApi(
  models: ChengmengModelOption[],
  configId: number | null,
) {
  return models.map((item) => {
    const limits = parseChengmengRefLimits(item.description, item.label)
    const fixed = resolveChengmengFixedCreditCost(item.id)
    const perSecond = fixed == null && isChengmengPerSecondBilling(item)
    const unitCost = getActionCost(item.creditAction, 1)
      || defaultCreditCostForModel(item)
    return {
      id: item.id,
      label: item.label,
      description: item.description,
      model_id: item.modelId,
      group_id: item.groupId,
      // 不对前台暴露上游单价
      base_price_yuan: null,
      unit_label: perSecond ? '积分/秒' : '积分/条',
      config_id: configId,
      billing_unit: perSecond ? 'per_second' : 'flat',
      billing_seconds: VIDEO_BILLING_SECONDS,
      duration_min: CHENGMENT_DURATION_BOUNDS.min,
      duration_max: CHENGMENT_DURATION_BOUNDS.max,
      duration_default: CHENGMENT_DURATION_BOUNDS.defaultSec,
      credit_action: item.creditAction,
      credit_cost: unitCost,
      credit_cost_flat: perSecond ? null : unitCost,
      credit_cost_per_second: perSecond ? unitCost : null,
      max_images: limits.maxImages,
      max_videos: limits.maxVideos,
      max_audios: limits.maxAudios,
      ref_limits_hint: formatChengmengRefLimitsHint(limits),
      default_option: !!item.defaultOption,
    }
  })
}
