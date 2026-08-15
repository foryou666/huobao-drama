import {
  COZE_API_BASE_URL,
  COZE_IMPERSONATE_PATH,
  COZE_SITE_URL,
  normalizeCozeAspectRatio,
  normalizeCozeDuration,
  resolveCozeApiBaseUrl,
  resolveCozeUpstreamModel,
} from '../constants/coze-web.js'
import { normalizeSeedanceResolution } from '../constants/seedance.js'
import { hasCozeLoginCookie, normalizeCozeCookie } from '../utils/coze-cookie.js'
import {
  buildSeedance2Content,
  parseVideoContentRefs,
  type VideoContentRef,
} from '../utils/seedance-content.js'
import { seedanceRatioRequestFields } from '../utils/video-aspect-ratio.js'
import type { CozeWebSession } from './coze-web-session.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

function extractTokenFromPayload(payload: any): string | null {
  const candidates = [
    payload?.access_token,
    payload?.token,
    payload?.data?.access_token,
    payload?.data?.token,
    payload?.data?.accessToken,
    payload?.data?.jwt_token,
    payload?.data?.data?.access_token,
  ]
  for (const item of candidates) {
    const value = String(item || '').trim()
    if (value) return value
  }
  return null
}

/** Cookie → impersonate → access_token；或直接使用 PAT */
export async function resolveBearerToken(session: CozeWebSession): Promise<string> {
  const pat = String(session.apiKey || '').trim()
  if (pat) return pat

  const cookie = normalizeCozeCookie(String(session.cookie || ''))
  if (!hasCozeLoginCookie(cookie)) {
    throw new Error('S通道7 未配置 Cookie 或 Personal Access Token')
  }

  const url = `${COZE_SITE_URL}${COZE_IMPERSONATE_PATH}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Cookie: cookie,
      Origin: COZE_SITE_URL,
      Referer: `${COZE_SITE_URL}/`,
      'User-Agent': UA,
    },
    body: JSON.stringify({}),
  })
  const text = await resp.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`扣子鉴权响应非 JSON (${resp.status}): ${text.slice(0, 200)}`)
  }
  if (resp.status >= 400) {
    throw new Error(`扣子鉴权失败 HTTP ${resp.status}: ${payload?.msg || payload?.message || text.slice(0, 200)}`)
  }
  const code = payload?.code ?? payload?.errno ?? payload?.status_code
  if (code != null && Number(code) !== 0) {
    throw new Error(`扣子鉴权失败: ${payload?.msg || payload?.message || `code=${code}`}`)
  }
  const token = extractTokenFromPayload(payload)
  if (!token) throw new Error('扣子鉴权未返回 access_token，请检查 Cookie 是否有效')
  return token
}

export async function validateCozeSession(session: CozeWebSession): Promise<boolean> {
  try {
    if (session.apiKey) {
      const base = resolveCozeApiBaseUrl(session.baseUrl)
      const resp = await fetch(`${base}/v1/workspaces`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.apiKey}`,
          Accept: 'application/json',
        },
      })
      if (resp.status === 401 || resp.status === 403) return false
      // 200 或业务可解析均视为可用；404 也可能是权限范围问题但 token 有效
      return resp.status < 500
    }
    await resolveBearerToken(session)
    return true
  } catch {
    return false
  }
}

function authHeaders(token: string, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  }
  if (contentType) headers['Content-Type'] = contentType
  return headers
}

function formatCozeApiError(status: number, path: string, payload: any, text: string): string {
  const msg = String(
    payload?.error?.message
    || payload?.message
    || payload?.msg
    || payload?.error
    || text.slice(0, 200)
    || `HTTP ${status}`,
  )
  return `S通道7 API 错误 ${path}: ${msg}`
}

function assertCozeBizOk(payload: any, path: string, text: string, status: number) {
  const code = payload?.code ?? payload?.errno ?? payload?.status_code
  if (code != null && Number(code) !== 0) {
    const msg = String(payload?.msg || payload?.message || payload?.error?.message || `code=${code}`)
    // 700012006 = Login verification is invalid：网页 Cookie 换到的 token 不能调开放平台视频 API
    if (Number(code) === 700012006 || /login verification is invalid/i.test(msg)) {
      throw new Error(
        'S通道7 鉴权无效：当前 Cookie 换到的登录态不能调用开放平台视频接口。'
        + '扣子「视频项目」权益走网页对话，与 api.coze.cn 的 generations API 不是同一通路。'
        + '请改用开放平台 PAT（且需具备对应模型权限），或提供视频项目页抓包以便改接网页接口。',
      )
    }
    throw new Error(formatCozeApiError(status, path, payload, text || msg))
  }
}

