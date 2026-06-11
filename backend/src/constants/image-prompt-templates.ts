/** 角色定妆照生成时的固定风格与构图要求 */
export const CHARACTER_IMAGE_STYLE_PROMPT =
  '电影级人物定妆照。真人电影角色定妆照，白色纯背景，左侧为面部特写，右侧为全身三视图（正面、侧面、背面），人物完整入画，无遮挡，站姿自然'

/** 场景主图生成时的固定风格与构图要求 */
export const SCENE_IMAGE_STYLE_PROMPT =
  '真人实拍场景设定图，完整展示场景空间结构、前景、中景、后景关系，固定陈设清晰，主视觉区域明确，不出现人物，不出现动物，不出现动态主体，适合作为后续分镜、镜头承接、场景一致性锁定参考图'

export function hasCharacterImageStylePrompt(text: string): boolean {
  return text.includes('真人电影角色定妆照')
}

export function hasSceneImageStylePrompt(text: string): boolean {
  return text.includes('真人实拍场景设定图')
}

export function appendCharacterImageStylePrompt(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed || hasCharacterImageStylePrompt(trimmed)) return trimmed
  return `${trimmed.replace(/[，,]\s*$/, '')}，${CHARACTER_IMAGE_STYLE_PROMPT}`
}

export function appendSceneImageStylePrompt(prompt: string): string {
  const trimmed = prompt.trim()
  if (!trimmed || hasSceneImageStylePrompt(trimmed)) return trimmed
  return `${trimmed.replace(/[，,]\s*$/, '')}，${SCENE_IMAGE_STYLE_PROMPT}`
}

export function shouldRefreshCharacterImagePrompt(prompt?: string | null): boolean {
  const trimmed = prompt?.trim() || ''
  if (!trimmed) return true
  return !hasCharacterImageStylePrompt(trimmed)
}

export function shouldRefreshSceneImagePrompt(prompt?: string | null): boolean {
  const trimmed = prompt?.trim() || ''
  if (!trimmed) return true
  return !hasSceneImageStylePrompt(trimmed)
}

export function buildDefaultCharacterImagePrompt(char: {
  name: string
  appearance?: string | null
  description?: string | null
}) {
  const traits = char.appearance || char.description || '人物特征待补充'
  return `${char.name}，${traits}，${CHARACTER_IMAGE_STYLE_PROMPT}`
}

export function buildDefaultSceneImagePrompt(scene: {
  location: string
  time?: string | null
  prompt?: string | null
}) {
  const details = scene.prompt?.trim()
    || `${scene.location}${scene.time ? `，${scene.time}` : ''}`
  return appendSceneImageStylePrompt(details)
}
