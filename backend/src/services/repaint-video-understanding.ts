import { getActiveConfig, getTextProviderBaseUrl, type AIConfig } from './ai.js'
import { trySyncStaticToOss } from '../utils/oss-entity-sync.js'
import { resolveMediaUrlForExternalApi } from '../utils/oss-upload.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import type { RepaintAnalysis, RepaintShotVisual } from './repaint-types.js'
import {
  attachEntityShotIds,
  mergeShotAssignments,
} from './repaint-types.js'

const VIDEO_MODEL = process.env.REPAINT_VIDEO_MODEL || process.env.REPAINT_VISION_MODEL || 'qwen-vl-max-latest'
const VIDEO_FPS = Number(process.env.REPAINT_VIDEO_FPS || '1') || 1

export interface FullVideoUnderstandingResult {
  video_summary: string
  characters: RepaintAnalysis['characters']
  scenes: RepaintAnalysis['scenes']
  props: RepaintAnalysis['props']
  shot_assignments: RepaintAnalysis['shot_assignments']
  shot_visuals: RepaintShotVisual[]
}

function resolveVisionConfig(): AIConfig {
  const image = getActiveConfig('image')
  if (image?.provider.toLowerCase().includes('ali')) return image
  const text = getActiveConfig('text')
  if (text?.provider.toLowerCase().includes('ali')) return text
  throw new Error('请在设置中配置百炼（ali）文本或图片 API，用于整片视频理解')
}

