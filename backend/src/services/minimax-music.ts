/**
 * MiniMax 官方音乐生成
 * POST https://api.minimaxi.com/v1/music_generation
 * 文档: https://platform.minimaxi.com/docs/api-reference/music-generation
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuid } from 'uuid'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getAudioDurationSeconds } from '../utils/audio-duration.js'
import { tryRefundCharge } from '../utils/credit-charge.js'
import { logTaskProgress, logTaskWarn } from '../utils/task-logger.js'
import { downloadFile } from '../utils/storage.js'
import {
  MINIMAX_MUSIC_DEFAULT_MODEL,
  MINIMAX_MUSIC_PROVIDER,
  maskMinimaxApiKey,
  normalizeMinimaxMusicModel,
  resolveMinimaxGroupId,
  resolveMinimaxMusicApiKey,
  resolveMinimaxMusicBaseUrl,
  type MinimaxMusicModel,
} from '../constants/minimax-music.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

export interface MinimaxMusicInput {
  prompt: string
  custom?: boolean
  instrumental?: boolean
  /** 存 DB version 字段，值为 MiniMax model id */
  version?: string | null
  title?: string | null
  style?: string | null
}

export interface MinimaxMusicClip {
  title?: string
  duration?: number
  lyrics?: string
  audio_url?: string
  audio_path?: string
}

function nowIso() {
  return new Date().toISOString()
}

export function isMinimaxMusicConfigured(): boolean {
  return !!resolveMinimaxMusicApiKey()
}

export function assertMinimaxMusicConfigured() {
  if (!isMinimaxMusicConfigured()) {
    throw new Error('MiniMax 未配置：请在 backend/.env 设置 MINIMAX_API_KEY')
  }
}

function buildRequestBody(input: MinimaxMusicInput) {
  const model: MinimaxMusicModel = normalizeMinimaxMusicModel(input.version)
  const instrumental = Boolean(input.instrumental)
  const custom = Boolean(input.custom)
  const promptText = String(input.prompt || '').trim()
  const styleText = String(input.style || '').trim()
  const title = String(input.title || '').trim()

  const body: Record<string, unknown> = {
    model,
    stream: false,
    output_format: 'url',
    aigc_watermark: false,
    audio_setting: {
      sample_rate: 44100,
      bitrate: 256000,
      format: 'mp3',
    },
  }

  if (instrumental) {
    // 纯音乐：prompt 必填，lyrics 非必填
    const desc = custom
      ? (styleText || promptText || title)
      : (promptText || styleText || title)
    if (!desc) throw new Error('纯音乐请填写风格/场景描述')
    body.is_instrumental = true
    body.prompt = desc.slice(0, 2000)
  } else if (custom) {
    // 自定义歌词：prompt=风格，lyrics=歌词
    const lyrics = promptText
    if (!lyrics) throw new Error('自定义模式请填写歌词，或勾选纯音乐')
    body.lyrics = lyrics.slice(0, 3500)
    body.prompt = (styleText || title || '流行, 电影感, 适合短剧').slice(0, 2000)
    body.is_instrumental = false
  } else {
    // 灵感模式 + 人声：用 lyrics_optimizer 根据 prompt 自动写词
    if (!promptText) throw new Error('请输入配乐提示词')
    body.prompt = promptText.slice(0, 2000)
    body.lyrics_optimizer = true
    body.is_instrumental = false
  }

  return body
}

function hexToBuffer(hex: string): Buffer {
  const cleaned = String(hex || '').trim().replace(/^0x/i, '').replace(/\s+/g, '')
  if (!cleaned || cleaned.length % 2 !== 0) {
    throw new Error('MiniMax 返回的音频 hex 无效')
  }
  return Buffer.from(cleaned, 'hex')
}

async function saveAudioBuffer(buffer: Buffer, ext = '.mp3'): Promise<string> {
  const subDir = 'music'
  const dir = path.join(STORAGE_ROOT, subDir)
  fs.mkdirSync(dir, { recursive: true })
  const filename = `${uuid()}${ext.startsWith('.') ? ext : `.${ext}`}`
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, buffer)
  const relative = `static/${subDir}/${filename}`
  try {
    const { trySyncStaticToOss } = await import('../utils/oss-entity-sync.js')
    await trySyncStaticToOss(relative, null)
  } catch {
    /* ignore */
  }
  return relative
}

