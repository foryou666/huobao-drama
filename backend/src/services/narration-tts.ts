import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { normalizeIndexTts2Voice } from './narration-voice.js'
import { IndexTTS2Adapter, isGradioIndexTts2Url, synthesizeIndexTts2Gradio } from './adapters/indextts2.js'
import { resolveIndexTts2RuntimeConfig } from './indextts2-config.js'
import type { IndexTts2EmotionOptions } from './adapters/indextts2-gradio.js'
import { trySyncStaticToOss } from '../utils/oss-entity-sync.js'
import { getAudioDurationSeconds } from '../utils/audio-duration.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

const indexTts2Adapter = new IndexTTS2Adapter()

async function saveAudioBuffer(buffer: Buffer, format = 'mp3') {
  const audioDir = path.join(STORAGE_ROOT, 'audio')
  fs.mkdirSync(audioDir, { recursive: true })
  const filename = `${uuid()}.${format}`
  const filePath = path.join(audioDir, filename)
  fs.writeFileSync(filePath, buffer)
  const relativePath = `static/audio/${filename}`
  await trySyncStaticToOss(relativePath)
  return relativePath
}

async function readTtsAudioBuffer(resp: Response, adapter: IndexTTS2Adapter) {
  const contentType = resp.headers.get('content-type') || ''

  if (contentType.includes('audio') || contentType.includes('octet-stream')) {
    const buffer = Buffer.from(await resp.arrayBuffer())
    const ext = contentType.includes('wav') ? 'wav' : 'mp3'
    return { buffer, format: ext }
  }

  const result = await resp.json()
  const parsed = adapter.parseResponse(result) as ReturnType<IndexTTS2Adapter['parseResponse']> & { audioUrl?: string | null }

  if (parsed.audioUrl) {
    const audioResp = await fetch(parsed.audioUrl)
    if (!audioResp.ok) {
      const errText = await audioResp.text()
      throw new Error(`IndexTTS2 下载音频失败 ${audioResp.status}: ${errText.slice(0, 200)}`)
    }
    const buffer = Buffer.from(await audioResp.arrayBuffer())
    const ct = audioResp.headers.get('content-type') || ''
    const format = parsed.format || (ct.includes('wav') ? 'wav' : 'mp3')
    return { buffer, format }
  }

  if (!parsed.audioHex) throw new Error('IndexTTS2 响应无音频数据')
  return {
    buffer: Buffer.from(parsed.audioHex, 'hex'),
    format: parsed.format || 'mp3',
  }
}

/** 使用 IndexTTS2 API 合成单段旁白，返回相对路径与时长 */
export async function generateNarrationTTS(opts: {
  text: string
  voice?: string
  configId?: number | null
  emotion?: IndexTts2EmotionOptions
}): Promise<{ path: string; durationSec: number }> {
  const text = String(opts.text || '').trim()
  if (!text) throw new Error('旁白文本为空')

  const config = resolveIndexTts2RuntimeConfig(opts.configId)
  const voice = opts.voice || String((config as any).settings?.default_voice || 'voice_01')
  const rawVoice = String(voice).trim()
  const usePathVoice = /^https?:\/\//i.test(rawVoice)
    || rawVoice.startsWith('static/')
    || path.isAbsolute(rawVoice)
  const normalizedVoice = usePathVoice ? rawVoice : normalizeIndexTts2Voice(rawVoice, rawVoice)

  let buffer: Buffer
  let format: string

  if (isGradioIndexTts2Url(config.baseUrl)) {
    const { audioUrl, format: gradioFormat } = await synthesizeIndexTts2Gradio({
      baseUrl: config.baseUrl,
      text,
      voice: normalizedVoice,
      emotion: opts.emotion,
    })
    const audioResp = await fetch(audioUrl)
    if (!audioResp.ok) {
      const errText = await audioResp.text()
      throw new Error(`IndexTTS2 下载音频失败 ${audioResp.status}: ${errText.slice(0, 200)}`)
    }
    buffer = Buffer.from(await audioResp.arrayBuffer())
    format = gradioFormat
  } else {
    const { url, method, headers, body } = indexTts2Adapter.buildGenerateRequest(config, {
      text,
      voice: normalizedVoice,
      model: config.model,
    })
    const resp = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      const errText = await resp.text()
      throw new Error(`IndexTTS2 API ${resp.status}: ${errText.slice(0, 300)}`)
    }
    ;({ buffer, format } = await readTtsAudioBuffer(resp, indexTts2Adapter))
  }
  const relativePath = await saveAudioBuffer(buffer, format)
  const durationSec = await getAudioDurationSeconds(relativePath)
  return { path: relativePath, durationSec: durationSec > 0 ? durationSec : 5 }
}
