import { getNarrationTextConfig, getTextProviderBaseUrl, type AIConfig } from './ai.js'
import { listNarrationSegments } from './narration-segments.js'
import {
  emptyNarrationAnalysis,
  type NarrationAnalysis,
  type NarrationSegmentMeta,
} from './narration-types.js'
import { assignCharacterVoices, ensureAnalysisVoices, defaultNarratorVoice } from './narration-voice.js'
import { ensureAnalysisVoiceProfiles } from './narration-voice-auto.js'
import {
  isApimartProvider,
  isRetryableApimartFetchError,
  isRetryableApimartHttpStatus,
  listApimartApiBases,
} from '../constants/apimart.js'
import { logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'

function stripJsonBlock(text: string) {
  let out = String(text || '').trim()
  const fenced = out.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) out = fenced[1].trim()
  return out
}

async function fetchChatCompletion(config: AIConfig, body: Record<string, unknown>): Promise<string> {
  const bases = isApimartProvider(config.provider)
    ? listApimartApiBases(config)
    : [getTextProviderBaseUrl(config).replace(/\/+$/, '')]

  let lastError = '文本服务不可用'
  for (let i = 0; i < bases.length; i += 1) {
    const root = bases[i].replace(/\/+$/, '')
    // listApimartApiBases 返回裸域名；OpenAI 兼容需挂 /v1
    const baseUrl = /\/v1$/i.test(root) ? root : joinProviderUrl(root, '/v1', '').replace(/\/+$/, '')
    const url = `${baseUrl}/chat/completions`
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      })
      const raw = await resp.text()
      if (!resp.ok) {
        const message = raw.slice(0, 300) || `文本服务错误 ${resp.status}`
        if (
          isApimartProvider(config.provider)
          && i < bases.length - 1
          && isRetryableApimartHttpStatus(resp.status)
        ) {
          lastError = message
          logTaskWarn('NarrationExtract', 'apimart-text-mirror-retry', {
            baseUrl,
            status: resp.status,
            attempt: i + 1,
            total: bases.length,
          })
          continue
        }
        throw new Error(message)
      }
      if (/^\s*data:\s*\{/m.test(raw)) {
        throw new Error('文本服务返回了流式响应，请确认请求已设置 stream=false')
      }
      const json = JSON.parse(raw)
      const content = json?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) throw new Error('实体抽取未返回内容')
      return content
    } catch (err: any) {
      if (
        isApimartProvider(config.provider)
        && i < bases.length - 1
        && isRetryableApimartFetchError(err)
      ) {
        lastError = err?.message || String(err)
        logTaskWarn('NarrationExtract', 'apimart-text-mirror-retry', {
          baseUrl,
          attempt: i + 1,
          total: bases.length,
          error: lastError.slice(0, 160),
        })
        continue
      }
      throw err
    }
  }
  throw new Error(lastError)
}

async function callTextJson(system: string, user: string): Promise<any> {
  const config = getNarrationTextConfig()
  const baseBody = {
    model: config.model,
    stream: false,
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }

  async function request(withJsonMode: boolean) {
    const content = await fetchChatCompletion(config, {
      ...baseBody,
      ...(withJsonMode ? { response_format: { type: 'json_object' } } : {}),
    })
    return JSON.parse(stripJsonBlock(content))
  }

  try {
    return await request(true)
  } catch {
    return await request(false)
  }
}

function buildSegmentOutline(segments: { segmentIndex: number; text: string }[]) {
  return segments.map(s => `[${s.segmentIndex}] ${s.text}`).join('\n')
}

