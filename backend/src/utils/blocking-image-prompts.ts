export type BlockingZone =
  | 'left_front'
  | 'center'
  | 'right_front'
  | 'left_back'
  | 'right_back'

export type BlockingFacing = 'left' | 'right' | 'front' | 'back' | 'camera'

export interface BlockingLayoutEntry {
  character_id: number
  zone: BlockingZone
  facing?: BlockingFacing
  action?: string
}

export interface BlockingLayout {
  camera?: {
    shot_type?: string
    angle?: string
    movement?: string
  }
  characters: BlockingLayoutEntry[]
  notes?: string
}

/** 写入 AI 提示词时使用「中间」，避免「中央」触发部分平台敏感词 */
const ZONE_PROMPT_LABELS: Record<BlockingZone, string> = {
  left_front: '左前方',
  center: '中间',
  right_front: '右前方',
  left_back: '左后方',
  right_back: '右后方',
}

const FACING_LABELS: Record<BlockingFacing, string> = {
  left: '面向左',
  right: '面向右',
  front: '面向镜头',
  back: '背对镜头',
  camera: '面向镜头',
}

const DEFAULT_ZONES: BlockingZone[] = [
  'left_front',
  'center',
  'right_front',
  'left_back',
  'right_back',
]

export function parseBlockingLayout(raw?: string | null): BlockingLayout | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const characters = Array.isArray(parsed.characters)
      ? parsed.characters
        .map((item: any) => ({
          character_id: Number(item.character_id),
          zone: item.zone as BlockingZone,
          facing: item.facing as BlockingFacing | undefined,
          action: item.action ? String(item.action) : undefined,
        }))
        .filter((item: BlockingLayoutEntry) => Number.isFinite(item.character_id) && item.zone)
      : []
    return {
      camera: parsed.camera && typeof parsed.camera === 'object' ? parsed.camera : undefined,
      characters,
      notes: parsed.notes ? String(parsed.notes) : undefined,
    }
  } catch {
    return null
  }
}

export function buildDefaultBlockingLayout(characterIds: number[]): BlockingLayout {
  const uniqueIds = [...new Set(characterIds.filter(Boolean))]
  return {
    characters: uniqueIds.map((characterId, index) => ({
      character_id: characterId,
      zone: DEFAULT_ZONES[Math.min(index, DEFAULT_ZONES.length - 1)],
      facing: 'camera',
    })),
  }
}

export function resolveBlockingLayout(
  raw: string | null | undefined,
  characterIds: number[],
): BlockingLayout {
  const parsed = parseBlockingLayout(raw)
  const ids = [...new Set(characterIds.filter(Boolean))]
  if (!ids.length) return { characters: [] }

  const byId = new Map<number, BlockingLayoutEntry>()
  for (const entry of parsed?.characters || []) {
    if (ids.includes(entry.character_id)) byId.set(entry.character_id, entry)
  }

  const defaults = buildDefaultBlockingLayout(ids)
  return {
    camera: parsed?.camera,
    notes: parsed?.notes,
    characters: ids.map((characterId, index) => {
      const existing = byId.get(characterId)
      if (existing) return existing
      return defaults.characters[index] || {
        character_id: characterId,
        zone: 'center',
        facing: 'camera',
      }
    }),
  }
}

const CLOSE_UP_PATTERN = /特写|近景|大特写|extreme\s*close|close[-\s]?up|\bECU\b|\bCU\b|medium\s*close|macro/i
const WIDE_PATTERN = /全景|远景|广角|wide|establishing|full\s*shot|\bWS\b|\bLS\b|long\s*shot/i

export type BlockingShotMode = 'close_up' | 'single' | 'multi'

export function resolveBlockingShotMode(input: {
  shotType?: string | null
  description?: string | null
  imagePrompt?: string | null
  characterCount: number
}): BlockingShotMode {
  const text = [input.shotType, input.description, input.imagePrompt].filter(Boolean).join(' ')
  if (CLOSE_UP_PATTERN.test(text)) return 'close_up'
  if (input.characterCount <= 1) return 'single'
  if (WIDE_PATTERN.test(text) || input.characterCount >= 2) return 'multi'
  return 'single'
}

