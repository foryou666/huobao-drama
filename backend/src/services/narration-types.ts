export type NarrationCharacter = {
  id: string
  name: string
  role?: string
  appearance?: string
  personality?: string
  description?: string
  image_url?: string
  image_generation_id?: number
  image_status?: 'generating' | 'completed' | 'failed'
  /** TTS 音色：asset:ID / static/...；旧 Gradio voice_01 已弃用 */
  voice_id?: string
  /** 抽取/推断的音色画像，用于自动匹配音色库 */
  voice_profile?: {
    gender?: '男' | '女' | '中性'
    age?: '少年' | '青年' | '中年' | '老年' | '未知'
    tone?: string
    desc?: string
  }
}

export type NarrationScene = {
  id: string
  location: string
  time?: string
  prompt: string
  image_url?: string
  image_generation_id?: number
  image_status?: 'generating' | 'completed' | 'failed'
}

export type NarrationProp = {
  id: string
  name: string
  type?: string
  description?: string
  prompt?: string
  image_url?: string
  image_generation_id?: number
  image_status?: 'generating' | 'completed' | 'failed'
}

export type NarrationSegmentMeta = {
  segment_index: number
  scene_id?: string
  character_ids?: string[]
  prop_ids?: string[]
  video_prompt: string
  /** narrator = 旁白朗读原文；否则为角色 id */
  speaker_id?: string
}

export type NarrationAnalysis = {
  characters: NarrationCharacter[]
  scenes: NarrationScene[]
  props: NarrationProp[]
  segment_meta: NarrationSegmentMeta[]
}

export function emptyNarrationAnalysis(): NarrationAnalysis {
  return { characters: [], scenes: [], props: [], segment_meta: [] }
}

export function parseNarrationAnalysis(raw?: string | null): NarrationAnalysis {
  if (!raw?.trim()) return emptyNarrationAnalysis()
  try {
    const parsed = JSON.parse(raw) as Partial<NarrationAnalysis>
    return {
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      props: Array.isArray(parsed.props) ? parsed.props : [],
      segment_meta: Array.isArray(parsed.segment_meta) ? parsed.segment_meta : [],
    }
  } catch {
    return emptyNarrationAnalysis()
  }
}
