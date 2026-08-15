/**
 * RunningHub OpenAPI 客户端（工作流 v2 + 上传 + 查询）
 * 文档：https://www.runninghub.cn/call-api/api-detail/2012710824451772417?apiType=5
 */
import fs from 'fs'
import path from 'path'
import {
  RUNNINGHUB_API_BASE,
  RUNNINGHUB_INDEXTTS2_WEBAPP_ID,
  RUNNINGHUB_INDEXTTS2_WORKFLOW_ID,
} from '../constants/runninghub-indextts2.js'

export interface RunningHubNodeInfo {
  nodeId: string
  fieldName: string
  fieldValue: unknown
  /** 上游节点说明（仅用于本地推断角色，提交时可带可不带） */
  description?: string
}

export interface RunningHubUploadResult {
  type?: string
  download_url?: string
  fileName?: string
  size?: string | number
}

export interface RunningHubTaskResultItem {
  url?: string | null
  nodeId?: string
  outputType?: string
  text?: string | null
}

export interface RunningHubTaskStatus {
  taskId: string
  status: string
  errorCode?: string
  errorMessage?: string
  results?: RunningHubTaskResultItem[] | null
  failedReason?: unknown
  usage?: unknown
  raw: unknown
}

function joinUrl(base: string, p: string) {
  return `${base.replace(/\/+$/, '')}${p.startsWith('/') ? p : `/${p}`}`
}

async function readJsonSafe(resp: Response): Promise<any> {
  const text = await resp.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { _raw: text }
  }
}

function unwrapData(payload: any): any {
  if (payload == null) return payload
  if (typeof payload === 'object' && 'data' in payload && payload.data != null) {
    return payload.data
  }
  return payload
}

function extractError(payload: any, status: number): string {
  const msg =
    payload?.errorMessage
    || payload?.msg
    || payload?.message
    || payload?.error
    || (typeof payload?._raw === 'string' ? payload._raw.slice(0, 200) : '')
  if (msg) return String(msg)
  return `RunningHub 请求失败 HTTP ${status}`
}