function dashScopeCompatibleUrl(config: AIConfig) {
  const baseUrl = getTextProviderBaseUrl(config)
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`
}

function stripJsonBlock(text: string) {
  let out = String(text || '').trim()
  const fenced = out.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) out = fenced[1].trim()
  return out
}

function buildContextPrompt(analysis: RepaintAnalysis) {
  const lines: string[] = [
    '【已知镜头切分（ffmpeg 场景检测，请以此为 shot_id 基准）】',
  ]
  for (const shot of analysis.shots) {
    const assignment = analysis.shot_assignments.find(a => a.shot_id === shot.id)
    const dialogue = analysis.utterances
      .filter(u => assignment?.utterance_ids.includes(u.id))
      .map(u => `[${u.start_sec}-${u.end_sec}s] ${u.text}`)
      .join(' ')
    lines.push(`- ${shot.id}: ${shot.start_sec}s-${shot.end_sec}s (${shot.duration_sec}s) | ASR: ${dialogue || '（无对白）'}`)
  }
  if (analysis.utterances.length) {
    lines.push('', '【完整 ASR 台词轴】')
    for (const u of analysis.utterances) {
      lines.push(`- [${u.start_sec}-${u.end_sec}s] ${u.text}`)
    }
  }
  return lines.join('\n')
}

function parseEntitiesFromVideoJson(
  parsed: any,
  analysis: RepaintAnalysis,
): Omit<FullVideoUnderstandingResult, 'video_summary'> {
  const characters: RepaintAnalysis['characters'] = (Array.isArray(parsed.characters) ? parsed.characters : []).map((item: any, idx: number) => ({
    id: String(item.id || `c${idx + 1}`),
    name: String(item.name || '').trim(),
    role: item.role ? String(item.role) : '',
    appearance: item.appearance ? String(item.appearance) : '',
    personality: item.personality ? String(item.personality) : '',
    description: item.description ? String(item.description) : '',
    shot_ids: Array.isArray(item.shot_ids) ? item.shot_ids.map(String) : [],
  })).filter((item: RepaintAnalysis['characters'][number]) => item.name)

  const scenes: RepaintAnalysis['scenes'] = (Array.isArray(parsed.scenes) ? parsed.scenes : []).map((item: any, idx: number) => ({
    id: String(item.id || `sc${idx + 1}`),
    location: String(item.location || '').trim(),
    time: item.time ? String(item.time) : '',
    prompt: item.prompt ? String(item.prompt) : '',
    shot_ids: Array.isArray(item.shot_ids) ? item.shot_ids.map(String) : [],
  })).filter((item: RepaintAnalysis['scenes'][number]) => item.location)

  const props: RepaintAnalysis['props'] = (Array.isArray(parsed.props) ? parsed.props : []).map((item: any, idx: number) => ({
    id: String(item.id || `p${idx + 1}`),
    name: String(item.name || '').trim(),
    type: item.type ? String(item.type) : 'prop',
    description: item.description ? String(item.description) : '',
    prompt: item.prompt ? String(item.prompt) : '',
    shot_ids: Array.isArray(item.shot_ids) ? item.shot_ids.map(String) : [],
  })).filter((item: RepaintAnalysis['props'][number]) => item.name)

  const shotNotes = Array.isArray(parsed.shot_notes) ? parsed.shot_notes : []
  let shot_assignments = mergeShotAssignments(analysis.shot_assignments, shotNotes)

  const charById = new Map(characters.map(c => [c.id, c]))
  const sceneById = new Map(scenes.map(s => [s.id, s]))
  const propById = new Map(props.map(p => [p.id, p]))

  for (const assignment of shot_assignments) {
    for (const cid of assignment.character_ids) {
      const char = charById.get(cid)
      if (char && !char.shot_ids.includes(assignment.shot_id)) char.shot_ids.push(assignment.shot_id)
    }
    for (const pid of assignment.prop_ids) {
      const prop = propById.get(pid)
      if (prop && !prop.shot_ids.includes(assignment.shot_id)) prop.shot_ids.push(assignment.shot_id)
    }
    if (assignment.scene_id) {
      const scene = sceneById.get(assignment.scene_id)
      if (scene && !scene.shot_ids.includes(assignment.shot_id)) scene.shot_ids.push(assignment.shot_id)
    }
  }

  const enrichedChars = attachEntityShotIds(
    characters,
    shot_assignments,
    analysis.utterances,
    (entity, utterance) => utterance.text.includes(entity.name),
  )

  const shot_visuals: RepaintShotVisual[] = (Array.isArray(parsed.shot_visuals) ? parsed.shot_visuals : parsed.shots || [])
    .map((item: any) => ({
      shot_id: String(item.shot_id || ''),
      shot_size: item.shot_size ? String(item.shot_size) : undefined,
      shot_size_detail: item.shot_size_detail ? String(item.shot_size_detail) : undefined,
      camera_angle: item.camera_angle ? String(item.camera_angle) : undefined,
      camera_movement: item.camera_movement ? String(item.camera_movement) : undefined,
      movement_motivation: item.movement_motivation ? String(item.movement_motivation) : undefined,
      action_blocking: item.action_blocking ? String(item.action_blocking) : undefined,
      dialogue_note: item.dialogue_note ? String(item.dialogue_note) : undefined,
    }))
    .filter((item: RepaintShotVisual) => item.shot_id && analysis.shots.some(s => s.id === item.shot_id))

  return {
    characters: enrichedChars,
    scenes,
    props,
    shot_assignments,
    shot_visuals,
  }
}

async function callFullVideoUnderstanding(
  config: AIConfig,
  videoUrl: string,
  analysis: RepaintAnalysis,
): Promise<FullVideoUnderstandingResult> {
  const model = config.model?.includes('vl') ? config.model : VIDEO_MODEL
  const context = buildContextPrompt(analysis)

  const system = `你是专业影视拉片与视频理解分析师。你将观看整段视频，结合 ASR 台词与镜头切分，输出用于「视频转绘」的结构化理解结果。
目标风格：欧美真人写实短剧（Western cinematic realistic）。
要求：
1. 先通观整片，理解剧情、情绪、空间关系与人物关系
2. 台词以 ASR 为准，不要编造对白
3. appearance/description 用中文，侧重欧美面孔、服装、体态
4. 每个已知 shot_id 都要给出 shot_visuals 条目
5. 只输出合法 JSON，不要 markdown`

  const userText = `${context}

请观看整段视频，输出 JSON：
{
  "video_summary": "200字以内整片剧情与风格概述",
  "characters":[{"id":"c1","name":"","role":"","appearance":"","personality":"","description":"","shot_ids":["s1"]}],
  "scenes":[{"id":"sc1","location":"","time":"","prompt":"","shot_ids":["s1"]}],
  "props":[{"id":"p1","name":"","type":"","description":"","prompt":"","shot_ids":["s1"]}],
  "shot_notes":[{"shot_id":"s1","scene_id":"sc1","character_ids":["c1"],"prop_ids":["p1"]}],
  "shot_visuals":[{"shot_id":"s1","shot_size":"中近景 (MCU)","shot_size_detail":"","camera_angle":"平视","camera_movement":"固定","movement_motivation":"","action_blocking":"","dialogue_note":""}]
}`

  const content: Array<Record<string, unknown>> = [
    {
      type: 'video_url',
      video_url: { url: videoUrl },
      fps: VIDEO_FPS,
    },
    { type: 'text', text: userText },
  ]

  const resp = await fetch(dashScopeCompatibleUrl(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    }),
  })

  const raw = await resp.text()
  if (!resp.ok) throw new Error(raw.slice(0, 500) || `整片视频理解错误 ${resp.status}`)

  const json = JSON.parse(raw)
  const text = json?.choices?.[0]?.message?.content
  const parsed = typeof text === 'string' ? JSON.parse(stripJsonBlock(text)) : text

  const video_summary = String(parsed?.video_summary || parsed?.summary || '').trim()
  if (!video_summary) throw new Error('整片视频理解未返回 video_summary')

  const entities = parseEntitiesFromVideoJson(parsed, analysis)
  if (!entities.shot_visuals.length) {
    throw new Error('整片视频理解未返回镜头级 shot_visuals')
  }

  return { video_summary, ...entities }
}

export async function analyzeFullVideoUnderstanding(
  analysis: RepaintAnalysis,
  sourceVideoPath: string,
  dramaId?: number | null,
): Promise<FullVideoUnderstandingResult> {
  const config = resolveVisionConfig()
  logTaskStart('RepaintVideo', 'full-understand', {
    shots: analysis.shots.length,
    model: VIDEO_MODEL,
    fps: VIDEO_FPS,
  })

  await trySyncStaticToOss(sourceVideoPath, dramaId ?? undefined)
  const videoUrl = await resolveMediaUrlForExternalApi(sourceVideoPath, dramaId)
  if (!videoUrl) throw new Error('视频需同步 OSS 并具备公网 URL，请检查 OSS 配置')

  logTaskProgress('RepaintVideo', 'call-model', { videoUrl: videoUrl.slice(0, 80) })
  const result = await callFullVideoUnderstanding(config, videoUrl, analysis)

  logTaskSuccess('RepaintVideo', 'full-understand', {
    summaryLen: result.video_summary.length,
    characters: result.characters.length,
    shot_visuals: result.shot_visuals.length,
  })

  return result
}

export async function analyzeFullVideoUnderstandingSafe(
  analysis: RepaintAnalysis,
  sourceVideoPath: string,
  dramaId?: number | null,
): Promise<{ result?: FullVideoUnderstandingResult; warning?: string }> {
  try {
    const result = await analyzeFullVideoUnderstanding(analysis, sourceVideoPath, dramaId)
    return { result }
  } catch (err: any) {
    logTaskError('RepaintVideo', 'full-understand-failed', { error: err.message })
    return { warning: err.message || String(err) }
  }
}
