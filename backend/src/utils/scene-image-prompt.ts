import {
  appendSceneImageStylePrompt,
  buildDefaultSceneImagePrompt as composeDefaultSceneImagePrompt,
} from '../constants/image-prompt-templates.js'

export { SCENE_IMAGE_STYLE_PROMPT } from '../constants/image-prompt-templates.js'

export function buildDefaultSceneImagePrompt(scene: {
  location: string
  time?: string | null
  prompt?: string | null
}) {
  return composeDefaultSceneImagePrompt(scene)
}

export function resolveSceneImagePrompt(
  scene: { location: string; time?: string | null; prompt?: string | null },
  override?: string | null,
) {
  const custom = override?.trim()
  if (custom) return appendSceneImageStylePrompt(custom)
  return buildDefaultSceneImagePrompt(scene)
}
