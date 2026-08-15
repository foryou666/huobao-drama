import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import type { AuthUser } from '../middleware/auth.js'

export interface ActivityInput {
  action: string
  summary?: string
  resourceType?: string
  resourceId?: number
  dramaId?: number
  episodeId?: number
  metadata?: Record<string, unknown>
  creditCost?: number
  transactionId?: number
}

function resolveOperatorMeta(user: AuthUser | Pick<AuthUser, 'id'>) {
  if ('username' in user && user.username) {
    return {
      operator_id: user.id,
      operator_username: user.username,
      operator_name: user.displayName || user.username,
    }
  }
  const [row] = db.select().from(schema.users).where(eq(schema.users.id, user.id)).all()
  return {
    operator_id: user.id,
    operator_username: row?.username || '',
    operator_name: row?.displayName || row?.username || '',
  }
}

export function logActivity(user: AuthUser | Pick<AuthUser, 'id'>, input: ActivityInput) {
  try {
    const operator = resolveOperatorMeta(user)
    const metadata = {
      ...operator,
      ...(input.transactionId ? { transaction_id: input.transactionId } : {}),
      ...(input.metadata || {}),
    }
    db.insert(schema.activityLogs).values({
      userId: user.id,
      action: input.action,
      summary: input.summary || null,
      resourceType: input.resourceType || null,
      resourceId: input.resourceId ?? null,
      dramaId: input.dramaId ?? null,
      episodeId: input.episodeId ?? null,
      metadata: JSON.stringify(metadata),
      creditCost: input.creditCost ?? null,
      createdAt: now(),
    }).run()
  } catch (err) {
    console.error('[activity] log failed', input.action, err)
  }
}

export function logCreditActivity(
  user: AuthUser,
  action: string,
  charge: { cost: number; transactionId?: number },
  input: Omit<ActivityInput, 'action' | 'creditCost' | 'transactionId'> = {},
) {
  logActivity(user, {
    action,
    creditCost: charge.cost > 0 ? charge.cost : undefined,
    transactionId: charge.transactionId,
    ...input,
  })
}

/** 从 activity metadata 提取关联扣费交易 ID（缺省时回查生成记录） */
export function extractActivityChargeTxIds(meta: Record<string, unknown> | null | undefined): number[] {
  if (!meta || typeof meta !== 'object') return []
  const ids = new Set<number>()
  for (const key of ['transaction_id', 'credit_tx_id'] as const) {
    const n = Number((meta as any)[key])
    if (Number.isFinite(n) && n > 0) ids.add(n)
  }
  const arr = (meta as any).credit_tx_ids
  if (Array.isArray(arr)) {
    for (const raw of arr) {
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) ids.add(n)
    }
  }
  if (ids.size) return [...ids]

  const genId = Number((meta as any).generation_id)
  if (Number.isFinite(genId) && genId > 0) {
    const [video] = db.select({
      creditTransactionId: schema.videoGenerations.creditTransactionId,
    }).from(schema.videoGenerations).where(eq(schema.videoGenerations.id, genId)).all()
    if (video?.creditTransactionId) ids.add(video.creditTransactionId)
    else {
      const [image] = db.select({
        creditTransactionId: schema.imageGenerations.creditTransactionId,
      }).from(schema.imageGenerations).where(eq(schema.imageGenerations.id, genId)).all()
      if (image?.creditTransactionId) ids.add(image.creditTransactionId)
    }
  }
  return [...ids]
}

/** charge_tx_id → 退款交易（只扫一次 refund 表） */
function buildRefundByChargeIdMap(): Map<number, typeof schema.creditTransactions.$inferSelect> {
  const map = new Map<number, typeof schema.creditTransactions.$inferSelect>()
  const refunds = db.select().from(schema.creditTransactions)
    .where(eq(schema.creditTransactions.type, 'refund'))
    .all()
  for (const tx of refunds) {
    if (!tx.metadata) continue
    try {
      const chargeId = Number(JSON.parse(tx.metadata).charge_tx_id)
      if (Number.isFinite(chargeId) && chargeId > 0 && !map.has(chargeId)) {
        map.set(chargeId, tx)
      }
    } catch { /* ignore */ }
  }
  return map
}

function resolveActivityRefund(
  meta: Record<string, unknown> | null,
  refundByChargeId: Map<number, typeof schema.creditTransactions.$inferSelect>,
) {
  const chargeIds = extractActivityChargeTxIds(meta)
  if (!chargeIds.length) {
    return { refunded: false, refund_partial: false, credit_refund_amount: 0 }
  }
  let refundedCount = 0
  let refundAmount = 0
  for (const id of chargeIds) {
    const refund = refundByChargeId.get(id)
    if (refund) {
      refundedCount += 1
      refundAmount += Math.abs(Number(refund.amount) || 0)
    }
  }
  return {
    refunded: refundedCount > 0 && refundedCount === chargeIds.length,
    refund_partial: refundedCount > 0 && refundedCount < chargeIds.length,
    credit_refund_amount: refundAmount,
  }
}

