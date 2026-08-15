import {
  FUNSHION_TAB_APP_CODE,
  normalizeFunshionAspectRatio,
  normalizeFunshionAuthHeader,
  normalizeFunshionClarity,
  normalizeFunshionDuration,
  resolveFunshionApiBaseUrl,
  resolveFunshionTabAppCode,
  resolveFunshionUpstreamModel,
} from '../constants/funshion-web.js'
import type { VideoContentRef } from '../utils/seedance-content.js'
import type { FunshionWebSession } from './funshion-web-session.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

function authHeader(session: FunshionWebSession): string {
  const raw = normalizeFunshionAuthHeader(session.token)
  if (!raw) throw new Error('S通道8 未配置 Token')
  return raw
}

function baseUrl(session: FunshionWebSession): string {
  return resolveFunshionApiBaseUrl(session.baseUrl)
}

async function funshionRequest(
  session: FunshionWebSession,
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const url = `${baseUrl(session)}${path.startsWith('/') ? path : `/${path}`}`
  const headers = new Headers(init.headers || {})
  if (!headers.has('Authorization')) headers.set('Authorization', authHeader(session))
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, text/plain, */*')
  if (!headers.has('User-Agent')) headers.set('User-Agent', UA)
  if (!headers.has('Origin')) headers.set('Origin', baseUrl(session))
  if (!headers.has('Referer')) headers.set('Referer', `${baseUrl(session)}/ai-app/video`)
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  const resp = await fetch(url, { ...init, headers })
  const text = await resp.text()
  let payload: any = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`橙星响应非 JSON (${resp.status}): ${text.slice(0, 200)}`)
  }
  if (resp.status === 401 || payload?.code === 401) {
    throw new Error('橙星登录已失效，请重新从视频页复制 Token')
  }
  if (resp.status >= 400) {
    throw new Error(`橙星 HTTP ${resp.status}: ${payload?.msg || payload?.message || text.slice(0, 200)}`)
  }
  return payload
}

export async function validateFunshionSession(session: FunshionWebSession): Promise<boolean> {
  try {
    const payload = await funshionRequest(session, '/service/user/get/userCoin/info', { method: 'GET' })
    const code = payload?.code
    return code == null || Number(code) === 200
  } catch {
    return false
  }
}

export type FunshionUserCoinInfo = {
  userId: number | null
  coinAmount: number
  coinVip: number
  coinPackage: number
  coinGive: number
}

/** GET /service/user/get/userCoin/info — 上游星币余额 */
export async function fetchFunshionUserCoin(session: FunshionWebSession): Promise<FunshionUserCoinInfo> {
  const payload = await funshionRequest(session, '/service/user/get/userCoin/info', { method: 'GET' })
  if (Number(payload?.code) !== 200 && payload?.code != null) {
    throw new Error(payload?.msg || payload?.message || '查询橙星余额失败')
  }
  const data = payload?.data || {}
  const num = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return {
    userId: data.userId != null && Number.isFinite(Number(data.userId)) ? Number(data.userId) : null,
    coinAmount: num(data.coinAmount ?? data.coin_amount ?? data.totalCoin),
    coinVip: num(data.coinVip ?? data.coin_vip),
    coinPackage: num(data.coinPackage ?? data.coin_package),
    coinGive: num(data.coinGive ?? data.coin_give),
  }
}

export async function createFunshionAppboxProject(
  session: FunshionWebSession,
  appId: string,
): Promise<string> {
  const payload = await funshionRequest(session, '/service/workflow/project/appbox/create', {
    method: 'POST',
    body: JSON.stringify({ appId }),
  })
  if (Number(payload?.code) !== 200) {
    throw new Error(payload?.msg || payload?.message || '创建橙星视频项目失败')
  }
  const id = payload?.data?.id
  if (!id) throw new Error('橙星未返回项目 ID')
  return String(id)
}

export async function ensureFunshionProjectId(session: FunshionWebSession): Promise<string> {
  const existing = String(session.projectId || '').trim()
  if (existing) return existing
  const appId = String(session.appId || '').trim()
  if (!appId) {
    throw new Error('请在设置中填写视频页项目 ID（URL /ai-app/video/后面那段），或填写 appId 以便自动创建项目')
  }
  const projectId = await createFunshionAppboxProject(session, appId)
  const { setFunshionWebSession } = await import('./funshion-web-session.js')
  setFunshionWebSession({
    id: session.id,
    project_id: projectId,
    set_active: false,
  })
  session.projectId = projectId
  return projectId
}

export async function uploadFunshionFile(
  session: FunshionWebSession,
  file: Buffer,
  filename: string,
  mime = 'application/octet-stream',
): Promise<{ fileUrl: string; fileId: string }> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(file)], { type: mime }), filename)
  const payload = await funshionRequest(session, '/service/workflow/common/file/upload', {
    method: 'POST',
    body: form,
  })
  if (Number(payload?.code) !== 200) {
    throw new Error(payload?.msg || '橙星上传失败')
  }
  const fileUrl = payload?.data?.fileUrl || payload?.data?.url
  const fileId = payload?.data?.fileId || payload?.data?.id || ''
  if (!fileUrl) throw new Error('橙星上传未返回文件地址')
  return { fileUrl: String(fileUrl), fileId: String(fileId || '') }
}

