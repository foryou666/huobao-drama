import { isChengmengProvider, CHENGMENG_VIDEO_MODELS, CHENGMENG_MODEL_70_CREDIT_COST, CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND, chengmengModelCreditAction } from './chengmeng.js'
import { SEEDANCE_MODELS, seedanceDurationBounds } from './seedance.js'
import { isGrokVideoModel, GROK_VIDEO_MODELS, GROK_VIDEO_CREDIT_COST, resolveGrokBillingSeconds } from './geeknow-grok.js'
import { isJimengVideoModel, JIMENG_CREDITS_PER_SECOND, JIMENG_SEEDANCE_2_0_CREDIT_COST, JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST, JIMENG_SEEDANCE_2_0_FAST_LIST_CREDIT_COST, JIMENG_SEEDANCE_2_0_WITH_REF_VIDEO_CREDIT_COST, JIMENG_SEEDANCE_2_5_CREDIT_COST, SEEDANCE_25_USER_REF_VIDEO_MULTIPLIER, resolveJimengBillingSeconds, resolveJimengVideoCreditAction } from './jimeng-web.js'
import {
  isXyqPerSecondBilling,
  isXyqVideoModel,
  XYQ_FAST_VIP_CREDIT_COST,
  XYQ_MINI_CREDIT_COST,
  XYQ_MINI_TRIAL_CREDIT_COST,
  XYQ_SEEDANCE_2_5_CREDITS_PER_SECOND,
  XYQ_VIP_CREDIT_COST,
  normalizeXyqDuration,
  resolveXyqVideoCreditAction,
} from './xyq-web.js'
import {
  isCozeVideoModel,
  COZE_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND,
  COZE_SEEDANCE_2_0_CREDITS_PER_SECOND,
  normalizeCozeDuration,
  resolveCozeVideoCreditAction,
} from './coze-web.js'
import {
  isFunshionVideoModel,
  FUNSHION_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND,
  FUNSHION_SEEDANCE_2_0_CREDITS_PER_SECOND,
  normalizeFunshionDuration,
  resolveFunshionVideoCreditAction,
} from './funshion-web.js'
import {
  isXingyuemengVideoModel,
  XINGYUEMENG_DURATION_BOUNDS,
  XINGYUEMENG_SEEDANCE_2_5_CREDITS_PER_SECOND,
  XINGYUEMENG_SEEDANCE_2_0_MINI_CREDITS_PER_SECOND,
  XINGYUEMENG_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND,
  XINGYUEMENG_SEEDANCE_2_0_PRO_CREDITS_PER_SECOND,
  XINGYUEMENG_VIDEO_MODELS,
  normalizeXingyuemengDuration,
  normalizeXingyuemengResolution,
  resolveXingyuemengUserCreditCost,
  resolveXingyuemengVideoCreditAction,
} from './xingyuemeng-web.js'
import { isDoubaoTrainingVideoModel } from './doubao-training.js'
import { isAistarslabProvider, AISTARSLAB_DEFAULT_CREDIT_COST, AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER } from './aistarslab.js'
import {
  AIGCCC_MINI_CREDIT_COST,
  AIGCCC_PRO_CREDIT_COST,
  aigcccModeCreditAction,
  isAigcccProvider,
  isAigcccVideoModel,
  normalizeAigcccDuration,
  normalizeAigcccMode,
} from './aigccc.js'