function pickPrimaryCharacterIndex(
  characters: Array<{ id: number; name: string }>,
  description?: string | null,
  imagePrompt?: string | null,
): number {
  const text = `${description || ''} ${imagePrompt || ''}`.toLowerCase()
  const matchedIndex = characters.findIndex(({ name }) => {
    const normalized = String(name || '').trim().toLowerCase()
    return normalized && text.includes(normalized)
  })
  return matchedIndex >= 0 ? matchedIndex : 0
}

const BLOCKING_SENSITIVE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/在床上[^\s，；]{0,16}(亲密|纠缠|交缠)|亲密纠缠|肢体交缠|交缠/g, '在场景内'],
  [/呼吸急促|喘息|眼神迷离|神情迷离/g, ''],
  [/私密[、,]?灼热|迷幻[、,]?/g, ''],
  [/lips slightly parted/gi, 'neutral expression'],
  [/\bin bed\b/gi, 'in scene'],
  [/sweat glistening[^\s,，；]*/gi, ''],
  [/parted[^\s,，；]*/gi, ''],
  [/亲密|缠绵|诱惑|裸露|半裸|色情/g, ''],
]

const BLOCKING_SENSITIVE_HINT =
  /亲密|纠缠|交缠|bed|parted|sweat|喘息|迷离|私密|灼热|迷幻|诱惑|裸露/i

function sanitizeForBlockingPreviz(text?: string | null): string {
  if (!text?.trim()) return ''
  let value = text.trim()
  for (const [pattern, replacement] of BLOCKING_SENSITIVE_REPLACEMENTS) {
    value = value.replace(pattern, replacement)
  }
  return value
    .replace(/[，；、,\s]{2,}/g, '，')
    .replace(/^[,，；\s]+|[,，；\s]+$/g, '')
    .trim()
}

function buildNeutralBlockingVisual(input: {
  shotType?: string | null
  location?: string | null
  time?: string | null
}): string {
  return [
    input.shotType ? `景别：${input.shotType}` : '',
    input.location ? `场景：${input.location}` : '',
    input.time ? `时间：${input.time}` : '',
    '仅作3D纯色人偶空间站位布局参考，无亲密行为、无性暗示',
  ].filter(Boolean).join('，')
}

function resolveBlockingVisualDescription(input: {
  description?: string | null
  imagePrompt?: string | null
  shotType?: string | null
  location?: string | null
  time?: string | null
}): string {
  const raw = sanitizeForBlockingPreviz(input.imagePrompt || input.description)
  if (!raw || BLOCKING_SENSITIVE_HINT.test(raw)) {
    return buildNeutralBlockingVisual(input)
  }
  return raw
}

function pickBlockingCharacters(
  characters: Array<{ id: number; name: string; entry: BlockingLayoutEntry }>,
  shotMode: BlockingShotMode,
  description?: string | null,
  imagePrompt?: string | null,
) {
  if (shotMode === 'multi') return characters
  if (!characters.length) return characters
  const index = pickPrimaryCharacterIndex(characters, description, imagePrompt)
  return [characters[index] || characters[0]]
}

const MANNEQUIN_COLORS = ['红色', '蓝色', '紫色', '绿色', '橙色', '黄色', '青色', '粉色']

function mannequinColorLabel(index: number): string {
  return MANNEQUIN_COLORS[index % MANNEQUIN_COLORS.length]
}

