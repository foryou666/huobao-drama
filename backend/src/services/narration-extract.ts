import { getTextConfig, getTextProviderBaseUrl } from './ai.js'
import { listNarrationSegments } from './narration-segments.js'
import {
  emptyNarrationAnalysis,
  type NarrationAnalysis,
  type NarrationSegmentMeta,
} from './narration-types.js'
import { assignCharacterVoices, ensureAnalysisVoices, defaultNarratorVoice } from './narration-voice.js'

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
        temperature: 0.3,
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

function buildSegmentOutline(segments: { segmentIndex: number; text: string }[]) {
  return segments.map(s => `[${s.segmentIndex}] ${s.text}`).join('\n')
}

export async function extractNarrationEntities(
  jobId: number,
  novelText: string,
  narratorVoice?: string | null,
): Promise<NarrationAnalysis> {
  const segments = listNarrationSegments(jobId)
  if (!segments.length) throw new Error('请先完成分段')

  const system = `你是解说漫制作助手。根据小说原文与分段，提取角色、场景、道具，并为每段生成 Grok 视频画面提示词。
输出 JSON：
{
  "characters":[{"id":"c1","name":"","role":"","appearance":"","description":"","voice_id":""}],
  "scenes":[{"id":"sc1","location":"","time":"","prompt":""}],
  "props":[{"id":"p1","name":"","type":"","description":"","prompt":""}],
  "segment_meta":[{"segment_index":0,"scene_id":"sc1","character_ids":["c1"],"prop_ids":[],"speaker_id":"narrator","video_prompt":""}]
}
规则：
1. TTS 将直接朗读分段中的小说原文，禁止改写、润色或生成解说词。
2. 不要修改分段文字；你只输出实体与画面 prompt，不负责旁白文案。
3. video_prompt 用中文，描述该段原文对应的电影感画面（人物、环境、光影、镜头）。
4. 每段 segment_meta 必须覆盖所有 segment_index。
5. 为每个角色指定 voice_id，必须从 voice_01、voice_02 … voice_12 中选择，同一角色全书 voice_id 必须相同。
6. speaker_id：旁白叙述填 "narrator"；若该段主要是某角色台词则填该角色 id。
7. appearance/description/prompt 侧重可视化，便于 AI 视频生成。`

  const user = `【小说原文（节选）】
${novelText.slice(0, 12000)}

【解说分段】
${buildSegmentOutline(segments.map(s => ({ segmentIndex: s.segmentIndex, text: s.text })))}`

  const parsed = await callTextJson(system, user)
  const analysis: NarrationAnalysis = {
    characters: (Array.isArray(parsed.characters) ? parsed.characters : []).map((item: any, idx: number) => ({
      id: String(item.id || `c${idx + 1}`),
      name: String(item.name || '').trim(),
      role: item.role ? String(item.role) : '',
      appearance: item.appearance ? String(item.appearance) : '',
      personality: item.personality ? String(item.personality) : '',
      description: item.description ? String(item.description) : '',
      voice_id: item.voice_id ? String(item.voice_id).trim() : undefined,
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

  if (!analysis.segment_meta.length) return emptyNarrationAnalysis()
  const voice = narratorVoice || defaultNarratorVoice()
  assignCharacterVoices(analysis.characters, voice)
  return ensureAnalysisVoices(analysis, voice)
}
