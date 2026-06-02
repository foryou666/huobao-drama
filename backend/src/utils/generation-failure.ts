import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from './response.js'
import { refundCreditTransaction } from '../services/credits.js'
import { logTaskProgress, logTaskWarn } from './task-logger.js'

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

  db.update(schema.imageGenerations)
    .set({ status: 'failed', errorMsg, updatedAt: now() })
    .where(eq(schema.imageGenerations.id, id))
    .run()

  refundLinkedCredit(record.creditTransactionId, {
    summary: '图片生成失败退款',
    resourceType: 'image_generation',
    resourceId: id,
    reason: errorMsg,
    dramaId: record.dramaId,
  })
}

export function failVideoGeneration(id: number, errorMsg: string) {
  const [record] = db.select().from(schema.videoGenerations).where(eq(schema.videoGenerations.id, id)).all()
  if (!record) return
  if (record.status === 'completed' || record.status === 'failed') return

  db.update(schema.videoGenerations)
    .set({ status: 'failed', errorMsg, updatedAt: now() })
    .where(eq(schema.videoGenerations.id, id))
    .run()

  refundLinkedCredit(record.creditTransactionId, {
    summary: '视频生成失败退款',
    resourceType: 'video_generation',
    resourceId: id,
    reason: errorMsg,
    dramaId: record.dramaId,
  })
}
