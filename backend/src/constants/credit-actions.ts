import { isChengmengProvider, CHENGMENG_VIDEO_MODELS, chengmengModelCreditAction } from './chengmeng.js'
import { SEEDANCE_MODELS, seedanceDurationBounds } from './seedance.js'
import { isGrokVideoModel, GROK_VIDEO_MODELS, GROK_VIDEO_CREDIT_COST, resolveGrokBillingSeconds } from './geeknow-grok.js'
import { isJimengVideoModel, JIMENG_VIDEO_CREDIT_COST } from './jimeng-web.js'
import { isAistarslabProvider, AISTARSLAB_DEFAULT_CREDIT_COST, AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER } from './aistarslab.js'

/** 积分操作键 — 管理员可在设置中调整单价 */
export const CREDIT_ACTIONS = {
  AGENT_RUN: 'agent.run',
  ASSISTANT_CHAT: 'assistant.chat',
  IMAGE_GENERATE: 'image.generate',
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

/** 图片平台单价（模型成本约 4 分/张） */
export const IMAGE_CREDIT_COST = 6

/** 视频按秒计费：1 元/秒；每次生成固定按 15 秒扣费（火山等默认通道） */
export const VIDEO_CREDITS_PER_SECOND = CREDITS_PER_YUAN
export const VIDEO_BILLING_SECONDS = 15

/** 橙盟 Seedance 2.0 Fast（9图过人脸）：15 秒/条，8 元/条 */
export const CHENGMENT_VIDEO_YUAN_PER_CLIP = 8
export const CHENGMENT_VIDEO_CREDIT_COST = CHENGMENT_VIDEO_YUAN_PER_CLIP * CREDITS_PER_YUAN

/** 橙盟 Seedance 2.0 标准版：固定 900 积分/条（9 元/条） */
export const CHENGMENG_SEEDANCE_2_0_YUAN_PER_CLIP = 9
export const CHENGMENG_SEEDANCE_2_0_CREDIT_COST = CHENGMENG_SEEDANCE_2_0_YUAN_PER_CLIP * CREDITS_PER_YUAN

/** 默认单价（积分）。后续可按 1 元 = 100 积分 换算充值 */
export const DEFAULT_CREDIT_PRICING: CreditActionDef[] = [
  { action: CREDIT_ACTIONS.AGENT_RUN, label: 'Agent 对话', defaultCost: 0, description: '剧本改写、提取、分镜拆解等文字类 Agent 调用（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.ASSISTANT_CHAT, label: '制作助手', defaultCost: 0, description: '剧集工作台 AI 助手对话（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.IMAGE_GENERATE, label: '镜头图生成', defaultCost: IMAGE_CREDIT_COST, description: '通用图片生成 / 首尾帧（平台 6 积分/张）' },
  { action: CREDIT_ACTIONS.CHARACTER_IMAGE, label: '角色图生成', defaultCost: IMAGE_CREDIT_COST, description: '角色基准图生成（平台 6 积分/张）' },
  { action: CREDIT_ACTIONS.CHARACTER_TRANSFORM, label: '角色风格转换', defaultCost: IMAGE_CREDIT_COST, description: '彩铅 / 红线 / 网格等 Seedance 变体（平台 6 积分/张）' },
  { action: CREDIT_ACTIONS.CHARACTER_OUTFIT, label: '角色换装', defaultCost: IMAGE_CREDIT_COST, description: '角色 + 服装双参考换装（平台 6 积分/张）' },
  { action: CREDIT_ACTIONS.CHARACTER_VOICE_SAMPLE, label: '角色音色试听', defaultCost: 0, description: 'TTS 音色试听（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.SCENE_IMAGE, label: '场景图生成', defaultCost: IMAGE_CREDIT_COST, description: '场景图生成（平台 6 积分/张）' },
  { action: CREDIT_ACTIONS.STORYBOARD_TTS, label: '镜头配音', defaultCost: 0, description: '分镜 TTS 配音（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE, label: '视频生成', defaultCost: VIDEO_CREDITS_PER_SECOND, description: `镜头视频生成（${VIDEO_BILLING_SECONDS} 秒/次，${VIDEO_CREDITS_PER_SECOND} 积分/秒）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0, label: '官方 Seedance 2.0', defaultCost: VIDEO_CREDITS_PER_SECOND, description: `火山官方 doubao-seedance-2-0-260128（4–${VIDEO_BILLING_SECONDS} 秒，${VIDEO_CREDITS_PER_SECOND} 积分/秒）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST, label: '官方 Seedance 2.0 Fast', defaultCost: VIDEO_CREDITS_PER_SECOND, description: `火山官方 doubao-seedance-2-0-fast-260128（4–${VIDEO_BILLING_SECONDS} 秒，${VIDEO_CREDITS_PER_SECOND} 积分/秒）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_CHENGMENT, label: '橙盟 Seedance 2.0 Fast', defaultCost: CHENGMENT_VIDEO_CREDIT_COST, description: `橙盟 Seedance 2.0 Fast / 9图过人脸（${VIDEO_BILLING_SECONDS} 秒/条，${CHENGMENT_VIDEO_YUAN_PER_CLIP} 元/条 = ${CHENGMENT_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_CHENGMENG_SEEDANCE_2_0, label: '橙盟 Seedance 2.0', defaultCost: CHENGMENG_SEEDANCE_2_0_CREDIT_COST, description: `橙盟 Seedance 2.0 标准版（${VIDEO_BILLING_SECONDS} 秒/条，${CHENGMENG_SEEDANCE_2_0_YUAN_PER_CLIP} 元/条 = ${CHENGMENG_SEEDANCE_2_0_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_1_5_PRO, label: 'Grok 1.5 Pro 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-1.5-pro（10 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_1_5_MAX, label: 'Grok 1.5 Max 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-1.5-max（15 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_3_PRO, label: 'Grok 3 Pro 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-3-pro（10 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_GROK_3_MAX, label: 'Grok 3 Max 视频', defaultCost: GROK_VIDEO_CREDIT_COST, description: `GeekNow grok-video-3-max（15 秒/条，按次计费，默认 ${GROK_VIDEO_CREDIT_COST} 积分/条）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG, label: '视频生成(即梦)', defaultCost: JIMENG_VIDEO_CREDIT_COST, description: `即梦 jimeng.jianying.com Cookie 通道，按条计费（默认 ${JIMENG_VIDEO_CREDIT_COST} 积分/条，可在积分管理中调整）` },
  { action: CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB, label: 'Seedance 2.0 VIP（兼容）', defaultCost: AISTARSLAB_DEFAULT_CREDIT_COST, description: `seedance通道3 旧版统一定价（兼容项）；新线路×模型请使用 video.generate.aistarslab.{线路}.{模型}，默认用户价=上游×1.5；含参考视频时 ×${AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER}` },
  { action: CREDIT_ACTIONS.GRID_GENERATE, label: '宫格图生成', defaultCost: IMAGE_CREDIT_COST, description: '九宫格参考图（平台 6 积分/张）' },
  { action: CREDIT_ACTIONS.GRID_PROMPT, label: '宫格提示词', defaultCost: 0, description: '宫格 LLM 提示词生成（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.PORTRAIT_SYNC, label: 'Seedance 资产同步', defaultCost: 0, description: '角色 Seedance 参考资产同步（免费，仍记录操作日志）' },
  { action: CREDIT_ACTIONS.STORYBOARD_BLOCKING, label: '场景站位图', defaultCost: IMAGE_CREDIT_COST, description: '3D 预可视化多人物站位图（平台 6 积分/张）' },
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
      action: CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG,
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
