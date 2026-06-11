import type { AIConfig } from '../services/adapters/types.js'

export const DEFAULT_MAX_IMAGE_REFERENCES = 6
export const GPT_IMAGE_MAX_REFERENCES = 16

export function getMaxImageReferenceCount(config?: Pick<AIConfig, 'provider' | 'model'> | null): number {
  const model = String(config?.model || '')
  if (/gpt-image|chatgpt-image/i.test(model)) return GPT_IMAGE_MAX_REFERENCES
  return DEFAULT_MAX_IMAGE_REFERENCES
}