export function formatActivityLogRow(
  row: typeof schema.activityLogs.$inferSelect,
  userMap: Map<number, typeof schema.users.$inferSelect>,
  refundByChargeId?: Map<number, typeof schema.creditTransactions.$inferSelect>,
) {
  const meta = row.metadata ? JSON.parse(row.metadata) : null
  const u = userMap.get(row.userId)
  const refundInfo = resolveActivityRefund(meta, refundByChargeId || new Map())
  let summary = enrichActivitySummary(row.summary, userMap, row)
  if ((refundInfo.refunded || refundInfo.refund_partial) && summary && !/已退款|部分退款/.test(summary)) {
    summary = `${summary}（${refundInfo.refunded ? '已退款' : '部分退款'}）`
  } else if ((refundInfo.refunded || refundInfo.refund_partial) && !summary) {
    summary = refundInfo.refunded ? '已退款' : '部分退款'
  }
  return {
    id: row.id,
    user_id: row.userId,
    username: u?.username || meta?.operator_username,
    display_name: u?.displayName || u?.username || meta?.operator_name,
    operator_id: meta?.operator_id ?? row.userId,
    operator_name: meta?.operator_name || u?.displayName || u?.username,
    action: row.action,
    summary,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    drama_id: row.dramaId,
    episode_id: row.episodeId,
    metadata: meta,
    credit_cost: row.creditCost ?? 0,
    credit_refunded: refundInfo.refunded,
    credit_refund_partial: refundInfo.refund_partial,
    credit_refund_amount: refundInfo.credit_refund_amount,
    refunded: refundInfo.refunded,
    created_at: row.createdAt,
  }
}

const USER_REF_PATTERNS = [
  /为用户\s*#(\d+)/g,
  /成员\s*#(\d+)/g,
]

function extractUserIdsFromSummary(summary: string): number[] {
  const ids = new Set<number>()
  for (const pattern of USER_REF_PATTERNS) {
    for (const match of summary.matchAll(pattern)) {
      ids.add(Number(match[1]))
    }
  }
  return [...ids]
}

function collectActivityReferencedUserIds(rows: typeof schema.activityLogs.$inferSelect[]): number[] {
  const ids = new Set<number>()
  for (const row of rows) {
    ids.add(row.userId)
    if (row.resourceType === 'user' && row.resourceId) ids.add(row.resourceId)
    for (const id of extractUserIdsFromSummary(row.summary || '')) ids.add(id)
    if (row.metadata) {
      try {
        const meta = JSON.parse(row.metadata) as { user_id?: number }
        if (meta.user_id) ids.add(Number(meta.user_id))
      } catch { /* ignore */ }
    }
  }
  return [...ids]
}

function enrichActivitySummary(
  summary: string | null | undefined,
  userMap: Map<number, typeof schema.users.$inferSelect>,
  row?: Pick<typeof schema.activityLogs.$inferSelect, 'resourceType' | 'resourceId' | 'metadata'>,
): string | null {
  if (!summary) return summary ?? null
  let text = summary
  const idsToEnrich = new Set(extractUserIdsFromSummary(text))
  if (row?.resourceType === 'user' && row.resourceId) idsToEnrich.add(row.resourceId)
  if (row?.metadata) {
    try {
      const meta = JSON.parse(row.metadata) as { user_id?: number }
      if (meta.user_id) idsToEnrich.add(Number(meta.user_id))
    } catch { /* ignore */ }
  }
  for (const id of idsToEnrich) {
    if (text.includes(`#${id}（`)) continue
    const user = userMap.get(id)
    const name = user?.displayName || user?.username
    if (!name) continue
    text = text.replace(new RegExp(`#${id}(?!（)`, 'g'), `#${id}（${name}）`)
  }
  return text
}

function buildUserMap(userIds: number[]) {
  const users = userIds.length
    ? db.select().from(schema.users).all().filter(u => userIds.includes(u.id))
    : []
  return new Map(users.map(u => [u.id, u]))
}

export function listEpisodeActivityLogs(episodeId: number, opts?: { limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200)
  const offset = Math.max(opts?.offset ?? 0, 0)
  const rows = db.select().from(schema.activityLogs)
    .orderBy(desc(schema.activityLogs.createdAt))
    .all()
    .filter(row =>
      row.episodeId === episodeId
      || (row.resourceType === 'episode' && row.resourceId === episodeId),
    )
  const slice = rows.slice(offset, offset + limit)
  const userMap = buildUserMap(collectActivityReferencedUserIds(slice))
  const refundByChargeId = buildRefundByChargeIdMap()
  return {
    items: slice.map(row => formatActivityLogRow(row, userMap, refundByChargeId)),
    total: rows.length,
    limit,
    offset,
  }
}

export function listActivityLogs(opts: {
  userId?: number
  userIds?: number[]
  limit?: number
  offset?: number
}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  let query = db.select().from(schema.activityLogs).orderBy(desc(schema.activityLogs.createdAt))
  if (opts.userIds?.length) {
    query = query.where(inArray(schema.activityLogs.userId, opts.userIds)) as typeof query
  } else if (opts.userId) {
    query = query.where(eq(schema.activityLogs.userId, opts.userId)) as typeof query
  }
  const rows = query.all()
  const slice = rows.slice(offset, offset + limit)
  const userMap = buildUserMap(collectActivityReferencedUserIds(slice))
  const refundByChargeId = buildRefundByChargeIdMap()
  return {
    items: slice.map(row => formatActivityLogRow(row, userMap, refundByChargeId)),
    total: rows.length,
    limit,
    offset,
  }
}
