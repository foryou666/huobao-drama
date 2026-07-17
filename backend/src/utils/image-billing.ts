import { getActiveConfig, getConfigById } from '../services/ai.js'
import { resolveImageGenerationConfig } from './image-config-routing.js'

/** 推断本次图片生成将使用的通道（用于扣费） */
export function resolveBillingImageProvider(options: {
  explicitModel?: string | null
  imageConfigId?: number | null
}): string | null {
  try {
    const config = resolveImageGenerationConfig({
      configId: options.imageConfigId,
      model: options.explicitModel,
    })
    return config.provider || null
  } catch {
    if (options.imageConfigId) {
      const config = getConfigById(options.imageConfigId)
      if (config?.provider) return config.provider
    }
    const active = getActiveConfig('image')
    return active?.provider || null
  }
}

/** 推断本次图片生成将使用的模型（用于扣费） */
export function resolveBillingImageModel(options: {
  explicitModel?: string | null
  imageConfigId?: number | null
}): string {
  const explicit = String(options.explicitModel || '').trim()
  if (explicit) return explicit

  if (options.imageConfigId) {
    const config = getConfigById(options.imageConfigId)
    if (config?.model) return config.model
    if (config?.models?.[0]) return config.models[0]
  }

  const active = getActiveConfig('image')
  if (active?.model) return active.model
  if (active?.models?.[0]) return active.models[0]
  return 'nano-banana-2'
}
