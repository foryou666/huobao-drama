import { db, schema } from '../db/index.js'
import { getConfigById } from '../services/ai.js'
import { isPlaceholderApiKey } from './official-volcengine-video.js'
import { fetchAistarslabVideoConfig } from '../services/aistarslab-client.js'
import {
  AISTARSLAB_DEFAULT_CHANNEL,
  AISTARSLAB_DEFAULT_CREDIT_COST,
  AISTARSLAB_DEFAULT_MODEL,
  AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER,
  AISTARSLAB_USER_PRICE_MULTIPLIER,
  aistarslabModelCreditAction,
  isAistarslabProvider,
  isAistarslabVideoModel,
  normalizeAistarslabDuration,
  aistarslabModelLabel,
  sanitizeAistarslabChannelTitle,
  sanitizeAistarslabUserFacingText,
} from '../constants/aistarslab.js'
import { CREDIT_ACTIONS } from '../constants/credit-actions.js'
import { getActionCost, updateCreditPricing } from '../services/credits.js'
import { eq } from 'drizzle-orm'

export interface AistarslabModelOption {
  model: string
  label: string
  resolutions: string[]
  fixedTotalCredits: number | null
  creditsPerSecond: number | null
  defaultOption?: boolean
}

export interface AistarslabChannelOption {
  channel: string
  title: string
  description: string
  secondsMin: number
  secondsMax: number
  aspectRatios: string[]
  supportedModeTypes: string[]
  defaultOption?: boolean
  models: AistarslabModelOption[]
}

export interface AistarslabVideoConfig {
  channels: AistarslabChannelOption[]
  referenceVideoCreditsMultiplier: number
}

function isAistarslabConfigRow(row: { provider?: string | null }) {
  return isAistarslabProvider(row.provider)
}

export function listAistarslabVideoConfigRows() {
  return db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(row => row.serviceType === 'video' && isAistarslabConfigRow(row))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))
}

export function findAistarslabVideoConfigRow() {
  const rows = listAistarslabVideoConfigRows()
  return rows.find(row => row.isActive) || rows[0] || null
}

export function findAistarslabVideoConfig() {
  const row = findAistarslabVideoConfigRow()
  return row ? getConfigById(row.id, { includeInactive: true }) : null
}

export function isAistarslabConfigId(configId: unknown) {
  const id = Number(configId)
  if (!Number.isFinite(id)) return false
  return listAistarslabVideoConfigRows().some(row => row.id === id)
}

export function isAistarslabVideoRequest(body: Record<string, unknown>) {
  if (body.aistarslab === true || body.aistarslab === 1 || body.aistarslab === '1') return true
  return isAistarslabVideoModel(String(body.model || ''))
}

export function resolveAistarslabVideoConfigId(body: Record<string, unknown>): number | null {
  if (!isAistarslabVideoRequest(body)) return null
  if (body.config_id != null) {
    const id = Number(body.config_id)
    if (Number.isFinite(id) && isAistarslabConfigId(id)) return id
  }
  return findAistarslabVideoConfigRow()?.id ?? null
}

export function assertAistarslabApiKey(config: { apiKey?: string | null; name?: string | null } | null | undefined) {
  if (!config || isPlaceholderApiKey(config.apiKey)) {
    const name = config?.name ? `「${config.name}」` : 'Seedance VIP 配置'
    throw new Error(`${name}的 API Key 未配置或无效，请在「设置 → AI 配置」中填写 API Key`)
  }
}

function normalizeModelOption(raw: any): AistarslabModelOption | null {
  const model = String(raw?.model ?? '').trim()
  if (!model) return null
  const fixed = raw?.fixedTotalCredits
  const perSec = raw?.creditsPerSecond
  const fixedNum = fixed != null ? Number(fixed) : NaN
  const perSecNum = perSec != null ? Number(perSec) : NaN
  const resolutions = Array.isArray(raw?.resolutions)
    ? raw.resolutions.map((item: unknown) => String(item ?? '').trim().toLowerCase()).filter(Boolean)
    : []
  return {
    model,
    label: String(raw?.label ?? aistarslabModelLabel(model)).trim() || model,
    resolutions: resolutions.length ? resolutions : ['720p'],
    fixedTotalCredits: Number.isFinite(fixedNum) && fixedNum >= 0 ? Math.round(fixedNum) : null,
    creditsPerSecond: Number.isFinite(perSecNum) && perSecNum >= 0 ? perSecNum : null,
    defaultOption: !!raw?.defaultOption,
  }
}

