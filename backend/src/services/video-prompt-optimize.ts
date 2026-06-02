import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getTextConfig, getTextProviderBaseUrl } from './ai.js'
import { isSeedance2Model } from '../constants/seedance.js'
import { isChengmengProvider } from '../constants/chengmeng.js'
import { logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'

function getEpisodeVideoConfig(episodeId: number) {
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  if (!ep?.videoConfigId) return null
  const [cfg] = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, ep.videoConfigId)).all()
  return cfg || null
}

function getVideoPromptRule(episodeId: number): string {
  const cfg = getEpisodeVideoConfig(episodeId)
  const model = cfg?.model ? (() => {
    try {
      const parsed = JSON.parse(cfg.model)
      return Array.isArray(parsed) ? parsed[0] : parsed
    } catch {
      return cfg.model
    }
  })() : null
  const isSeedance2 = cfg
    ? isChengmengProvider(cfg.provider) || isSeedance2Model(model)
    : false
  if (isSeedance2) {
    return '首行「图片1是…，图片2是…」自然语言引用（禁止 @图片）；多个【镜头 NNN】子块，每块约 2 秒，含景别/运镜/打光/表演/台词口型细则/AI 补充提示词；默认 MS/MCU 面部完整入镜，ECU 仅末块钩子；各块「时长：N 秒」之和等于镜头总时长；禁止仅用 0-3秒/<n> 简写。'
  }
  return '按 3 秒分段描述镜内变化；可使用 <location>/<role> 标记；保持与镜头时长一致。'
}

function stripPromptWrapper(text: string) {
  let out = String(text || '').trim()
  if (!out) return ''
  const fenced = out.match(/^```(?:[\w-]+)?\s*([\s\S]*?)```$/i)
  if (fenced) out = fenced[1].trim()
  out = out.replace(/^video_prompt[：:]\s*/i, '').trim()
  return out
}

async function callTextCompletion(system: string, user: string): Promise<string> {
  const config = getTextConfig()
  const baseUrl = getTextProviderBaseUrl(config)
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  logTaskProgress('VideoPromptOptimize', 'request', { model: config.model, provider: config.provider })
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
  if (!resp.ok) {
    throw new Error(raw.slice(0, 240) || `文本服务错误 ${resp.status}`)
  }
  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('文本服务返回非 JSON')
  }
  const content = json?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('文本服务未返回有效内容')
  }
  return stripPromptWrapper(content)
}

export interface OptimizeVideoPromptParams {
  storyboardId: number
  currentPrompt?: string
  feedback?: string
  mode?: 'polish' | 'rewrite'
  focus?: VideoPromptOptimizeFocus
}

export type VideoPromptOptimizeFocus =
  | 'transition'
  | 'shot'
  | 'camera'
  | 'dialogue'
  | 'general'

const HONGGUO_DIRECTOR_BASE = `你是红果竖屏网剧资深导演，熟悉强钩子、快反转、对白驱动与竖屏构图。优化时保持剧情与总时长不变，只改 video_prompt 中与专项相关的表述。默认 MS/MCU 保证面部完整入镜，禁止连续 CU/ECU 裁脸。`

const FOCUS_INSTRUCTIONS: Record<Exclude<VideoPromptOptimizeFocus, 'general'>, string> = {
  transition: `${HONGGUO_DIRECTOR_BASE}

【专项：转场优化】
1. 逐段检查当前提示词里各【镜头 NNN】子块之间、以及子块内部的转场/衔接设计。
2. 用专业导演视角优化：入点/出点是否清晰、情绪与视线是否连续、动静对比是否合理、切镜节奏是否符合竖屏短剧（避免无动机硬切、避免同景别连切）。
3. 在提示词中明确写出合理的转场方式（如：动作匹配切、视线引导切、情绪递进切、缓推过渡、留白呼吸等），让 AI 视频生成能理解块与块如何衔接。
4. 不要改变各块「时长：N 秒」之和与参考图映射首行；非转场相关内容尽量保留。`,

  shot: `${HONGGUO_DIRECTOR_BASE}

【专项：镜头优化】
1. 以红果网剧导演分镜规范，逐段复检景别（MS/MCU/CU/ECU）与构图意图。
2. 优化：竖屏 9:16 下**默认 MS/MCU**，面部完整入镜（含额头下巴）；CU 仅情绪高点（每镜最多 1–2 块）；ECU 仅末块钩子；信息交代用 MS；避免连续特写导致裁脸。
3. 每段补充或修正：景别、机位角度、画面重心、人物站位与视线关系；AI 补充提示词加入 full face visible, head and shoulders in frame。
4. 保留参考图映射与各块时长；非景别/构图相关内容尽量保留。`,

  camera: `${HONGGUO_DIRECTOR_BASE}

【专项：运镜优化】
1. 逐段复检运镜设计（固定/推/拉/摇/移/跟/升降/环绕/手持等）是否服务情绪与叙事。
2. 按红果网剧习惯优化：情绪升温用慢推或缓跟、冲突用手持微晃、对白段稳定少炫技、高潮可适度动态；避免无动机乱运镜。
3. 在每块写清运镜起止、速度与目的（如：45度侧角慢推至 MCU，强调眼神变化）。
4. 保留参考图映射与各块时长；非运镜相关内容尽量保留。`,

  dialogue: `${HONGGUO_DIRECTOR_BASE}

【专项：台词优化】
1. 对照镜头对白与 video_prompt 中的台词/口型/表演描述，检查台词是否合理、是否口语化、是否符合角色情绪。
2. 核对台词信息量与镜头总时长（约 3–4 字/秒口型节奏）：台词过长则拆分到多段【镜头 NNN】或调整切镜，让每段口型可完成；台词过短则避免冗长空镜。
3. 台词较长时：优化运镜与切镜（如推近口型、正反打、反应镜头插入、句读处切镜），保证竖屏短剧可读性与节奏。
4. 在提示词中写清台词归属、口型/微表情/停顿；保留参考图映射，各块「时长：N 秒」之和仍等于镜头总时长。`,
}

