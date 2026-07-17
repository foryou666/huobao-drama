/**
 * IndexTTS2 Gradio 部署对接（/gradio_api/call/gen_single）
 * 根地址示例：https://host.container.x-gpu.com/
 */
import fs from 'fs'
import path from 'path'
import { getAbsolutePath } from '../../utils/storage.js'
import { openMediaReadStream } from '../../utils/media-download.js'

export interface GradioFileData {
  path: string
  url: string
  orig_name?: string
  size?: number | null
  mime_type?: string | null
  is_stream?: boolean
  meta?: { _type?: string }
}

/**
 * gen_single 参数顺序（与 Gradio inputs 一致）：
 * 0 情绪方式, 1 参考音色, 2 文本, 3 情绪参考音频, 4 情绪权重,
 * 5-12 Happy/Angry/Sad/Afraid/Disgusted/Melancholic/Surprised/Calm,
 * 13 情绪文字描述, 14+ 采样参数
 */
const DEFAULT_GEN_SINGLE_PARAMS: unknown[] = [
  'Same as the voice reference',
  null,
  '',
  null,
  0.8,
  0, 0, 0, 0, 0, 0, 0, 0,
  '',
  false,
  120,
  true,
  0.8,
  30,
  0.8,
  0,
  3,
  10,
  1500,
] as unknown[]

export type IndexTts2EmotionMode = 'same' | 'text' | 'vector'

export interface IndexTts2EmotionVector {
  happy?: number
  angry?: number
  sad?: number
  afraid?: number
  disgusted?: number
  melancholic?: number
  surprised?: number
  calm?: number
}

export interface IndexTts2EmotionOptions {
  mode?: IndexTts2EmotionMode
  description?: string
  weight?: number
  vector?: IndexTts2EmotionVector
}

function applyEmotionParams(data: unknown[], emotion?: IndexTts2EmotionOptions) {
  const mode = emotion?.mode || 'same'
  const weight = emotion?.weight ?? 0.8
  data[4] = weight
  if (mode === 'text') {
    data[0] = 'Use text description to control emotion'
    data[13] = String(emotion?.description || '').trim()
    return
  }
  if (mode === 'vector') {
    data[0] = 'Use emotion vectors'
    const v = emotion?.vector || {}
    data[5] = v.happy ?? 0
    data[6] = v.angry ?? 0
    data[7] = v.sad ?? 0
    data[8] = v.afraid ?? 0
    data[9] = v.disgusted ?? 0
    data[10] = v.melancholic ?? 0
    data[11] = v.surprised ?? 0
    data[12] = v.calm ?? 0
    return
  }
  data[0] = 'Same as the voice reference'
}

export function normalizeGradioBase(url: string) {
  return String(url || '').trim().replace(/\/+$/, '')
}

export function isGradioIndexTts2Url(url: string) {
  const base = normalizeGradioBase(url)
  if (!base) return false
  if (/indextts|\/generate|\/infer/i.test(base) && !/container\.x-gpu\.com/i.test(base)) {
    return false
  }
  return !/\/api\/v\d+\//i.test(base)
}

function parseGradioComplete(txt: string) {
  if (txt.includes('event: error')) {
    const errLine = txt.split('\n').find(l => l.startsWith('data: '))
    throw new Error(`IndexTTS2 Gradio 错误: ${(errLine || txt).slice(0, 400)}`)
  }

  const lines = txt.split('\n')
  let lastData: string | null = null
  for (const line of lines) {
    if (line.startsWith('data: ')) lastData = line.slice(6)
  }
  if (lastData == null) {
    throw new Error(`IndexTTS2 Gradio 无响应: ${txt.slice(0, 300)}`)
  }

  const parsed = JSON.parse(lastData.trim())
  if (parsed == null) {
    throw new Error(`IndexTTS2 Gradio 无结果: ${txt.slice(0, 300)}`)
  }
  return parsed
}

async function gradioCall(base: string, api: string, data: unknown[]) {
  const root = normalizeGradioBase(base)
  const prefix = `${root}/gradio_api/call/${api}`
  const start = await fetch(prefix, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  })
  if (!start.ok) {
    const errText = await start.text()
    throw new Error(`IndexTTS2 Gradio ${api} ${start.status}: ${errText.slice(0, 300)}`)
  }
  const { event_id: eventId } = await start.json() as { event_id: string }
  const result = await fetch(`${prefix}/${eventId}`)
  const txt = await result.text()
  return parseGradioComplete(txt)
}

function voiceNameToExampleIndex(voice: string): number | null {
  const m = voice.match(/^voice_(\d{1,2})(?:\.wav)?$/i)
  if (!m) return null
  const n = Number(m[1])
  if (n >= 1 && n <= 12) return n - 1
  return null
}