export async function submitCozeVideoTask(
  session: CozeWebSession,
  body: Record<string, unknown>,
): Promise<string> {
  const token = await resolveBearerToken(session)
  const base = resolveCozeApiBaseUrl(session.baseUrl)
  const url = `${base}/api/v3/contents/generations/tasks`
  const resp = await fetch(url, {
    method: 'POST',
    headers: authHeaders(token, 'application/json'),
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`S通道7 提交响应非 JSON (${resp.status}): ${text.slice(0, 200)}`)
  }
  if (resp.status >= 400) {
    throw new Error(formatCozeApiError(resp.status, '/generations/tasks', payload, text))
  }
  assertCozeBizOk(payload, '/generations/tasks', text, resp.status)
  const taskId = String(
    payload?.id
    || payload?.task_id
    || payload?.data?.id
    || payload?.data?.task_id
    || '',
  ).trim()
  if (!taskId) {
    throw new Error(`S通道7 未返回任务 ID: ${text.slice(0, 300)}`)
  }
  return taskId
}

export async function pollCozeVideoTask(
  session: CozeWebSession,
  taskId: string,
): Promise<any> {
  const token = await resolveBearerToken(session)
  const base = resolveCozeApiBaseUrl(session.baseUrl)
  const url = `${base}/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`
  const resp = await fetch(url, {
    method: 'GET',
    headers: authHeaders(token),
  })
  const text = await resp.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`S通道7 轮询响应非 JSON (${resp.status}): ${text.slice(0, 200)}`)
  }
  if (resp.status >= 400) {
    throw new Error(formatCozeApiError(resp.status, `/generations/tasks/${taskId}`, payload, text))
  }
  return payload
}

export function buildCozeGenerateBody(input: {
  model?: string | null
  prompt: string
  duration?: number | null
  aspectRatio?: string | null
  resolution?: string | null
  refs?: VideoContentRef[]
  baseUrl?: string | null
}): Record<string, unknown> {
  const upstreamModel = resolveCozeUpstreamModel(input.model)
  const refs = input.refs || []
  const content = refs.length
    ? buildSeedance2Content(input.prompt, refs)
    : [{ type: 'text', text: String(input.prompt || '') }]
  const hasReferenceMedia = content.some((item: any) =>
    item?.type === 'image_url' || item?.type === 'video_url' || item?.type === 'audio_url')
  const duration = normalizeCozeDuration(input.duration)
  const ratio = normalizeCozeAspectRatio(input.aspectRatio)
  const baseUrl = resolveCozeApiBaseUrl(input.baseUrl)

  const body: Record<string, unknown> = {
    model: upstreamModel,
    content,
    generate_audio: true,
    ...seedanceRatioRequestFields(ratio, upstreamModel, hasReferenceMedia, baseUrl || COZE_API_BASE_URL),
    duration,
    watermark: false,
    resolution: normalizeSeedanceResolution(input.resolution, upstreamModel),
  }
  return body
}

export function parseCozePollStatus(result: any): {
  status: 'completed' | 'failed' | 'running'
  videoUrl?: string | null
  error?: string
} {
  const status = String(result?.status || '').toLowerCase()
  if (status === 'succeeded' || status === 'success' || status === 'completed') {
    const videoUrl = result?.content?.video_url
      || result?.video_url
      || result?.output?.video_url
      || result?.data?.video_url
      || null
    return { status: 'completed', videoUrl }
  }
  if (status === 'failed' || status === 'error' || status === 'canceled' || status === 'cancelled') {
    const raw = String(
      result?.error?.message
      || result?.message
      || result?.error
      || 'S通道7视频生成失败',
    )
    return { status: 'failed', error: raw }
  }
  return { status: 'running' }
}

export function collectRefsFromRecordFields(input: {
  referenceMode?: string | null
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string | null
  referencePayload?: string | null
}): VideoContentRef[] {
  const refs: VideoContentRef[] = []
  const seen = new Set<string>()
  const push = (type: 'image' | 'video' | 'audio', url?: string | null, role?: VideoContentRef['role']) => {
    const next = String(url || '').trim()
    if (!next || seen.has(`${type}:${next}`)) return
    seen.add(`${type}:${next}`)
    refs.push({ type, url: next, role })
  }

  if (input.referenceMode === 'single' && input.imageUrl) push('image', input.imageUrl)
  if (input.referenceMode === 'first_last') {
    push('image', input.firstFrameUrl, 'first_frame')
    push('image', input.lastFrameUrl, 'last_frame')
  }
  if (input.referenceMode === 'multiple' && input.referenceImageUrls) {
    try {
      const list = typeof input.referenceImageUrls === 'string'
        ? JSON.parse(input.referenceImageUrls)
        : input.referenceImageUrls
      if (Array.isArray(list)) list.forEach((url: string) => push('image', url))
    } catch { /* ignore */ }
  }

  for (const ref of parseVideoContentRefs(input.referencePayload)) {
    if (ref.type === 'image' || ref.type === 'video' || ref.type === 'audio') {
      push(ref.type, ref.url, ref.role)
    }
  }
  return refs
}
