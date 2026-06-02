export interface SceneAnglePreset {
  id: string
  label: string
  description: string
  prompt: string
}

/** 场景多角度预设 — 基于主场景图参考生成 */
export const SCENE_ANGLE_PRESETS: Record<string, SceneAnglePreset> = {
  wide: {
    id: 'wide',
    label: '全景',
    description: '建立空间关系的宽景别',
    prompt: '同一场景的广角全景视角，展示完整空间布局、主要家具与结构关系，电影级场景概念图',
  },
  left_45: {
    id: 'left_45',
    label: '左45°',
    description: '从场景左侧斜向观看',
    prompt: '同一场景从左侧约45度斜向视角观看，保持相同装修、道具与光照风格，仅改变机位',
  },
  right_45: {
    id: 'right_45',
    label: '右45°',
    description: '从场景右侧斜向观看',
    prompt: '同一场景从右侧约45度斜向视角观看，保持相同装修、道具与光照风格，仅改变机位',
  },
  reverse: {
    id: 'reverse',
    label: '对面',
    description: '反打/对面方向，适合对话正反打',
    prompt: '同一场景从对面方向观看（反打机位），空间布局一致但观察方向相反，适合对话镜头',
  },
  top_down: {
    id: 'top_down',
    label: '俯视',
    description: '略高机位俯视空间',
    prompt: '同一场景的略高机位俯视视角，强调地面布局与人物活动区域，保持场景一致',
  },
  detail: {
    id: 'detail',
    label: '细节',
    description: '场景局部特写背景',
    prompt: '同一场景的局部细节视角（墙面、窗户、关键道具近景），保持材质与色调一致',
  },
}

/** 单张多视角拼板（非独立角度，存 reference_images） */
export const SCENE_MULTI_VIEW_SHEET_ID = 'multi_view_sheet'

export const SCENE_MULTI_VIEW_SHEET = {
  id: SCENE_MULTI_VIEW_SHEET_ID,
  label: '多视角拼板',
  description: '一张图内拼接同场景多个机位视角',
  prompt: '',
}

export function getSceneAnglePreset(angleId: string): SceneAnglePreset | null {
  if (angleId === SCENE_MULTI_VIEW_SHEET_ID) {
    return {
      id: SCENE_MULTI_VIEW_SHEET.id,
      label: SCENE_MULTI_VIEW_SHEET.label,
      description: SCENE_MULTI_VIEW_SHEET.description,
      prompt: '',
    }
  }
  return SCENE_ANGLE_PRESETS[angleId] || null
}

export function listSceneAnglePresets(): SceneAnglePreset[] {
  return Object.values(SCENE_ANGLE_PRESETS)
}

export function listBatchSceneAngleIds(): string[] {
  return listSceneAnglePresets().map(item => item.id)
}