function resolveExampleIndex(voice: string): number {
  const trimmed = String(voice || '').trim()
  if (!trimmed || trimmed === 'default') return 0
  const byName = voiceNameToExampleIndex(trimmed)
  if (byName != null) return byName
  if (/^\d+$/.test(trimmed)) {
    const idx = Number(trimmed)
    if (idx >= 0 && idx <= 11) return idx
  }
  throw new Error(`IndexTTS2 音色 "${trimmed}" 无效，请使用 voice_01~voice_12 或 0~11`)
}

async function uploadAudioToGradio(base: string, buffer: Buffer, filename: string): Promise<GradioFileData> {
  const root = normalizeGradioBase(base)
  const form = new FormData()
  const blob = new Blob([new Uint8Array(buffer)])
  form.append('files', blob, filename)
  const resp = await fetch(`${root}/gradio_api/upload`, { method: 'POST', body: form })
  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`IndexTTS2 上传参考音频失败 ${resp.status}: ${errText.slice(0, 200)}`)
  }
  const uploaded = await resp.json() as string[]
  const serverPath = uploaded?.[0]
  if (!serverPath) throw new Error('IndexTTS2 上传参考音频无返回路径')
  const url = `${root}/gradio_api/file=${encodeURIComponent(serverPath)}`
  return {
    path: serverPath,
    url,
    orig_name: filename,
    meta: { _type: 'gradio.FileData' },
  }
}

async function readStaticMediaBuffer(staticPath: string): Promise<{ buffer: Buffer; filename: string }> {
  const normalized = String(staticPath || '').trim().replace(/^\/+/, '')
  if (!normalized.startsWith('static/')) {
    throw new Error(`IndexTTS2 无效参考音频路径: ${staticPath}`)
  }
  const absPath = getAbsolutePath(normalized)
  if (fs.existsSync(absPath)) {
    return { buffer: fs.readFileSync(absPath), filename: path.basename(absPath) }
  }
  try {
    const { stream } = await openMediaReadStream(normalized)
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      stream.on('end', () => resolve())
      stream.on('error', reject)
    })
    return { buffer: Buffer.concat(chunks), filename: path.basename(normalized) }
  } catch {
    throw new Error(`IndexTTS2 参考音频不存在: ${normalized}`)
  }
}

async function resolveVoiceReference(base: string, voice: string): Promise<GradioFileData> {
  const trimmed = String(voice || '').trim()
  if (!trimmed) throw new Error('IndexTTS2 未配置音色 voice')

  if (/^https?:\/\//i.test(trimmed)) {
    const resp = await fetch(trimmed)
    if (!resp.ok) throw new Error(`IndexTTS2 下载参考音频失败 ${resp.status}`)
    const buffer = Buffer.from(await resp.arrayBuffer())
    const name = trimmed.split('/').pop()?.split('?')[0] || 'voice_ref.wav'
    return uploadAudioToGradio(base, buffer, name)
  }

  if (trimmed.startsWith('static/')) {
    const { buffer, filename } = await readStaticMediaBuffer(trimmed)
    return uploadAudioToGradio(base, buffer, filename)
  }

  if (path.isAbsolute(trimmed)) {
    if (!fs.existsSync(trimmed)) throw new Error(`IndexTTS2 参考音频不存在: ${trimmed}`)
    const buffer = fs.readFileSync(trimmed)
    return uploadAudioToGradio(base, buffer, path.basename(trimmed))
  }

  const exampleIndex = resolveExampleIndex(trimmed)
  const example = await gradioCall(base, 'load_example', [exampleIndex])
  const voiceRef = example?.[0]?.value as GradioFileData | undefined
  if (!voiceRef?.url) throw new Error(`IndexTTS2 加载示例音色 #${exampleIndex} 失败`)
  return voiceRef
}

/** 通过 Gradio gen_single 合成语音，返回音频下载 URL */
export async function synthesizeIndexTts2Gradio(opts: {
  baseUrl: string
  text: string
  voice: string
  emotion?: IndexTts2EmotionOptions
}): Promise<{ audioUrl: string; format: string }> {
  const text = String(opts.text || '').trim()
  if (!text) throw new Error('旁白文本为空')

  const voiceRef = await resolveVoiceReference(opts.baseUrl, opts.voice)
  const data = [...DEFAULT_GEN_SINGLE_PARAMS]
  applyEmotionParams(data, opts.emotion)
  data[1] = voiceRef
  data[2] = text

  const out = await gradioCall(opts.baseUrl, 'gen_single', data)
  const audio = (out?.[0]?.value || out?.[0]) as GradioFileData | undefined
  if (!audio?.url) throw new Error('IndexTTS2 Gradio 响应无音频')

  const format = audio.orig_name?.toLowerCase().endsWith('.mp3') ? 'mp3' : 'wav'
  return { audioUrl: audio.url, format }
}
