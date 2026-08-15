/**
 * 统一生成日志：生图 / 生视频状态、失败原因、积分扣除与退款
 * 复用 image_generations / video_generations / credit_transactions，不新建表
 */
import { db, schema } from '../db/index.js'
import { desc, eq, inArray } from 'drizzle-orm'
import { toSnakeCase } from '../utils/transform.js'
import { sanitizeUserFacingProviderError } from '../utils/provider-error-sanitize.js'
import type { AuditScope } from './team-audit.js'

export type GenerationLogKind = 'image' | 'video'

export interface GenerationLogsQuery {
  scope: AuditScope
  kind?: GenerationLogKind | 'all'
  status?: string
  keyword?: string
  limit?: number
  offset?: number
}

interface CreditInfo {
  chargeId: number | null
  chargeAmount: number
  chargeAction: string | null
  refunded: boolean
  refundAmount: number
  refundReason: string | null
}

function buildCreditMaps() {
  const byId = new Map<number, typeof schema.creditTransactions.$inferSelect>()
  const refundByChargeId = new Map<number, typeof schema.creditTransactions.$inferSelect>()

  for (const tx of db.select().from(schema.creditTransactions).all()) {
    byId.set(tx.id, tx)
    if (tx.type === 'refund' && tx.metadata) {
      try {
        const meta = JSON.parse(tx.metadata)
        const chargeId = Number(meta.charge_tx_id)
        if (Number.isFinite(chargeId) && chargeId > 0 && !refundByChargeId.has(chargeId)) {
          refundByChargeId.set(chargeId, tx)
        }
      } catch { /* ignore */ }
    }
  }
  return { byId, refundByChargeId }
}

function resolveCreditInfo(
  chargeTxId: number | null | undefined,
  maps: ReturnType<typeof buildCreditMaps>,
): CreditInfo {
  if (!chargeTxId) {
    return {
      chargeId: null,
      chargeAmount: 0,
      chargeAction: null,
      refunded: false,
      refundAmount: 0,
      refundReason: null,
    }
  }
  const charge = maps.byId.get(chargeTxId)
  const refund = maps.refundByChargeId.get(chargeTxId)
  let refundReason: string | null = null
  if (refund?.metadata) {
    try {
      refundReason = String(JSON.parse(refund.metadata).reason || '') || null
    } catch { /* ignore */ }
  }
  return {
    chargeId: chargeTxId,
    chargeAmount: charge ? Math.abs(Number(charge.amount) || 0) : 0,
    chargeAction: charge?.action || null,
    refunded: !!refund,
    refundAmount: refund ? Math.abs(Number(refund.amount) || 0) : 0,
    refundReason,
  }
}

function buildImageOwnerMap() {
  const map = new Map<number, number>()
  for (const log of db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.action, 'image.generate')).all()) {
    if (!log.metadata) continue
    try {
      const meta = JSON.parse(log.metadata)
      const genId = Number(meta.generation_id)
      if (Number.isFinite(genId) && genId > 0) map.set(genId, log.userId)
    } catch { /* ignore */ }
  }
  return map
}

function buildUserMap(ids: number[]) {
  const uniq = [...new Set(ids.filter(id => Number.isFinite(id) && id > 0))]
  if (!uniq.length) return new Map<number, typeof schema.users.$inferSelect>()
  return new Map(
    db.select().from(schema.users).where(inArray(schema.users.id, uniq)).all()
      .map(u => [u.id, u]),
  )
}

function buildDramaMap(ids: number[]) {
  const uniq = [...new Set(ids.filter(id => Number.isFinite(id) && id > 0))]
  if (!uniq.length) return new Map<number, string>()
  return new Map(
    db.select().from(schema.dramas).where(inArray(schema.dramas.id, uniq)).all()
      .filter(d => !d.deletedAt)
      .map(d => [d.id, d.title || `项目#${d.id}`]),
  )
}

