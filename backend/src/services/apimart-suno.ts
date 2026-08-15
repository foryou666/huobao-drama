/**
 * @deprecated 配乐已切换至 MiniMax 官方 API（见 services/minimax-music.ts）。
 * 本文件仅保留兼容参考，线上不再调用。
 *
 * APIMart Suno 音乐生成
 * - 提交: POST /v1/music/generations
 * - 轮询: GET /v1/music/tasks/:task_id
 */
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { downloadFile } from '../utils/storage.js'
import { getAudioDurationSeconds } from '../utils/audio-duration.js'
import { tryRefundCharge } from '../utils/credit-charge.js'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { joinProviderUrl } from './adapters/url.js'
import {
  isApimartProvider,
  isRetryableApimartFetchError,
  isRetryableApimartHttpStatus,
  listApimartApiBases,
  APIMART_DEFAULT_BASE_URL,
} from '../constants/apimart.js'
import {
  APIMART_SUNO_MODEL,
  APIMART_SUNO_PROVIDER,
  normalizeApimartSunoVersion,
  type ApimartSunoVersion,
} from '../constants/apimart-suno.js'
import { getApimartImageConfig, type AIConfig } from './ai.js'

export interface SunoGenerateInput {
  prompt: string
  custom?: boolean
  instrumental?: boolean
  version?: string | null
  title?: string | null
  style?: string | null
  negativeTags?: string | null
  vocalGender?: string | null
}

export interface SunoClip {
  title?: string
  duration?: number
  lyrics?: string
  tags?: string
  audio_url?: string
  image_url?: string
  audio_path?: string
  cover_path?: string
}

function nowIso() {
  return new Date().toISOString()
}

/** 复用已配置的 APIMart Key（图片/文本通道均可） */
export function resolveApimartSunoConfig(): AIConfig {
  const image = getApimartImageConfig()
  if (image?.apiKey) return image

  const rows = db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(r => isApimartProvider(r.provider) && r.isActive && r.apiKey)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.id || 0) - (a.id || 0))

  if (rows[0]) {
    const models = rows[0].model ? JSON.parse(rows[0].model) : []
    let settings: Record<string, unknown> | undefined
    if (rows[0].settings) {
      try { settings = JSON.parse(rows[0].settings) } catch { /* ignore */ }
    }
    return {
      id: rows[0].id,
      provider: rows[0].provider || 'apimart',
      baseUrl: rows[0].baseUrl || APIMART_DEFAULT_BASE_URL,
      apiKey: rows[0].apiKey,
      model: models[0] || APIMART_SUNO_MODEL,
      models,
      settings,
    }
  }

  throw new Error(
    'APIMart 未配置：请在「设置 → AI 服务」添加并启用 APIMart（图片或文本通道均可，Key 通用）',
  )
}

export function isApimartSunoConfigured(): boolean {
  try {
    resolveApimartSunoConfig()
    return true
  } catch {
    return false
  }
}

async function apimartFetchJson(
  config: AIConfig,
  build: (baseUrl: string) => { url: string; method: string; body?: unknown },
  logLabel: string,
): Promise<any> {
  const bases = listApimartApiBases(config)
  let lastError = 'APIMart 所有域名均不可达'

  for (let i = 0; i < bases.length; i += 1) {
    const baseUrl = bases[i]
    const req = build(baseUrl)
    try {
      const response = await fetch(req.url, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: req.body != null ? JSON.stringify(req.body) : undefined,
        signal: AbortSignal.timeout(120_000),
      })
      const text = await response.text()
      let result: any
      try {
        result = text ? JSON.parse(text) : {}
      } catch {
        result = { raw: text.slice(0, 800) }
      }

      if (!response.ok) {
        const message = result?.error?.message
          || result?.message
          || `API error ${response.status}: ${text.slice(0, 400)}`
        if (i < bases.length - 1 && isRetryableApimartHttpStatus(response.status)) {
          lastError = message
          logTaskWarn('SunoMusic', `${logLabel}-mirror-retry`, {
            baseUrl,
            status: response.status,
            attempt: i + 1,
          })
          continue
        }
        throw new Error(message)
      }

      return result
    } catch (error: any) {
      const message = String(error?.message || error)
      if (i < bases.length - 1 && isRetryableApimartFetchError(error)) {
        lastError = message
        logTaskWarn('SunoMusic', `${logLabel}-mirror-retry`, {
          baseUrl,
          error: message,
          attempt: i + 1,
        })
        continue
      }
      throw error instanceof Error ? error : new Error(message)
    }
  }

  throw new Error(lastError)
}

