import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { resolveSubtitleRemoverConfig } from './subtitle-remover-config.js'
import { resolveMediaFilePath } from '../utils/media-path.js'
import { trySyncStaticToOss } from '../utils/oss-entity-sync.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

function authHeaders(apiKey: string) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

const MIN_OUTPUT_BYTES = 64 * 1024

function assertValidOutputBuffer(buffer: Buffer) {
  if (buffer.length < MIN_OUTPUT_BYTES) {
    throw new Error(
      `VSR 成品无效（仅 ${buffer.length} 字节）。`
      + '请确认本机 VSR 已用可用 ffmpeg 启动（设置 VSR_FFMPEG_PATH）后重试。',
    )
  }
}

function submitTimeoutMs(fileSizeBytes: number) {
  const sizeMb = fileSizeBytes / (1024 * 1024)
  // ~20s/MB，至少 3 分钟，最多 15 分钟（经 Tailscale 传大文件较慢）
  return Math.max(180_000, Math.min(900_000, Math.ceil(sizeMb * 20_000)))
}

function resolveInpaintMode(inpaintMode?: string, subtitleAreas?: number[][]) {
  const mode = String(inpaintMode || 'sttn-det').trim() || 'sttn-det'
  if ((!subtitleAreas || subtitleAreas.length === 0) && mode === 'sttn-auto') return 'sttn-det'
  return mode
}

export async function submitSubtitleRemovalJob(opts: {
  sourceRelativePath: string
  inpaintMode?: string
  subtitleAreas?: number[][]
}) {
  const config = resolveSubtitleRemoverConfig()
  const absPath = resolveMediaFilePath(opts.sourceRelativePath)
  if (!absPath || !fs.existsSync(absPath)) {
    throw new Error('源视频文件不存在')
  }

  const stat = fs.statSync(absPath)
  const timeoutMs = submitTimeoutMs(stat.size)

  const form = new FormData()
  const buffer = fs.readFileSync(absPath)
  const filename = path.basename(absPath)
  form.append('file', new Blob([buffer]), filename)
  form.append('inpaint_mode', resolveInpaintMode(opts.inpaintMode, opts.subtitleAreas))
  if (opts.subtitleAreas?.length) {
    form.append('subtitle_areas', JSON.stringify(opts.subtitleAreas))
  }

  let resp: Response
  try {
    resp = await fetch(`${config.baseUrl}/v1/jobs`, {
      method: 'POST',
      headers: authHeaders(config.apiKey),
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err: any) {
    const msg = String(err?.message || err || '')
    if (msg.includes('timeout') || msg.includes('aborted')) {
      const sizeMb = Math.round(stat.size / (1024 * 1024))
      throw new Error(
        `转发到本机 VSR 超时（${Math.round(timeoutMs / 1000)}s，视频约 ${sizeMb}MB）。`
        + '请确认本机 VSR 已启动、Tailscale 在线，或尝试压缩视频后重试。',
      )
    }
    throw err
  }
  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`VSR 提交失败 ${resp.status}: ${errText.slice(0, 300)}`)
  }
  const result = await resp.json() as { job_id?: string }
  if (!result.job_id) throw new Error('VSR 未返回 job_id')
  return result.job_id
}

export async function pollSubtitleRemovalRemoteJob(remoteJobId: string) {
  const config = resolveSubtitleRemoverConfig()
  const resp = await fetch(`${config.baseUrl}/v1/jobs/${remoteJobId}`, {
    headers: authHeaders(config.apiKey),
    signal: AbortSignal.timeout(30_000),
  })
  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`VSR 查询失败 ${resp.status}: ${errText.slice(0, 300)}`)
  }
  return resp.json() as Promise<{
    status: string
    progress?: number
    error?: string | null
    has_output?: boolean
    output_size?: number
  }>
}

export async function downloadSubtitleRemovalOutput(remoteJobId: string) {
  const config = resolveSubtitleRemoverConfig()
  const resp = await fetch(`${config.baseUrl}/v1/jobs/${remoteJobId}/output`, {
    headers: authHeaders(config.apiKey),
    signal: AbortSignal.timeout(600_000),
  })
  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`VSR 下载失败 ${resp.status}: ${errText.slice(0, 300)}`)
  }
  const buffer = Buffer.from(await resp.arrayBuffer())
  assertValidOutputBuffer(buffer)
  const outDir = path.join(STORAGE_ROOT, 'videos', 'subtitle-removed')
  fs.mkdirSync(outDir, { recursive: true })
  const ext = '.mp4'
  const filename = `${uuid()}${ext}`
  const filePath = path.join(outDir, filename)
  fs.writeFileSync(filePath, buffer)
  const relativePath = `static/videos/subtitle-removed/${filename}`
  await trySyncStaticToOss(relativePath)
  return relativePath
}
