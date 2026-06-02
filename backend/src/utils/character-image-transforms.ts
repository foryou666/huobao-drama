export interface CharacterImageTransformPreset {
  id: string
  label: string
  description: string
  prompt: string
}

export const CHARACTER_IMAGE_TRANSFORMS: Record<string, CharacterImageTransformPreset> = {
  colored_pencil: {
    id: 'colored_pencil',
    label: '彩铅图',
    description: '转为彩铅手绘风格，适合 Seedance 2.0 参考',
    prompt: '将参考图中的人物转为高质量彩铅手绘插画风格，保留相同构图、服装、发型与五官特征；线条柔和、色彩层次丰富；非真人照片、非写实摄影；干净背景，单人半身或全身肖像',
  },
  face_red_lines: {
    id: 'face_red_lines',
    label: '脸部红线',
    description: '在脸部叠加红色定位辅助线',
    prompt: '基于参考图保留人物整体形象，在脸部叠加清晰红色辅助定位线（五官轮廓线、中线、对称参考线），风格为非真人插画/线稿辅助效果，便于视频模型识别面部结构；不要改变人物身份特征',
  },
  face_white_mesh: {
    id: 'face_white_mesh',
    label: '白色网格',
    description: '在脸部叠加白色网状辅助线',
    prompt: '基于参考图保留人物整体形象，在脸部叠加半透明白色网状线/网格线（类似3D建模拓扑辅助线），风格为非真人插画辅助效果；不要改变人物身份特征与服装',
  },
}

export function getCharacterTransformPreset(transformType: string): CharacterImageTransformPreset | null {
  return CHARACTER_IMAGE_TRANSFORMS[transformType] || null
}

export function listCharacterTransformPresets(): CharacterImageTransformPreset[] {
  return Object.values(CHARACTER_IMAGE_TRANSFORMS)
}

export function buildCharacterTransformPrompt(preset: CharacterImageTransformPreset, charName: string): string {
  return `角色「${charName}」。${preset.prompt}。严格以参考图为准，保持同一人物。`
}
