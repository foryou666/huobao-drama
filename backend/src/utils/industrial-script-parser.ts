export interface ParsedSceneHeader {
  code?: string
  location: string
  time: string
  raw: string
}

export interface ParsedIndustrialShot {
  shotNumber: number
  title: string
  duration: number
  shotType?: string
  angle?: string
  movement?: string
  lighting?: string
  performance?: string
  dialogue?: string
  dialogueType: string
  aiPromptEn?: string
  aiPromptZh?: string
  industrialBlock: string
  isIndustrial: boolean
  sceneHeader?: ParsedSceneHeader
  location?: string
  time?: string
}

export interface ParseIndustrialScriptResult {
  shots: ParsedIndustrialShot[]
  skipped_template_count: number
  marker_count: number
}

const SCENE_RE = /【场景[：:]\s*(?:S\d+\s*)?([^·\】]+?)(?:\s*[·•]\s*|\s+)([^】]+?)】/
const SHOT_HEADER_RE = /【镜头\s*(\d+)\s*[-–—]\s*([^】]+)】/
const SHOT_MARKER_RE = /【镜头\s*\d+\s*[-–—]/g
const FIELD_LABELS = [
  '时长',
  '景别与角度',
  '运镜方式',
  '打光细化',
  '表演与微表情',
  '台词/音效',
  'AI补充提示词（中文版）',
  'AI补充提示词',
] as const

function normalizeText(raw: string) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\*\*/g, '')
    .trim()
}

function parseDuration(raw?: string): number {
  const m = String(raw || '').match(/([\d.]+)/)
  if (!m) return 2
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : 2
}

function inferDialogueType(text: string): string {
  const raw = String(text || '')
  if (/【系统/.test(raw) || /系统提示音/.test(raw)) return 'system'
  if (/【音效】/.test(raw) || /^【音效/.test(raw)) return 'sfx'
  if (/\(VO\)|（VO）/i.test(raw)) return 'vo'
  if (/\(OS\)|（OS）/.test(raw)) return 'os'
  if (/^【闪白/.test(raw)) return 'transition'
  return 'dialogue'
}

function parseSceneHeader(line: string): ParsedSceneHeader | null {
  const m = line.match(SCENE_RE)
  if (!m) return null
  const codeMatch = line.match(/S(\d+)/i)
  return {
    code: codeMatch ? `S${codeMatch[1]}` : undefined,
    location: m[1].trim(),
    time: m[2].trim(),
    raw: line.trim(),
  }
}

function extractField(block: string, label: string): string | undefined {
  const labels = label === 'AI补充提示词'
    ? ['AI补充提示词（中文版）', 'AI补充提示词']
    : [label]
  for (const name of labels) {
    const re = new RegExp(`${name}[：:]\\s*([\\s\\S]*?)(?=\\n(?:${FIELD_LABELS.map(f => f.replace(/[()/]/g, '\\$&')).join('|')})[：:]|$)`, 'i')
    const m = block.match(re)
    if (m?.[1]) {
      const value = m[1].trim()
      if (value) return value
    }
  }
  return undefined
}

function buildDescription(shot: Partial<ParsedIndustrialShot>): string {
  const parts = [shot.performance, shot.dialogue].filter(Boolean)
  return parts.join(' · ').slice(0, 280)
}

function buildIndustrialBlock(shot: Partial<ParsedIndustrialShot> & { shotNumber: number; title: string; duration: number }): string {
  const lines = [
    `【镜头 ${String(shot.shotNumber).padStart(3, '0')} - ${shot.title}】`,
    '',
    `时长：${shot.duration}秒`,
  ]
  if (shot.shotType || shot.angle) lines.push('', `景别与角度：${[shot.shotType, shot.angle].filter(Boolean).join('，')}`)
  if (shot.movement) lines.push('', `运镜方式：${shot.movement}`)
  if (shot.lighting) lines.push('', `打光细化：${shot.lighting}`)
  if (shot.performance) lines.push('', `表演与微表情：${shot.performance}`)
  if (shot.dialogue) lines.push('', `台词/音效：${shot.dialogue}`)
  if (shot.aiPromptEn) lines.push('', `AI补充提示词：${shot.aiPromptEn}`)
  if (shot.aiPromptZh) lines.push('', `AI补充提示词（中文版）：${shot.aiPromptZh}`)
  return lines.join('\n').trim()
}

/** 识别提示词模板里的占位示例镜头（非 DeepSeek 生成结果） */
export function isTemplatePlaceholderShot(shot: ParsedIndustrialShot): boolean {
  const title = shot.title.trim()
  // 仅匹配模板占位标题，勿误伤「悬念钩子 猫爪心声」等真实钩子镜
  if (/动作描述\s*[\/／]\s*角色标签|^XXX$/i.test(title)) return true
  if (/^悬念钩子$/i.test(title)) return true

  const block = shot.industrialBlock || ''
  if (/（从速查表选择）|（格式同上）|（复制场景库基准）/.test(block)) return true
  if (/^时长[：:]\s*1-3秒/m.test(block) && /（从速查表选择）/.test(block)) return true

  if (shot.aiPromptEn && /英文描述，包含/.test(shot.aiPromptEn)) return true
  if (shot.aiPromptZh && /中文描述，包含/.test(shot.aiPromptZh)) return true
  if (shot.performance && /^眼睛\/嘴角\/眉头/.test(shot.performance)) return true
  if (shot.dialogue && /^[""]对话[""]/.test(shot.dialogue)) return true

  return false
}

function buildSceneTimeline(text: string): Array<{ index: number; scene: ParsedSceneHeader }> {
  const items: Array<{ index: number; scene: ParsedSceneHeader }> = []
  const re = /【场景[：:][^】]+】/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const scene = parseSceneHeader(match[0])
    if (scene) items.push({ index: match.index, scene })
  }
  return items
}

