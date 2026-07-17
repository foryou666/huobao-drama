import { getTextConfig, getTextProviderBaseUrl } from './ai.js'
import { detectVideoShots } from '../utils/shot-detect.js'
import { extractAudioWav } from '../utils/extract-audio.js'
import { transcribeRepaintAudio } from './repaint-asr.js'
import { analyzeShotsWithVisionSafe } from './repaint-shot-vision.js'
import { analyzeFullVideoUnderstandingSafe } from './repaint-video-understanding.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import {
  assignUtterancesToShots,
  attachEntityShotIds,
  emptyRepaintAnalysis,
  mergeShotAssignments,
  type RepaintAnalysis,
} from './repaint-types.js'
import { now } from '../utils/response.js'

function stripJsonBlock(text: string) {
  let out = String(text || '').trim()
  const fenced = out.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) out = fenced[1].trim()
  return out
}

async function callTextJson(system: string, user: string): Promise<any> {
  const config = getTextConfig()
  const baseUrl = getTextProviderBaseUrl(config)
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`

  async function request(withJsonMode: boolean) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        ...(withJsonMode ? { response_format: { type: 'json_object' } } : {}),
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
    if (typeof content !== 'string' || !content.trim()) throw new Error('实体抽取未返回内容')
    return JSON.parse(stripJsonBlock(content))
  }

  try {
    return await request(true)
  } catch {
    return await request(false)
  }
}

function buildTimelinePrompt(analysis: RepaintAnalysis) {
  const lines: string[] = ['【镜头时间轴与台词】']
  for (const shot of analysis.shots) {
    const assignment = analysis.shot_assignments.find(a => a.shot_id === shot.id)
    const dialogue = analysis.utterances
      .filter(u => assignment?.utterance_ids.includes(u.id))
      .map(u => `[${u.start_sec}-${u.end_sec}s] ${u.text}`)
      .join(' ')
    lines.push(`- ${shot.id} (${shot.start_sec}-${shot.end_sec}s): ${dialogue || '（无对白）'}`)
  }
  return lines.join('\n')
}

async function extractEntitiesFromTimeline(analysis: RepaintAnalysis) {
  const system = `你是视频转绘项目的实体抽取助手。根据镜头切分与 ASR 台词，提取本视频出现的角色、场景、道具。
目标风格：欧美真人写实短剧（Western cinematic realistic）。
输出 JSON：
{
  "characters":[{"id":"c1","name":"","role":"","appearance":"","personality":"","description":""}],
  "scenes":[{"id":"sc1","location":"","time":"","prompt":""}],
  "props":[{"id":"p1","name":"","type":"","description":"","prompt":""}],
  "shot_notes":[{"shot_id":"s1","scene_id":"sc1","character_ids":["c1"],"prop_ids":["p1"]}]
}
规则：
1. 台词以 ASR 为准，不要改写或编造对白。
2. appearance/description 用中文，侧重欧美面孔、服装、体态的可视化描述。
3. 场景 prompt 用中文视觉描述（地点、光线、陈设），系统会自动追加场景设定图模板。
4. 道具只在画面中有明确物体时出现。
5. shot_notes 为每个镜头绑定 scene/character/prop 的 id（来自上面列表）。`

  const user = buildTimelinePrompt(analysis)
  const parsed = await callTextJson(system, user)

  const characters: RepaintAnalysis['characters'] = (Array.isArray(parsed.characters) ? parsed.characters : []).map((item: any, idx: number) => ({
    id: String(item.id || `c${idx + 1}`),
    name: String(item.name || '').trim(),
    role: item.role ? String(item.role) : '',
    appearance: item.appearance ? String(item.appearance) : '',
    personality: item.personality ? String(item.personality) : '',
    description: item.description ? String(item.description) : '',
    shot_ids: [] as string[],
  })).filter((item: any) => item.name)

  const scenes: RepaintAnalysis['scenes'] = (Array.isArray(parsed.scenes) ? parsed.scenes : []).map((item: any, idx: number) => ({
    id: String(item.id || `sc${idx + 1}`),
    location: String(item.location || '').trim(),
    time: item.time ? String(item.time) : '',
    prompt: item.prompt ? String(item.prompt) : '',
    shot_ids: [] as string[],
  })).filter((item: any) => item.location)

  const props: RepaintAnalysis['props'] = (Array.isArray(parsed.props) ? parsed.props : []).map((item: any, idx: number) => ({
    id: String(item.id || `p${idx + 1}`),
    name: String(item.name || '').trim(),
    type: item.type ? String(item.type) : 'prop',
    description: item.description ? String(item.description) : '',
    prompt: item.prompt ? String(item.prompt) : '',
    shot_ids: [] as string[],
  })).filter((item: any) => item.name)

  const shotNotes = Array.isArray(parsed.shot_notes) ? parsed.shot_notes : []
  const shot_assignments = mergeShotAssignments(analysis.shot_assignments, shotNotes)

  const charById = new Map<string, RepaintAnalysis['characters'][number]>(
    characters.map((c) => [c.id, c]),
  )
  const sceneById = new Map<string, RepaintAnalysis['scenes'][number]>(
    scenes.map((s) => [s.id, s]),
  )
  const propById = new Map<string, RepaintAnalysis['props'][number]>(
    props.map((p) => [p.id, p]),
  )

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

  return {
    characters: enrichedChars,
    scenes,
    props,
    shot_assignments,
  }
}

export interface RunRepaintAnalysisParams {
  sourceVideoPath: string
  sourceDuration: number
  dramaId?: number | null
  skipAsr?: boolean
}

export async function runRepaintAnalysis(params: RunRepaintAnalysisParams): Promise<RepaintAnalysis> {
  logTaskStart('RepaintAnalysis', 'run', {
    path: params.sourceVideoPath,
    duration: params.sourceDuration,
  })

  const warnings: string[] = []
  const analysis = emptyRepaintAnalysis()

  logTaskProgress('RepaintAnalysis', 'shot-detect')
  analysis.shots = await detectVideoShots(params.sourceVideoPath, params.sourceDuration)

  let utterances = [] as RepaintAnalysis['utterances']
  if (!params.skipAsr) {
    try {
      logTaskProgress('RepaintAnalysis', 'extract-audio')
      const audioPath = await extractAudioWav(params.sourceVideoPath)
      analysis.audio_path = audioPath
      logTaskProgress('RepaintAnalysis', 'asr')
      utterances = await transcribeRepaintAudio(audioPath, params.dramaId)
    } catch (err: any) {
      warnings.push(`ASR 失败：${err.message || err}`)
      logTaskError('RepaintAnalysis', 'asr', { error: err.message })
    }
  } else {
    warnings.push('已跳过 ASR（调试模式）')
  }

  analysis.utterances = utterances
  analysis.shot_assignments = assignUtterancesToShots(analysis.shots, utterances)

  let usedFullVideoUnderstanding = false
  try {
    logTaskProgress('RepaintAnalysis', 'full-video-understand')
    const { result, warning } = await analyzeFullVideoUnderstandingSafe(
      analysis,
      params.sourceVideoPath,
      params.dramaId,
    )
    if (warning) warnings.push(`整片视频理解：${warning}`)
    if (result) {
      analysis.video_summary = result.video_summary
      analysis.characters = result.characters
      analysis.scenes = result.scenes
      analysis.props = result.props
      analysis.shot_assignments = result.shot_assignments
      analysis.shot_visuals = result.shot_visuals
      usedFullVideoUnderstanding = true
    }
  } catch (err: any) {
    warnings.push(`整片视频理解失败：${err.message || err}`)
    logTaskError('RepaintAnalysis', 'full-video-understand', { error: err.message })
  }

  if (!usedFullVideoUnderstanding) {
    if (utterances.length) {
      try {
        logTaskProgress('RepaintAnalysis', 'entity-extract')
        const extracted = await extractEntitiesFromTimeline(analysis)
        analysis.characters = extracted.characters
        analysis.scenes = extracted.scenes
        analysis.props = extracted.props
        analysis.shot_assignments = extracted.shot_assignments
      } catch (err: any) {
        warnings.push(`实体抽取失败：${err.message || err}`)
        logTaskError('RepaintAnalysis', 'entity-extract', { error: err.message })
      }
    } else {
      warnings.push('无台词轴，跳过实体抽取（可手动添加角色/场景）')
    }

    try {
      logTaskProgress('RepaintAnalysis', 'shot-vision')
      const { visuals, warning } = await analyzeShotsWithVisionSafe(
        analysis,
        params.sourceVideoPath,
        params.dramaId,
      )
      if (visuals.length) analysis.shot_visuals = visuals
      if (warning) warnings.push(warning)
    } catch (err: any) {
      warnings.push(`逐帧视觉理解失败：${err.message || err}`)
      logTaskError('RepaintAnalysis', 'shot-vision', { error: err.message })
    }
  } else {
    const weakShots = analysis.shots.filter(s => {
      const visual = analysis.shot_visuals?.find(v => v.shot_id === s.id)
      return !visual?.shot_size || !visual?.action_blocking
    })
    if (weakShots.length) {
      try {
        logTaskProgress('RepaintAnalysis', 'shot-vision-supplement', { count: weakShots.length })
        const { visuals, warning } = await analyzeShotsWithVisionSafe(
          { ...analysis, shots: weakShots },
          params.sourceVideoPath,
          params.dramaId,
        )
        if (visuals.length) {
          const byId = new Map((analysis.shot_visuals || []).map(v => [v.shot_id, v]))
          for (const visual of visuals) byId.set(visual.shot_id, visual)
          analysis.shot_visuals = [...byId.values()]
        }
        if (warning) warnings.push(`薄弱镜头视觉补全：${warning}`)
      } catch (err: any) {
        warnings.push(`薄弱镜头视觉补全失败：${err.message || err}`)
      }
    }
  }

  analysis.warnings = warnings.length ? warnings : undefined
  analysis.analyzed_at = now()

  logTaskSuccess('RepaintAnalysis', 'run', {
    shots: analysis.shots.length,
    utterances: analysis.utterances.length,
    characters: analysis.characters.length,
    scenes: analysis.scenes.length,
    props: analysis.props.length,
    shot_visuals: analysis.shot_visuals?.length || 0,
    video_summary: analysis.video_summary ? analysis.video_summary.length : 0,
  })

  return analysis
}
