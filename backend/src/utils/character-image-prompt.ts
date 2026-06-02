export function buildDefaultCharacterImagePrompt(char: {
  name: string
  appearance?: string | null
  description?: string | null
}) {
  return `${char.name}, ${char.appearance || char.description || '人物立绘'}, 高质量, 正面, 白色背景`
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
  if (custom) return custom
  return buildDefaultCharacterImagePrompt(char)
}
