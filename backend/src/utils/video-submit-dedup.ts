import { createHash } from 'crypto'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

const IN_FLIGHT_STATUSES = ['pending', 'processing'] as const

/** 相同内容拦截窗口 */
export const DUPLICATE_VIDEO_BLOCK_WINDOW_MS = 60 * 1000

/** 同一用户任意内容提交间隔（1 分钟内仅 1 条） */
export const USER_VIDEO_SUBMIT_INTERVAL_MS = 60 * 1000

/** 进程内短锁：挡住「双击/并发」在入库前的竞态 */
const submittingFingerprints = new Map<string, number>()
const userSubmitLocks = new Map<number, number>()
const SUBMIT_LOCK_TTL_MS = 120_000

export class DuplicateVideoSubmitError extends Error {
  readonly existingId: number | null

  constructor(existingId?: number | null, message?: string) {
    const id = existingId && existingId > 0 ? existingId : null
    super(
      message
        || (id
          ? `相同内容的视频正在生成中（#${id}），请稍后再试或等待完成`
          : '相同内容正在提交中，请勿重复点击'),
    )
    this.name = 'DuplicateVideoSubmitError'
    this.existingId = id
  }
}

export class VideoSubmitRateLimitError extends Error {
  readonly existingId: number | null
  readonly retryAfterSec: number

  constructor(existingId?: number | null, retryAfterSec = 60) {
    const id = existingId && existingId > 0 ? existingId : null
    const wait = Math.max(1, Math.ceil(retryAfterSec))
    super(
      id
        ? `提交过于频繁，请 ${wait} 秒后再试（最近任务 #${id}）`
        : `提交过于频繁，请 ${wait} 秒后再试`,
    )
    this.name = 'VideoSubmitRateLimitError'
    this.existingId = id
    this.retryAfterSec = wait
  }
}

function isWithinWindow(createdAt: string | null | undefined, windowMs: number, now = Date.now()): boolean {
  if (!createdAt) return true
  const ts = Date.parse(createdAt)
  if (!Number.isFinite(ts)) return true
  return now - ts < windowMs
}

function secondsUntilWindowEnds(createdAt: string | null | undefined, windowMs: number, now = Date.now()): number {
  const ts = createdAt ? Date.parse(createdAt) : NaN
  if (!Number.isFinite(ts)) return Math.ceil(windowMs / 1000)
  return Math.max(1, Math.ceil((ts + windowMs - now) / 1000))
}

export interface VideoSubmitDedupInput {
  userId: number
  prompt: string
  model?: string | null
  provider?: string | null
  duration?: number | null
  aspectRatio?: string | null
  resolution?: string | null
  referenceMode?: string | null
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string[] | null
  contentRefs?: unknown[] | null
  /** 通道3 线路号等，写入 style 的非 session 标识 */
  channelKey?: string | null
}

function normText(value: unknown): string {
  return String(value ?? '').trim()
}

function normUrl(value: unknown): string {
  return String(value ?? '').trim()
}

function normDuration(value: unknown): string {
  if (value == null || value === '') return ''
  const n = Number(value)
  return Number.isFinite(n) ? String(Math.round(n)) : ''
}

function normRefsJson(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return ''
    try {
      return normRefsJson(JSON.parse(s))
    } catch {
      return s
    }
  }
  if (!Array.isArray(raw)) return ''
  const urls = raw
    .map(item => {
      if (typeof item === 'string') return normUrl(item)
      if (item && typeof item === 'object') return normUrl((item as Record<string, unknown>).url)
      return ''
    })
    .filter(Boolean)
    .sort()
  return urls.join('|')
}

function normContentRefs(raw: unknown): string {
  if (raw == null) return ''
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return ''
    try {
      return normContentRefs(JSON.parse(s))
    } catch {
      return s
    }
  }
  if (!Array.isArray(raw)) return ''
  const items = raw
    .map(item => {
      if (!item || typeof item !== 'object') return ''
      const row = item as Record<string, unknown>
      const type = normText(row.type).toLowerCase()
      const url = normUrl(row.url)
      const role = normText(row.role).toLowerCase()
      if (!url && !type) return ''
      return `${type}:${role}:${url}`
    })
    .filter(Boolean)
    .sort()
  return items.join('|')
}

/** 内容指纹：不含 session / storyboard，避免换 Session 绕过 */
export function buildVideoSubmitFingerprint(input: VideoSubmitDedupInput): string {
  const payload = [
    `u:${input.userId}`,
    `prompt:${normText(input.prompt)}`,
    `model:${normText(input.model)}`,
    `provider:${normText(input.provider)}`,
    `duration:${normDuration(input.duration)}`,
    `aspect:${normText(input.aspectRatio)}`,
    `resolution:${normText(input.resolution).toLowerCase()}`,
    `refMode:${normText(input.referenceMode)}`,
    `image:${normUrl(input.imageUrl)}`,
    `first:${normUrl(input.firstFrameUrl)}`,
    `last:${normUrl(input.lastFrameUrl)}`,
    `refImages:${normRefsJson(input.referenceImageUrls)}`,
    `contentRefs:${normContentRefs(input.contentRefs)}`,
    `channel:${normText(input.channelKey)}`,
  ].join('\n')
  return createHash('sha256').update(payload).digest('hex')
}