function buildMediaItems(refs: VideoContentRef[], type: 'image' | 'video' | 'audio') {
  return refs
    .filter(ref => ref.type === type && ref.url)
    .map((ref, index) => ({
      type,
      category: 'other',
      url: ref.url,
      name: type === 'image' ? `图${index + 1}` : (type === 'video' ? `视频${index + 1}` : `音频${index + 1}`),
      num: index + 1,
      id: '',
      resourceId: '',
    }))
}

export function buildFunshionVideoTaskBody(input: {
  projectId: string
  model?: string | null
  prompt: string
  duration?: number | null
  aspectRatio?: string | null
  resolution?: string | null
  refs: VideoContentRef[]
}) {
  const pictures = buildMediaItems(input.refs, 'image')
  const videos = buildMediaItems(input.refs, 'video')
  const audios = buildMediaItems(input.refs, 'audio')
  const duration = normalizeFunshionDuration(input.duration)
  const clarity = normalizeFunshionClarity(input.resolution, undefined, input.model)
  const refCount = pictures.length + videos.length + audios.length
  const tabAppCode = resolveFunshionTabAppCode(refCount)

  return {
    prompt: String(input.prompt || '').trim(),
    model: resolveFunshionUpstreamModel(input.model),
    aspectRatio: normalizeFunshionAspectRatio(input.aspectRatio),
    clarity,
    duration: String(duration),
    audioEnable: true,
    videoCount: 1,
    images: pictures.map(item => item.url),
    pictures,
    videos,
    audios,
    userProjectId: input.projectId,
    tabAppCode,
  }
}