function normalizeChannelOption(raw: any): AistarslabChannelOption | null {
  const channel = String(raw?.channel ?? '').trim()
  if (!channel) return null
  const models = (Array.isArray(raw?.models) ? raw.models : [])
    .map(normalizeModelOption)
    .filter(Boolean) as AistarslabModelOption[]
  if (!models.length) return null
  const secondsMin = Math.max(1, Math.round(Number(raw?.secondsMin ?? 4) || 4))
  const secondsMax = Math.max(secondsMin, Math.round(Number(raw?.secondsMax ?? 15) || 15))
  const aspectRatios = Array.isArray(raw?.aspectRatios)
    ? raw.aspectRatios.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
    : ['16:9', '9:16', '1:1']
  const rawTitle = String(raw?.title ?? channel).trim() || channel
  return {
    channel,
    title: sanitizeAistarslabChannelTitle(rawTitle) || rawTitle,
    description: sanitizeAistarslabUserFacingText(String(raw?.description ?? '').trim()),
    secondsMin,
    secondsMax,
    aspectRatios,
    supportedModeTypes: Array.isArray(raw?.supportedModeTypes)
      ? raw.supportedModeTypes.map((item: unknown) => String(item ?? '').trim()).filter(Boolean)
      : ['text2video', 'image2video'],
    defaultOption: !!raw?.defaultOption,
    models,
  }
}

export function normalizeAistarslabVideoConfig(raw: unknown): AistarslabVideoConfig {
  const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const multiplierRaw = Number((data as any).referenceVideoCreditsMultiplier)
  const referenceVideoCreditsMultiplier = Number.isFinite(multiplierRaw) && multiplierRaw > 0
    ? multiplierRaw
    : AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER
  const channels = (Array.isArray((data as any).channels) ? (data as any).channels : [])
    .map(normalizeChannelOption)
    .filter(Boolean) as AistarslabChannelOption[]
  return { channels, referenceVideoCreditsMultiplier }
}

export function resolveDefaultAistarslabSelection(config: AistarslabVideoConfig) {
  const channel = config.channels.find(item => item.defaultOption) || config.channels[0]
  if (!channel) {
    return { channel: AISTARSLAB_DEFAULT_CHANNEL, model: AISTARSLAB_DEFAULT_MODEL }
  }
  const model = channel.models.find(item => item.defaultOption)?.model || channel.models[0]?.model
  return { channel: channel.channel, model: model || AISTARSLAB_DEFAULT_MODEL }
}

export function computeAistarslabCreditCost(
  config: AistarslabVideoConfig,
  channelId: string,
  modelId: string,
  seconds?: number | null,
  hasReferenceVideo = false,
): number {
  const channel = config.channels.find(item => item.channel === channelId) || config.channels[0]
  const model = channel?.models.find(item => item.model === modelId) || channel?.models[0]
  const billedSeconds = normalizeAistarslabDuration(seconds)
  let cost = AISTARSLAB_DEFAULT_CREDIT_COST
  if (model?.fixedTotalCredits && model.fixedTotalCredits > 0) {
    cost = Math.round(model.fixedTotalCredits)
  } else if (model?.creditsPerSecond && model.creditsPerSecond > 0) {
    cost = Math.round(model.creditsPerSecond * billedSeconds)
  }
  if (hasReferenceVideo) {
    cost = Math.round(cost * config.referenceVideoCreditsMultiplier)
  }
  return Math.max(1, cost)
}

/** 上游参考价（不含用户倍率） */
export function computeAistarslabUpstreamCreditCost(
  config: AistarslabVideoConfig,
  channelId: string,
  modelId: string,
  seconds?: number | null,
  hasReferenceVideo = false,
): number {
  return computeAistarslabCreditCost(config, channelId, modelId, seconds, hasReferenceVideo)
}

