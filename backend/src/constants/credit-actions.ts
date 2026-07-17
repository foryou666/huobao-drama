import { isChengmengProvider, CHENGMENG_VIDEO_MODELS, CHENGMENG_MODEL_70_CREDIT_COST, CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND, chengmengModelCreditAction } from './chengmeng.js'
import { SEEDANCE_MODELS, seedanceDurationBounds } from './seedance.js'
import { isGrokVideoModel, GROK_VIDEO_MODELS, GROK_VIDEO_CREDIT_COST, resolveGrokBillingSeconds } from './geeknow-grok.js'
import { isJimengVideoModel, JIMENG_SEEDANCE_2_0_CREDIT_COST, JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST, JIMENG_VIDEO_MODELS, resolveJimengBillingSeconds, resolveJimengVideoCreditAction } from './jimeng-web.js'
import {
  isXyqVideoModel,
  XYQ_FAST_VIP_CREDIT_COST,
  XYQ_MINI_CREDIT_COST,
  XYQ_MINI_TRIAL_CREDIT_COST,
  XYQ_VIP_CREDIT_COST,
  normalizeXyqDuration,
  resolveXyqVideoCreditAction,
} from './xyq-web.js'
import { isDoubaoTrainingVideoModel } from './doubao-training.js'
import { isAistarslabProvider, AISTARSLAB_DEFAULT_CREDIT_COST, AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER } from './aistarslab.js'

/** 积分操作键 — 管理员可在设置中调整单价 */
export const CREDIT_ACTIONS = {
  AGENT_RUN: 'agent.run',
  ASSISTANT_CHAT: 'assistant.chat',
  IMAGE_GENERATE: 'image.generate',
  IMAGE_GENERATE_NANO_BANANA_2: 'image.generate.nano_banana_2',
  IMAGE_GENERATE_APIMART: 'image.generate.apimart',
  IMAGE_GENERATE_APIMART_1K: 'image.generate.apimart.1k',
  IMAGE_GENERATE_APIMART_2K: 'image.generate.apimart.2k',
  CHARACTER_IMAGE: 'character.image',
  CHARACTER_TRANSFORM: 'character.image.transform',
  CHARACTER_OUTFIT: 'character.image.outfit',
  CHARACTER_VOICE_SAMPLE: 'character.voice_sample',
  SCENE_IMAGE: 'scene.image',
  STORYBOARD_TTS: 'storyboard.tts',
  VIDEO_GENERATE: 'video.generate',
  VIDEO_GENERATE_SEEDANCE_2_0: 'video.generate.seedance2',
  VIDEO_GENERATE_SEEDANCE_2_0_FAST: 'video.generate.seedance2_fast',
  VIDEO_GENERATE_CHENGMENT: 'video.generate.chengmeng',
  VIDEO_GENERATE_CHENGMENG_SEEDANCE_2_0: 'video.generate.chengmeng_seedance2',
  VIDEO_GENERATE_GROK_1_5_PRO: 'video.generate.grok.1_5_pro',
  VIDEO_GENERATE_GROK_1_5_MAX: 'video.generate.grok.1_5_max',
  VIDEO_GENERATE_GROK_3_PRO: 'video.generate.grok.3_pro',
  VIDEO_GENERATE_GROK_3_MAX: 'video.generate.grok.3_max',
  VIDEO_GENERATE_JIMENG: 'video.generate.jimeng',
  VIDEO_GENERATE_JIMENG_SEEDANCE_2_0_FAST: 'video.generate.jimeng.seedance2_fast',
  VIDEO_GENERATE_JIMENG_SEEDANCE_2_0: 'video.generate.jimeng.seedance2',
  VIDEO_GENERATE_XYQ_MINI_TRIAL: 'video.generate.xyq.mini_trial',
  VIDEO_GENERATE_XYQ_MINI: 'video.generate.xyq.mini',
  VIDEO_GENERATE_XYQ_SEEDANCE_2_0_FAST: 'video.generate.xyq.seedance2_fast',
  VIDEO_GENERATE_XYQ_SEEDANCE_2_0: 'video.generate.xyq.seedance2',
  VIDEO_GENERATE_DOUBAO_TRAINING: 'video.generate.doubao_training',
  VIDEO_GENERATE_AISTARSLAB: 'video.generate.aistarslab',
  GRID_GENERATE: 'grid.generate',
  GRID_PROMPT: 'grid.prompt',
  PORTRAIT_SYNC: 'portrait.sync',
  STORYBOARD_BLOCKING: 'storyboard.blocking',
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
  // S通道5 / 通道3：可按上游成本单独定价，允许低于全局 750 保底
  if (key.startsWith('video.generate.xyq.') || key.startsWith('video.generate.aistarslab.')) {
    return Math.floor(cost)
  }
  return Math.max(MIN_USER_VIDEO_CREDIT_COST, Math.floor(cost))
}

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

