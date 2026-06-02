export const SCENE_ANGLE_PRESETS = [
  { id: 'wide', label: '全景', description: '建立空间关系的宽景别', prompt: '同一场景的广角全景视角，展示完整空间布局、主要家具与结构关系，电影级场景概念图' },
  { id: 'left_45', label: '左45°', description: '从场景左侧斜向观看', prompt: '同一场景从左侧约45度斜向视角观看，保持相同装修、道具与光照风格，仅改变机位' },
  { id: 'right_45', label: '右45°', description: '从场景右侧斜向观看', prompt: '同一场景从右侧约45度斜向视角观看，保持相同装修、道具与光照风格，仅改变机位' },
  { id: 'reverse', label: '对面', description: '反打/对面方向', prompt: '同一场景从对面方向观看（反打机位），空间布局一致但观察方向相反，适合对话镜头' },
  { id: 'top_down', label: '俯视', description: '略高机位俯视空间', prompt: '同一场景的略高机位俯视视角，强调地面布局与人物活动区域，保持场景一致' },
  { id: 'detail', label: '细节', description: '场景局部特写背景', prompt: '同一场景的局部细节视角（墙面、窗户、关键道具近景），保持材质与色调一致' },
]

export const SCENE_ANGLE_SHEET_ID = 'multi_view_sheet'
export const SCENE_ANGLE_SHEET_LABEL = '多视角拼板'

export function parseSceneAngleImages(raw) {
  if (!raw) return []
  if (typeof raw === 'object') return Array.isArray(raw) ? raw : []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function listSceneImages(scene) {
  const primaryUrl = String(scene?.image_url || scene?.imageUrl || scene?.local_path || scene?.localPath || '').replace(/^\/+/, '')
  const items = []
  if (primaryUrl) items.push({ angle_id: 'hero', label: '主视角', url: primaryUrl })
  for (const entry of parseSceneAngleImages(scene?.reference_images || scene?.referenceImages)) {
    if (!items.some(item => item.angle_id === entry.angle_id)) items.push(entry)
  }
  return items
}

export function resolveSceneImageUrl(scene, angleId) {
  const normalized = String(angleId || '').trim()
  if (!normalized || normalized === 'hero') {
    return String(scene?.image_url || scene?.imageUrl || scene?.local_path || scene?.localPath || '').replace(/^\/+/, '') || null
  }
  const match = parseSceneAngleImages(scene?.reference_images || scene?.referenceImages)
    .find(item => item.angle_id === normalized)
  if (match?.url) return String(match.url).replace(/^\/+/, '')
  return String(scene?.image_url || scene?.imageUrl || '').replace(/^\/+/, '') || null
}

export function resolveSceneImageForStoryboard(scene, storyboard) {
  const angleId = storyboard?.scene_angle_id || storyboard?.sceneAngleId || 'hero'
  return resolveSceneImageUrl(scene, angleId)
}

export function sceneAngleLabel(angleId) {
  if (!angleId || angleId === 'hero') return '主视角'
  if (angleId === 'blocking') return '站位图'
  if (String(angleId).startsWith('blocking:')) return '站位图'
  if (angleId === SCENE_ANGLE_SHEET_ID) return SCENE_ANGLE_SHEET_LABEL
  return SCENE_ANGLE_PRESETS.find(item => item.id === angleId)?.label || angleId
}

/** 场景图列表 + 本镜头站位图（只读展示，不写入场景主图） */
export function listSceneImagesForStoryboard(scene, storyboard, getBlockingImage) {
  const items = listSceneImages(scene).map(item => ({ ...item, readonly: false }))
  const blockingUrl = getBlockingImage?.(storyboard)
  if (blockingUrl) {
    items.push({
      angle_id: 'blocking',
      label: '站位图',
      url: String(blockingUrl).replace(/^\/+/, ''),
      readonly: true,
    })
  }
  return items
}

/** 场景页：主视角/多角度 + 各镜头站位图 */
export function listSceneImagesWithStoryboardBlockings(scene, storyboards = [], getBlockingImage) {
  const items = listSceneImages(scene).map(item => ({ ...item, readonly: false }))
  for (const sb of storyboards) {
    const sceneId = sb?.scene_id || sb?.sceneId
    if (sceneId !== scene?.id) continue
    const url = getBlockingImage?.(sb)
    if (!url) continue
    const angleId = `blocking:${sb.id}`
    if (items.some(item => item.angle_id === angleId)) continue
    const num = sb.storyboard_number || sb.storyboardNumber || sb.id
    items.push({
      angle_id: angleId,
      label: `站位 #${num}`,
      url: String(url).replace(/^\/+/, ''),
      readonly: true,
    })
  }
  return items
}

export function sceneAngleKey(sceneId, angleId) {
  return `${sceneId}:${angleId}`
}

function sceneBaseDescription(scene) {
  const custom = String(scene?.prompt || '').trim()
  if (custom) return custom
  return `${scene.location}, ${scene.time || ''}`.replace(/,\s*,/g, ',').replace(/,\s*$/, '')
}

export function buildSceneAnglePrompt(scene, angleId, customPrompt) {
  if (customPrompt?.trim()) return customPrompt.trim()
  const preset = SCENE_ANGLE_PRESETS.find(item => item.id === angleId)
  if (!preset) throw new Error(`未知场景角度：${angleId}`)
  const base = sceneBaseDescription(scene)
  return [
    `场景「${scene.location}」${scene.time ? `（${scene.time}）` : ''}。`,
    base ? `场景描述：${base}。` : '',
    preset.prompt,
    '严格以参考图1为同一场景基准：保持空间结构、装修风格、主要道具、色调与光照一致，仅改变观察角度/机位；',
    '输出写实影视场景图，非插画；干净无文字水印。',
  ].filter(Boolean).join('')
}

export function buildSceneAngleSheetPrompt(scene, customPrompt) {
  if (customPrompt?.trim()) return customPrompt.trim()
  const base = sceneBaseDescription(scene)
  const panels = SCENE_ANGLE_PRESETS.slice(0, 4)
    .map((preset, index) => `格${index + 1}：${preset.label} — ${preset.prompt}`)
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
