import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from './response.js'
import { refundCreditTransaction } from '../services/credits.js'
import { logTaskProgress, logTaskWarn } from './task-logger.js'
import { sanitizeUserFacingProviderError } from './provider-error-sanitize.js'

function refundLinkedCredit(
  creditTransactionId: number | null | undefined,
  opts: {
    summary: string
    resourceType: string
    resourceId: number
    reason: string
    dramaId?: number | null
    episodeId?: number | null
  },
) {
  if (!creditTransactionId) return
  const result = refundCreditTransaction(creditTransactionId, {
    summary: opts.summary,
    resourceType: opts.resourceType,
    resourceId: opts.resourceId,
    dramaId: opts.dramaId ?? undefined,
    episodeId: opts.episodeId ?? undefined,
    metadata: { reason: opts.reason },
  })
  if (result?.ok) {
    logTaskProgress('CreditRefund', 'generation-failed', {
      chargeTxId: creditTransactionId,
      refundTxId: result.transactionId,
      amount: result.cost,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
    })
  } else if (result?.message) {
    logTaskWarn('CreditRefund', 'skipped', {
      chargeTxId: creditTransactionId,
      message: result.message,
    })
  }
}

export function failImageGeneration(id: number, errorMsg: string) {
  const [record] = db.select().from(schema.imageGenerations).where(eq(schema.imageGenerations.id, id)).all()
  if (!record) return
  if (record.status === 'completed' || record.status === 'failed') return

  const userMessage = sanitizeUserFacingProviderError(errorMsg)

  db.update(schema.imageGenerations)
    .set({ status: 'failed', errorMsg: userMessage, updatedAt: now() })
    .where(eq(schema.imageGenerations.id, id))
    .run()

  refundLinkedCredit(record.creditTransactionId, {
    summary: '图片生成失败退款',
    resourceType: 'image_generation',
    resourceId: id,
    reason: userMessage,
    dramaId: record.dramaId,
  })
}

const VIDEO_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired'])

export function failVideoGeneration(id: number, errorMsg: string) {
  const [record] = db.select().from(schema.videoGenerations).where(eq(schema.videoGenerations.id, id)).all()
  if (!record) return
  if (VIDEO_TERMINAL_STATUSES.has(String(record.status || ''))) return

  const userMessage = sanitizeUserFacingProviderError(errorMsg)

  db.update(schema.videoGenerations)
    .set({ status: 'failed', errorMsg: userMessage, updatedAt: now() })
    .where(eq(schema.videoGenerations.id, id))
    .run()

  refundLinkedCredit(record.creditTransactionId, {
    summary: '视频生成失败退款',
    resourceType: 'video_generation',
    resourceId: id,
    reason: userMessage,
    dramaId: record.dramaId,
  })
}

/** 用户/上游取消：退款并标记 cancelled（与 failed 区分展示） */
export function cancelVideoGeneration(id: number, errorMsg = '任务已取消') {
  const [record] = db.select().from(schema.videoGenerations).where(eq(schema.videoGenerations.id, id)).all()
  if (!record) return false
  if (VIDEO_TERMINAL_STATUSES.has(String(record.status || ''))) return false

  const userMessage = sanitizeUserFacingProviderError(errorMsg)

  db.update(schema.videoGenerations)
    .set({ status: 'cancelled', errorMsg: userMessage, updatedAt: now() })
    .where(eq(schema.videoGenerations.id, id))
    .run()

  refundLinkedCredit(record.creditTransactionId, {
    summary: '视频生成取消退款',
    resourceType: 'video_generation',
    resourceId: id,
    reason: userMessage,
    dramaId: record.dramaId,
  })
  return true
}

/** 上游过期：退款并标记 expired */
export function expireVideoGeneration(id: number, errorMsg = '任务已过期') {
  const [record] = db.select().from(schema.videoGenerations).where(eq(schema.videoGenerations.id, id)).all()
  if (!record) return
  if (VIDEO_TERMINAL_STATUSES.has(String(record.status || ''))) return

  const userMessage = sanitizeUserFacingProviderError(errorMsg)

  db.update(schema.videoGenerations)
    .set({ status: 'expired', errorMsg: userMessage, updatedAt: now() })
    .where(eq(schema.videoGenerations.id, id))
    .run()

  refundLinkedCredit(record.creditTransactionId, {
    summary: '视频生成过期退款',
    resourceType: 'video_generation',
    resourceId: id,
    reason: userMessage,
    dramaId: record.dramaId,
  })
}