/** 积分操作键 — 管理员可在设置中调整单价 */
export const CREDIT_ACTIONS = {
  AGENT_RUN: 'agent.run',
  ASSISTANT_CHAT: 'assistant.chat',
  IMAGE_GENERATE: 'image.generate',
  IMAGE_GENERATE_NANO_BANANA_2: 'image.generate.nano_banana_2',
  IMAGE_GENERATE_APIMART: 'image.generate.apimart',
  IMAGE_GENERATE_APIMART_1K: 'image.generate.apimart.1k',
  IMAGE_GENERATE_APIMART_2K: 'image.generate.apimart.2k',
  IMAGE_GENERATE_DREAM50_PRO_1K: 'image.generate.dream50_pro.1k',
  IMAGE_GENERATE_DREAM50_PRO_2K: 'image.generate.dream50_pro.2k',
  IMAGE_GENERATE_DREAM50_PRO_4K: 'image.generate.dream50_pro.4k',
  CHARACTER_IMAGE: 'character.image',
  CHARACTER_TRANSFORM: 'character.image.transform',
  CHARACTER_OUTFIT: 'character.image.outfit',
  CHARACTER_VOICE_SAMPLE: 'character.voice_sample',
  SCENE_IMAGE: 'scene.image',
  STORYBOARD_TTS: 'storyboard.tts',
  VIDEO_GENERATE: 'video.generate',
  VIDEO_GENERATE_SEEDANCE_2_0: 'video.generate.seedance2',
  VIDEO_GENERATE_SEEDANCE_2_0_FAST: 'video.generate.seedance2_fast',
  /** 通道2 Seedance 2.0 Mini（与通道9 同价矩阵） */
  VIDEO_GENERATE_SEEDANCE_2_0_MINI: 'video.generate.seedance2_mini',
  /** 通道2 Fast 超分（720p；历史项，实际扣费已并入 Fast 时长×分辨率一口价） */
  VIDEO_GENERATE_SEEDANCE_2_0_FAST_HD: 'video.generate.seedance2_fast_hd',
  /** 通道2 官方 Seedance 2.5 */
  VIDEO_GENERATE_SEEDANCE_2_5: 'video.generate.seedance25',
  VIDEO_GENERATE_CHENGMENT: 'video.generate.chengmeng',
  VIDEO_GENERATE_CHENGMENG_SEEDANCE_2_0: 'video.generate.chengmeng_seedance2',
  VIDEO_GENERATE_GROK_1_5_PRO: 'video.generate.grok.1_5_pro',
  VIDEO_GENERATE_GROK_1_5_MAX: 'video.generate.grok.1_5_max',
  VIDEO_GENERATE_GROK_3_PRO: 'video.generate.grok.3_pro',
  VIDEO_GENERATE_GROK_3_MAX: 'video.generate.grok.3_max',
  VIDEO_GENERATE_JIMENG: 'video.generate.jimeng',
  VIDEO_GENERATE_JIMENG_SEEDANCE_2_0_FAST: 'video.generate.jimeng.seedance2_fast',
  VIDEO_GENERATE_JIMENG_SEEDANCE_2_0: 'video.generate.jimeng.seedance2',
  VIDEO_GENERATE_JIMENG_SEEDANCE_2_5: 'video.generate.jimeng.seedance25',
  VIDEO_GENERATE_XYQ_MINI_TRIAL: 'video.generate.xyq.mini_trial',
  VIDEO_GENERATE_XYQ_MINI: 'video.generate.xyq.mini',
  VIDEO_GENERATE_XYQ_SEEDANCE_2_0_FAST: 'video.generate.xyq.seedance2_fast',
  VIDEO_GENERATE_XYQ_SEEDANCE_2_0: 'video.generate.xyq.seedance2',
  VIDEO_GENERATE_XYQ_SEEDANCE_2_5: 'video.generate.xyq.seedance25',
  VIDEO_GENERATE_COZE_SEEDANCE_2_0_FAST: 'video.generate.coze.seedance2_fast',
  VIDEO_GENERATE_COZE_SEEDANCE_2_0: 'video.generate.coze.seedance2',
  VIDEO_GENERATE_FUNSHION_SEEDANCE_2_0_FAST: 'video.generate.funshion.seedance2_fast',
  VIDEO_GENERATE_FUNSHION_SEEDANCE_2_0: 'video.generate.funshion.seedance2',
  VIDEO_GENERATE_XINGYUEMENG_SEEDANCE_2_5: 'video.generate.xingyuemeng.seedance2_5',
  VIDEO_GENERATE_XINGYUEMENG_SEEDANCE_2_0_MINI: 'video.generate.xingyuemeng.seedance2_mini',
  VIDEO_GENERATE_XINGYUEMENG_SEEDANCE_2_0_FAST: 'video.generate.xingyuemeng.seedance2_fast',
  VIDEO_GENERATE_XINGYUEMENG_SEEDANCE_2_0_PRO: 'video.generate.xingyuemeng.seedance2_pro',
  VIDEO_GENERATE_DOUBAO_TRAINING: 'video.generate.doubao_training',
  VIDEO_GENERATE_AISTARSLAB: 'video.generate.aistarslab',
  VIDEO_GENERATE_AIGCCC_MINI: 'video.generate.aigccc.mini',
  VIDEO_GENERATE_AIGCCC_PRO: 'video.generate.aigccc.pro',
  GRID_GENERATE: 'grid.generate',
  GRID_PROMPT: 'grid.prompt',
  PORTRAIT_SYNC: 'portrait.sync',
  STORYBOARD_BLOCKING: 'storyboard.blocking',
  MUSIC_GENERATE_SUNO: 'music.generate.suno',
  VIDEO_UPSCALE_SEEDVR2: 'video.upscale.seedvr2',
  VIDEO_UPSCALE_FUNSHION_2K: 'video.upscale.funshion.2k',
  SUBTITLE_ERASE: 'subtitle.erase',
} as const

export type CreditAction = typeof CREDIT_ACTIONS[keyof typeof CREDIT_ACTIONS]

export interface CreditActionDef {
  action: CreditAction
  label: string
  defaultCost: number
  description: string
}

/** 充值换算：1 元 = 100 积分 */
export const CREDITS_PER_YUAN = 100

/** 用户视频类消耗最低积分（每次生成；培训通道除外） */
export const MIN_USER_VIDEO_CREDIT_COST = 750

/**
 * 通道1 / 通道3 用户定价：本站 = 上游 + 2 元（再换算为积分）
 */
export const VIDEO_UPSTREAM_MARKUP_YUAN = 2
/** @deprecated 已取消「≤5.5元固定750」档，统一上游+2元 */
export const VIDEO_UPSTREAM_YUAN_PRICE_THRESHOLD = 5.5

/** 由上游成本（元）计算本站用户积分价：上游 + 2 元 */
export function computeUserCreditsFromUpstreamYuan(upstreamYuan?: number | null): number {
  const yuan = Number(upstreamYuan)
  if (!Number.isFinite(yuan) || yuan <= 0) return MIN_USER_VIDEO_CREDIT_COST
  return Math.max(1, Math.round((yuan + VIDEO_UPSTREAM_MARKUP_YUAN) * CREDITS_PER_YUAN))
}

/** 由上游成本（积分，1 元 = 100 积分）计算本站用户积分价 */
export function computeUserCreditsFromUpstreamCredits(upstreamCredits?: number | null): number {
  const credits = Number(upstreamCredits)
  if (!Number.isFinite(credits) || credits <= 0) return MIN_USER_VIDEO_CREDIT_COST
  return computeUserCreditsFromUpstreamYuan(credits / CREDITS_PER_YUAN)
}

