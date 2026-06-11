import {
  appendCharacterImageStylePrompt,
  buildDefaultCharacterImagePrompt as composeDefaultCharacterImagePrompt,
} from '../constants/image-prompt-templates.js'

export function buildDefaultCharacterImagePrompt(char: {
  name: string
  appearance?: string | null
  description?: string | null
}) {
  return composeDefaultCharacterImagePrompt(char)
}

export function resolveCharacterImagePrompt(
  char: {
    name: string
    appearance?: string | null
    description?: string | null
    imagePrompt?: string | null
  },
  override?: string | null,
) {
  const custom = override?.trim() || char.imagePrompt?.trim()
  if (custom) return appendCharacterImageStylePrompt(custom)
  return buildDefaultCharacterImagePrompt(char)
}