function sceneAtPosition(timeline: Array<{ index: number; scene: ParsedSceneHeader }>, pos: number) {
  let current: ParsedSceneHeader | undefined
  for (const item of timeline) {
    if (item.index <= pos) current = item.scene
    else break
  }
  return current
}

function parseShotBlock(block: string, sceneHeader?: ParsedSceneHeader): ParsedIndustrialShot | null {
  const headerMatch = block.match(SHOT_HEADER_RE)
  if (!headerMatch) return null

  const shotNumber = Number(headerMatch[1])
  const title = headerMatch[2].trim()
  if (!Number.isFinite(shotNumber)) return null

  const durationRaw = extractField(block, '时长')
  const angleRaw = extractField(block, '景别与角度')
  const movement = extractField(block, '运镜方式')
  const lighting = extractField(block, '打光细化')
  const performance = extractField(block, '表演与微表情')
  const dialogue = extractField(block, '台词/音效')
  const aiPromptZh = extractField(block, 'AI补充提示词（中文版）')
  const aiPromptEn = extractField(block, 'AI补充提示词')

  const hasIndustrial = !!(angleRaw && (aiPromptEn || aiPromptZh))
  const duration = parseDuration(durationRaw)

  let shotType: string | undefined
  let angle: string | undefined
  if (angleRaw) {
    const parts = angleRaw.split(/[，,]/).map(s => s.trim()).filter(Boolean)
    shotType = parts[0]
    angle = parts.slice(1).join('，') || undefined
  }

  const parsed: ParsedIndustrialShot = {
    shotNumber,
    title,
    duration,
    shotType,
    angle,
    movement,
    lighting,
    performance,
    dialogue,
    dialogueType: inferDialogueType(dialogue || ''),
    aiPromptEn,
    aiPromptZh,
    industrialBlock: block.trim(),
    isIndustrial: hasIndustrial,
    sceneHeader,
    location: sceneHeader?.location,
    time: sceneHeader?.time,
  }

  if (!parsed.industrialBlock) {
    parsed.industrialBlock = buildIndustrialBlock(parsed)
  }

  return parsed
}

function dedupeShots(shots: ParsedIndustrialShot[]): ParsedIndustrialShot[] {
  const byNumber = new Map<number, ParsedIndustrialShot>()
  for (const shot of shots) {
    const existing = byNumber.get(shot.shotNumber)
    if (!existing) {
      byNumber.set(shot.shotNumber, shot)
      continue
    }
    const existingTemplate = isTemplatePlaceholderShot(existing)
    const incomingTemplate = isTemplatePlaceholderShot(shot)
    if (existingTemplate && !incomingTemplate) {
      byNumber.set(shot.shotNumber, shot)
      continue
    }
    if (!existingTemplate && incomingTemplate) continue
    if ((shot.industrialBlock?.length || 0) > (existing.industrialBlock?.length || 0)) {
      byNumber.set(shot.shotNumber, shot)
    }
  }
  return [...byNumber.values()].sort((a, b) => a.shotNumber - b.shotNumber)
}

/** 解析红果工业分镜脚本文本 */
export function parseIndustrialScript(text: string): ParsedIndustrialShot[] {
  return parseIndustrialScriptDetailed(text).shots
}

export function parseIndustrialScriptDetailed(text: string): ParseIndustrialScriptResult {
  const normalized = normalizeText(text)
  if (!normalized) return { shots: [], skipped_template_count: 0, marker_count: 0 }

  const markerCount = (normalized.match(SHOT_MARKER_RE) || []).length
  const timeline = buildSceneTimeline(normalized)
  const parts = normalized.split(/(?=【镜头\s*\d+\s*[-–—])/).map(s => s.trim()).filter(Boolean)

  const rawShots: ParsedIndustrialShot[] = []
  let skippedTemplate = 0

  for (const part of parts) {
    if (!SHOT_HEADER_RE.test(part)) continue
    const pos = normalized.indexOf(part)
    const scene = sceneAtPosition(timeline, pos)
    const shot = parseShotBlock(part, scene)
    if (!shot) continue
    if (isTemplatePlaceholderShot(shot)) {
      skippedTemplate += 1
      continue
    }
    rawShots.push(shot)
  }

  const shots = dedupeShots(rawShots)
  return { shots, skipped_template_count: skippedTemplate, marker_count: markerCount }
}

export function buildClipVideoPrompt(shots: ParsedIndustrialShot[]): string {
  return shots
    .map(s => s.industrialBlock || buildIndustrialBlock(s))
    .join('\n\n---\n\n')
    .trim()
}

export function summarizeShotForList(shot: ParsedIndustrialShot) {
  return {
    shot_number: shot.shotNumber,
    title: shot.title,
    duration: shot.duration,
    location: shot.location || '',
    time: shot.time || '',
    action: shot.performance || '',
    dialogue: shot.dialogue || '',
    dialogue_type: shot.dialogueType,
    description: buildDescription(shot),
    is_industrial: shot.isIndustrial,
  }
}

export function validateParsedImport(result: ParseIndustrialScriptResult): string | null {
  if (result.shots.length) return null
  if (result.marker_count >= 2 && result.skipped_template_count >= 2) {
    return '检测到粘贴的是「提示词模板」示例（如「动作描述/角色标签」），不是 DeepSeek 生成结果。请从百炼对话里复制完整工业分镜输出（标题应为「户部尚书跪地/为难」等具体描述）。'
  }
  if (result.marker_count === 0) {
    return '未能找到【镜头 001 - 标题】格式的内容，请检查粘贴是否完整。'
  }
  return '未能解析出有效镜头，请确认粘贴的是完整工业分镜脚本。'
}