function resolveAistarslabChannelModel(
  config: AistarslabVideoConfig,
  channelId: string,
  modelId: string,
) {
  const channel = config.channels.find(item => item.channel === channelId) || config.channels[0]
  const model = channel?.models.find(item => item.model === modelId) || channel?.models[0]
  return { channel, model }
}

export function defaultAistarslabUserCreditCost(
  config: AistarslabVideoConfig,
  channelId: string,
  modelId: string,
  seconds?: number | null,
): number {
  const { channel } = resolveAistarslabChannelModel(config, channelId, modelId)
  const billedSeconds = seconds ?? channel?.secondsMax ?? normalizeAistarslabDuration(undefined)
  const upstream = computeAistarslabUpstreamCreditCost(
    config,
    channelId,
    modelId,
    billedSeconds,
    false,
  )
  return Math.max(1, Math.round(upstream * AISTARSLAB_USER_PRICE_MULTIPLIER))
}

function pricingDescriptionForAistarslabModel(
  channel: AistarslabChannelOption,
  model: AistarslabModelOption,
  upstreamCost: number,
  userCost: number,
): string {
  const billingHint = model.fixedTotalCredits
    ? `上游 ${model.fixedTotalCredits} 积分/条`
    : model.creditsPerSecond
      ? `上游 ${model.creditsPerSecond} 积分/秒`
      : '上游按次'
  return `seedance通道3 · 线路 ${channel.channel} ${channel.title} · ${model.model}（${billingHint}，${channel.secondsMin}-${channel.secondsMax} 秒；默认用户价 ${userCost} 积分/次 = 上游约 ${upstreamCost} × ${AISTARSLAB_USER_PRICE_MULTIPLIER}）`
}

/** 为每条上游线路×模型同步积分定价项（默认用户价 = 上游 ×1.5） */
export function ensureAistarslabModelCreditPricing(config: AistarslabVideoConfig) {
  for (const channel of config.channels) {
    for (const model of channel.models) {
      const action = aistarslabModelCreditAction(channel.channel, model.model)
      const [existing] = db.select().from(schema.creditPricing)
        .where(eq(schema.creditPricing.action, action))
        .all()
      if (existing) continue

      const upstreamCost = computeAistarslabUpstreamCreditCost(
        config,
        channel.channel,
        model.model,
        channel.secondsMax,
        false,
      )
      let userCost = defaultAistarslabUserCreditCost(config, channel.channel, model.model, channel.secondsMax)
      if (
        channel.channel === AISTARSLAB_DEFAULT_CHANNEL
        && model.model === AISTARSLAB_DEFAULT_MODEL
      ) {
        const legacy = getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB, 1)
        if (legacy > 0) userCost = legacy
      }

      updateCreditPricing(
        action,
        userCost,
        `VIP ${channel.title} · ${model.label}`,
        pricingDescriptionForAistarslabModel(channel, model, upstreamCost, userCost),
      )
    }
  }
}

export function resolveAistarslabCreditAction(
  channel?: string | null,
  model?: string | null,
): string {
  return aistarslabModelCreditAction(channel, model)
}

export function isAistarslabSelectionAllowed(
  config: AistarslabVideoConfig,
  channelId?: string | null,
  modelId?: string | null,
): boolean {
  const channel = String(channelId || '').trim()
  const model = String(modelId || '').trim()
  if (!channel || !model) return false
  return config.channels.some(item =>
    item.channel === channel && item.models.some(entry => entry.model === model),
  )
}

export async function loadAistarslabVideoConfigFromProvider(config: { baseUrl?: string | null; apiKey?: string | null }) {
  const raw = await fetchAistarslabVideoConfig(config)
  return normalizeAistarslabVideoConfig(raw)
}

