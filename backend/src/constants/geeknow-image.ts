import type { AIConfig } from '../services/ai.js'

/** GeekNow 图片 API 使用的模型名（带连字符） */
export const GEEKNOW_IMAGE_MODEL = 'gpt-image-2'

export function resolveGeeknowImageModel(config: AIConfig): string {
  const models = config.models?.length ? config.models : (config.model ? [config.model] : [])
  const exact = models.find(m => m === GEEKNOW_IMAGE_MODEL)
  if (exact) return exact
  const gptImage = models.find(m => /^gpt-image-2$/i.test(String(m)))
  if (gptImage) return gptImage
  return GEEKNOW_IMAGE_MODEL
}
