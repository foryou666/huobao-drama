export const BLOCKING_ZONES = [
  { id: 'left_front', label: '左前方' },
  { id: 'center', label: '中间' },
  { id: 'right_front', label: '右前方' },
  { id: 'left_back', label: '左后方' },
  { id: 'right_back', label: '右后方' },
]

export const BLOCKING_FACINGS = [
  { id: 'camera', label: '面向镜头' },
  { id: 'left', label: '面向左' },
  { id: 'right', label: '面向右' },
  { id: 'front', label: '正面' },
  { id: 'back', label: '背对镜头' },
]

export function parseBlockingLayout(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function buildDefaultBlockingLayout(characterIds) {
  const zones = BLOCKING_ZONES.map(item => item.id)
  return {
    characters: [...new Set((characterIds || []).filter(Boolean))].map((characterId, index) => ({
      character_id: characterId,
      zone: zones[Math.min(index, zones.length - 1)],
      facing: 'camera',
    })),
  }
}

export function resolveBlockingLayout(raw, characterIds) {
  const parsed = parseBlockingLayout(raw)
  const ids = [...new Set((characterIds || []).filter(Boolean))]
  const byId = new Map((parsed?.characters || []).map(entry => [entry.character_id, entry]))
  const defaults = buildDefaultBlockingLayout(ids)
  return {
    camera: parsed?.camera || {},
    notes: parsed?.notes || '',
    characters: ids.map((characterId, index) =>
      byId.get(characterId) || defaults.characters[index] || {
        character_id: characterId,
        zone: 'center',
        facing: 'camera',
      },
    ),
  }
}

export const MANNEQUIN_COLORS = [
  { id: 'red', label: '红色', css: '#e74c3c' },
  { id: 'blue', label: '蓝色', css: '#3498db' },
  { id: 'purple', label: '紫色', css: '#9b59b6' },
  { id: 'green', label: '绿色', css: '#2ecc71' },
  { id: 'orange', label: '橙色', css: '#e67e22' },
  { id: 'yellow', label: '黄色', css: '#f1c40f' },
  { id: 'cyan', label: '青色', css: '#1abc9c' },
  { id: 'pink', label: '粉色', css: '#fd79a8' },
]

export function mannequinColorLabel(index) {
  return MANNEQUIN_COLORS[index % MANNEQUIN_COLORS.length]?.label || '纯色'
}

export function mannequinColorCss(index) {
  return MANNEQUIN_COLORS[index % MANNEQUIN_COLORS.length]?.css || '#888'
}

function zoneLabel(zoneId) {
  return BLOCKING_ZONES.find(item => item.id === zoneId)?.label || zoneId || ''
}

function facingLabel(facingId) {
  return BLOCKING_FACINGS.find(item => item.id === (facingId || 'camera'))?.label || ''
}

/** 与生成站位图时的颜色顺序一致（按下方角色列表从上到下） */
export function buildBlockingColorLegend(layout, nameById) {
  return (layout?.characters || []).map((entry, index) => {
    const name = typeof nameById === 'function'
      ? nameById(entry.character_id)
      : (nameById?.[entry.character_id] || `#${entry.character_id}`)
    const color = mannequinColorLabel(index)
    const zone = zoneLabel(entry.zone)
    const facing = facingLabel(entry.facing)
    const parts = [`${color}人偶=${name}`]
    if (zone) parts.push(zone)
    if (facing) parts.push(facing)
    return parts.join('/')
  })
}

/** 写入 video_prompt 首行的站位图说明（图片N 需与实际上传顺序一致） */
export function buildBlockingVideoPromptSnippet(layout, nameById, imageIndex) {
  const legend = buildBlockingColorLegend(layout, nameById)
  if (!legend.length) return ''
  const legendText = legend.join('，')
  const indexPart = Number.isFinite(imageIndex) && imageIndex > 0
    ? `图片${imageIndex}是`
    : '图片N是'
  return `${indexPart}3D站位参考图（${legendText}；仅作空间布局参考，成片须替换为真人形象，勿保留纯色人偶外观）`
}

export function getBlockingImageIndexFromPromptItems(items) {
  const match = (items || []).find(item => item.source === 'blocking' && item.imageIndex)
  if (match?.imageIndex) return match.imageIndex

  const numbered = (items || []).filter(item => item.type === 'image' && !item.technical)
  const idx = numbered.findIndex(item => item.source === 'blocking')
  return idx >= 0 ? idx + 1 : null
}

const CLOSE_UP_PATTERN = /特写|近景|大特写|extreme\s*close|close[-\s]?up|\bECU\b|\bCU\b|medium\s*close|macro/i

export function resolveBlockingShotMode(sb, characterCount = 0) {
  const text = [
    sb?.shot_type || sb?.shotType,
    sb?.description,
    sb?.image_prompt || sb?.imagePrompt,
  ].filter(Boolean).join(' ')
  if (CLOSE_UP_PATTERN.test(text)) return 'close_up'
  if (characterCount <= 1) return 'single'
  return 'multi'
}

export function blockingShotModeHint(sb, characterCount = 0) {
  const mode = resolveBlockingShotMode(sb, characterCount)
  if (mode === 'close_up') {
    return '检测到特写/近景镜头：将自动使用场景 + 主体角色参考图，并允许特写构图。生成时会自动弱化动作/画面中的敏感描述。'
  }
  if (mode === 'single') return '单角色镜头：将使用场景 + 1 张角色参考图。生成时会自动弱化敏感描述。'
  return '多角色镜头：将使用场景 + 全部绑定角色参考图。生成时会自动弱化敏感描述。'
}

export function updateBlockingLayoutEntry(layout, characterId, patch) {
  const next = resolveBlockingLayout(layout, layout.characters.map(item => item.character_id))
  next.characters = next.characters.map(entry =>
    entry.character_id === characterId ? { ...entry, ...patch } : entry,
  )
  return next
}

export function getBlockingImage(sb) {
  return sb?.blocking_image || sb?.blockingImage || null
}