function fingerprintFromRecord(row: typeof schema.videoGenerations.$inferSelect): string {
  const style = normText(row.style)
  const channelKey = /^(jimeng_session|xyq_key|coze_session|funshion_session|xingyuemeng_session|doubao_training_session):/.test(style)
    ? ''
    : style

  let referenceImageUrls: string[] | null = null
  if (row.referenceImageUrls) {
    try {
      const parsed = JSON.parse(row.referenceImageUrls)
      referenceImageUrls = Array.isArray(parsed) ? parsed.map(String) : null
    } catch {
      referenceImageUrls = null
    }
  }

  let contentRefs: unknown[] | null = null
  if (row.referencePayload) {
    try {
      const parsed = JSON.parse(row.referencePayload)
      contentRefs = Array.isArray(parsed) ? parsed : null
    } catch {
      contentRefs = null
    }
  }

  return buildVideoSubmitFingerprint({
    userId: Number(row.userId || 0),
    prompt: row.prompt || '',
    model: row.model,
    provider: row.provider,
    duration: row.duration,
    aspectRatio: row.aspectRatio,
    resolution: row.resolution,
    referenceMode: row.referenceMode,
    imageUrl: row.imageUrl,
    firstFrameUrl: row.firstFrameUrl,
    lastFrameUrl: row.lastFrameUrl,
    referenceImageUrls,
    contentRefs,
    channelKey,
  })
}

function pruneSubmitLocks(now = Date.now()) {
  for (const [key, ts] of submittingFingerprints) {
    if (now - ts > SUBMIT_LOCK_TTL_MS) submittingFingerprints.delete(key)
  }
  for (const [userId, ts] of userSubmitLocks) {
    if (now - ts > SUBMIT_LOCK_TTL_MS) userSubmitLocks.delete(userId)
  }
}

/** 该用户 1 分钟内是否已有任意一条视频提交 */
export function findRecentUserVideoSubmit(userId: number): { id: number; createdAt: string } | null {
  if (!userId) return null
  const [row] = db
    .select({
      id: schema.videoGenerations.id,
      createdAt: schema.videoGenerations.createdAt,
    })
    .from(schema.videoGenerations)
    .where(and(
      eq(schema.videoGenerations.userId, userId),
      isNull(schema.videoGenerations.deletedAt),
    ))
    .orderBy(desc(schema.videoGenerations.id))
    .limit(1)
    .all()

  if (!row) return null
  if (!isWithinWindow(row.createdAt, USER_VIDEO_SUBMIT_INTERVAL_MS)) return null
  return { id: row.id, createdAt: row.createdAt }
}

export function findInFlightDuplicateVideoId(input: VideoSubmitDedupInput): number | null {
  if (!input.userId) return null
  const fingerprint = buildVideoSubmitFingerprint(input)
  const rows = db
    .select()
    .from(schema.videoGenerations)
    .where(and(
      eq(schema.videoGenerations.userId, input.userId),
      inArray(schema.videoGenerations.status, [...IN_FLIGHT_STATUSES]),
      isNull(schema.videoGenerations.deletedAt),
    ))
    .all()

  const now = Date.now()
  for (const row of rows) {
    if (!isWithinWindow(row.createdAt, DUPLICATE_VIDEO_BLOCK_WINDOW_MS, now)) continue
    if (fingerprintFromRecord(row) === fingerprint) return row.id
  }
  return null
}

/**
 * 入库前拦截：同用户 1 分钟内已有任意提交（含并发短锁）。
 * 返回 fingerprint，调用方在入库成功后 release。
 */
export function assertNoDuplicateInFlightVideoSubmit(input: VideoSubmitDedupInput): string {
  if (!input.userId) return ''

  const fingerprint = buildVideoSubmitFingerprint(input)
  pruneSubmitLocks()
  const now = Date.now()

  const userLockedAt = userSubmitLocks.get(input.userId)
  if (userLockedAt && now - userLockedAt < USER_VIDEO_SUBMIT_INTERVAL_MS) {
    throw new VideoSubmitRateLimitError(null, Math.ceil((USER_VIDEO_SUBMIT_INTERVAL_MS - (now - userLockedAt)) / 1000))
  }

  const recent = findRecentUserVideoSubmit(input.userId)
  if (recent) {
    throw new VideoSubmitRateLimitError(
      recent.id,
      secondsUntilWindowEnds(recent.createdAt, USER_VIDEO_SUBMIT_INTERVAL_MS, now),
    )
  }

  const lockedAt = submittingFingerprints.get(fingerprint)
  if (lockedAt && now - lockedAt < SUBMIT_LOCK_TTL_MS) {
    throw new DuplicateVideoSubmitError(null)
  }

  userSubmitLocks.set(input.userId, now)
  submittingFingerprints.set(fingerprint, now)
  return fingerprint
}

export function releaseVideoSubmitDedupLock(fingerprint?: string | null, userId?: number | null) {
  if (fingerprint) submittingFingerprints.delete(fingerprint)
  if (userId) userSubmitLocks.delete(userId)
}
