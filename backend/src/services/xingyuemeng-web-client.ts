import crypto from 'crypto'
import {
  XINGYUEMENG_AES_IV,
  XINGYUEMENG_AES_KEY,
  XINGYUEMENG_ASSET_TYPE_CLIP,
  normalizeXingyuemengAspectRatio,
  normalizeXingyuemengDuration,
  normalizeXingyuemengResolution,
  normalizeXingyuemengToken,
  resolveXingyuemengApiBaseUrl,
  resolveXingyuemengUpstreamModelName,
  resolveXingyuemengVideoMode,
} from '../constants/xingyuemeng-web.js'
import type { VideoContentRef } from '../utils/seedance-content.js'
import type { XingyuemengWebSession } from './xingyuemeng-web-session.js'
import { setXingyuemengWebSession } from './xingyuemeng-web-session.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

function encryptBody(payload: unknown): string {
  const cipher = crypto.createCipheriv(
    'aes-128-cbc',
    Buffer.from(XINGYUEMENG_AES_KEY),
    Buffer.from(XINGYUEMENG_AES_IV),
  )
  return cipher.update(JSON.stringify(payload), 'utf8', 'base64') + cipher.final('base64')
}

function decryptPayload(encoded: string): unknown {
  const decipher = crypto.createDecipheriv(
    'aes-128-cbc',
    Buffer.from(XINGYUEMENG_AES_KEY),
    Buffer.from(XINGYUEMENG_AES_IV),
  )
  const text = decipher.update(encoded, 'base64', 'utf8') + decipher.final('utf8')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function baseUrl(session: XingyuemengWebSession): string {
  return resolveXingyuemengApiBaseUrl(session.baseUrl)
}

function authToken(session: XingyuemengWebSession): string {
  const token = normalizeXingyuemengToken(session.token)
  if (!token) throw new Error('S通道9 未配置 Token')
  return token
}

export async function xingyuemengRequest(
  session: XingyuemengWebSession,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const url = `${baseUrl(session)}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${authToken(session)}`,
    'X-Team-Id': String(session.teamId || '0'),
    'Request-Id': crypto.randomUUID(),
    'User-Agent': UA,
    Origin: 'https://xingyuemeng.com',
    Referer: 'https://xingyuemeng.com/',
  }

  const init: RequestInit = { method, headers }
  if (method.toUpperCase() !== 'GET' && body !== undefined) {
    headers['Content-Type'] = 'application/json;charset=UTF-8'
    init.body = JSON.stringify({ __enc: 1, data: encryptBody(body) })
  }

  const resp = await fetch(url, init)
  const text = await resp.text()
  let payload: any = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`星月梦响应非 JSON (${resp.status}): ${text.slice(0, 200)}`)
  }

  if (resp.status === 401 || payload?.code === 401) {
    throw new Error('星月梦登录已失效，请重新复制 localStorage.xymai_token')
  }

  let data = payload?.data
  if (data && typeof data === 'object' && typeof data.encoded === 'string') {
    data = decryptPayload(data.encoded)
  }

  if (resp.status >= 400) {
    throw new Error(`星月梦 HTTP ${resp.status}: ${payload?.message || text.slice(0, 200)}`)
  }
  if (payload?.code != null && Number(payload.code) !== 200) {
    throw new Error(payload?.message || `星月梦错误 code=${payload.code}`)
  }
  return data
}

export async function validateXingyuemengSession(session: XingyuemengWebSession): Promise<boolean> {
  try {
    const me = await xingyuemengRequest(session, 'POST', '/v1/auth/me', {})
    const nextToken = normalizeXingyuemengToken(me?.token)
    if (nextToken && nextToken !== session.token) {
      setXingyuemengWebSession({ id: session.id, token: nextToken, set_active: false })
      session.token = nextToken
    }
    return !!(me?.user?.uid || me?.user?.id || me?.token)
  } catch {
    return false
  }
}

export async function fetchXingyuemengWallet(session: XingyuemengWebSession) {
  return xingyuemengRequest(session, 'GET', '/v1/points/wallet')
}

