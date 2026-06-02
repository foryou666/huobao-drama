export function buildDefaultSceneImagePrompt(scene: {
  location: string
  time?: string | null
  prompt?: string | null
}) {
  const base = scene.prompt?.trim()
  if (base) return base
  return `${scene.location}, ${scene.time || ''}, 高质量场景, 电影感`.replace(/,\s*,/g, ',').replace(/,\s*$/, '')
}

export function resolveSceneImagePrompt(
  scene: { location: string; time?: string | null; prompt?: string | null },
  override?: string | null,
) {
  const custom = override?.trim()
  if (custom) return custom
  return buildDefaultSceneImagePrompt(scene)
}