async function persistAudioFromResponse(payload: any): Promise<{ audioPath: string; durationSec?: number }> {
  const data = payload?.data || {}
  const audioField = data?.audio ?? payload?.audio
  const extra = payload?.extra_info || {}
  const durationMs = Number(extra.music_duration)
  const durationSec = Number.isFinite(durationMs) && durationMs > 0
    ? durationMs / 1000
    : undefined

  if (!audioField || typeof audioField !== 'string') {
    throw new Error('MiniMax 未返回音频数据')
  }

  let audioPath: string
  if (/^https?:\/\//i.test(audioField)) {
    audioPath = await downloadFile(audioField, 'music')
  } else {
    // hex
    const buf = hexToBuffer(audioField)
    const fmt = String(payload?.audio_setting?.format || extra.format || 'mp3').toLowerCase()
    const ext = fmt === 'wav' ? '.wav' : fmt === 'pcm' ? '.pcm' : '.mp3'
    audioPath = await saveAudioBuffer(buf, ext)
  }

  const probed = await getAudioDurationSeconds(audioPath)
  return {
    audioPath,
    durationSec: probed || durationSec,
  }
}

export async function generateMinimaxMusic(input: MinimaxMusicInput): Promise<{
  clip: MinimaxMusicClip
  model: string
  traceId?: string
}> {
  assertMinimaxMusicConfigured()
  const apiKey = resolveMinimaxMusicApiKey()
  const baseUrl = resolveMinimaxMusicBaseUrl()
  const body = buildRequestBody(input)
  const url = `${baseUrl}/v1/music_generation`

  logTaskProgress('MinimaxMusic', 'request', {
    model: body.model,
    instrumental: Boolean(body.is_instrumental),
    hasLyrics: Boolean(body.lyrics),
    lyricsOptimizer: Boolean(body.lyrics_optimizer),
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10 * 60_000),
  })

  const text = await response.text()
  let result: any
  try {
    result = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`MiniMax 响应非 JSON: ${text.slice(0, 300)}`)
  }

  const statusCode = result?.base_resp?.status_code
  if (!response.ok || (statusCode != null && Number(statusCode) !== 0)) {
    const message = result?.base_resp?.status_msg
      || result?.message
      || result?.error?.message
      || `MiniMax 错误 HTTP ${response.status}`
    throw new Error(String(message))
  }

  const dataStatus = Number(result?.data?.status)
  if (dataStatus === 1) {
    throw new Error('MiniMax 仍在合成中，请稍后重试（请使用非流式请求）')
  }

  const saved = await persistAudioFromResponse(result)
  const clip: MinimaxMusicClip = {
    title: input.title || undefined,
    duration: saved.durationSec,
    lyrics: typeof body.lyrics === 'string' ? body.lyrics : undefined,
    audio_path: saved.audioPath,
  }

  return {
    clip,
    model: String(body.model || MINIMAX_MUSIC_DEFAULT_MODEL),
    traceId: result?.trace_id ? String(result.trace_id) : undefined,
  }
}

function updateRow(id: number, patch: Partial<typeof schema.musicGenerations.$inferInsert>) {
  db.update(schema.musicGenerations)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(schema.musicGenerations.id, id))
    .run()
}

/** 后台完成一条音乐任务 */
export async function processMusicGeneration(id: number) {
  const [row] = db.select().from(schema.musicGenerations)
    .where(eq(schema.musicGenerations.id, id))
    .all()
  if (!row) return
  if (row.status === 'completed' || row.status === 'failed') return

  updateRow(id, { status: 'processing', provider: MINIMAX_MUSIC_PROVIDER })
  logTaskProgress('MinimaxMusic', 'processing', { id })

  try {
    const generated = await generateMinimaxMusic({
      prompt: row.prompt,
      custom: Boolean(row.customMode),
      instrumental: Boolean(row.instrumental),
      version: row.version,
      title: row.title,
      style: row.style,
    })

    const clip = generated.clip
    if (!clip.audio_path) throw new Error('音轨保存失败')

    updateRow(id, {
      status: 'completed',
      audioPath: clip.audio_path,
      durationSec: clip.duration ?? null,
      clipsJson: JSON.stringify([clip]),
      remoteTaskId: generated.traceId || null,
      version: generated.model,
      provider: MINIMAX_MUSIC_PROVIDER,
      errorMsg: null,
    })
    logTaskProgress('MinimaxMusic', 'completed', { id, model: generated.model })
  } catch (err: any) {
    const message = String(err?.message || err || '生成失败')
    updateRow(id, { status: 'failed', errorMsg: message })
    if (row.creditTxId) {
      tryRefundCharge(row.creditTxId, {
        summary: 'MiniMax 配乐失败退款',
        resourceType: 'music_generation',
        resourceId: id,
        metadata: { reason: message },
      })
    }
    logTaskWarn('MinimaxMusic', 'failed', { id, error: message })
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
    logTaskProgress('MinimaxMusic', 'resume-pending', { count: rows.length })
  }
}

export interface MinimaxBalanceInfo {
  configured: boolean
  api_key_masked: string
  group_id: string | null
  base_url: string
  /** 上游账户可用余额（元），查询失败则为 null */
  balance: number | null
  currency: string | null
  raw_label: string | null
  error: string | null
  source: string | null
}

function pickNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (v == null || v === '') continue
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
    if (Number.isFinite(n)) return n
  }
  return null
}

function parseBalancePayload(payload: any): { balance: number | null; currency: string | null; label: string | null } {
  const infos = payload?.balance_infos || payload?.data?.balance_infos
  if (Array.isArray(infos) && infos.length) {
    const first = infos[0]
    const balance = pickNumber(
      first?.total_balance,
      first?.available_balance,
      first?.cash_balance,
      first?.amount,
      first?.payable_amount,
    )
    const currency = String(first?.currency || first?.unit || 'CNY').trim() || 'CNY'
    return {
      balance,
      currency,
      label: balance != null ? `${balance} ${currency}` : null,
    }
  }

  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  const balance = pickNumber(
    data?.total_balance,
    data?.available_balance,
    data?.balance,
    data?.cash_balance,
    data?.wallet_balance,
  )
  if (balance != null) {
    const currency = String(data?.currency || 'CNY').trim() || 'CNY'
    return { balance, currency, label: `${balance} ${currency}` }
  }

  // Token Plan remains：无账户余额时展示套餐剩余提示
  const remains = data?.model_remains || payload?.model_remains
  if (Array.isArray(remains) && remains.length) {
    const first = remains[0]
    const remaining = pickNumber(
      first?.current_interval_usage_count,
      first?.remaining_count,
      first?.remaining,
    )
    const total = pickNumber(first?.current_interval_total_count, first?.total_count, first?.total)
    const model = String(first?.model || first?.model_name || 'Token Plan').trim()
    if (remaining != null) {
      const label = total != null
        ? `${model} 剩余 ${remaining}/${total}`
        : `${model} 剩余 ${remaining}`
      return { balance: remaining, currency: 'quota', label }
    }
  }

  return { balance: null, currency: null, label: null }
}

/**
 * 查询 MiniMax 账户余额 / Token Plan 余量（尽力而为，失败不抛错）
 * 优先按量付费余额接口，再尝试 Token Plan remains。
 */
export async function fetchMinimaxAccountBalance(): Promise<MinimaxBalanceInfo> {
  const apiKey = resolveMinimaxMusicApiKey()
  const baseUrl = resolveMinimaxMusicBaseUrl()
  const groupId = resolveMinimaxGroupId()
  const base: MinimaxBalanceInfo = {
    configured: Boolean(apiKey),
    api_key_masked: maskMinimaxApiKey(apiKey),
    group_id: groupId || null,
    base_url: baseUrl,
    balance: null,
    currency: null,
    raw_label: null,
    error: null,
    source: null,
  }
  if (!apiKey) {
    base.error = '未配置 MINIMAX_API_KEY'
    return base
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const candidates: Array<{ method: 'GET' | 'POST'; path: string; source: string; body?: string }> = []
  const withGroup = (path: string) => {
    if (!groupId) return path
    return path.includes('?') ? `${path}&GroupId=${encodeURIComponent(groupId)}` : `${path}?GroupId=${encodeURIComponent(groupId)}`
  }

  candidates.push(
    { method: 'GET', path: withGroup('/v1/api/v2/query/balance'), source: 'query_balance' },
    { method: 'POST', path: withGroup('/v1/api/v2/query/balance'), source: 'query_balance_post', body: '{}' },
    { method: 'GET', path: withGroup('/v1/token_plan/remains'), source: 'token_plan_remains' },
  )

  const errors: string[] = []
  for (const cand of candidates) {
    try {
      const resp = await fetch(`${baseUrl}${cand.path}`, {
        method: cand.method,
        headers,
        body: cand.body,
        signal: AbortSignal.timeout(12_000),
      })
      const text = await resp.text()
      let payload: any = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        errors.push(`${cand.source}: 非 JSON HTTP ${resp.status}`)
        continue
      }
      const statusCode = payload?.base_resp?.status_code
      if (!resp.ok || (statusCode != null && Number(statusCode) !== 0)) {
        const msg = payload?.base_resp?.status_msg
          || payload?.message
          || payload?.error?.message
          || `HTTP ${resp.status}`
        errors.push(`${cand.source}: ${msg}`)
        continue
      }
      const parsed = parseBalancePayload(payload)
      if (parsed.balance == null && !parsed.label) {
        errors.push(`${cand.source}: 响应无余额字段`)
        continue
      }
      return {
        ...base,
        balance: parsed.balance,
        currency: parsed.currency,
        raw_label: parsed.label,
        source: cand.source,
        error: null,
      }
    } catch (err: any) {
      errors.push(`${cand.source}: ${err?.message || String(err)}`)
    }
  }

  return {
    ...base,
    error: errors[0] || '余额查询失败',
  }
}
