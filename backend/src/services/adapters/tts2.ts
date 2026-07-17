/**
 * TTS2 适配器 — 对接用户提供的 TTS2 API（OpenAI /audio/speech 兼容或 JSON hex 响应）
 */
import type { TTSProviderAdapter } from './types'
import { joinProviderUrl } from './url'

export class TTS2Adapter implements TTSProviderAdapter {
  readonly provider = 'tts2'

  buildGenerateRequest(config: any, params: { text: string; voice: string; model?: string; speed?: number }) {
    const settings = config.settings || {}
    const endpoint = String(settings.endpoint || '/v1/audio/speech')
    const url = joinProviderUrl(config.baseUrl, '', endpoint)

    return {
      url,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model: params.model || config.model || 'tts-2',
        input: params.text,
        voice: params.voice || settings.default_voice || 'alloy',
        speed: params.speed ?? settings.speed ?? 1,
        response_format: settings.response_format || 'mp3',
      },
    }
  }

  parseResponse(result: any) {
    if (result?.data?.audio) {
      return {
        audioHex: String(result.data.audio),
        audioLength: Number(result.data.extra_info?.audio_length || 0),
        sampleRate: Number(result.data.extra_info?.audio_sample_rate || 32000),
        bitrate: Number(result.data.extra_info?.bitrate || 128000),
        format: String(result.data.extra_info?.audio_format || 'mp3'),
        channel: 1,
      }
    }
    if (result?.audio) {
      const raw = String(result.audio)
      const hex = /^[0-9a-f]+$/i.test(raw) ? raw : Buffer.from(raw, 'base64').toString('hex')
      return {
        audioHex: hex,
        audioLength: 0,
        sampleRate: 32000,
        bitrate: 128000,
        format: String(result.format || 'mp3'),
        channel: 1,
      }
    }
    throw new Error('TTS2 响应缺少音频数据')
  }
}
