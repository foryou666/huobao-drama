import { getSceneAnglePreset, listBatchSceneAngleIds, type SceneAnglePreset } from '../constants/scene-angles.js'

export function buildSceneAngleSheetPrompt(
  scene: { location: string; time?: string | null; prompt?: string | null },
  customPrompt?: string | null,
): string {
  if (customPrompt?.trim()) return customPrompt.trim()

  const base = scene.prompt?.trim() || `${scene.location}, ${scene.time || ''}`.replace(/,\s*$/, '')
  const panels = listBatchSceneAngleIds()
    .slice(0, 4)
    .map((id, index) => {
      const preset = getSceneAnglePreset(id)
      return `格${index + 1}：${preset?.label || id} — ${preset?.prompt || ''}`
    })
    .join('；')

  return [
    `场景「${scene.location}」${scene.time ? `（${scene.time}）` : ''}。`,
    base ? `场景描述：${base}。` : '',
    '生成一张横向多视角拼板参考图（multi-view scene sheet），同一场景在一张图内展示多个机位视角。',
    `拼板布局：${panels}。`,
    '严格以参考图1为同一场景基准：各格必须是同一空间、同一装修与道具，仅机位/视角不同；',
    '每格画面清晰分隔，整体为写实影视场景概念图；不要文字水印，不要插画风格。',
  ].filter(Boolean).join('')
}

export function buildSceneAnglePrompt(
  scene: { location: string; time?: string | null; prompt?: string | null },
  preset: SceneAnglePreset,
  customPrompt?: string | null,
): string {
  if (customPrompt?.trim()) return customPrompt.trim()

  const base = scene.prompt?.trim() || `${scene.location}, ${scene.time || ''}`.replace(/,\s*$/, '')

  return [
    `场景「${scene.location}」${scene.time ? `（${scene.time}）` : ''}。`,
    base ? `场景描述：${base}。` : '',
    preset.prompt,
    '严格以参考图1为同一场景基准：保持空间结构、装修风格、主要道具、色调与光照一致，仅改变观察角度/机位；',
    '输出写实影视场景图，非插画；干净无文字水印。',
  ].filter(Boolean).join('')
}

export function buildSceneAnglePromptById(
  scene: { location: string; time?: string | null; prompt?: string | null },
  angleId: string,
  customPrompt?: string | null,
): string {
  const preset = getSceneAnglePreset(angleId)
  if (!preset) throw new Error(`未知场景角度：${angleId}`)
  return buildSceneAnglePrompt(scene, preset, customPrompt)
}