export function isVideoCreditAction(action?: string | null): boolean {
  const key = String(action || '').trim()
  if (!key) return false
  if (key === CREDIT_ACTIONS.VIDEO_GENERATE_DOUBAO_TRAINING) return false
  return key === CREDIT_ACTIONS.VIDEO_GENERATE || key.startsWith('video.generate.')
}

export function applyMinUserVideoCreditCost(cost: number, action?: string | null): number {
  if (!isVideoCreditAction(action)) return cost
  if (cost <= 0) return cost
  const key = String(action || '')
  // S通道5 / S通道7 / 通道1 / 通道3 / 通道4 / 通道6 / 通道2：单独定价，允许低于全局 750 保底
  // 通道2 / 通道4 / S通道5·S 2.5 / S通道7 为按秒计费（单价可远低于 750）
  if (
    key.startsWith('video.generate.xyq.')
    || key.startsWith('video.generate.coze.')
    || key.startsWith('video.generate.funshion.')
    || key.startsWith('video.generate.xingyuemeng.')
    || key.startsWith('video.generate.chengmeng')
    || key.startsWith('video.generate.aistarslab')
    || key.startsWith('video.generate.jimeng')
    || key.startsWith('video.generate.aigccc')
    || key === CREDIT_ACTIONS.VIDEO_GENERATE
    || key === CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0
    || key === CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST
    || key === CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_MINI
    || key === CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST_HD
    || key === CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_5
    || key === CREDIT_ACTIONS.VIDEO_UPSCALE_SEEDVR2
    || key === CREDIT_ACTIONS.VIDEO_UPSCALE_FUNSHION_2K
  ) {
    return Math.floor(cost)
  }
  return Math.max(MIN_USER_VIDEO_CREDIT_COST, Math.floor(cost))
}

/** MiniMax 配乐：按次计费（上游约 1 元/次 → 本站 200 积分；管理员可在积分设置调整） */
export const SUNO_MUSIC_CREDIT_COST = 200

/** 图片平台单价（gpt-image-2 等） */
export const IMAGE_CREDIT_COST = 12

/** 启灵泽 nano-banana-2 上游约 0.12 元/张 */
export const NANO_BANANA_2_MODEL = 'nano-banana-2'
export const NANO_BANANA_2_CREDIT_COST = 19

/** APIMart 图片通道（Image 2 / gpt-image-2） */
export const APIMART_IMAGE_PROVIDER = 'apimart'
/** @deprecated 兼容旧统一定价；工作台按 1k/2k 分项计费 */
export const APIMART_IMAGE_CREDIT_COST = 8
export const APIMART_IMAGE_1K_CREDIT_COST = 8
export const APIMART_IMAGE_2K_CREDIT_COST = 24

/** dream5.0 pro（即梦通道4 Seedream 5.0 Pro）：按分辨率计费 */
export const DREAM50_PRO_IMAGE_1K_CREDIT_COST = 8
export const DREAM50_PRO_IMAGE_2K_CREDIT_COST = 12
export const DREAM50_PRO_IMAGE_4K_CREDIT_COST = 20

export function isNanoBanana2Model(model?: string | null): boolean {
  return String(model || '').trim().toLowerCase() === NANO_BANANA_2_MODEL
}

export function isDream50ProImageModel(model?: string | null): boolean {
  const id = String(model || '').trim().toLowerCase()
  return id === 'dream5.0-pro' || id === 'dream5.0 pro' || id === 'dreamina-seedream-5.0-pro'
}

export function isApimartImageProvider(provider?: string | null): boolean {
  return String(provider || '').trim().toLowerCase() === APIMART_IMAGE_PROVIDER
}

export function isGptImage2Model(model?: string | null): boolean {
  return /gpt-image-2|^image-2$/i.test(String(model || '').trim())
}

/** 按图片通道 / 模型 / 分辨率选择扣费项 */
export function resolveImageCreditAction(
  model?: string | null,
  fallback: CreditAction = CREDIT_ACTIONS.IMAGE_GENERATE,
  provider?: string | null,
  resolution?: string | null,
): CreditAction {
  if (isNanoBanana2Model(model)) return CREDIT_ACTIONS.IMAGE_GENERATE_NANO_BANANA_2
  if (isDream50ProImageModel(model) || String(provider || '').toLowerCase() === 'jimeng_web') {
    const res = String(resolution || '').trim().toLowerCase()
    if (res === '4k') return CREDIT_ACTIONS.IMAGE_GENERATE_DREAM50_PRO_4K
    if (res === '1k') return CREDIT_ACTIONS.IMAGE_GENERATE_DREAM50_PRO_1K
    return CREDIT_ACTIONS.IMAGE_GENERATE_DREAM50_PRO_2K
  }
  if (isApimartImageProvider(provider) || isGptImage2Model(model)) {
    const res = String(resolution || '').trim().toLowerCase()
    if (res === '2k') return CREDIT_ACTIONS.IMAGE_GENERATE_APIMART_2K
    if (res === '1k') return CREDIT_ACTIONS.IMAGE_GENERATE_APIMART_1K
    return CREDIT_ACTIONS.IMAGE_GENERATE_APIMART_1K
  }
  return fallback
}

/** 视频按秒计费：1 元/秒；每次生成固定按 15 秒扣费（火山等默认通道） */
export const VIDEO_CREDITS_PER_SECOND = CREDITS_PER_YUAN
export const VIDEO_BILLING_SECONDS = 15

/**
 * 通道2 管理端参考价（对齐通道9 · 5s·480p 一口价，非按秒单价）。
 * 实际扣费走 resolveOfficialChannel2UserCreditCost（时长×分辨率矩阵）。
 */