export class RunningHubClient {
  constructor(
    private apiKey: string,
    private apiBase = RUNNINGHUB_API_BASE,
  ) {
    if (!apiKey?.trim()) throw new Error('RunningHub API Key 未配置')
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey.trim()}`,
      ...extra,
    }
  }

  /** 上传本地文件，返回 fileName（工作流节点）与 download_url */
  async uploadBinary(filePath: string): Promise<RunningHubUploadResult> {
    const abs = path.resolve(filePath)
    if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${filePath}`)
    const buf = fs.readFileSync(abs)
    const form = new FormData()
    form.append('file', new Blob([buf]), path.basename(abs))

    const url = joinUrl(this.apiBase, '/openapi/v2/media/upload/binary')
    const resp = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
    const payload = await readJsonSafe(resp)
    if (!resp.ok || (payload?.code != null && Number(payload.code) !== 0 && payload.code !== '0')) {
      throw new Error(extractError(payload, resp.status) || 'RunningHub 上传失败')
    }
    const data = unwrapData(payload) as RunningHubUploadResult
    if (!data?.fileName && !data?.download_url) {
      throw new Error('RunningHub 上传成功但未返回文件地址')
    }
    return data
  }

  /**
   * 经典上传（/task/openapi/upload），返回 api/xxx.ext
   * Seedvr2 LoadVideo 等 Comfy 节点与网页端一致，应使用此格式，而不是 openapi/ 前缀。
   */
  async uploadForComfyInput(filePath: string): Promise<RunningHubUploadResult> {
    const abs = path.resolve(filePath)
    if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${filePath}`)
    const buf = fs.readFileSync(abs)
    const form = new FormData()
    form.append('apiKey', this.apiKey.trim())
    form.append('fileType', 'input')
    form.append('file', new Blob([buf]), path.basename(abs))

    const url = joinUrl(this.apiBase, '/task/openapi/upload')
    const resp = await fetch(url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(180_000),
    })
    const payload = await readJsonSafe(resp)
    if (!resp.ok || (payload?.code != null && Number(payload.code) !== 0 && payload.code !== '0')) {
      throw new Error(extractError(payload, resp.status) || 'RunningHub 上传失败')
    }
    const data = unwrapData(payload) as RunningHubUploadResult
    if (!data?.fileName && !data?.download_url) {
      throw new Error('RunningHub 上传成功但未返回文件地址')
    }
    return data
  }

  /** OpenAPI v2 提交工作流 */
  async runWorkflow(opts: {
    workflowId?: string
    nodeInfoList: RunningHubNodeInfo[]
    instanceType?: string
    usePersonalQueue?: boolean
    webhookUrl?: string
  }): Promise<RunningHubTaskStatus> {
    const workflowId = String(opts.workflowId || RUNNINGHUB_INDEXTTS2_WORKFLOW_ID).trim()
    const url = joinUrl(this.apiBase, `/openapi/v2/run/workflow/${workflowId}`)
    const body: Record<string, unknown> = {
      nodeInfoList: opts.nodeInfoList,
    }
    if (opts.instanceType) body.instanceType = opts.instanceType
    if (opts.usePersonalQueue != null) body.usePersonalQueue = opts.usePersonalQueue
    if (opts.webhookUrl) body.webhookUrl = opts.webhookUrl

    const resp = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
    const payload = await readJsonSafe(resp)
    const data = unwrapData(payload)
    const taskId = data?.taskId || data?.task_id || payload?.taskId
    if (!taskId) {
      throw new Error(extractError(payload, resp.status) || '提交 RunningHub 任务失败')
    }
    return normalizeTask({ ...data, taskId }, payload)
  }

  /**
   * AI 应用 API
   * 优先 OpenAPI v2：POST /openapi/v2/run/ai-app/{webappId}
   * 回退旧版：POST /task/openapi/ai-app/run
   */
  async runAiApp(opts: {
    webappId?: string
    nodeInfoList: RunningHubNodeInfo[]
    instanceType?: string
    usePersonalQueue?: boolean
    webhookUrl?: string
  }): Promise<RunningHubTaskStatus> {
    const webappId = String(opts.webappId || RUNNINGHUB_INDEXTTS2_WEBAPP_ID)
    const body: Record<string, unknown> = {
      apiKey: this.apiKey.trim(),
      webappId,
      nodeInfoList: opts.nodeInfoList,
    }
    if (opts.instanceType) body.instanceType = opts.instanceType
    if (opts.usePersonalQueue != null) body.usePersonalQueue = opts.usePersonalQueue
    if (opts.webhookUrl) body.webhookUrl = opts.webhookUrl

    const attempts: Array<{ url: string; headers: Record<string, string> }> = [
      {
        url: joinUrl(this.apiBase, `/openapi/v2/run/ai-app/${webappId}`),
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      },
      {
        url: joinUrl(this.apiBase, '/task/openapi/ai-app/run'),
        headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      },
    ]

    let lastError = ''
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]
      const resp = await fetch(attempt.url, {
        method: 'POST',
        headers: attempt.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
      const payload = await readJsonSafe(resp)
      const data = unwrapData(payload)
      const taskId = data?.taskId || data?.task_id || payload?.taskId
      if (taskId) {
        return normalizeTask({ ...data, taskId }, payload)
      }
      lastError = extractError(payload, resp.status) || `HTTP ${resp.status}`
      const canRetry = i < attempts.length - 1 && (resp.status === 404 || resp.status === 405 || resp.status === 501)
      if (!canRetry) break
    }
    throw new Error(lastError || '提交 AI 应用任务失败')
  }

  async queryTask(taskId: string): Promise<RunningHubTaskStatus> {
    const url = joinUrl(this.apiBase, '/openapi/v2/query')
    const resp = await fetch(url, {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ taskId }),
      signal: AbortSignal.timeout(30_000),
    })
    const payload = await readJsonSafe(resp)
    const data = unwrapData(payload)
    if (!resp.ok && !data?.status && !data?.taskId) {
      // 回退旧 outputs 接口
      return this.queryTaskLegacy(taskId)
    }
    return normalizeTask(data || payload, payload)
  }

  async queryTaskLegacy(taskId: string): Promise<RunningHubTaskStatus> {
    const url = joinUrl(this.apiBase, '/task/openapi/outputs')
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: this.apiKey.trim(), taskId }),
      signal: AbortSignal.timeout(30_000),
    })
    const payload = await readJsonSafe(resp)
    const data = unwrapData(payload)
    // 旧接口：code=0 且 data 为结果数组时视为成功
    if (payload?.code === 0 || payload?.code === '0') {
      const results = Array.isArray(data) ? data : data?.results
      if (results) {
        return normalizeTask({
          taskId,
          status: 'SUCCESS',
          results,
        }, payload)
      }
    }
    const status = String(data?.status || payload?.status || '').toUpperCase()
    if (status) return normalizeTask({ ...data, taskId }, payload)
    throw new Error(extractError(payload, resp.status) || '查询任务失败')
  }

  async pollUntilDone(taskId: string, opts?: {
    timeoutMs?: number
    intervalMs?: number
  }): Promise<RunningHubTaskStatus> {
    const timeoutMs = opts?.timeoutMs ?? 10 * 60_000
    const intervalMs = opts?.intervalMs ?? 2500
    const started = Date.now()
    let last: RunningHubTaskStatus | null = null
    while (Date.now() - started < timeoutMs) {
      last = await this.queryTask(taskId)
      const st = String(last.status || '').toUpperCase()
      if (st === 'SUCCESS' || st === 'FAILED' || st === 'ERROR' || st === 'CANCELLED') {
        return last
      }
      await new Promise(r => setTimeout(r, intervalMs))
    }
    throw new Error(`RunningHub 任务超时（${Math.round(timeoutMs / 1000)}s）${last?.status ? `，最后状态 ${last.status}` : ''}`)
  }

  /**
   * 拉取工作流/应用的 nodeInfoList 示例，供管理员同步节点映射。
   * 优先 AI 应用官方接口 GET /api/webapp/apiCallDemo。
   */
  async fetchNodeInfoDemo(opts?: {
    workflowId?: string
    webappId?: string
  }): Promise<{ nodeInfoList: RunningHubNodeInfo[]; source: string; raw: unknown }> {
    const workflowId = String(opts?.workflowId || RUNNINGHUB_INDEXTTS2_WORKFLOW_ID)
    const webappId = String(opts?.webappId || RUNNINGHUB_INDEXTTS2_WEBAPP_ID)
    const key = this.apiKey.trim()
    const idCandidates = Array.from(new Set([webappId, workflowId].filter(Boolean)))

    const attempts: Array<{ source: string; run: () => Promise<any> }> = []

    for (const id of idCandidates) {
      attempts.push({
        source: `webapp_apiCallDemo(${id})`,
        run: async () => {
          const url = joinUrl(this.apiBase, `/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(key)}&webappId=${encodeURIComponent(id)}`)
          const resp = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(30_000),
          })
          return { status: resp.status, payload: await readJsonSafe(resp) }
        },
      })
    }

    attempts.push(
      {
        source: 'api_openapi_getJsonApiFormat',
        run: async () => {
          const resp = await fetch(joinUrl(this.apiBase, '/api/openapi/getJsonApiFormat'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: key, workflowId }),
            signal: AbortSignal.timeout(30_000),
          })
          return { status: resp.status, payload: await readJsonSafe(resp) }
        },
      },
      {
        source: 'task_getJsonApiFormat',
        run: async () => {
          const resp = await fetch(joinUrl(this.apiBase, '/task/openapi/getJsonApiFormat'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey: key, workflowId }),
            signal: AbortSignal.timeout(30_000),
          })
          return { status: resp.status, payload: await readJsonSafe(resp) }
        },
      },
      {
        source: 'open_api_getJsonApiFormat_bearer',
        run: async () => {
          const resp = await fetch(joinUrl(this.apiBase, '/api/open-api/getJsonApiFormat'), {
            method: 'POST',
            headers: this.authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ apiKey: key, workflowId, webappId }),
            signal: AbortSignal.timeout(30_000),
          })
          return { status: resp.status, payload: await readJsonSafe(resp) }
        },
      },
    )

    const errors: string[] = []
    for (const attempt of attempts) {
      try {
        const { status, payload } = await attempt.run()
        const list = extractNodeInfoList(payload)
        if (list?.length) {
          return { nodeInfoList: list, source: attempt.source, raw: payload }
        }
        // ComfyUI API format prompt → 可编辑字段模板
        const fromPrompt = nodeInfoListFromComfyPrompt(payload)
        if (fromPrompt?.length) {
          return { nodeInfoList: fromPrompt, source: `${attempt.source}+prompt`, raw: payload }
        }
        errors.push(`${attempt.source}: HTTP ${status} ${extractError(payload, status)}`)
      } catch (err: any) {
        errors.push(`${attempt.source}: ${err?.message || err}`)
      }
    }
    throw new Error(
      '无法自动拉取 nodeInfoList。请打开 RunningHub API 文档 → Playground → 复制请求体中的 nodeInfoList，'
      + '粘贴到设置「节点参数模板」后再次点同步。'
      + ` 详情：${errors.slice(0, 3).join('；')}`,
    )
  }
}

function normalizeTask(data: any, raw: unknown): RunningHubTaskStatus {
  const taskId = String(data?.taskId || data?.task_id || '')
  let status = String(data?.status || data?.taskStatus || '').toUpperCase()
  let results = data?.results
  if (!results && Array.isArray(data?.data)) results = data.data
  if (!status && results) status = 'SUCCESS'
  return {
    taskId,
    status,
    errorCode: data?.errorCode != null ? String(data.errorCode) : undefined,
    errorMessage: data?.errorMessage || data?.errorMsg || undefined,
    results: Array.isArray(results) ? results : null,
    failedReason: data?.failedReason,
    usage: data?.usage,
    raw,
  }
}

export function extractNodeInfoList(payload: any): RunningHubNodeInfo[] | null {
  const candidates = [
    payload?.nodeInfoList,
    payload?.data?.nodeInfoList,
    payload?.data?.nodeInfoListTemplate,
    payload?.nodeInfoListTemplate,
    payload?.data?.prompt,
    payload?.demo?.nodeInfoList,
    payload?.data?.demo?.nodeInfoList,
  ]
  // curl / 整段 JSON 粘贴
  if (typeof payload === 'string') {
    const parsed = tryParseNodeInfoFromText(payload)
    if (parsed?.length) return parsed
  }
  if (typeof payload?.data === 'string') {
    try {
      const inner = JSON.parse(payload.data)
      candidates.push(inner?.nodeInfoList)
      const fromPrompt = nodeInfoListFromComfyPrompt({ data: { prompt: inner } })
      if (fromPrompt?.length) return fromPrompt
    } catch { /* ignore */ }
    const fromText = tryParseNodeInfoFromText(payload.data)
    if (fromText?.length) return fromText
  }
  if (typeof payload?.curl === 'string' || typeof payload?.data?.curl === 'string') {
    const curl = String(payload?.curl || payload?.data?.curl)
    const fromCurl = tryParseNodeInfoFromText(curl)
    if (fromCurl?.length) return fromCurl
  }
  for (const c of candidates) {
    if (Array.isArray(c) && c.length && c.every((x: any) => x && x.nodeId != null && x.fieldName != null)) {
      return c.map((x: any) => ({
        nodeId: String(x.nodeId),
        fieldName: String(x.fieldName),
        fieldValue: x.fieldValue,
        description: String(x.description || x.descriptionCn || x.descriptionEn || '').trim() || undefined,
      }))
    }
  }
  return null
}

/** 从 curl 或粘贴文本中提取 nodeInfoList */
export function tryParseNodeInfoFromText(text: string): RunningHubNodeInfo[] | null {
  const raw = String(text || '').trim()
  if (!raw) return null
  // 直接是数组
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr[0]?.nodeId != null) {
        return arr.map((x: any) => ({
          nodeId: String(x.nodeId),
          fieldName: String(x.fieldName),
          fieldValue: x.fieldValue,
        }))
      }
    } catch { /* ignore */ }
  }
  // 整段请求体
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw)
      if (Array.isArray(obj?.nodeInfoList)) {
        return obj.nodeInfoList.map((x: any) => ({
          nodeId: String(x.nodeId),
          fieldName: String(x.fieldName),
          fieldValue: x.fieldValue,
        }))
      }
    } catch { /* ignore */ }
  }
  const m = raw.match(/"nodeInfoList"\s*:\s*(\[[\s\S]*?\])\s*[,}]/)
  if (m) {
    try {
      const arr = JSON.parse(m[1])
      if (Array.isArray(arr) && arr.length) {
        return arr.map((x: any) => ({
          nodeId: String(x.nodeId),
          fieldName: String(x.fieldName),
          fieldValue: x.fieldValue,
        }))
      }
    } catch { /* ignore */ }
  }
  return null
}

/** ComfyUI API format prompt → 可覆盖的标量字段列表 */
export function nodeInfoListFromComfyPrompt(payload: any): RunningHubNodeInfo[] | null {
  let prompt = payload?.data?.prompt ?? payload?.prompt ?? payload?.data
  if (typeof prompt === 'string') {
    try { prompt = JSON.parse(prompt) } catch { return null }
  }
  if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) return null

  const list: RunningHubNodeInfo[] = []
  for (const [nodeId, node] of Object.entries(prompt as Record<string, any>)) {
    const inputs = node?.inputs
    if (!inputs || typeof inputs !== 'object') continue
    for (const [fieldName, fieldValue] of Object.entries(inputs)) {
      // 跳过节点连线 [nodeId, slot]
      if (Array.isArray(fieldValue) && fieldValue.length === 2 && typeof fieldValue[0] === 'string') continue
      list.push({ nodeId: String(nodeId), fieldName: String(fieldName), fieldValue })
    }
  }
  return list.length ? list : null
}

export function pickAudioResult(results: RunningHubTaskResultItem[] | null | undefined): string | null {
  if (!results?.length) return null
  const audioExt = /^(mp3|wav|flac|m4a|ogg|aac|wma)$/i
  const hit = results.find(r => r.url && audioExt.test(String(r.outputType || '')))
    || results.find(r => r.url && /\.(mp3|wav|flac|m4a|ogg|aac)(\?|$)/i.test(String(r.url)))
    || results.find(r => r.url)
  return hit?.url || null
}
