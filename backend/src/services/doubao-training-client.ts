import { randomUUID } from 'crypto'
import { DOUBAO_TRAINING_BASE_URL } from '../constants/doubao-training.js'
import type { DoubaoTrainingSession } from './doubao-training-session.js'
import { buildDoubaoCookie, extractDoubaoCookieField } from '../utils/doubao-cookie.js'
import { doubaoBrowserService } from './doubao-browser-service.js'

const FAKE_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Content-Type': 'application/json',
  Origin: DOUBAO_TRAINING_BASE_URL,
  Referer: `${DOUBAO_TRAINING_BASE_URL}/chat/`,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
}

function resolveProxyBaseUrl(): string | null {
  const raw = String(process.env.DOUBAO_TRAINING_PROXY_URL || process.env.DOUBAO2API_URL || '').trim()
  return raw ? raw.replace(/\/+$/, '') : null
}

function parseSseEvents(text: string): any[] {
  const events: any[] = []
  for (const block of text.split('\n\n')) {
    const dataLine = block.split('\n').find(line => line.startsWith('data:'))
    if (!dataLine) continue
    const payload = dataLine.slice(5).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      events.push(JSON.parse(payload))
    } catch { /* ignore */ }
  }
  return events
}

function extractVideoUrlFromEvents(events: any[]): string | null {
  for (const event of events) {
    const contentType = event?.content_type ?? event?.message?.content_type
    if (contentType !== 2021 && contentType !== '2021') continue
    const content = event?.content ?? event?.message?.content
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content)
        const url = parsed?.video_url || parsed?.videoUrl || parsed?.download_url
        if (url) return String(url)
      } catch {
        const m = content.match(/https?:\/\/[^\s"']+\.mp4[^\s"']*/i)
        if (m?.[0]) return m[0]
      }
    } else if (content && typeof content === 'object') {
      const url = content.video_url || content.videoUrl || content.download_url
      if (url) return String(url)
    }
  }
  for (const event of events) {
    const text = JSON.stringify(event)
    const m = text.match(/https?:\\\/\\\/[^"\\]+|https?:\/\/[^"\\]+/g)
    if (m?.length) {
      const mp4 = m.map(item => item.replace(/\\\//g, '/')).find(item => /\.mp4|tos-|volces|byteimg|douyin/i.test(item))
      if (mp4) return mp4
    }
  }
  return null
}

function extractAsyncTaskId(events: any[]): string | null {
  for (const event of events) {
    const id = event?.fin_reason?.async_task?.id
      || event?.async_task?.id
      || event?.task_id
    if (id) return String(id)
  }
  return null
}

function buildVideoCompletionBody(prompt: string, ratio: string, duration: number) {
  const localConversationId = `${Date.now()}_${randomUUID()}`
  const localMessageId = `${Date.now()}_${randomUUID()}`
  return {
    messages: [{
      content: JSON.stringify({
        text: prompt,
        ratio,
        duration,
        video_ratio: ratio,
      }),
      content_type: 2020,
      attachments: [],
      references: [],
    }],
    completion_option: {
      is_regen: false,
      with_suggest: false,
      need_create_conversation: true,
      launch_stage: 1,
      is_replace: false,
      is_delete: false,
      is_ai_playground: false,
      memory_type: 2,
      message_from: 0,
      use_deep_think: false,
      use_auto_cot: false,
      resend_for_regen: false,
      enable_commerce_credit: true,
    },
    evaluate_option: { web_ab_params: '' },
    local_conversation_id: localConversationId,
    local_message_id: localMessageId,
  }
}

export async function validateDoubaoTrainingSession(session: DoubaoTrainingSession): Promise<boolean> {
  try {
    const cookie = buildDoubaoCookie(session.sessionId, session.cookie)
    const csrf = extractDoubaoCookieField(cookie, 'passport_csrf_token')
    const resp = await fetch(`${DOUBAO_TRAINING_BASE_URL}/passport/account/info/v2/?account_sdk_source=web`, {
      method: 'POST',
      headers: {
        ...FAKE_HEADERS,
        Cookie: cookie,
        ...(csrf ? { 'x-tt-passport-csrf-token': csrf } : {}),
      },
      body: JSON.stringify({}),
    })
    if (!resp.ok) return false
    const json = await resp.json().catch(() => ({})) as any
    return !!(json?.data?.user_id || json?.user_id)
  } catch {
    return false
  }
}

async function generateViaProxy(
  session: DoubaoTrainingSession,
  prompt: string,
  ratio: string,
): Promise<string> {
  const base = resolveProxyBaseUrl()
  if (!base) throw new Error('proxy not configured')

  const resp = await fetch(`${base}/v1/video/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.sessionId}`,
    },
    body: JSON.stringify({ model: 'doubao-video', prompt, ratio }),
  })
  const json = await resp.json().catch(() => ({})) as any
  if (!resp.ok) {
    throw new Error(String(json?.detail || json?.message || `豆包代理 HTTP ${resp.status}`))
  }
  const url = json?.data?.[0]?.video_url || json?.videos?.[0]?.video_url
  if (!url) throw new Error(String(json?.message || '豆包代理未返回视频 URL'))
  return String(url)
}

async function generateViaBrowser(
  session: DoubaoTrainingSession,
  prompt: string,
  ratio: string,
  duration: number,
): Promise<string> {
  const url = `${DOUBAO_TRAINING_BASE_URL}/samantha/chat/completion`
  const body = JSON.stringify(buildVideoCompletionBody(prompt, ratio, duration))
  const csrf = extractDoubaoCookieField(buildDoubaoCookie(session.sessionId, session.cookie), 'passport_csrf_token')
  const headers: Record<string, string> = {
    ...FAKE_HEADERS,
    ...(csrf ? { 'x-tt-passport-csrf-token': csrf } : {}),
  }

  const first = await doubaoBrowserService.fetch(session, url, { method: 'POST', headers, body })
  if (!first.ok) throw new Error(`豆包提交失败 HTTP ${first.status}: ${first.text.slice(0, 200)}`)

  const firstEvents = parseSseEvents(first.text)
  let videoUrl = extractVideoUrlFromEvents(firstEvents)
  if (videoUrl) return videoUrl

  const taskId = extractAsyncTaskId(firstEvents)
  if (!taskId) {
    throw new Error('豆包未返回视频任务 ID，请确认 Session 有效且账号有 Seedance 2.0 视频额度')
  }

  const streamUrl = `${DOUBAO_TRAINING_BASE_URL}/samantha/chat/async/stream`
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 3000 : 5000))
    const poll = await doubaoBrowserService.fetch(session, streamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ task_id: taskId, event_id: 0 }),
    })
    if (!poll.ok) continue
    videoUrl = extractVideoUrlFromEvents(parseSseEvents(poll.text))
    if (videoUrl) return videoUrl
    if (/额度|次数|quota|limit|exceed/i.test(poll.text)) {
      throw new Error('豆包账号今日免费视频额度已用完')
    }
  }
  throw new Error('豆包视频生成超时，请稍后重试')
}

export async function generateDoubaoTrainingVideo(params: {
  session: DoubaoTrainingSession
  prompt: string
  ratio: string
  duration: number
}): Promise<string> {
  const { session, prompt, ratio, duration } = params
  if (resolveProxyBaseUrl()) {
    try {
      return await generateViaProxy(session, prompt, ratio)
    } catch (err: any) {
      if (!/proxy not configured/i.test(String(err?.message))) throw err
    }
  }
  return generateViaBrowser(session, prompt, ratio, duration)
}
