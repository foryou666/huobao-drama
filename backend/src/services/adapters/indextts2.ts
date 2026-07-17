/**
 * IndexTTS2 适配器
 * 支持两种部署：
 * 1. REST JSON API（完整地址如 https://host/api/v1/indextts2_generate）
 * 2. Gradio 根地址（如 https://host.container.x-gpu.com/），走 gen_single
 */
import type { TTSProviderAdapter } from './types'
import { joinProviderUrl } from './url'
export { isGradioIndexTts2Url, synthesizeIndexTts2Gradio } from './indextts2-gradio.js'
export type { IndexTts2EmotionMode, IndexTts2EmotionOptions, IndexTts2EmotionVector } from './indextts2-gradio.js'

export function resolveIndexTts2ApiUrl(config: { baseUrl?: string; settings?: Record<string, unknown> }) {
  const base = String(config.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new Error('IndexTTS2 API 地址为空')

  const settings = config.settings || {}
  if (settings.use_full_url === true || /indextts|\/generate|\/infer|\/tts/i.test(base)) {
    return base
  }

  const endpoint = String(settings.endpoint || '/api/v1/indextts2_generate')
  return joinProviderUrl(base, '', endpoint)
}

export class IndexTTS2Adapter implements TTSProviderAdapter {
  readonly provider = 'indextts2'

  buildGenerateRequest(config: any, params: { text: string; voice: string; model?: string; speed?: number }) {
    const settings = config.settings || {}
    const url = resolveIndexTts2ApiUrl(config)
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const apiKey = String(config.apiKey || '').trim()
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const voice = params.voice || settings.default_voice || settings.voice || ''
    if (!voice) {
      throw new Error('IndexTTS2 未配置音色 voice：请设置 TTS2_VOICE 或在任务中指定旁白音色')
    }

    return {
      url,
      method: 'POST',
      headers,
      body: {
        text: params.text,
        voice,
        response_format: settings.response_format || 'mp3',
        stream_mode: false,
        speed: params.speed ?? settings.speed ?? 1,
        sample_rate: settings.sample_rate || 24000,
      },
    }
  }

  parseResponse(result: any) {
    if (result?.code != null && Number(result.code) !== 200) {
      throw new Error(String(result.msg || result.message || `IndexTTS2 错误 ${result.code}`))
    }

    if (result?.data?.audio) {
      return {
        audioHex: String(result.data.audio),
        audioLength: Number(result.data.extra_info?.audio_length || 0),
        sampleRate: Number(result.data.extra_info?.audio_sample_rate || 24000),
        bitrate: Number(result.data.extra_info?.bitrate || 128000),
        format: String(result.data.extra_info?.audio_format || result.format || 'mp3'),
        channel: 1,
        audioUrl: null as string | null,
      }
    }

    if (result?.audio_url) {
      return {
        audioHex: '',
        audioLength: 0,
        sampleRate: 24000,
        bitrate: 128000,
        format: String(result.format || 'mp3'),
        channel: 1,
        audioUrl: String(result.audio_url),
      }
    }

    if (result?.audio) {
      const raw = String(result.audio)
      const hex = /^[0-9a-f]+$/i.test(raw) ? raw : Buffer.from(raw, 'base64').toString('hex')
      return {
        audioHex: hex,
        audioLength: 0,
        sampleRate: 24000,
        bitrate: 128000,
        format: String(result.format || 'mp3'),
        channel: 1,
        audioUrl: null,
      }
    }

    throw new Error('IndexTTS2 响应缺少音频（audio_url / audio / data.audio）')
  }
}