function buildBlockingStyleRules(shotMode: BlockingShotMode): string {
  const purpose =
    '生成一张 3D 预可视化站位图（previz / blocking diagram），仅表达人物在场景中的空间位置、朝向与相对距离，供后续写实首帧与视频生成参考布局；禁止生成接近成片质量的写实画面，以免干扰后续视频生成。'

  const shared = [
    purpose,
    '整体风格：低多边形 3D 场景 + 纯色 blocking 人偶，类似动画 previz / 三维分镜示意图（参考 cel-shaded 赛璐璐渲染、黑色描边、平涂纯色）。',
    '每位角色呈现为无五官细节的纯色 3D 人偶，各自使用不同高饱和纯色区分身份，不需还原真实服装纹理或皮肤质感。',
    '场景仅保留参考图1中的空间结构与透视关系，环境可适度简化，重点突出人物站位与朝向。',
    '禁止写实摄影、电影感光斑、景深虚化、胶片颗粒、插画海报或 UI 界面；禁止文字水印；禁止亲密行为与性暗示。',
  ]

  if (shotMode === 'close_up') {
    return [
      ...shared,
      '参考图2为镜头主体角色的身份参考；在场景内展示该角色的位置、朝向与景别关系，允许特写/近景构图，聚焦主体纯色人偶。',
      '不要强行改成多人大全景，也不要输出写实面部特写。',
    ].join('')
  }

  if (shotMode === 'single') {
    return [
      ...shared,
      '参考图2为角色身份参考；将单个纯色人偶放入场景并保持位置与朝向关系。',
    ].join('')
  }

  return [
    ...shared,
    '参考图2起为各角色身份参考；必须将多个不同颜色的纯色人偶放入同一场景，清晰展示前后左右站位、朝向与相对距离。',
    '必须呈现多人物 blocking 布局，禁止变成单人大特写；除站位外不要添加无关道具。',
  ].join('')
}

function describeCharacterBlocking(
  name: string,
  entry: BlockingLayoutEntry,
  colorIndex = 0,
): string {
  const color = mannequinColorLabel(colorIndex)
  const zone = ZONE_PROMPT_LABELS[entry.zone] || entry.zone
  const facing = entry.facing ? FACING_LABELS[entry.facing] || entry.facing : '面向镜头'
  const action = sanitizeForBlockingPreviz(entry.action)
  return action
    ? `「${name}」以${color}纯色人偶呈现，站于${zone}，${facing}，动作：${action}`
    : `「${name}」以${color}纯色人偶呈现，站于${zone}，${facing}`
}

export function buildBlockingImagePrompt(input: {
  title?: string | null
  description?: string | null
  imagePrompt?: string | null
  action?: string | null
  atmosphere?: string | null
  shotType?: string | null
  angle?: string | null
  movement?: string | null
  location?: string | null
  time?: string | null
  sceneLocation?: string | null
  sceneTime?: string | null
  characters: Array<{ id: number; name: string; entry: BlockingLayoutEntry }>
  layout?: BlockingLayout | null
  customPrompt?: string | null
  shotMode?: BlockingShotMode
}): string {
  if (input.customPrompt?.trim()) {
    return input.customPrompt.trim()
  }

  const shotMode = input.shotMode || resolveBlockingShotMode({
    shotType: input.shotType,
    description: input.description || input.imagePrompt,
    imagePrompt: input.imagePrompt,
    characterCount: input.characters.length,
  })

  const camera = input.layout?.camera
  const shotType = camera?.shot_type || input.shotType
  const angle = camera?.angle || input.angle
  const movement = camera?.movement || input.movement
  const location = input.location || input.sceneLocation
  const time = input.time || input.sceneTime
  const title = sanitizeForBlockingPreviz(input.title)
  const action = sanitizeForBlockingPreviz(input.action)
  const atmosphere = sanitizeForBlockingPreviz(input.atmosphere)
  const visualDescription = resolveBlockingVisualDescription({
    description: input.description,
    imagePrompt: input.imagePrompt,
    shotType,
    location,
    time,
  })

  const characterLines = pickBlockingCharacters(
    input.characters,
    shotMode,
    input.description,
    input.imagePrompt,
  ).map(({ name, entry }, index) =>
    describeCharacterBlocking(name, entry, index),
  )

  const styleRules = buildBlockingStyleRules(shotMode)

  return [
    title ? `镜头：${title}` : '',
    visualDescription ? `画面描述：${visualDescription}` : '',
    action ? `动作：${action}` : '',
    atmosphere ? `氛围：${atmosphere}` : '',
    location ? `地点：${location}` : '',
    time ? `时间：${time}` : '',
    shotType ? `景别：${shotType}` : '',
    angle ? `机位：${angle}` : '',
    movement ? `运镜：${movement}` : '',
    characterLines.length ? `人物站位：${characterLines.join('；')}` : '',
    input.layout?.notes ? `站位备注：${input.layout.notes}` : '',
    styleRules,
  ].filter(Boolean).join('；')
}