export async function submitFunshionVideoTask(
  session: FunshionWebSession,
  body: Record<string, unknown>,
): Promise<string> {
  const payload = await funshionRequest(session, '/service/workflow/project/appbox/video/task', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (Number(payload?.code) === 407) {
    throw new Error('提示词含敏感词，请修改后重试')
  }
  if (Number(payload?.code) !== 200) {
    throw new Error(payload?.msg || payload?.message || '橙星提交视频任务失败')
  }
  const taskId = payload?.data?.taskId || payload?.data?.id
  if (!taskId) throw new Error('橙星未返回 taskId')
  return String(taskId)
}

export async function pollFunshionVideoTask(
  session: FunshionWebSession,
  projectId: string,
  taskId: string,
  tabAppCode: string = FUNSHION_TAB_APP_CODE,
  promptHint?: string | null,
): Promise<{ status: 'processing' | 'completed' | 'failed'; videoUrl?: string | null; error?: string | null; resolvedTaskId?: string | null }> {
  const tab = String(tabAppCode || FUNSHION_TAB_APP_CODE).trim() || FUNSHION_TAB_APP_CODE
  const payload = await funshionRequest(
    session,
    `/service/workflow/resource/project/${encodeURIComponent(projectId)}?tabAppCode=${encodeURIComponent(tab)}&pageSize=50&pageNum=1`,
    { method: 'GET' },
  )
  if (Number(payload?.code) !== 200 && payload?.code != null) {
    throw new Error(payload?.msg || '查询橙星任务失败')
  }

  const list = Array.isArray(payload?.data?.content)
    ? payload.data.content
    : (Array.isArray(payload?.data?.list)
      ? payload.data.list
      : (Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload?.list) ? payload.list : [])))

  const needle = String(taskId || '').trim()
  const prompt = String(promptHint || '').trim()
  let hit = list.find((item: any) => {
    const candidates = [
      item?.taskId,
      item?.id,
      item?.data?.taskId,
      item?.extend?.taskId,
      item?.extra?.taskId,
    ]
    return candidates.some(v => String(v || '') === needle)
  })
  // 橙星偶发：提交返回的 taskId 与资源列表 taskId 不一致，回退按完整提示词匹配
  if (!hit && prompt) {
    hit = list.find((item: any) => {
      const p = String(item?.data?.extra?.prompt || item?.data?.prompt || item?.prompt || '')
      return p === prompt || (prompt.length > 24 && p.includes(prompt.slice(-24)))
    }) || null
  }

  if (!hit) return { status: 'processing' }

  const resolvedTaskId = hit?.taskId != null ? String(hit.taskId) : null
  const status = String(
    hit.taskStatus || hit.status || hit.state || hit?.data?.taskStatus || hit?.data?.status || '',
  ).toUpperCase()
  if (['SUCCESS', 'COMPLETED', 'DONE', 'FINISH', 'FINISHED'].includes(status) || status === '1') {
    const videoUrl = hit?.data?.url
      || hit?.data?.originUrl
      || hit?.data?.videoUrl
      || hit?.url
      || hit?.videoUrl
      || hit?.resourceUrl
      || hit?.fileUrl
      || null
    if (!videoUrl) return { status: 'processing', resolvedTaskId }
    return { status: 'completed', videoUrl: String(videoUrl), resolvedTaskId }
  }
  if (['FAILED', 'ERROR', 'FAIL', '4', '-1'].includes(status)) {
    return {
      status: 'failed',
      error: hit?.taskMessage || hit?.errorMsg || hit?.data?.message || hit?.msg || '橙星生成失败',
      resolvedTaskId,
    }
  }
  return { status: 'processing', resolvedTaskId }
}

export type FunshionEnhanceClarityOption = {
  label: string
  value: string
  isDefault?: boolean
  disabled?: boolean
}

/** GET /storyboard/ai/video-enhance/input/{videoResId} */
export async function getFunshionEnhanceInput(
  session: FunshionWebSession,
  videoResId: string,
): Promise<{ clarity: FunshionEnhanceClarityOption[]; estimateCoinCount: FunshionEnhanceClarityOption[] }> {
  const id = String(videoResId || '').trim()
  if (!id) throw new Error('缺少视频资源 ID')
  const payload = await funshionRequest(
    session,
    `/service/workflow/storyboard/ai/video-enhance/input/${encodeURIComponent(id)}`,
    { method: 'GET' },
  )
  if (Number(payload?.code) !== 200) {
    throw new Error(payload?.msg || payload?.message || '查询超分参数失败')
  }
  return {
    clarity: Array.isArray(payload?.data?.clarity) ? payload.data.clarity : [],
    estimateCoinCount: Array.isArray(payload?.data?.estimateCoinCount) ? payload.data.estimateCoinCount : [],
  }
}

/**
 * POST /storyboard/ai/video-enhance/task
 * 注意字段名是 videoResId（不是 videoResourceId）
 */