export function isNanoBanana2Model(model?: string | null): boolean {
  return String(model || '').trim().toLowerCase() === NANO_BANANA_2_MODEL
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

/** 橙盟通道1 · 480p model_id=70：0.32 元/秒 × 15 秒 ≈ 4.8 元/条 → 默认 500 积分/条 */
export const CHENGMENT_VIDEO_YUAN_PER_CLIP = CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND * VIDEO_BILLING_SECONDS
export const CHENGMENT_VIDEO_CREDIT_COST = CHENGMENG_MODEL_70_CREDIT_COST

/** 橙盟线路2（已停用展示）：兼容旧定价项 */
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
  { action: CREDIT_ACTIONS.CHARACTER_IMAGE, label: '角色图生成', defaultCost: IMAGE_CREDIT_COST, description: `角色基准图生成（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.CHARACTER_TRANSFORM, label: '角色风格转换', defaultCost: IMAGE_CREDIT_COST, description: `彩铅 / 红线 / 网格等 Seedance 变体（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.CHARACTER_OUTFIT, label: '角色换装', defaultCost: IMAGE_CREDIT_COST, description: `角色 + 服装双参考换装（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.CHARACTER_VOICE_SAMPLE, label: '角色音色试听', defaultCost: 0, description: 'TTS 音色试听（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.SCENE_IMAGE, label: '场景图生成', defaultCost: IMAGE_CREDIT_COST, description: `场景图生成（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.STORYBOARD_TTS, label: '镜头配音', defaultCost: 0, description: '分镜 TTS 配音（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE, label: '视频生成', defaultCost: VIDEO_CREDITS_PER_SECOND, description: `镜头视频生成（${VIDEO_BILLING_SECONDS} 秒/次，${VIDEO_CREDITS_PER_SECOND} 积分/秒）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0, label: '官方 Seedance 2.0', defaultCost: VIDEO_CREDITS_PER_SECOND, description: `火山官方 doubao-seedance-2-0-260128（4–${VIDEO_BILLING_SECONDS} 秒，${VIDEO_CREDITS_PER_SECOND} 积分/秒）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST, label: '官方 Seedance 2.0 Fast', defaultCost: VIDEO_CREDITS_PER_SECOND, description: `火山官方 doubao-seedance-2-0-fast-260128（4–${VIDEO_BILLING_SECONDS} 秒，${VIDEO_CREDITS_PER_SECOND} 积分/秒）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_CHENGMENT, label: '橙盟 9图-满血', defaultCost: CHENGMENT_VIDEO_CREDIT_COST, description: `橙盟 model_id=70（${CHENGMENG_CHANNEL1_480P_YUAN_PER_SECOND} 元/秒 · ${VIDEO_BILLING_SECONDS} 秒/条 ≈ ${CHENGMENT_VIDEO_YUAN_PER_CLIP} 元，本站 ${CHENGMENT_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_CHENGMENG_SEEDANCE_2_0, label: '橙盟 9图满血线路2（停用）', defaultCost: CHENGMENG_SEEDANCE_2_0_CREDIT_COST, description: `橙盟 model_id=77（通道1已停用，保留兼容旧定价项）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_1_5_PRO, label: 'Grok 1.5 Pro 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-1.5-pro（10 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_1_5_MAX, label: 'Grok 1.5 Max 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-1.5-max（15 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_3_PRO, label: 'Grok 3 Pro 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-3-pro（10 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_3_MAX, label: 'Grok 3 Max 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-3-max（15 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG, label: '视频生成(即梦·兼容)', defaultCost: JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST, description: '即梦通道旧版统一定价（兼容项）；请使用下方「Seedance 2.0 Fast VIP / 2.0 VIP」分项定价' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG_SEEDANCE_2_0_FAST, label: 'Seedance 2.0 Fast VIP（通道4）', defaultCost: JIMENG_SEEDANCE_2_0_FAST_CREDIT_COST, description: '即梦通道4 · Seedance 2.0 Fast VIP（Web dreamina_seedance_40_vision），按条计费' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG_SEEDANCE_2_0, label: 'Seedance 2.0 VIP（通道4）', defaultCost: JIMENG_SEEDANCE_2_0_CREDIT_COST, description: '即梦通道4 · Seedance 2.0 VIP（Web dreamina_seedance_40_pro_vision），按条计费' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_MINI_TRIAL, label: 'S2.0A（S通道5）', defaultCost: XYQ_MINI_TRIAL_CREDIT_COST, description: 'S通道5 · S2.0A，本站按条 300 积分' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_MINI, label: 'S2.0B（S通道5）', defaultCost: XYQ_MINI_CREDIT_COST, description: 'S通道5 · S2.0B，本站按条 500 积分' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_SEEDANCE_2_0_FAST, label: 'S 2.0 Fast VIP（S通道5）', defaultCost: XYQ_FAST_VIP_CREDIT_COST, description: 'S通道5 · Fast VIP，本站按条 750 积分' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_SEEDANCE_2_0, label: 'S 2.0 VIP（S通道5）', defaultCost: XYQ_VIP_CREDIT_COST, description: 'S通道5 · VIP，本站按条 900 积分' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_DOUBAO_TRAINING, label: '豆包培训视频（培训通道）', defaultCost: 0, description: '内部培训 · 豆包免费额度练手，生成后自动叠加「内部培训专用」标识，不扣积分' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB, label: 'Seedance 2.0 VIP（兼容）', defaultCost: AISTARSLAB_DEFAULT_CREDIT_COST, description: `seedance通道3 旧版统一定价（兼容项）；新线路×模型请使用 video.generate.aistarslab.{线路}.{模型}，默认用户价=上游×1.5；含参考视频时 ×${AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER}` },
  { action: CREDIT_ACTIONS.GRID_GENERATE, label: '宫格图生成', defaultCost: IMAGE_CREDIT_COST, description: `九宫格参考图（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
  { action: CREDIT_ACTIONS.GRID_PROMPT, label: '宫格提示词', defaultCost: 0, description: '宫格 LLM 提示词生成（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.PORTRAIT_SYNC, label: 'Seedance 资产同步', defaultCost: 0, description: '角色 Seedance 参考资产同步（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.STORYBOARD_BLOCKING, label: '场景站位图', defaultCost: IMAGE_CREDIT_COST, description: `3D 预可视化多人物站位图（平台 ${IMAGE_CREDIT_COST} 积分/张）` },
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
) {
  const normalized = String(model || '').trim()
  if (normalized === SEEDANCE_MODELS.V2_0_FAST) {
    const billedSeconds = resolveVideoBillingSeconds(duration, normalized)
    return {
      action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST,
      quantity: billedSeconds,
      billedSeconds,
    }
  }
  if (normalized === SEEDANCE_MODELS.V2_0) {
    const billedSeconds = resolveVideoBillingSeconds(duration, normalized)
    return {
      action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0,
      quantity: billedSeconds,
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
    return {
      action: resolveJimengVideoCreditAction(normalized) as CreditAction,
      quantity: 1,
      billedSeconds: resolveJimengBillingSeconds(normalized, duration),
    }
  }
  if (isXyqVideoModel(normalized) || provider === 'xyq_web') {
    return {
      action: resolveXyqVideoCreditAction(normalized) as CreditAction,
      quantity: 1,
      billedSeconds: normalizeXyqDuration(duration),
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