export function collectBlockingReferenceImages(input: {
  sceneImage?: string | null
  characterImages: string[]
  maxCharacterRefs?: number
}): string[] {
  const refs: string[] = []
  const push = (url?: string | null) => {
    const value = String(url || '').trim()
    if (value && !refs.includes(value)) refs.push(value)
  }

  push(input.sceneImage)
  const limit = input.maxCharacterRefs ?? input.characterImages.length
  for (const image of input.characterImages.slice(0, Math.max(0, limit))) push(image)
  return refs.slice(0, 6)
}

export function selectBlockingCharacterImages(
  characterImages: string[],
  characterMeta: Array<{ id: number; name: string }>,
  shotMode: BlockingShotMode,
  description?: string | null,
  imagePrompt?: string | null,
): string[] {
  if (!characterImages.length) return []
  if (shotMode === 'multi') return characterImages
  const index = pickPrimaryCharacterIndex(characterMeta, description, imagePrompt)
  return [characterImages[index] || characterImages[0]]
}

export function collectFrameFromBlockingReferences(input: {
  blockingImage: string
  sceneImage?: string | null
  characterImages: string[]
}): string[] {
  const refs: string[] = []
  const push = (url?: string | null) => {
    const value = String(url || '').trim()
    if (value && !refs.includes(value)) refs.push(value)
  }

  push(input.blockingImage)
  push(input.sceneImage)
  for (const image of input.characterImages) push(image)
  return refs.slice(0, 6)
}

export function buildFirstFrameFromBlockingPrompt(input: {
  title?: string | null
  description?: string | null
  imagePrompt?: string | null
  action?: string | null
  atmosphere?: string | null
  shotType?: string | null
  angle?: string | null
  movement?: string | null
  location?: string | null
  time?: string | null
  characters: Array<{ name: string; entry: BlockingLayoutEntry }>
  frameType?: 'first_frame' | 'last_frame'
  customPrompt?: string | null
}): string {
  if (input.customPrompt?.trim()) {
    return input.customPrompt.trim()
  }

  const frameType = input.frameType || 'first_frame'
  const frameHint = frameType === 'first_frame'
    ? '生成这个镜头的起始关键帧，突出建立关系和动作开始瞬间'
    : '生成这个镜头的结束关键帧，突出动作结束、情绪落点或结果状态'

  const characterLines = input.characters.map(({ name, entry }) =>
    describeCharacterBlocking(name, entry),
  )

  const styleRules = [
    '基于参考图1（3D 纯色人偶站位图 / blocking diagram）严格保持人物空间站位、前后远近、朝向、机位、景别与整体构图，不得改变 blocking 关系。',
    '参考图2为场景环境，参考图3起为各角色身份与服装，用于写实化面部、服装与光影质感。',
    '输出写实影视级关键帧静帧，高质感、自然皮肤与场景细节；禁止输出 3D 灰模 / 纯色人偶 / cel-shaded previz / 插画风格。',
    '保持同一场景连戏一致，不要添加无关文字水印。',
  ].join('')

  return [
    input.title ? `镜头标题：${input.title}` : '',
    (input.imagePrompt || input.description) ? `画面描述：${input.imagePrompt || input.description}` : '',
    input.action ? `动作：${input.action}` : '',
    input.atmosphere ? `氛围：${input.atmosphere}` : '',
    input.location ? `地点：${input.location}` : '',
    input.time ? `时间：${input.time}` : '',
    input.shotType ? `景别：${input.shotType}` : '',
    input.angle ? `机位：${input.angle}` : '',
    input.movement ? `运镜：${input.movement}` : '',
    characterLines.length ? `人物站位：${characterLines.join('；')}` : '',
    frameHint,
    styleRules,
  ].filter(Boolean).join('；')
}