export function listAistarslabModelOptionsForApi(
  config: AistarslabVideoConfig,
  configId: number | null,
) {
  ensureAistarslabModelCreditPricing(config)
  return config.channels.flatMap((channel) =>
    channel.models.map((model) => {
      const creditAction = aistarslabModelCreditAction(channel.channel, model.model)
      const upstreamCost = computeAistarslabUpstreamCreditCost(
        config,
        channel.channel,
        model.model,
        channel.secondsMax,
        false,
      )
      const creditCost = getActionCost(creditAction, 1)
      const defaultUserCost = defaultAistarslabUserCreditCost(
        config,
        channel.channel,
        model.model,
        channel.secondsMax,
      )
      return {
        id: `${channel.channel}:${model.model}`,
        channel: channel.channel,
        channel_title: channel.title,
        channel_description: channel.description,
        label: model.label,
        model: model.model,
        option_key: `${channel.channel}:${model.model}`,
        config_id: configId,
        seconds_min: channel.secondsMin,
        seconds_max: channel.secondsMax,
        duration_default: Math.min(channel.secondsMax, Math.max(channel.secondsMin, 15)),
        aspect_ratios: channel.aspectRatios,
        supported_mode_types: channel.supportedModeTypes,
        billing_unit: model.fixedTotalCredits ? 'flat' : 'dynamic',
        credit_action: creditAction,
        credit_cost: creditCost > 0 ? creditCost : defaultUserCost,
        credit_cost_flat: creditCost > 0 ? creditCost : defaultUserCost,
        upstream_credit_cost: upstreamCost,
        default_user_credit_cost: defaultUserCost,
        credits_per_second: model.creditsPerSecond,
        fixed_total_credits: model.fixedTotalCredits,
        default_option: !!(channel.defaultOption && model.defaultOption),
      }
    }),
  )
}

export function bodyHasReferenceVideo(body: Record<string, unknown>): boolean {
  const refs = Array.isArray(body.content_refs) ? body.content_refs : []
  return refs.some((item: any) => String(item?.type || '').toLowerCase() === 'video')
}

/** 用户扣费：按线路×模型积分项 ×（含参考视频时 ×referenceVideoCreditsMultiplier） */
export function resolveAistarslabUserCreditCost(body: Record<string, unknown>): number {
  const channel = String(body.aistarslab_channel || body.channel || AISTARSLAB_DEFAULT_CHANNEL).trim()
  const model = String(body.model || AISTARSLAB_DEFAULT_MODEL).trim()
  const action = aistarslabModelCreditAction(channel, model)
  let base = getActionCost(action, 1)
  if (base <= 0) {
    base = getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB, 1)
  }
  if (!bodyHasReferenceVideo(body)) return Math.max(1, base)
  return Math.max(1, Math.round(base * AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER))
}

/** 上游线路参考价（仅供管理端展示，用户扣费见 resolveAistarslabUserCreditCost） */
export async function resolveAistarslabFlatCreditCost(
  config: { baseUrl?: string | null; apiKey?: string | null } | null | undefined,
  body: Record<string, unknown>,
): Promise<number> {
  const channel = String(body.aistarslab_channel || body.channel || AISTARSLAB_DEFAULT_CHANNEL).trim()
  const model = String(body.model || AISTARSLAB_DEFAULT_MODEL).trim()
  const seconds = body.duration != null ? Number(body.duration) : undefined
  const hasReferenceVideo = bodyHasReferenceVideo(body)
  if (!config?.apiKey) {
    return computeAistarslabCreditCost(
      { channels: [], referenceVideoCreditsMultiplier: AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER },
      channel,
      model,
      seconds,
      hasReferenceVideo,
    )
  }
  try {
    const remote = await loadAistarslabVideoConfigFromProvider(config)
    if (remote.channels.length) {
      return computeAistarslabCreditCost(remote, channel, model, seconds, hasReferenceVideo)
    }
  } catch {
    /* fallback below */
  }
  return computeAistarslabCreditCost(
    { channels: [], referenceVideoCreditsMultiplier: AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER },
    channel,
    model,
    seconds,
    hasReferenceVideo,
  )
}

/** @deprecated 使用 resolveAistarslabFlatCreditCost */
export const resolveAistarslabChargeQuantity = resolveAistarslabFlatCreditCost

export { isAistarslabVideoModel }