function buildFocusInstruction(focus: VideoPromptOptimizeFocus | undefined, mode: 'polish' | 'rewrite', feedback: string): string {
  if (feedback) return feedback
  if (focus && focus !== 'general' && FOCUS_INSTRUCTIONS[focus]) {
    return FOCUS_INSTRUCTIONS[focus]
  }
  if (mode === 'rewrite') return '按用户要求重写 video_prompt，保持格式规范与总时长。'
  return '在不改变剧情与总时长的前提下润色：增强运镜、表演、光影与 AI 可执行细节。'
}

function buildSystemPrompt(
  mode: 'polish' | 'rewrite',
  rule: string,
  focus: VideoPromptOptimizeFocus | undefined,
): string {
  const focusLine = focus && focus !== 'general'
    ? `当前为专项优化（${focus}），只重点修改该专项相关内容，其余尽量保留。`
    : ''
  const action = mode === 'rewrite' ? '按用户要求重写' : '润色优化'
  return `你是红果短剧平台的视频提示词优化专家。${focusLine}根据镜头上下文${action} video_prompt，使其更适合 AI 视频生成。

格式要求：${rule}

输出要求：
- 只输出优化后的完整 video_prompt 正文
- 不要解释、不要 markdown、不要 JSON、不要标题
- 保留用户明确要求保留的内容与参考图编号映射
- 英文 AI 补充提示词可保留或优化，但不要无关堆砌`
}

export async function optimizeVideoPrompt(params: OptimizeVideoPromptParams): Promise<string> {
  const [sb] = db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.id, params.storyboardId)).all()
  if (!sb) throw new Error('镜头不存在')

  const characterIds = db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, sb.id)).all()
    .map(row => row.characterId)
  const characters = characterIds.length
    ? db.select().from(schema.characters).all().filter(c => characterIds.includes(c.id))
    : []
  const scene = sb.sceneId
    ? db.select().from(schema.scenes).where(eq(schema.scenes.id, sb.sceneId)).all()[0]
    : null

  const currentPrompt = String(params.currentPrompt ?? sb.videoPrompt ?? '').trim()
  const feedback = String(params.feedback ?? '').trim()
  const mode = params.mode === 'rewrite' ? 'rewrite' : 'polish'
  const focus = normalizeFocus(params.focus)
  const rule = getVideoPromptRule(sb.episodeId)

  const system = buildSystemPrompt(mode, rule, focus)

  const contextLines = [
    `镜头描述：${sb.description || sb.title || '—'}`,
    `动作：${sb.action || '—'}`,
    `对白：${sb.dialogue || '无'}`,
    `景别/机位/运镜：${[sb.shotType, sb.angle, sb.movement].filter(Boolean).join(' · ') || '—'}`,
    `时长：${sb.duration || 15} 秒`,
    `角色：${characters.map(c => c.name).join('、') || '无'}`,
    `场景：${scene?.location || sb.location || '—'}${scene?.time || sb.time ? ` · ${scene?.time || sb.time}` : ''}`,
    `氛围：${sb.atmosphere || '—'}`,
  ]

  const userParts = [
    '【镜头信息】',
    contextLines.join('\n'),
    '',
    '【当前 video_prompt】',
    currentPrompt || '（空，请根据镜头信息生成）',
  ]
  if (feedback || focus !== 'general' || mode === 'polish') {
    userParts.push('', '【优化要求】', buildFocusInstruction(focus, mode, feedback))
  }

  const optimized = await callTextCompletion(system, userParts.join('\n'))
  if (!optimized) throw new Error('优化结果为空')
  logTaskSuccess('VideoPromptOptimize', 'done', {
    storyboardId: params.storyboardId,
    length: optimized.length,
    focus,
    mode,
  })
  return optimized
}

function normalizeFocus(raw?: string | null): VideoPromptOptimizeFocus {
  const value = String(raw || '').trim()
  if (value === 'transition' || value === 'shot' || value === 'camera' || value === 'dialogue') return value
  return 'general'
}