export async function submitFunshionEnhanceTask(
  session: FunshionWebSession,
  input: { videoResId: string; clarity: string; sceneId?: string | null },
): Promise<{ taskId: string; resourceId: string; taskStatus: string }> {
  const videoResId = String(input.videoResId || '').trim()
  const clarity = String(input.clarity || '').trim()
  if (!videoResId) throw new Error('缺少视频资源 ID')
  if (!clarity) throw new Error('缺少超分清晰度')
  const body: Record<string, unknown> = { videoResId, clarity }
  const sceneId = String(input.sceneId || '').trim()
  if (sceneId) body.sceneId = sceneId

  const payload = await funshionRequest(session, '/service/workflow/storyboard/ai/video-enhance/task', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (Number(payload?.code) !== 200) {
    throw new Error(payload?.msg || payload?.message || '提交超分任务失败')
  }
  const taskId = payload?.data?.taskId || payload?.data?.id
  const resourceId = payload?.data?.resourceId || payload?.data?.id
  if (!taskId) throw new Error('橙星未返回超分 taskId')
  return {
    taskId: String(taskId),
    resourceId: resourceId != null ? String(resourceId) : '',
    taskStatus: String(payload?.data?.taskStatus || 'QUEUED'),
  }
}

export async function pollFunshionEnhanceTask(
  session: FunshionWebSession,
  projectId: string,
  taskId: string,
  tabAppCode: string = FUNSHION_TAB_APP_CODE,
  enhanceResourceId?: string | null,
): Promise<{ status: 'processing' | 'completed' | 'failed'; videoUrl?: string | null; error?: string | null }> {
  const list = await listFunshionProjectResources(session, projectId, tabAppCode)

  const needleTask = String(taskId || '').trim()
  const needleRes = String(enhanceResourceId || '').trim()
  const hit = list.find((item: any) => {
    if (needleRes && String(item?.id || '') === needleRes) return true
    return String(item?.taskId || '') === needleTask
  })
  if (!hit) return { status: 'processing' }

  const status = String(hit.taskStatus || hit.status || '').toUpperCase()
  if (['SUCCESS', 'COMPLETED', 'DONE', 'FINISH', 'FINISHED'].includes(status) || status === '1') {
    const videoUrl = hit?.data?.url
      || hit?.data?.originUrl
      || hit?.data?.videoUrl
      || hit?.url
      || null
    if (!videoUrl) return { status: 'processing' }
    return { status: 'completed', videoUrl: String(videoUrl) }
  }
  if (['FAILED', 'ERROR', 'FAIL', '4', '-1'].includes(status)) {
    return {
      status: 'failed',
      error: hit?.taskMessage || hit?.errorMsg || hit?.data?.message || '橙星超分失败',
    }
  }
  return { status: 'processing' }
}

export async function listFunshionProjectResources(
  session: FunshionWebSession,
  projectId: string,
  tabAppCode: string = FUNSHION_TAB_APP_CODE,
): Promise<any[]> {
  const tab = String(tabAppCode || FUNSHION_TAB_APP_CODE).trim() || FUNSHION_TAB_APP_CODE
  const payload = await funshionRequest(
    session,
    `/service/workflow/resource/project/${encodeURIComponent(projectId)}?tabAppCode=${encodeURIComponent(tab)}&pageSize=50&pageNum=1`,
    { method: 'GET' },
  )
  if (Number(payload?.code) !== 200 && payload?.code != null) {
    throw new Error(payload?.msg || '查询橙星资源失败')
  }
  if (Array.isArray(payload?.data?.content)) return payload.data.content
  if (Array.isArray(payload?.data?.list)) return payload.data.list
  if (Array.isArray(payload?.data)) return payload.data
  return []
}

/** 从橙星视频 URL / 本地路径解析 wf-{resourceId} */
export function extractFunshionVideoResId(...candidates: Array<string | null | undefined>): string | null {
  for (const raw of candidates) {
    const s = String(raw || '')
    const m = s.match(/wf-([a-f0-9]{20,})(?:-|\.|_|$|\?)/i)
    if (m?.[1]) return m[1]
  }
  return null
}