export const OFFICIAL_SEEDANCE_MINI_CREDITS_PER_SECOND = XINGYUEMENG_SEEDANCE_2_0_MINI_CREDITS_PER_SECOND
export const OFFICIAL_SEEDANCE_FAST_CREDITS_PER_SECOND = XINGYUEMENG_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND
/** @deprecated Fast 720p 已并入矩阵；保留兼容旧迁移 */
export const OFFICIAL_SEEDANCE_FAST_HD_CREDITS_PER_SECOND = 490
export const OFFICIAL_SEEDANCE_2_0_CREDITS_PER_SECOND = XINGYUEMENG_SEEDANCE_2_0_PRO_CREDITS_PER_SECOND
export const OFFICIAL_SEEDANCE_2_5_CREDITS_PER_SECOND = XINGYUEMENG_SEEDANCE_2_5_CREDITS_PER_SECOND

/** 通道2 模型 → 通道9 同档价表（Pro ↔ 官方 2.0 标准版） */
export function mapOfficialChannel2ToXingyuemengModel(model?: string | null): string {
  const id = String(model || '').trim()
  if (id === SEEDANCE_MODELS.V2_0_MINI) return XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_MINI
  if (id === SEEDANCE_MODELS.V2_0_FAST) return XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST
  if (id === SEEDANCE_MODELS.V2_0) return XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_PRO
  if (id === SEEDANCE_MODELS.V2_5) return XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_5
  return XINGYUEMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST
}

/** 通道2 用户扣费：与通道9 同矩阵；2.5 超过 15s 时按末档增量外推至 30s */
export function resolveOfficialChannel2UserCreditCost(
  model?: string | null,
  duration?: number | null,
  resolution?: string | null,
): number {
  const id = String(model || SEEDANCE_MODELS.V2_0_FAST).trim()
  const xyModel = mapOfficialChannel2ToXingyuemengModel(id)
  const sec = resolveVideoBillingSeconds(duration, id)
  const res = normalizeXingyuemengResolution(resolution, '480p')
  if (sec <= XINGYUEMENG_DURATION_BOUNDS.max) {
    return resolveXingyuemengUserCreditCost(xyModel, sec, res)
  }
  const costMax = resolveXingyuemengUserCreditCost(xyModel, XINGYUEMENG_DURATION_BOUNDS.max, res)
  const costPrev = resolveXingyuemengUserCreditCost(xyModel, XINGYUEMENG_DURATION_BOUNDS.max - 1, res)
  const delta = Math.max(1, costMax - costPrev)
  return costMax + delta * (sec - XINGYUEMENG_DURATION_BOUNDS.max)
}

export function buildOfficialChannel2CreditCostMatrix(
  model?: string | null,
): Record<string, Record<number, number>> {
  const id = String(model || SEEDANCE_MODELS.V2_0_FAST).trim()
  const bounds = seedanceDurationBounds(id)
  const matrix: Record<string, Record<number, number>> = {}
  for (const res of ['480p', '720p'] as const) {
    const byDuration: Record<number, number> = {}
    for (let sec = bounds.min; sec <= bounds.max; sec++) {
      byDuration[sec] = resolveOfficialChannel2UserCreditCost(id, sec, res)
    }
    matrix[res] = byDuration
  }
  return matrix
}

export function resolveOfficialChannel2CreditAction(model?: string | null): CreditAction {
  const id = String(model || '').trim()
  if (id === SEEDANCE_MODELS.V2_5) return CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_5
  if (id === SEEDANCE_MODELS.V2_0_MINI) return CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_MINI
  if (id === SEEDANCE_MODELS.V2_0) return CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0
  return CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST
}

/** @deprecated 通道2 已改为时长×分辨率一口价 */
export function resolveOfficialChannel2CreditsPerSecond(resolution?: string | null): number {
  const res = String(resolution || '').trim().toLowerCase()
  if (res === '720p') return OFFICIAL_SEEDANCE_FAST_HD_CREDITS_PER_SECOND
  return OFFICIAL_SEEDANCE_FAST_CREDITS_PER_SECOND
}

/** RunningHub Seedvr2 视频超分：按源视频秒数计费 */
/** 暂定 6 积分/秒（15s=90） */
export const VIDEO_UPSCALE_SEEDVR2_CREDITS_PER_SECOND = 6

/** 通道8 橙星超分 2K：按次（上游约 4 星币） */
export const VIDEO_UPSCALE_FUNSHION_2K_CREDIT_COST = 40

export function resolveVideoUpscaleSeedvr2CreditCost(durationSec?: number | null): number {
  const sec = Math.max(1, Math.ceil(Number(durationSec) || 1))
  return Math.max(1, sec * VIDEO_UPSCALE_SEEDVR2_CREDITS_PER_SECOND)
}

export function resolveVideoUpscaleFunshion2kCreditCost(): number {
  return Math.max(1, VIDEO_UPSCALE_FUNSHION_2K_CREDIT_COST)
}

/** RunningHub 去字幕/去水印：按源视频秒数计费 */
export const SUBTITLE_ERASE_CREDITS_PER_SECOND = 4

export function resolveSubtitleEraseCreditCost(durationSec?: number | null): number {
  const sec = Math.max(1, Math.ceil(Number(durationSec) || 1))
  return Math.max(1, sec * SUBTITLE_ERASE_CREDITS_PER_SECOND)
}