function buildSubmitBody(input: SunoGenerateInput) {
  const custom = Boolean(input.custom)
  const instrumental = Boolean(input.instrumental)
  const version: ApimartSunoVersion = normalizeApimartSunoVersion(input.version)
  const prompt = String(input.prompt || '').trim()

  const body: Record<string, unknown> = {
    model: APIMART_SUNO_MODEL,
    custom,
    instrumental,
    version,
    prompt,
  }

  if (custom) {
    if (input.title) body.title = String(input.title).trim()
    if (input.style) body.style = String(input.style).trim()
    if (input.negativeTags) body.negative_tags = String(input.negativeTags).trim()
  }

  const gender = String(input.vocalGender || '').trim()
  if (gender && /^(male|female|m|f)$/i.test(gender)) {
    body.vocal_gender = /^(f|female)$/i.test(gender) ? 'Female' : 'Male'
  }

  return body
}

export async function submitSunoGeneration(input: SunoGenerateInput): Promise<{ taskId: string }> {
  const config = resolveApimartSunoConfig()
  const body = buildSubmitBody(input)

  const result = await apimartFetchJson(
    config,
    (baseUrl) => ({
      url: joinProviderUrl(baseUrl || APIMART_DEFAULT_BASE_URL, '/v1', '/music/generations'),
      method: 'POST',
      body,
    }),
    'submit',
  )

  const taskId = result?.data?.[0]?.task_id
    || result?.data?.task_id
    || result?.task_id
  if (!taskId) {
    throw new Error(`Suno 未返回 task_id: ${JSON.stringify(result).slice(0, 400)}`)
  }
  return { taskId: String(taskId) }
}

export async function pollSunoTask(taskId: string): Promise<{
  status: string
  progress?: number
  music: SunoClip[]
  error?: string
}> {
  const config = resolveApimartSunoConfig()
  const result = await apimartFetchJson(
    config,
    (baseUrl) => ({
      url: joinProviderUrl(baseUrl || APIMART_DEFAULT_BASE_URL, '/v1', `/music/tasks/${encodeURIComponent(taskId)}`),
      method: 'GET',
    }),
    'poll',
  )

  const payload = result?.data || result
  const status = String(payload?.status || result?.status || '').toLowerCase()
  const progress = Number(payload?.progress ?? result?.progress)
  const musicRaw = payload?.result?.music
    || payload?.data?.result?.music
    || result?.result?.music
    || []
  const music: SunoClip[] = Array.isArray(musicRaw)
    ? musicRaw.map((item: any) => ({
      title: item?.title ? String(item.title) : undefined,
      duration: Number(item?.duration) || undefined,
      lyrics: item?.lyrics != null ? String(item.lyrics) : undefined,
      tags: item?.tags != null ? String(item.tags) : undefined,
      audio_url: item?.audio_url ? String(item.audio_url) : undefined,
      image_url: item?.image_url || item?.image_large_url
        ? String(item.image_url || item.image_large_url)
        : undefined,
    }))
    : []

  const error = payload?.error?.message || result?.error?.message || undefined
  return {
    status,
    progress: Number.isFinite(progress) ? progress : undefined,
    music,
    error: error ? String(error) : undefined,
  }
}

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export async function waitForSunoTask(
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<SunoClip[]> {
  const intervalMs = opts.intervalMs ?? 4000
  const timeoutMs = opts.timeoutMs ?? 8 * 60_000
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    const poll = await pollSunoTask(taskId)
    if (poll.status === 'completed' || poll.status === 'success') {
      if (!poll.music.length) throw new Error('Suno 完成但未返回音轨')
      return poll.music
    }
    if (poll.status === 'failed' || poll.status === 'error') {
      throw new Error(poll.error || 'Suno 生成失败')
    }
    await sleep(intervalMs)
  }
  throw new Error('Suno 生成超时，请稍后在历史中刷新查看')
}