function truncatePrompt(prompt?: string | null, max = 120) {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function matchStatus(status: string | null | undefined, filter?: string) {
  if (!filter || filter === 'all') return true
  const s = String(status || '')
  if (filter === 'processing') return s === 'processing' || s === 'pending'
  return s === filter
}

function matchKeyword(row: { prompt?: string | null; errorMsg?: string | null; model?: string | null; provider?: string | null }, keyword?: string) {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return true
  const hay = [row.prompt, row.errorMsg, row.model, row.provider].map(v => String(v || '').toLowerCase()).join('\n')
  return hay.includes(kw)
}

export function listGenerationLogs(query: GenerationLogsQuery) {
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100)
  const offset = Math.max(Number(query.offset || 0), 0)
  const kind = (query.kind || 'all') as GenerationLogKind | 'all'
  const scopeUserIds = query.scope.userIds
  const creditMaps = buildCreditMaps()
  const imageOwnerMap = buildImageOwnerMap()

  // 取足够窗口再合并分页（日志页通常 limit≤100）
  const fetchWindow = Math.min(800, Math.max(200, (offset + limit) * 4))

  type RawItem = {
    kind: GenerationLogKind
    id: number
    status: string | null
    provider: string | null
    model: string | null
    prompt: string | null
    errorMsg: string | null
    dramaId: number | null
    creditTransactionId: number | null
    ownerUserId: number | null
    createdAt: string
    completedAt: string | null
  }

  const raw: RawItem[] = []

  if (kind === 'all' || kind === 'image') {
    const images = db.select().from(schema.imageGenerations)
      .orderBy(desc(schema.imageGenerations.createdAt))
      .limit(fetchWindow)
      .all()
    for (const row of images) {
      let ownerUserId: number | null = null
      if (row.creditTransactionId) {
        ownerUserId = creditMaps.byId.get(row.creditTransactionId)?.userId ?? null
      }
      if (!ownerUserId) ownerUserId = imageOwnerMap.get(row.id) ?? null
      if (scopeUserIds?.length) {
        if (!ownerUserId || !scopeUserIds.includes(ownerUserId)) continue
      }
      if (!matchStatus(row.status, query.status)) continue
      if (!matchKeyword(row, query.keyword)) continue
      raw.push({
        kind: 'image',
        id: row.id,
        status: row.status,
        provider: row.provider,
        model: row.model,
        prompt: row.prompt,
        errorMsg: row.errorMsg,
        dramaId: row.dramaId,
        creditTransactionId: row.creditTransactionId,
        ownerUserId,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
      })
    }
  }

  if (kind === 'all' || kind === 'video') {
    const videos = db.select().from(schema.videoGenerations)
      .orderBy(desc(schema.videoGenerations.createdAt))
      .limit(fetchWindow)
      .all()
      .filter(row => !row.deletedAt)
    for (const row of videos) {
      let ownerUserId = row.userId ?? null
      if (!ownerUserId && row.creditTransactionId) {
        ownerUserId = creditMaps.byId.get(row.creditTransactionId)?.userId ?? null
      }
      if (scopeUserIds?.length) {
        if (!ownerUserId || !scopeUserIds.includes(ownerUserId)) continue
      }
      if (!matchStatus(row.status, query.status)) continue
      if (!matchKeyword(row, query.keyword)) continue
      raw.push({
        kind: 'video',
        id: row.id,
        status: row.status,
        provider: row.provider,
        model: row.model,
        prompt: row.prompt,
        errorMsg: row.errorMsg,
        dramaId: row.dramaId,
        creditTransactionId: row.creditTransactionId,
        ownerUserId,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
      })
    }
  }

  raw.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

  const stats = {
    total: raw.length,
    completed: raw.filter(r => r.status === 'completed').length,
    processing: raw.filter(r => r.status === 'processing' || r.status === 'pending').length,
    failed: raw.filter(r => r.status === 'failed').length,
    images: raw.filter(r => r.kind === 'image').length,
    videos: raw.filter(r => r.kind === 'video').length,
  }

  const page = raw.slice(offset, offset + limit)
  const userMap = buildUserMap(page.map(r => r.ownerUserId || 0))
  const dramaMap = buildDramaMap(page.map(r => r.dramaId || 0))

  const items = page.map((row) => {
    const credit = resolveCreditInfo(row.creditTransactionId, creditMaps)
    const owner = row.ownerUserId ? userMap.get(row.ownerUserId) : null
    const status = String(row.status || 'pending')
    return toSnakeCase({
      kind: row.kind,
      id: row.id,
      status,
      provider: row.provider,
      model: row.model,
      prompt: truncatePrompt(row.prompt),
      errorMsg: row.errorMsg
        ? sanitizeUserFacingProviderError(row.errorMsg)
        : null,
      dramaId: row.dramaId,
      dramaTitle: row.dramaId ? (dramaMap.get(row.dramaId) || null) : null,
      operatorId: row.ownerUserId,
      operatorName: owner?.displayName || owner?.username || null,
      username: owner?.username || null,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      creditTransactionId: credit.chargeId,
      creditCost: credit.chargeAmount,
      creditAction: credit.chargeAction,
      creditRefunded: credit.refunded,
      creditRefundAmount: credit.refundAmount,
      creditRefundReason: credit.refundReason,
      detailPath: row.kind === 'image'
        ? `/images?focus=${row.id}`
        : `/videos?focus=${row.id}`,
    })
  })

  return {
    items,
    stats,
    pagination: {
      limit,
      offset,
      total: stats.total,
      has_more: offset + limit < stats.total,
    },
    scope: query.scope.mode,
    team_id: query.scope.teamId ?? null,
  }
}
