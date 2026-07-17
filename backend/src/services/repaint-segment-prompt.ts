import { getTextConfig, getTextProviderBaseUrl } from './ai.js'
import { logTaskError, logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'
import { CHENGMENT_PROMPT_MAX_LENGTH } from '../constants/chengmeng.js'
import type { RepaintAnalysis, RepaintShotVisual } from './repaint-types.js'
import type { PackedSegment } from './repaint-segments.js'

function roundSec(n: number) {
  return Math.round(n * 100) / 100
}

function formatClock(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function utterancesInRange(analysis: RepaintAnalysis, start: number, end: number) {
  return analysis.utterances.filter(u => u.start_sec < end && u.end_sec > start)
}

function shotEntities(analysis: RepaintAnalysis, shotId: string) {
  const assignment = analysis.shot_assignments.find(a => a.shot_id === shotId)
  const chars = analysis.characters.filter(c =>
    assignment?.character_ids.includes(c.id) || c.shot_ids?.includes(shotId),
  )
  const scenes = analysis.scenes.filter(s =>
    assignment?.scene_id === s.id || s.shot_ids?.includes(shotId),
  )
  const props = analysis.props.filter(p =>
    assignment?.prop_ids.includes(p.id) || p.shot_ids?.includes(shotId),
  )
  return { assignment, chars, scenes, props }
}

function segmentPartTitle(analysis: RepaintAnalysis, packed: PackedSegment, segmentIndex: number) {
  const sceneNames = new Set<string>()
  for (const shotId of packed.shot_ids) {
    for (const scene of shotEntities(analysis, shotId).scenes) {
      if (scene.location) sceneNames.add(scene.location)
    }
  }
  const label = [...sceneNames][0] || 'Segment'
  return `Part ${segmentIndex + 1}: ${label}`
}

function shotDialogue(analysis: RepaintAnalysis, shotId: string, segStart: number, segEnd: number) {
  const { assignment } = shotEntities(analysis, shotId)
  const lines = utterancesInRange(analysis, segStart, segEnd)
    .filter(u => assignment?.utterance_ids.includes(u.id))
    .map(u => u.text.trim())
    .filter(Boolean)
  return lines.join(' ')
}

function getShotVisual(analysis: RepaintAnalysis, shotId: string): RepaintShotVisual | undefined {
  return analysis.shot_visuals?.find(v => v.shot_id === shotId)
}

function formatShotBlockFromVisual(
  shotIndex: number,
  relStart: number,
  relEnd: number,
  dur: number,
  visual: RepaintShotVisual,
  dialogueFallback: string,
) {
  const sizeLine = visual.shot_size_detail
    ? `${visual.shot_size} —— ${visual.shot_size_detail}`
    : (visual.shot_size || '中景 (MS)')
  const movement = visual.camera_movement || '固定 (Static)'
  const motivation = visual.movement_motivation
    ? `。【内在动机】：${visual.movement_motivation}`
    : ''

  const lines = [
    `Shot ${shotIndex} (${formatClock(relStart)} - ${formatClock(relEnd)})`,
    `• Shot ID & Duration: Shot ${shotIndex} / ${dur}s`,
    `• Shot Size（景别）: ${sizeLine}`,
    `• Camera Angle（角度）: ${visual.camera_angle || '平视 (Eye-level)'}`,
    `• Camera Movement（运镜）: ${movement}${motivation}`,
    `• Action & Blocking（剧情与调度）：${visual.action_blocking || '（见画面）'}`,
    `• Dialogue: ${visual.dialogue_note || dialogueFallback || 'Silence.'}`,
    '',
  ]
  return lines.join('\n')
}

function buildShotContextBlock(
  analysis: RepaintAnalysis,
  packed: PackedSegment,
  shotIndex: number,
  shotId: string,
) {
  const shot = analysis.shots.find(s => s.id === shotId)
  if (!shot) return ''
  const relStart = roundSec(shot.start_sec - packed.start_sec)
  const relEnd = roundSec(shot.end_sec - packed.start_sec)
  const dur = roundSec(Math.max(0.1, relEnd - relStart))
  const { chars, scenes, props } = shotEntities(analysis, shotId)
  const dialogue = shotDialogue(analysis, shotId, packed.start_sec, packed.end_sec)
  const visual = getShotVisual(analysis, shotId)

  const lines = [
    `Shot ${shotIndex} (${formatClock(relStart)} - ${formatClock(relEnd)})`,
    `  duration: ${dur}s`,
    `  characters: ${chars.map(c => c.name).join('、') || '—'}`,
    `  scene: ${scenes.map(s => s.location).join('、') || '—'}`,
    `  props: ${props.map(p => p.name).join('、') || '—'}`,
    `  dialogue (ASR, do not rewrite): ${dialogue || 'Silence'}`,
  ]

  if (visual) {
    lines.push(
      `  [视觉分析] 景别: ${visual.shot_size || '—'}`,
      `  [视觉分析] 角度: ${visual.camera_angle || '—'}`,
      `  [视觉分析] 运镜: ${visual.camera_movement || '—'}`,
      `  [视觉分析] 动机: ${visual.movement_motivation || '—'}`,
      `  [视觉分析] 调度: ${visual.action_blocking || '—'}`,
      `  [视觉分析] 对白: ${visual.dialogue_note || dialogue || 'Silence'}`,
    )
  }

  lines.push(
    chars.map(c => `  - ${c.name}: ${c.appearance || c.description || ''}`).join('\n'),
    scenes.map(s => `  - scene ${s.location}: ${s.prompt || ''}`).join('\n'),
  )

  return lines.filter(Boolean).join('\n')
}

function buildLlmUserPrompt(
  analysis: RepaintAnalysis,
  packed: PackedSegment,
  segmentIndex: number,
  imageHeader: string,
) {
  const partTitle = segmentPartTitle(analysis, packed, segmentIndex)
  const blocks = packed.shot_ids.map((shotId, idx) =>
    buildShotContextBlock(analysis, packed, idx + 1, shotId),
  ).join('\n\n')

  return [
    `【分段】${partTitle}`,
    `【片段时间】${formatClock(0)} - ${formatClock(packed.duration_sec)}（${roundSec(packed.duration_sec)}s）`,
    imageHeader ? `【参考图映射】${imageHeader}` : '',
    '【本段镜头清单】',
    blocks,
    '',
    '请输出该分段的完整 Seedance 视频 Prompt 正文（不要 JSON）。',
  ].filter(Boolean).join('\n')
}

const SEGMENT_PROMPT_SYSTEM = `你是欧美真人写实短剧（Western cinematic realistic）的视频转绘分镜编剧。
根据镜头切分、ASR 台词、角色/场景信息与【视觉分析】字段，为每个分段撰写可直接用于 AI 视频生成的详细分镜 Prompt。

输出要求：
1. 第一行写 Part 标题，格式：Part N: 英文短标题 (中文场景名)
2. 每个镜头按下列结构输出（字段名必须保留，内容用中文撰写；专业术语可中英并列）：

Shot K (MM:SS - MM:SS)
• Shot ID & Duration: Shot K / X.Xs
• Shot Size（景别）: 如 中近景 (MCU) —— 构图说明
• Camera Angle（角度）: 如 平视 (Eye-level) / 过肩拍 (OTS)
• Camera Movement（运镜）: 如 固定 (Static) / 后退拉镜头 (Dolly Back)。【内在动机】：运镜原因
• Action & Blocking（剧情与调度）：角色位置、朝向、肢体动作、道具互动，具体到可拍摄
• Dialogue: 台词原文（ASR 为准，不改写）；无对白写 Silence.；画外音标注 (O.S.)

3. 若输入含【视觉分析】，必须优先采用其景别/角度/运镜/调度描述，仅做润色整合，禁止推翻
4. 风格：Western cinematic realistic，自然光/电影感；尽可能匹配原镜头构图、站位、景别与运镜
5. 若含原片关键帧参考（图片1），构图与人物站位必须与参考帧高度一致
6. 台词必须与输入 ASR 一致，禁止编造新对白
7. 角色名使用中文原名；可参考【参考图映射】中的图片编号约束外观
8. 全段总字数控制在 1200 字以内（含英文术语）`

export interface SegmentPromptOptions {
  fidelityMode?: boolean
  sourceShotDuration?: number
  shotCount?: number
}

function fidelityStyleLine(options?: SegmentPromptOptions, genDurationSec?: number) {
  if (!options?.fidelityMode) {
    return 'Western cinematic realistic short drama. Maintain dialogue rhythm, not pixel-level match.'
  }
  const parts = [
    'Western cinematic realistic short drama.',
    '【精确还原】尽可能匹配原镜头构图、人物左右站位、前后景关系、景别、运镜与道具位置。',
    '图片1为原片关键帧时，构图与站位必须高度一致；其余参考图约束角色/场景外观。',
  ]
  if ((options.shotCount || 1) > 1) {
    parts.push(`本段包含 ${options.shotCount} 个镜头，按时间轴顺序依次还原，切镜点与原片对齐。`)
  }
  const src = options.sourceShotDuration
  if (src && genDurationSec && genDurationSec > src + 0.05) {
    parts.push(`原片段约 ${src}s，本段生成 ${genDurationSec}s，动作节奏按原镜收敛，避免多余运镜。`)
  }
  return parts.join(' ')
}

async function callTextCompletion(system: string, user: string): Promise<string> {
  const config = getTextConfig()
  const baseUrl = getTextProviderBaseUrl(config)
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.35,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  const raw = await resp.text()
  if (!resp.ok) throw new Error(raw.slice(0, 300) || `文本服务错误 ${resp.status}`)
  const json = JSON.parse(raw)
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('分镜 Prompt 未返回内容')
  return content.trim()
}

function inferShotSize(duration: number) {
  if (duration < 1.2) return '大特写 (ECU) —— 面部或道具细节'
  if (duration < 2) return '特写 (CU) —— 锁骨以上'
  if (duration < 3.5) return '中近景 (MCU) —— 胸部以上'
  if (duration < 5.5) return '中景 (MS) —— 腰部以上'
  return '全景 (LS) —— 交代环境与人物站位'
}

function inferMovement(duration: number, hasDialogue: boolean) {
  if (duration < 1.5) return '固定 (Static)。【内在动机】：短镜头凝固情绪或细节'
  if (hasDialogue) return '微幅推镜 (Subtle Push-in)。【内在动机】：配合对白节奏强调说话者'
  return '后退拉镜头 (Dolly Back)。【内在动机】：展示人物与环境关系'
}

function inferAngle(charCount: number, shotIndex: number) {
  if (charCount >= 2 && shotIndex % 2 === 0) return '过肩拍 (Over-the-shoulder, OTS)'
  return '平视 (Eye-level)'
}

function buildPromptBodyFromVisuals(
  analysis: RepaintAnalysis,
  packed: PackedSegment,
  segmentIndex: number,
  options?: SegmentPromptOptions,
) {
  const genDur = roundSec(Math.max(0.1, packed.end_sec - packed.start_sec))
  const blocks: string[] = [segmentPartTitle(analysis, packed, segmentIndex)]
  blocks.push(fidelityStyleLine(options, genDur))
  blocks.push('')

  for (let idx = 0; idx < packed.shot_ids.length; idx++) {
    const shotId = packed.shot_ids[idx]
    const shot = analysis.shots.find(s => s.id === shotId)
    const visual = getShotVisual(analysis, shotId)
    if (!shot || !visual?.shot_size || !visual.action_blocking) return null

    const relStart = roundSec(shot.start_sec - packed.start_sec)
    const relEnd = roundSec(shot.end_sec - packed.start_sec)
    const dur = roundSec(Math.max(0.1, relEnd - relStart))
    const dialogue = shotDialogue(analysis, shotId, packed.start_sec, packed.end_sec)
    const dialogueFallback = dialogue ? `"${dialogue}"` : 'Silence.'

    blocks.push(formatShotBlockFromVisual(idx + 1, relStart, relEnd, dur, visual, dialogueFallback))
  }

  return blocks.join('\n').trim()
}

function buildFallbackSegmentPrompt(
  analysis: RepaintAnalysis,
  packed: PackedSegment,
  segmentIndex: number,
  options?: SegmentPromptOptions,
) {
  const genDur = roundSec(Math.max(0.1, packed.end_sec - packed.start_sec))
  const fromVisuals = buildPromptBodyFromVisuals(analysis, packed, segmentIndex, options)
  if (fromVisuals) return fromVisuals

  const lines: string[] = [segmentPartTitle(analysis, packed, segmentIndex)]
  lines.push(fidelityStyleLine(options, genDur))
  lines.push('')

  packed.shot_ids.forEach((shotId, idx) => {
    const shot = analysis.shots.find(s => s.id === shotId)
    if (!shot) return
    const relStart = roundSec(shot.start_sec - packed.start_sec)
    const relEnd = roundSec(shot.end_sec - packed.start_sec)
    const dur = roundSec(Math.max(0.1, relEnd - relStart))
    const visual = getShotVisual(analysis, shotId)
    const dialogue = shotDialogue(analysis, shotId, packed.start_sec, packed.end_sec)

    if (visual?.shot_size && visual.action_blocking) {
      lines.push(formatShotBlockFromVisual(
        idx + 1,
        relStart,
        relEnd,
        dur,
        visual,
        dialogue ? `"${dialogue}"` : 'Silence.',
      ))
      return
    }

    const { chars, scenes, props } = shotEntities(analysis, shotId)
    const charNames = chars.map(c => c.name).filter(Boolean)
    const sceneName = scenes[0]?.location || '场景'
    const propHint = props.length ? `，道具：${props.map(p => p.name).join('、')}` : ''

    lines.push(`Shot ${idx + 1} (${formatClock(relStart)} - ${formatClock(relEnd)})`)
    lines.push(`• Shot ID & Duration: Shot ${idx + 1} / ${dur}s`)
    lines.push(`• Shot Size（景别）: ${inferShotSize(dur)}`)
    lines.push(`• Camera Angle（角度）: ${inferAngle(charNames.length, idx + 1)}`)
    lines.push(`• Camera Movement（运镜）: ${inferMovement(dur, !!dialogue)}`)
    lines.push(
      `• Action & Blocking（剧情与调度）：${charNames.length ? charNames.join('、') : '人物'}在${sceneName}中，`
      + `${charNames.length >= 2 ? '保持双人空间对峙站位，' : '单人画面，'}`
      + `自然表演，电影感构图${propHint}。`,
    )
    lines.push(`• Dialogue: ${dialogue ? `${charNames[0] || '角色'}: "${dialogue}"` : 'Silence.'}`)
    lines.push('')
  })

  return lines.join('\n').trim()
}

function truncateSegmentBody(body: string, maxLen: number) {
  if (body.length <= maxLen) return body
  const note = `\n…（已达 ${maxLen} 字符上限，后续镜头未写入）`
  const budget = Math.max(120, maxLen - note.length)
  const parts = body.split(/\n(?=Shot \d+)/)
  let out = ''
  for (const part of parts) {
    const next = out ? `${out}\n${part}` : part
    if (next.length > budget) break
    out = next
  }
  if (out && out.length < body.length) return `${out.trimEnd()}${note}`
  return `${body.slice(0, budget).trimEnd()}${note}`
}

function composeFinalPrompt(imageHeader: string, body: string) {
  const header = imageHeader ? `${imageHeader}\n` : ''
  const merged = `${header}${body}`.trim()
  if (merged.length <= CHENGMENT_PROMPT_MAX_LENGTH) return merged
  const bodyBudget = Math.max(400, CHENGMENT_PROMPT_MAX_LENGTH - header.length - 20)
  const trimmedBody = truncateSegmentBody(body, bodyBudget)
  return `${header}${trimmedBody}`.trim()
}

export async function generateDetailedSegmentPrompt(
  analysis: RepaintAnalysis,
  packed: PackedSegment,
  segmentIndex: number,
  imageHeader: string,
  options?: SegmentPromptOptions,
): Promise<string> {
  logTaskProgress('RepaintSegmentPrompt', 'generate', {
    segment: segmentIndex,
    shots: packed.shot_ids.length,
    fidelity: !!options?.fidelityMode,
  })

  try {
    const direct = buildPromptBodyFromVisuals(analysis, packed, segmentIndex, options)
    if (direct) {
      const finalPrompt = composeFinalPrompt(imageHeader, direct)
      logTaskSuccess('RepaintSegmentPrompt', 'from-vision', { segment: segmentIndex, length: finalPrompt.length })
      return finalPrompt
    }

    const user = buildLlmUserPrompt(analysis, packed, segmentIndex, imageHeader)
    const body = await callTextCompletion(SEGMENT_PROMPT_SYSTEM, user)
    if (!body.includes('Shot ') && !body.includes('Shot ID')) {
      throw new Error('LLM 输出格式不符')
    }
    const finalPrompt = composeFinalPrompt(imageHeader, body)
    logTaskSuccess('RepaintSegmentPrompt', 'generate', { segment: segmentIndex, length: finalPrompt.length })
    return finalPrompt
  } catch (err: any) {
    logTaskError('RepaintSegmentPrompt', 'generate-fallback', {
      segment: segmentIndex,
      error: err.message,
    })
    const fallback = buildFallbackSegmentPrompt(analysis, packed, segmentIndex, options)
    return composeFinalPrompt(imageHeader, fallback)
  }
}