async function downloadClips(clips: SunoClip[]): Promise<SunoClip[]> {
  const out: SunoClip[] = []
  for (const clip of clips) {
    const next: SunoClip = { ...clip }
    if (clip.audio_url) {
      try {
        next.audio_path = await downloadFile(clip.audio_url, 'music')
        next.duration = await getAudioDurationSeconds(next.audio_path) || clip.duration
      } catch (err: any) {
        logTaskWarn('SunoMusic', 'download-audio-failed', { error: err?.message || String(err) })
      }
    }
    if (clip.image_url) {
      try {
        next.cover_path = await downloadFile(clip.image_url, 'music/covers')
      } catch {
        /* cover optional */
      }
    }
    out.push(next)
  }
  return out
}

function updateRow(id: number, patch: Partial<typeof schema.musicGenerations.$inferInsert>) {
  db.update(schema.musicGenerations)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(schema.musicGenerations.id, id))
    .run()
}

/** 后台完成一条音乐任务（下载落盘 + 更新状态） */
export async function processMusicGeneration(id: number) {
  const [row] = db.select().from(schema.musicGenerations)
    .where(eq(schema.musicGenerations.id, id))
    .all()
  if (!row) return
  if (row.status === 'completed' || row.status === 'failed') return

  updateRow(id, { status: 'processing' })
  logTaskProgress('SunoMusic', 'processing', { id })

  try {
    let taskId = row.remoteTaskId
    if (!taskId) {
      const submitted = await submitSunoGeneration({
        prompt: row.prompt,
        custom: Boolean(row.customMode),
        instrumental: Boolean(row.instrumental),
        version: row.version,
        title: row.title,
        style: row.style,
        negativeTags: row.negativeTags,
        vocalGender: row.vocalGender,
      })
      taskId = submitted.taskId
      updateRow(id, { remoteTaskId: taskId, provider: APIMART_SUNO_PROVIDER })
    }

    const clips = await waitForSunoTask(taskId)
    const downloaded = await downloadClips(clips)
    const primary = downloaded.find(c => c.audio_path) || downloaded[0]
    if (!primary?.audio_path) {
      throw new Error('音轨下载失败，请重试')
    }

    updateRow(id, {
      status: 'completed',
      audioPath: primary.audio_path,
      coverPath: primary.cover_path || null,
      durationSec: primary.duration ?? null,
      clipsJson: JSON.stringify(downloaded),
      errorMsg: null,
    })
    logTaskProgress('SunoMusic', 'completed', { id, clips: downloaded.length })
  } catch (err: any) {
    const message = String(err?.message || err || '生成失败')
    updateRow(id, { status: 'failed', errorMsg: message })
    if (row.creditTxId) {
      tryRefundCharge(row.creditTxId, {
        summary: 'Suno 配乐失败退款',
        resourceType: 'music_generation',
        resourceId: id,
        metadata: { reason: message },
      })
    }
    logTaskWarn('SunoMusic', 'failed', { id, error: message })
  }
}

/** 服务重启后恢复未完成任务 */
export function resumePendingMusicGenerations() {
  const rows = db.select().from(schema.musicGenerations)
    .all()
    .filter(r => r.status === 'pending' || r.status === 'processing')
    .slice(0, 20)

  for (const row of rows) {
    void processMusicGeneration(row.id)
  }
  if (rows.length) {
    logTaskProgress('SunoMusic', 'resume-pending', { count: rows.length })
  }
}