function parseEntities(parsed: any, narratorVoice?: string | null): NarrationAnalysis {
  const voice = narratorVoice || defaultNarratorVoice()
  const analysis: NarrationAnalysis = {
    characters: (Array.isArray(parsed.characters) ? parsed.characters : []).map((item: any, idx: number) => ({
      id: String(item.id || `c${idx + 1}`),
      name: String(item.name || '').trim(),
      role: item.role ? String(item.role) : '',
      appearance: item.appearance ? String(item.appearance) : '',
      personality: item.personality ? String(item.personality) : '',
      description: item.description ? String(item.description) : '',
      voice_id: item.voice_id ? String(item.voice_id).trim() : undefined,
      voice_profile: item.voice_profile && typeof item.voice_profile === 'object'
        ? {
          gender: item.voice_profile.gender ? String(item.voice_profile.gender) : undefined,
          age: item.voice_profile.age ? String(item.voice_profile.age) : undefined,
          tone: item.voice_profile.tone ? String(item.voice_profile.tone) : undefined,
          desc: item.voice_profile.desc || item.voice_profile.description
            ? String(item.voice_profile.desc || item.voice_profile.description)
            : undefined,
        }
        : undefined,
    })).filter((c: { name: string }) => c.name),
    scenes: (Array.isArray(parsed.scenes) ? parsed.scenes : []).map((item: any, idx: number) => ({
      id: String(item.id || `sc${idx + 1}`),
      location: String(item.location || '').trim(),
      time: item.time ? String(item.time) : '',
      prompt: String(item.prompt || item.location || '').trim(),
    })).filter((s: { location: string }) => s.location),
    props: (Array.isArray(parsed.props) ? parsed.props : []).map((item: any, idx: number) => ({
      id: String(item.id || `p${idx + 1}`),
      name: String(item.name || '').trim(),
      type: item.type ? String(item.type) : '',
      description: item.description ? String(item.description) : '',
      prompt: item.prompt ? String(item.prompt) : '',
    })).filter((p: { name: string }) => p.name),
    segment_meta: (Array.isArray(parsed.segment_meta) ? parsed.segment_meta : []).map((item: any) => ({
      segment_index: Number(item.segment_index),
      scene_id: item.scene_id ? String(item.scene_id) : undefined,
      character_ids: Array.isArray(item.character_ids) ? item.character_ids.map(String) : [],
      prop_ids: Array.isArray(item.prop_ids) ? item.prop_ids.map(String) : [],
      speaker_id: item.speaker_id ? String(item.speaker_id).trim() : 'narrator',
      video_prompt: String(item.video_prompt || '').trim(),
    })).filter((m: NarrationSegmentMeta) => Number.isFinite(m.segment_index)),
  }
  assignCharacterVoices(analysis.characters, voice)
  ensureAnalysisVoiceProfiles(analysis)
  return ensureAnalysisVoices(analysis, voice)
}

/**
 * 第一步：仅从全文提取角色/场景/道具（不依赖分段）。
 */
export async function extractNarrationEntities(
  jobId: number,
  novelText: string,
  narratorVoice?: string | null,
): Promise<NarrationAnalysis> {
  const segments = listNarrationSegments(jobId)

  // 已有分段时：一次性抽实体 + 段画面（兼容旧流程 / 重抽）
  if (segments.length) {
    const system = `你是解说漫制作助手。根据小说原文与分段，提取角色、场景、道具，并为每段生成 Grok 视频画面提示词。
输出 JSON：
{
  "characters":[{"id":"c1","name":"","role":"","appearance":"","personality":"","description":"","voice_profile":{"gender":"女","age":"青年","tone":"温柔","desc":""}}],
  "scenes":[{"id":"sc1","location":"","time":"","prompt":""}],
  "props":[{"id":"p1","name":"","type":"","description":"","prompt":""}],
  "segment_meta":[{"segment_index":0,"scene_id":"sc1","character_ids":["c1"],"prop_ids":[],"speaker_id":"narrator","video_prompt":""}]
}
规则：
1. TTS 将直接朗读分段中的小说原文，禁止改写、润色或生成解说词。
2. 不要修改分段文字；你只输出实体与画面 prompt，不负责旁白文案。
3. video_prompt 用中文，写可拍摄的电影画面：主体、动作、环境、光影、景别与运镜；可参考原文中的「画面：」描写，但禁止照抄旁白原文当 prompt。
4. 每段旁白约 6~10 秒：video_prompt 必须包含 2~3 个可视节拍（建立→动作/信息→收束），用人物动作、道具互动或环境微事件填满时长。
5. 严禁整段只有「缓慢推进/推移/缓拉」空镜；运镜要短促且服务于动作，景别要有变化（如特写→中景、跟拍→停住）。
6. 严禁输出「文字标注」「黑屏过渡」「字幕卡片」「音波/波形」「标题板」等非实拍描述。
7. 若某段无法对应实景（纯元数据、空内容），video_prompt 填空字符串 ""。
8. 每段 segment_meta 必须覆盖所有 segment_index。
9. 为每个角色填写 personality（性格）与 voice_profile：gender 取 男/女/中性，age 取 少年/青年/中年/老年，tone 如 沉稳/温柔/活泼/磁性/清亮/新闻，desc 用一句话描述适合的配音感觉。不要再填 voice_01 这类旧音色编号。
10. speaker_id：旁白叙述填 "narrator"；若该段主要是某角色台词则填该角色 id。
11. appearance/description/prompt 侧重可视化，便于 AI 视频生成。`

    const user = `【小说原文（节选）】
${novelText.slice(0, 12000)}

【解说分段】
${buildSegmentOutline(segments.map(s => ({ segmentIndex: s.segmentIndex, text: s.text })))}`

    const parsed = await callTextJson(system, user)
    const analysis = parseEntities(parsed, narratorVoice)
    if (!analysis.characters.length && !analysis.scenes.length && !analysis.props.length) {
      return emptyNarrationAnalysis()
    }
    return analysis
  }

  // 无分段：只抽资产，供用户先确认再生图 / 再分段
  const system = `你是解说漫制作助手。根据小说全文提取角色、场景、道具文字设定（此时尚未分段）。
输出 JSON：
{
  "characters":[{"id":"c1","name":"","role":"","appearance":"","personality":"","description":"","voice_profile":{"gender":"女","age":"青年","tone":"温柔","desc":""}}],
  "scenes":[{"id":"sc1","location":"","time":"","prompt":""}],
  "props":[{"id":"p1","name":"","type":"","description":"","prompt":""}],
  "segment_meta":[]
}
规则：
1. 只提取实体，不要输出分段，segment_meta 固定为空数组。
2. 为每个角色填写 personality（性格）与 voice_profile（gender/age/tone/desc），用于后续自动匹配音色库参考音频。不要填写 voice_01 这类旧编号。
3. appearance/description/prompt 侧重可视化，便于后续 AI 生图与视频。
4. 场景按地点+时间段区分；道具只保留对叙事/画面有用的。`

  const user = `【小说原文】
${novelText.slice(0, 16000)}`

  const parsed = await callTextJson(system, user)
  const analysis = parseEntities({ ...parsed, segment_meta: [] }, narratorVoice)
  if (!analysis.characters.length && !analysis.scenes.length && !analysis.props.length) {
    throw new Error('未提取到角色/场景/道具，请检查原文后重试')
  }
  analysis.segment_meta = []
  return analysis
}