async function ensureProjectId(session: XingyuemengWebSession): Promise<string> {
  const existing = String(session.projectId || '').trim()
  if (existing) return existing

  const select = await xingyuemengRequest(session, 'GET', '/v1/projects/select')
  const list = Array.isArray(select) ? select : (select?.data || [])
  const first = list[0]
  if (first?.id) {
    const projectId = String(first.id)
    setXingyuemengWebSession({ id: session.id, project_id: projectId, set_active: false })
    session.projectId = projectId
    return projectId
  }

  const created = await xingyuemengRequest(session, 'POST', '/v1/projects', {
    name: `影光工场-${Date.now().toString(36)}`,
    desc: 'auto',
  })
  const projectId = String(created?.id || '')
  if (!projectId) throw new Error('星月梦创建项目失败')
  setXingyuemengWebSession({ id: session.id, project_id: projectId, set_active: false })
  session.projectId = projectId
  return projectId
}

async function ensureEpisodeId(session: XingyuemengWebSession, projectId: string): Promise<string> {
  const existing = String(session.episodeId || '').trim()
  if (existing) return existing

  const eps = await xingyuemengRequest(session, 'GET', `/v1/episodes?project_id=${encodeURIComponent(projectId)}`)
  const rows = Array.isArray(eps?.data) ? eps.data : (Array.isArray(eps) ? eps : [])
  const first = rows[0]
  if (first?.id) {
    const episodeId = String(first.id)
    setXingyuemengWebSession({ id: session.id, episode_id: episodeId, set_active: false })
    session.episodeId = episodeId
    return episodeId
  }

  const created = await xingyuemengRequest(session, 'POST', '/v1/episodes', {
    project_id: Number(projectId),
    name: '影光',
    desc: '',
  })
  const episodeId = String(created?.id || created?.episode?.id || '')
  if (!episodeId) throw new Error('星月梦创建剧集失败，请在设置中填写 episode_id')
  setXingyuemengWebSession({ id: session.id, episode_id: episodeId, set_active: false })
  session.episodeId = episodeId
  return episodeId
}

export async function createXingyuemengStoryboardAsset(
  session: XingyuemengWebSession,
): Promise<{ assetId: string; shotId: string; projectId: string; episodeId: string }> {
  const projectId = await ensureProjectId(session)
  const episodeId = await ensureEpisodeId(session, projectId)
  const created = await xingyuemengRequest(
    session,
    'POST',
    `/v1/episodes/${encodeURIComponent(episodeId)}/storyboards/shots`,
    {},
  )
  const shot = created?.shot || created
  const assetId = String(shot?.asset?.id || '')
  const shotId = String(shot?.id || '')
  if (!assetId) throw new Error('星月梦创建分镜资产失败')
  return { assetId, shotId, projectId, episodeId }
}

export async function uploadXingyuemengFile(
  session: XingyuemengWebSession,
  file: Buffer,
  filename: string,
  mime = 'application/octet-stream',
): Promise<string> {
  const ext = (filename.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin'
  const base = filename.replace(/\.[^/.]+$/, '') || `file_${Date.now()}`
  const presign = await xingyuemengRequest(
    session,
    'GET',
    `/upload/presigned?ext=${encodeURIComponent(ext)}&filename=${encodeURIComponent(base)}`,
  )
  const uploadUrl = String(presign?.upload_url || '')
  const publicUrl = String(presign?.public_url || '')
  if (!uploadUrl || !publicUrl) throw new Error('星月梦预签名上传失败')

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mime || 'application/octet-stream' },
    body: new Uint8Array(file),
  })
  if (!put.ok) throw new Error(`星月梦上传失败 HTTP ${put.status}`)
  return publicUrl
}

export function buildXingyuemengGenerateBody(input: {
  model?: string | null
  prompt: string
  duration?: number | null
  aspectRatio?: string | null
  resolution?: string | null
  refs: VideoContentRef[]
}) {
  const images = input.refs.filter(r => r.type === 'image' && r.url).map(r => r.url)
  const videos = input.refs.filter(r => r.type === 'video' && r.url).map(r => r.url)
  const audios = input.refs.filter(r => r.type === 'audio' && r.url).map(r => r.url)
  const refCount = images.length + videos.length + audios.length
  const prompt = String(input.prompt || '').trim()
  const modelParams: Record<string, unknown> = {
    video_mode: resolveXingyuemengVideoMode(refCount),
    video_duration: normalizeXingyuemengDuration(input.duration),
    canvas_resolution: normalizeXingyuemengResolution(input.resolution),
    canvas_ratio: normalizeXingyuemengAspectRatio(input.aspectRatio),
    generate_audio: true,
    seed: -1,
  }
  if (images.length) modelParams.reference_images = images
  if (videos.length) modelParams.reference_videos = videos
  if (audios.length) modelParams.reference_audios = audios

  return {
    prompt,
    prompt_type: 'custom',
    prompt_variables: {},
    ignore_style: false,
    sora_prompt_optimize: false,
    model_name: resolveXingyuemengUpstreamModelName(input.model),
    model_params: modelParams,
    gen_count: 1,
    is_auto: 0,
    asset_type: XINGYUEMENG_ASSET_TYPE_CLIP,
  }
}

