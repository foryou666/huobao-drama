import path from 'path'
import { findNarrationVoicePreset } from '../constants/narration-voices.js'
import {
  findCachedPresetVoicePath,
  isRunningHubVoiceRef,
} from './narration-voice.js'
import {
  generateRunningHubIndexTts,
  type RunningHubEmotionVector,
} from './runninghub-indextts2.js'
import type { StudioTtsVoiceInput } from './tts-studio.js'

export { findCachedPresetVoicePath, isRunningHubVoiceRef }

export function resolveNarrationVoiceInput(voice?: string | null): StudioTtsVoiceInput {
  const v = String(voice || '').trim()
  if (!v) throw new Error('未选择旁白音色')

  const assetMatch = /^asset:(\d+)$/i.exec(v)
  if (assetMatch) {
    return { voice_asset_id: Number(assetMatch[1]) }
  }

  if (/^https?:\/\//i.test(v)) {
    return { voice_path: v }
  }

  const normalizedPath = v.replace(/^\/+/, '')
  if (normalizedPath.startsWith('static/') || path.isAbsolute(v)) {
    return { voice_path: normalizedPath.startsWith('static/') ? normalizedPath : v }
  }

  const preset = findNarrationVoicePreset(v)
  const voiceKey = preset?.voice_id || v
  const cached = findCachedPresetVoicePath(voiceKey)
  if (cached) {
    return { voice_path: cached, voice_id: voiceKey }
  }

  const label = preset?.name || voiceKey
  throw new Error(
    `音色「${label}」缺少参考音频。RunningHub IndexTTS2 需从音色库选择参考音色，`
    + '不再使用 Gradio 内置 voice_01~12。',
  )
}

/** 使用 RunningHub IndexTTS2 合成单段旁白，返回相对路径与时长 */
export async function generateNarrationTTS(opts: {
  text: string
  voice?: string
  configId?: number | null
  emotionVector?: RunningHubEmotionVector
  emotionWeight?: number
}): Promise<{ path: string; durationSec: number }> {
  const text = String(opts.text || '').trim()
  if (!text) throw new Error('旁白文本为空')

  // configId 保留兼容字段；解说漫统一走 RunningHub 通道
  void opts.configId

  const voiceInput = resolveNarrationVoiceInput(opts.voice)
  const result = await generateRunningHubIndexTts({
    text,
    voice: voiceInput,
    emotionVector: opts.emotionVector,
    emotionWeight: opts.emotionWeight ?? 0.8,
  })

  return {
    path: result.path,
    durationSec: result.durationSec > 0 ? result.durationSec : 5,
  }
}