/**
 * 分段完成后：在已有资产上为每段绑定场景/角色/道具并写 video_prompt。
 */
export async function bindNarrationSegmentMeta(
  jobId: number,
  novelText: string,
  existing: NarrationAnalysis,
  narratorVoice?: string | null,
): Promise<NarrationAnalysis> {
  const segments = listNarrationSegments(jobId)
  if (!segments.length) throw new Error('请先完成旁白分段')
  if (!existing.characters.length && !existing.scenes.length) {
    throw new Error('请先提取角色/场景/道具')
  }

  const system = `你是解说漫制作助手。资产已确定，请仅为每段旁白分配场景/角色/道具，并生成 Grok 画面提示词（单镜最长约 10 秒）。
输出 JSON：
{
  "segment_meta":[{"segment_index":0,"scene_id":"sc1","character_ids":["c1"],"prop_ids":[],"speaker_id":"narrator","video_prompt":""}]
}
规则：
1. 只能使用【已有资产】中的 id，禁止新增角色/场景/道具。
2. 每段必须有一条 segment_meta，覆盖全部 segment_index。
3. video_prompt 用中文写可拍摄画面；每段约 6~10 秒，须含 2~3 个可视节拍（建立→动作/信息→收束），优先人物动作与道具互动。
4. 禁止整段只有缓慢推/拉空镜；运镜短促且服务动作，连续段落景别/机位要有变化。
5. 可参考原文「画面：」描写；禁止照抄旁白；禁止「文字标注/黑屏/字幕/波形」。
6. 无法对应实景时 video_prompt 填 ""。
7. TTS 朗读分段原文，不要改写旁白。
8. speaker_id：旁白用 "narrator"；角色台词用该角色 id。`

  const user = `【已有资产】
角色：${JSON.stringify(existing.characters.map(c => ({ id: c.id, name: c.name })))}
场景：${JSON.stringify(existing.scenes.map(s => ({ id: s.id, location: s.location, time: s.time })))}
道具：${JSON.stringify(existing.props.map(p => ({ id: p.id, name: p.name })))}

【小说原文（节选）】
${novelText.slice(0, 8000)}

【解说分段】
${buildSegmentOutline(segments.map(s => ({ segmentIndex: s.segmentIndex, text: s.text })))}`

  const parsed = await callTextJson(system, user)
  const meta = (Array.isArray(parsed.segment_meta) ? parsed.segment_meta : []).map((item: any) => ({
    segment_index: Number(item.segment_index),
    scene_id: item.scene_id ? String(item.scene_id) : undefined,
    character_ids: Array.isArray(item.character_ids) ? item.character_ids.map(String) : [],
    prop_ids: Array.isArray(item.prop_ids) ? item.prop_ids.map(String) : [],
    speaker_id: item.speaker_id ? String(item.speaker_id).trim() : 'narrator',
    video_prompt: String(item.video_prompt || '').trim(),
  })).filter((m: NarrationSegmentMeta) => Number.isFinite(m.segment_index))

  const voice = narratorVoice || defaultNarratorVoice()
  const next: NarrationAnalysis = {
    ...existing,
    segment_meta: meta.length ? meta : segments.map(s => ({
      segment_index: s.segmentIndex,
      character_ids: [],
      prop_ids: [],
      speaker_id: 'narrator',
      video_prompt: '',
    })),
  }
  return ensureAnalysisVoices(next, voice)
}