export async function submitXingyuemengVideoTask(
  session: XingyuemengWebSession,
  assetId: string,
  body: Record<string, unknown>,
): Promise<string> {
  const data = await xingyuemengRequest(
    session,
    'POST',
    `/v1/resource-generation/${encodeURIComponent(assetId)}`,
    body,
  )
  const taskId = data?.task_id || data?.task?.id || data?.id
  if (!taskId) throw new Error('星月梦未返回 task_id')
  // 触发任务推进（网页也会 POST）
  try {
    await xingyuemengRequest(session, 'POST', `/v1/resource-generation/task/${encodeURIComponent(String(taskId))}`, {})
  } catch { /* optional */ }
  return String(taskId)
}

function extractXingyuemengTaskError(task: any): string {
  const raw = task?.error ?? task?.error_msg ?? task?.fail_reason ?? task?.message ?? ''
  if (raw == null) return ''
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'object') {
    const nested = raw.message || raw.error || raw.msg || raw.reason || raw.detail
    if (nested) return String(nested).trim()
    try {
      return JSON.stringify(raw)
    } catch {
      return ''
    }
  }
  return String(raw).trim()
}

/** 透传上游失败文案；多任务时优先 ai_task_id 对应项，其次更详细的内容安全说明 */
function pickXingyuemengFailureError(asset: any): string {
  const tasks = Array.isArray(asset?.tasks) ? asset.tasks : []
  const preferredTaskId = asset?.ai_task_id != null ? String(asset.ai_task_id) : ''
  const matched = preferredTaskId
    ? tasks.find((t: any) => String(t?.id || '') === preferredTaskId)
    : null
  const errors = tasks
    .map((t: any) => extractXingyuemengTaskError(t))
    .filter(Boolean)
  const matchedError = matched ? extractXingyuemengTaskError(matched) : ''
  const detailed = errors
    .filter((e: string) => /内容安全|涉黄|敏感|违规|未通过/.test(e))
    .sort((a: string, b: string) => b.length - a.length)[0] || ''
  const assetError = extractXingyuemengTaskError(asset)
  // 短泛化提示（如「输入文本可能包含敏感信息」）时改用更完整的审核说明
  if (matchedError && detailed && detailed.length > matchedError.length + 8) {
    return detailed
  }
  return matchedError || detailed || errors[0] || assetError || ''
}

export async function pollXingyuemengAsset(
  session: XingyuemengWebSession,
  assetId: string,
): Promise<{ status: 'processing' | 'completed' | 'failed'; videoUrl?: string | null; error?: string | null }> {
  const asset = await xingyuemengRequest(session, 'GET', `/v1/assets/${encodeURIComponent(assetId)}`)
  const videoUrl = asset?.video_url ? String(asset.video_url) : null
  const taskStatus = asset?.ai_task_status
  const tasks = Array.isArray(asset?.tasks) ? asset.tasks : []
  const preferredTaskId = asset?.ai_task_id != null ? String(asset.ai_task_id) : ''
  const matched = preferredTaskId
    ? tasks.find((t: any) => String(t?.id || '') === preferredTaskId)
    : null
  const latest = matched || tasks.find((t: any) => extractXingyuemengTaskError(t)) || tasks[0]
  const taskError = pickXingyuemengFailureError(asset)

  if (videoUrl) return { status: 'completed', videoUrl }
  // 2 = success（已验证），3/failed 视为失败
  if (taskStatus === 3 || taskStatus === 'failed' || taskStatus === 'error' || latest?.status === 3) {
    return { status: 'failed', error: taskError || '星月梦生成失败' }
  }
  if (taskError && (latest?.status === 3 || /fail|错误|失败|敏感|安全检测/i.test(taskError))) {
    return { status: 'failed', error: taskError }
  }
  return { status: 'processing' }
}
