import { getActiveConfig, type AIConfig } from './ai.js'
import { logTaskProgress, logTaskStart, logTaskSuccess, logTaskError } from '../utils/task-logger.js'
import { resolveMediaUrlForExternalApi } from '../utils/oss-upload.js'
import { trySyncStaticToOss } from '../utils/oss-entity-sync.js'

export interface RepaintUtterance {
  id: string
  start_sec: number
  end_sec: number
  text: string
  speaker?: string
}

function resolveDashScopeConfig(): AIConfig {
  const audio = getActiveConfig('audio')
  if (audio?.provider.toLowerCase().includes('ali')) return audio
  const text = getActiveConfig('text')
  if (text?.provider.toLowerCase().includes('ali')) return text
  throw new Error('请在设置中配置百炼（ali）文本或音频 API，用于 ASR 转写')
}

function dashScopeRoot(config: AIConfig) {
  const base = (config.baseUrl || 'https://dashscope.aliyuncs.com').replace(/\/+$/, '')
  if (base.includes('/compatible-mode')) return 'https://dashscope.aliyuncs.com'
  const match = base.match(/^(https?:\/\/[^/]+)/i)
  return match?.[1] || 'https://dashscope.aliyuncs.com'
}

async function submitAsrTask(config: AIConfig, fileUrl: string): Promise<string> {
  const root = dashScopeRoot(config)
  const url = `${root}/api/v1/services/audio/asr/transcription`
  logTaskProgress('RepaintASR', 'submit', { fileUrl: fileUrl.slice(0, 80) })
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: 'fun-asr',
      input: { file_urls: [fileUrl] },
      parameters: {
        channel_id: [0],
        language_hints: ['zh', 'en'],
      },
    }),
  })
  const raw = await resp.text()
  if (!resp.ok) throw new Error(raw.slice(0, 300) || `ASR 提交失败 ${resp.status}`)
  let json: any
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('ASR 返回非 JSON')
  }
  const taskId = json?.output?.task_id || json?.task_id
  if (!taskId) throw new Error(json?.message || 'ASR 未返回 task_id')
  return String(taskId)
}

async function pollAsrTask(config: AIConfig, taskId: string): Promise<string> {
  const root = dashScopeRoot(config)
  const url = `${root}/api/v1/tasks/${taskId}`
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    })
    const json = await resp.json().catch(() => ({}))
    const status = String(json?.output?.task_status || json?.task_status || '').toUpperCase()
    if (status === 'SUCCEEDED' || status === 'SUCCESS') {
      const results = json?.output?.results || json?.output?.result || []
      const first = Array.isArray(results) ? results[0] : null
      const transcriptionUrl = first?.transcription_url || json?.output?.transcription_url
      if (!transcriptionUrl) throw new Error('ASR 成功但未返回 transcription_url')
      return String(transcriptionUrl)
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(json?.output?.message || json?.message || 'ASR 任务失败')
    }
  }
  throw new Error('ASR 转写超时，请稍后重试')
}

function msToSec(ms: number) {
  return Math.round((ms / 1000) * 100) / 100
}

function parseAsrResult(json: any): RepaintUtterance[] {
  const transcripts = json?.transcripts
    || json?.results?.[0]?.transcripts
    || (Array.isArray(json?.sentences) ? [{ sentences: json.sentences }] : [])

  const items: RepaintUtterance[] = []
  let idx = 0

  const pushSentence = (sentence: any) => {
    const text = String(sentence?.text || '').trim()
    if (!text) return
    const begin = Number(sentence?.begin_time ?? sentence?.start_time ?? 0)
    const end = Number(sentence?.end_time ?? begin)
    items.push({
      id: `u${++idx}`,
      start_sec: msToSec(begin),
      end_sec: msToSec(end > begin ? end : begin + 500),
      text,
      speaker: sentence?.speaker_id != null ? `sp${sentence.speaker_id}` : undefined,
    })
  }

  if (Array.isArray(transcripts)) {
    for (const block of transcripts) {
      for (const sentence of block?.sentences || []) pushSentence(sentence)
    }
  }
  if (!items.length && Array.isArray(json?.sentences)) {
    for (const sentence of json.sentences) pushSentence(sentence)
  }

  return items.sort((a, b) => a.start_sec - b.start_sec)
}

export async function transcribeRepaintAudio(
  audioRelativePath: string,
  dramaId?: number | null,
): Promise<RepaintUtterance[]> {
  const config = resolveDashScopeConfig()
  logTaskStart('RepaintASR', 'transcribe', { path: audioRelativePath })

  await trySyncStaticToOss(audioRelativePath, dramaId ?? undefined)
  const fileUrl = await resolveMediaUrlForExternalApi(audioRelativePath, dramaId)
  if (!fileUrl) {
    throw new Error('音频需同步 OSS 后供 ASR 拉取，请检查 OSS 配置')
  }

  const taskId = await submitAsrTask(config, fileUrl)
  const resultUrl = await pollAsrTask(config, taskId)
  const resultResp = await fetch(resultUrl)
  if (!resultResp.ok) throw new Error(`下载 ASR 结果失败 ${resultResp.status}`)
  const resultJson = await resultResp.json()
  const utterances = parseAsrResult(resultJson)
  logTaskSuccess('RepaintASR', 'transcribe', { count: utterances.length, taskId })
  return utterances
}
