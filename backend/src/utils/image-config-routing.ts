import {
  getActiveConfig,
  getApimartImageConfig,
  getConfigById,
  getQilingzeImageConfig,
  type AIConfig,
} from '../services/ai.js'
import { isNanoBanana2Model } from '../constants/credit-actions.js'

function inferModelForRouting(options: {
  model?: string | null
  configId?: number | null
}): string {
  const explicit = String(options.model || '').trim()
  if (explicit) return explicit

  const hinted = options.configId ? getConfigById(options.configId) : getActiveConfig('image')
  return hinted?.model || hinted?.models?.[0] || ''
}

/**
 * 按模型选择图片上游：
 * - nano-banana-2 → 启灵泽（不走 APIMart，上游更便宜）
 * - gpt-image-2 → 优先 APIMart（无剧集 config_id 时）
 */
export function resolveImageGenerationConfig(options: {
  configId?: number | null
  model?: string | null
}): AIConfig {
  const effectiveModel = inferModelForRouting(options)

  if (isNanoBanana2Model(effectiveModel)) {
    const qilingze = getQilingzeImageConfig()
    if (!qilingze) {
      throw new Error('Nano Banana 2 需使用启灵泽通道，请在「设置 → AI 配置」中启用启灵泽图片服务')
    }
    return qilingze
  }

  if (options.configId != null) {
    const explicit = getConfigById(options.configId)
    if (explicit) return explicit
  }

  const normalized = String(effectiveModel || '').trim().toLowerCase()
  if (!normalized || normalized === 'gpt-image-2') {
    const apimart = getApimartImageConfig()
    if (apimart) return apimart
  }

  const active = getActiveConfig('image')
  if (!active) throw new Error('No active image AI config')
  return active
}