/** 橙盟通道1 · model_id=53：默认按条积分 */
export const CHENGMENG_VIDEO_YUAN_PER_CLIP = CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND * VIDEO_BILLING_SECONDS
export const CHENGMENT_VIDEO_CREDIT_COST = CHENGMENG_MODEL_70_CREDIT_COST

/** 橙盟通道1 · model_id=32 */
export const CHENGMENG_SEEDANCE_2_0_YUAN_PER_CLIP = 9
export const CHENGMENG_SEEDANCE_2_0_CREDIT_COST = CHENGMENG_SEEDANCE_2_0_YUAN_PER_CLIP * CREDITS_PER_YUAN

/** 默认单价（积分）。后续可按 1 元 = 100 积分 换算充值 */
export const DEFAULT_CREDIT_PRICING: CreditActionDef[] = [
  { action: CREDIT_ACTIONS.AGENT_RUN, label: 'Agent 对话', defaultCost: 0, description: '剧本改写、提取、分镜拆解等文字类 Agent 调用（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.ASSISTANT_CHAT, label: '制作助手', defaultCost: 0, description: '剧集工作台 AI 助手对话（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.IMAGE_GENERATE, label: '镜头图生成', defaultCost: IMAGE_CREDIT_COST, description: `通用图片生成 / 首尾帧（gpt-image-2 等 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.IMAGE_GENERATE_NANO_BANANA_2, label: 'Nano Banana 2 图片', defaultCost: NANO_BANANA_2_CREDIT_COST, description: `启灵泽 nano-banana-2（上游约 0.12 元/张，平台 ${NANO_BANANA_2_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.IMAGE_GENERATE_APIMART, label: '图片生成（兼容）', defaultCost: APIMART_IMAGE_1K_CREDIT_COST, description: `Image 2 旧版统一定价（兼容项）；请使用 Image 2 · 1K / 2K` },
  { action: CREDIT_ACTIONS.IMAGE_GENERATE_APIMART_1K, label: 'Image 2 · 1K', defaultCost: APIMART_IMAGE_1K_CREDIT_COST, description: `Image 2（gpt-image-2）1K，平台 ${APIMART_IMAGE_1K_CREDIT_COST} 积分/张` },
  { action: CREDIT_ACTIONS.IMAGE_GENERATE_APIMART_2K, label: 'Image 2 · 2K', defaultCost: APIMART_IMAGE_2K_CREDIT_COST, description: `Image 2（gpt-image-2）2K，平台 ${APIMART_IMAGE_2K_CREDIT_COST} 积分/张` },
  { action: CREDIT_ACTIONS.IMAGE_GENERATE_DREAM50_PRO_1K, label: 'dream5.0 pro · 1K', defaultCost: DREAM50_PRO_IMAGE_1K_CREDIT_COST, description: `即梦通道4 · Seedream 5.0 Pro 1K，平台 ${DREAM50_PRO_IMAGE_1K_CREDIT_COST} 积分/张` },
  { action: CREDIT_ACTIONS.IMAGE_GENERATE_DREAM50_PRO_2K, label: 'dream5.0 pro · 2K', defaultCost: DREAM50_PRO_IMAGE_2K_CREDIT_COST, description: `即梦通道4 · Seedream 5.0 Pro 2K，平台 ${DREAM50_PRO_IMAGE_2K_CREDIT_COST} 积分/张` },
  { action: CREDIT_ACTIONS.IMAGE_GENERATE_DREAM50_PRO_4K, label: 'dream5.0 pro · 4K', defaultCost: DREAM50_PRO_IMAGE_4K_CREDIT_COST, description: `即梦通道4 · Seedream 5.0 Pro 4K，平台 ${DREAM50_PRO_IMAGE_4K_CREDIT_COST} 积分/张` },
  { action: CREDIT_ACTIONS.CHARACTER_IMAGE, label: '角色图生成', defaultCost: IMAGE_CREDIT_COST, description: `角色基准图生成（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.CHARACTER_TRANSFORM, label: '角色风格转换', defaultCost: IMAGE_CREDIT_COST, description: `彩铅 / 红线 / 网格等 Seedance 变体（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.CHARACTER_OUTFIT, label: '角色换装', defaultCost: IMAGE_CREDIT_COST, description: `角色 + 服装双参考换装（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.CHARACTER_VOICE_SAMPLE, label: '角色音色试听', defaultCost: 0, description: 'TTS 音色试听（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.SCENE_IMAGE, label: '场景图生成', defaultCost: IMAGE_CREDIT_COST, description: `场景图生成（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.STORYBOARD_TTS, label: '镜头配音', defaultCost: 0, description: '分镜 TTS 配音（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE, label: '视频生成', defaultCost: VIDEO_CREDITS_PER_SECOND, description: `镜头视频生成（${VIDEO_BILLING_SECONDS} 秒/次，${VIDEO_CREDITS_PER_SECOND} 积分/秒）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0, label: '官方 Seedance 2.0（通道2）', defaultCost: OFFICIAL_SEEDANCE_2_0_CREDITS_PER_SECOND, description: '通道2 · Seedance 2.0（对齐通道9 Pro），时长×分辨率一口价，如 480p 5s=280、720p 5s=610' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST, label: '官方 Seedance 2.0 Fast（通道2）', defaultCost: OFFICIAL_SEEDANCE_FAST_CREDITS_PER_SECOND, description: '通道2 · Seedance 2.0 Fast（对齐通道9），时长×分辨率一口价，如 480p 5s=230、720p 5s=490' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_MINI, label: '官方 Seedance 2.0 Mini（通道2）', defaultCost: OFFICIAL_SEEDANCE_MINI_CREDITS_PER_SECOND, description: '通道2 · Seedance 2.0 Mini（对齐通道9），时长×分辨率一口价，如 480p 5s=140、720p 5s=310' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST_HD, label: '官方 Seedance 2.0 Fast 超分（通道2·历史）', defaultCost: OFFICIAL_SEEDANCE_FAST_HD_CREDITS_PER_SECOND, description: '历史项：Fast 720p 已并入 Fast 一口价矩阵（参考 720p 5s=490）' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_5, label: '官方 Seedance 2.5（通道2）', defaultCost: OFFICIAL_SEEDANCE_2_5_CREDITS_PER_SECOND, description: '通道2 · Seedance 2.5（对齐通道9），时长×分辨率一口价，如 480p 5s=430、720p 5s=920；16–30s 按末档增量外推' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_CHENGMENT, label: '橙盟 Seedance 2.0 Fast（53）', defaultCost: CHENGMENT_VIDEO_CREDIT_COST, description: `橙盟通道1 model_id=53（${VIDEO_BILLING_SECONDS} 秒/条，本站 ${CHENGMENT_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_CHENGMENG_SEEDANCE_2_0, label: '橙盟 Seedance 2.0（32）', defaultCost: CHENGMENG_SEEDANCE_2_0_CREDIT_COST, description: `橙盟通道1 model_id=32（${VIDEO_BILLING_SECONDS} 秒/条，本站 ${CHENGMENG_SEEDANCE_2_0_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_1_5_PRO, label: 'Grok 1.5 Pro 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-1.5-pro（10 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_1_5_MAX, label: 'Grok 1.5 Max 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-1.5-max（15 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_3_PRO, label: 'Grok 3 Pro 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-3-pro（10 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_3_MAX, label: 'Grok 3 Max 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-3-max（15 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG, label: '视频生成(即梦·兼容)', defaultCost: JIMENG_CREDITS_PER_SECOND, description: `即梦通道旧版统一定价（兼容项）；请使用下方分项。通道4按秒计费：S 2.5 ${JIMENG_SEEDANCE_2_5_CREDIT_COST} / Fast VIP 标价 ${JIMENG_SEEDANCE_2_0_FAST_LIST_CREDIT_COST}·实收 ${JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST}（8折） / VIP ${JIMENG_SEEDANCE_2_0_CREDIT_COST}（有参考视频 ${JIMENG_SEEDANCE_2_0_WITH_REF_VIDEO_CREDIT_COST}）积分/秒` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG_SEEDANCE_2_5, label: 'S 2.5（通道4）', defaultCost: JIMENG_SEEDANCE_2_5_CREDIT_COST, description: `即梦通道4 · Seedance 2.5（4–30 秒），按秒计费，默认 ${JIMENG_SEEDANCE_2_5_CREDIT_COST} 积分/秒（39元/30s）；用户自带参考视频时按 ${Math.round(SEEDANCE_25_USER_REF_VIDEO_MULTIPLIER * 100)}% 扣费` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG_SEEDANCE_2_0_FAST, label: 'Seedance 2.0 Fast VIP（通道4）', defaultCost: JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST, description: `即梦通道4 · Seedance 2.0 Fast VIP，标价 ${JIMENG_SEEDANCE_2_0_FAST_LIST_CREDIT_COST} 积分/秒，促销 8 折实收 ${JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST} 积分/秒` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG_SEEDANCE_2_0, label: 'Seedance 2.0 VIP（通道4）', defaultCost: JIMENG_SEEDANCE_2_0_CREDIT_COST, description: `即梦通道4 · Seedance 2.0 VIP：无参考视频 ${JIMENG_SEEDANCE_2_0_CREDIT_COST} 积分/秒；有用户参考视频 ${JIMENG_SEEDANCE_2_0_WITH_REF_VIDEO_CREDIT_COST} 积分/秒（对齐上游加价）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_SEEDANCE_2_5, label: 'S 2.5（S通道5）', defaultCost: XYQ_SEEDANCE_2_5_CREDITS_PER_SECOND, description: `S通道5 · Seedance 2.5（5–30 秒），按秒计费，默认 ${XYQ_SEEDANCE_2_5_CREDITS_PER_SECOND} 积分/秒（39元/30s）；用户自带参考视频时按 ${Math.round(SEEDANCE_25_USER_REF_VIDEO_MULTIPLIER * 100)}% 扣费` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_MINI_TRIAL, label: 'S2.0A（S通道5）', defaultCost: XYQ_MINI_TRIAL_CREDIT_COST, description: 'S通道5 · S2.0A，本站按条 300 积分' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_MINI, label: 'S2.0B（S通道5）', defaultCost: XYQ_MINI_CREDIT_COST, description: 'S通道5 · S2.0B，本站按条 500 积分' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_SEEDANCE_2_0_FAST, label: 'S 2.0 Fast VIP（S通道5）', defaultCost: XYQ_FAST_VIP_CREDIT_COST, description: 'S通道5 · Fast VIP，本站按条 750 积分' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_SEEDANCE_2_0, label: 'S 2.0 VIP（S通道5）', defaultCost: XYQ_VIP_CREDIT_COST, description: 'S通道5 · VIP，本站按条 900 积分' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_COZE_SEEDANCE_2_0_FAST, label: 'S 2.0 Fast（S通道7）', defaultCost: COZE_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND, description: `S通道7 · Seedance 2.0 Fast（扣子），按秒计费，默认 ${COZE_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND} 积分/秒` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_COZE_SEEDANCE_2_0, label: 'S 2.0（S通道7）', defaultCost: COZE_SEEDANCE_2_0_CREDITS_PER_SECOND, description: `S通道7 · Seedance 2.0（扣子），按秒计费，默认 ${COZE_SEEDANCE_2_0_CREDITS_PER_SECOND} 积分/秒` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_FUNSHION_SEEDANCE_2_0_FAST, label: 'S 2.0 Fast（通道8·梦工厂专用）', defaultCost: FUNSHION_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND, description: `通道8(梦工厂专用) Seedance 2.0 Fast，按秒计费，默认 ${FUNSHION_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND} 积分/秒` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_FUNSHION_SEEDANCE_2_0, label: 'S 2.0（通道8·梦工厂专用）', defaultCost: FUNSHION_SEEDANCE_2_0_CREDITS_PER_SECOND, description: `通道8(梦工厂专用) Seedance 2.0，按秒计费，默认 ${FUNSHION_SEEDANCE_2_0_CREDITS_PER_SECOND} 积分/秒` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XINGYUEMENG_SEEDANCE_2_5, label: 'S 2.5（S通道9）', defaultCost: XINGYUEMENG_SEEDANCE_2_5_CREDITS_PER_SECOND, description: 'S通道9 · 星月梦 Seedance 2.5，上游 estimate×10 不加价，如 480p 5s=430、720p 5s=920' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XINGYUEMENG_SEEDANCE_2_0_PRO, label: 'S 2.0 Pro（S通道9）', defaultCost: XINGYUEMENG_SEEDANCE_2_0_PRO_CREDITS_PER_SECOND, description: 'S通道9 · 星月梦 Seedance 2.0 Pro，上游 estimate×10（上游1:10 / 本站1:100），如 480p 5s=280、720p 5s=610' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XINGYUEMENG_SEEDANCE_2_0_FAST, label: 'S 2.0 Fast（S通道9）', defaultCost: XINGYUEMENG_SEEDANCE_2_0_FAST_CREDITS_PER_SECOND, description: 'S通道9 · 星月梦 Seedance 2.0 Fast，上游 estimate×10（上游1:10 / 本站1:100），如 480p 5s=230、720p 5s=490' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XINGYUEMENG_SEEDANCE_2_0_MINI, label: 'S 2.0 Mini（S通道9）', defaultCost: XINGYUEMENG_SEEDANCE_2_0_MINI_CREDITS_PER_SECOND, description: 'S通道9 · 星月梦 Seedance 2.0 Mini，上游 estimate×10（上游1:10 / 本站1:100），如 480p 4s=120、720p 5s=310' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_DOUBAO_TRAINING, label: '豆包培训视频（培训通道）', defaultCost: 0, description: '内部培训 · 豆包免费额度练手，生成后自动叠加「内部培训专用」标识，不扣积分' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB, label: 'Seedance 2.0 VIP（兼容）', defaultCost: AISTARSLAB_DEFAULT_CREDIT_COST, description: `seedance通道3 旧版统一定价（兼容项）；新线路×模型请使用 video.generate.aistarslab.{线路}.{模型}，用户价：本站=上游+2元；含参考视频时上游参考价 ×${AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER}` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_AIGCCC_MINI, label: 'S2.0 fast（S通道6）', defaultCost: AIGCCC_MINI_CREDIT_COST, description: `S通道6 · S2.0 fast，按条 ${AIGCCC_MINI_CREDIT_COST} 积分` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_AIGCCC_PRO, label: 'S2.0满血（S通道6）', defaultCost: AIGCCC_PRO_CREDIT_COST, description: `S通道6 · S2.0满血，按条 ${AIGCCC_PRO_CREDIT_COST} 积分` },
  { action: CREDIT_ACTIONS.GRID_GENERATE, label: '宫格图生成', defaultCost: IMAGE_CREDIT_COST, description: `九宫格参考图（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.GRID_PROMPT, label: '宫格提示词', defaultCost: 0, description: '宫格 LLM 提示词生成（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.PORTRAIT_SYNC, label: 'Seedance 资产同步', defaultCost: 0, description: '角色 Seedance 参考资产同步（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.STORYBOARD_BLOCKING, label: '场景站位图', defaultCost: IMAGE_CREDIT_COST, description: `3D 预可视化多人物站位图（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.MUSIC_GENERATE_SUNO, label: 'MiniMax 配乐', defaultCost: SUNO_MUSIC_CREDIT_COST, description: `MiniMax 官方 music_generation 配乐（按次，默认 ${SUNO_MUSIC_CREDIT_COST} 积分；每次 1 条音轨）` },
  { action: CREDIT_ACTIONS.VIDEO_UPSCALE_SEEDVR2, label: '视频超分', defaultCost: VIDEO_UPSCALE_SEEDVR2_CREDITS_PER_SECOND, description: `工具箱 · 视频超分（按源视频秒数，默认 ${VIDEO_UPSCALE_SEEDVR2_CREDITS_PER_SECOND} 积分/秒）` },
  { action: CREDIT_ACTIONS.VIDEO_UPSCALE_FUNSHION_2K, label: '通道8超分2K', defaultCost: VIDEO_UPSCALE_FUNSHION_2K_CREDIT_COST, description: `通道8 · 橙星后处理超分固定 2K（按次，默认 ${VIDEO_UPSCALE_FUNSHION_2K_CREDIT_COST} 积分）` },
  { action: CREDIT_ACTIONS.SUBTITLE_ERASE, label: '去字幕/去水印', defaultCost: SUBTITLE_ERASE_CREDITS_PER_SECOND, description: `工具箱 · RunningHub 去字幕/去水印（按源视频秒数，默认 ${SUBTITLE_ERASE_CREDITS_PER_SECOND} 积分/秒）` },
]

export const DEFAULT_USER_CREDITS = 10_000

export function getVideoGenerationCreditCost(seconds = VIDEO_BILLING_SECONDS, perSecond = VIDEO_CREDITS_PER_SECOND): number {
  return Math.max(0, perSecond * Math.max(1, seconds))
}

export function resolveVideoBillingSeconds(duration?: number | null, model?: string | null): number {
  const { min, max, defaultSec } = seedanceDurationBounds(model)
  const parsed = Math.round(Number(duration ?? defaultSec))
  if (!Number.isFinite(parsed)) return defaultSec
  return Math.min(max, Math.max(min, parsed))
}

export function resolveGrokVideoCreditAction(model?: string | null): CreditAction {
  const normalized = String(model || '').trim().toLowerCase()
  switch (normalized) {
    case GROK_VIDEO_MODELS.V1_5_PRO:
      return CREDIT_ACTIONS.VIDEO_GENERATE_GROK_1_5_PRO
    case GROK_VIDEO_MODELS.V1_5_MAX:
      return CREDIT_ACTIONS.VIDEO_GENERATE_GROK_1_5_MAX
    case GROK_VIDEO_MODELS.V3_PRO:
      return CREDIT_ACTIONS.VIDEO_GENERATE_GROK_3_PRO
    case GROK_VIDEO_MODELS.V3_MAX:
      return CREDIT_ACTIONS.VIDEO_GENERATE_GROK_3_MAX
    default:
      return CREDIT_ACTIONS.VIDEO_GENERATE_GROK_3_PRO
  }
}

export function resolveVideoCreditCharge(
  provider?: string | null,
  model?: string | null,
  duration?: number | null,
  resolution?: string | null,
) {
  const normalized = String(model || '').trim()
  if (
    normalized === SEEDANCE_MODELS.V2_0_FAST
    || normalized === SEEDANCE_MODELS.V2_0_MINI
    || normalized === SEEDANCE_MODELS.V2_0
    || normalized === SEEDANCE_MODELS.V2_5
  ) {
    const billedSeconds = resolveVideoBillingSeconds(duration, normalized)
    return {
      action: resolveOfficialChannel2CreditAction(normalized),
      quantity: 1,
      billedSeconds,
    }
  }
  if (isGrokVideoModel(normalized)) {
    const billedSeconds = resolveGrokBillingSeconds(normalized, duration)
    return {
      action: resolveGrokVideoCreditAction(normalized),
      quantity: 1,
      billedSeconds,
    }
  }
  if (isJimengVideoModel(normalized)) {
    const billedSeconds = resolveJimengBillingSeconds(normalized, duration)
    return {
      action: resolveJimengVideoCreditAction(normalized) as CreditAction,
      quantity: billedSeconds,
      billedSeconds,
    }
  }
  if (isXyqVideoModel(normalized) || provider === 'xyq_web') {
    const billedSeconds = normalizeXyqDuration(duration, normalized)
    const perSecond = isXyqPerSecondBilling(normalized)
    return {
      action: resolveXyqVideoCreditAction(normalized) as CreditAction,
      quantity: perSecond ? billedSeconds : 1,
      billedSeconds,
    }
  }
  if (isCozeVideoModel(normalized) || provider === 'coze_web') {
    const billedSeconds = normalizeCozeDuration(duration)
    return {
      action: resolveCozeVideoCreditAction(normalized) as CreditAction,
      quantity: billedSeconds,
      billedSeconds,
    }
  }
  if (isFunshionVideoModel(normalized) || provider === 'funshion_web') {
    const billedSeconds = normalizeFunshionDuration(duration)
    return {
      action: resolveFunshionVideoCreditAction(normalized) as CreditAction,
      quantity: billedSeconds,
      billedSeconds,
    }
  }
  if (isXingyuemengVideoModel(normalized) || provider === 'xingyuemeng_web') {
    const billedSeconds = normalizeXingyuemengDuration(duration)
    return {
      action: resolveXingyuemengVideoCreditAction(normalized) as CreditAction,
      quantity: 1,
      billedSeconds,
    }
  }
  if (isDoubaoTrainingVideoModel(normalized) || provider === 'doubao_training') {
    return {
      action: CREDIT_ACTIONS.VIDEO_GENERATE_DOUBAO_TRAINING,
      quantity: 1,
      billedSeconds: 5,
    }
  }
  if (isAistarslabProvider(provider)) {
    return {
      action: CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB,
      quantity: 1,
      billedSeconds: resolveVideoBillingSeconds(duration, normalized),
    }
  }
  if (isAigcccProvider(provider) || isAigcccVideoModel(normalized)) {
    const mode = normalizeAigcccMode(normalized)
    return {
      action: aigcccModeCreditAction(mode) as CreditAction,
      quantity: 1,
      billedSeconds: normalizeAigcccDuration(duration),
    }
  }
  if (isChengmengProvider(provider)) {
    const chengmengModel = normalized || CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST
    return {
      action: chengmengModelCreditAction(chengmengModel) as CreditAction,
      quantity: 1,
      billedSeconds: resolveVideoBillingSeconds(duration, chengmengModel),
    }
  }
  return {
    action: CREDIT_ACTIONS.VIDEO_GENERATE,
    quantity: VIDEO_BILLING_SECONDS,
    billedSeconds: VIDEO_BILLING_SECONDS,
  }
}
