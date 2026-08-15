/**
 * 通道2（火山方舟）盈亏统计：本站实收 vs 控制台实付（upstream_actual_cost_yuan）
 */
import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { CREDITS_PER_YUAN } from '../constants/credit-actions.js'
import {
  resolveSiteCreditCharge,
} from './volcengine-task-billing.js'
import {
  getOfficialChannel2BillSyncStatus,
  runOfficialChannel2BillSyncBatch,
} from './official-channel2-bill-sync.js'

export interface OfficialChannel2PnlQuery {
  days?: number | null
  limit?: number
  offset?: number
  sort?: 'profit_asc' | 'profit_desc' | 'date_desc'
  backfillBills?: boolean
  onlyCompleted?: boolean
}

function roundMoney(n: number) {
  return Math.round(Number(n || 0) * 10000) / 10000
}

function yuanFromCredits(credits: number | null | undefined) {
  return roundMoney(Number(credits || 0) / CREDITS_PER_YUAN)
}

function isCompletedStatus(status?: string | null) {
  const s = String(status || '').toLowerCase()
  return s === 'completed' || s === 'succeeded' || s === 'success'
}

function parseAnchorMs(row: {
  completedAt?: string | null
  createdAt?: string | null
}) {
  const raw = row.completedAt || row.createdAt
  if (!raw) return NaN
  const ms = Date.parse(String(raw))
  return Number.isFinite(ms) ? ms : NaN
}

const BACKFILL_TASK_LIMIT = 50

export async function computeOfficialChannel2Pnl(query: OfficialChannel2PnlQuery = {}) {
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))
  const offset = Math.max(0, Number(query.offset) || 0)
  const sort = query.sort || 'profit_asc'
  const days = query.days != null && Number(query.days) > 0 ? Number(query.days) : null
  const onlyCompleted = query.onlyCompleted !== false

  const whereParts = [eq(schema.videoGenerations.provider, 'volcengine')]
  if (days) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
    whereParts.push(gte(schema.videoGenerations.createdAt, since))
  }

  let rows = db.select()
    .from(schema.videoGenerations)
    .where(and(...whereParts))
    .orderBy(desc(schema.videoGenerations.id))
    .all()

  if (onlyCompleted) {
    rows = rows.filter(r => isCompletedStatus(r.status))
  }

  let backfill: { attempted: number; matched: number; remaining: number; error: string | null } = {
    attempted: 0,
    matched: 0,
    remaining: 0,
    error: null,
  }
  if (query.backfillBills) {
    const result = await runOfficialChannel2BillSyncBatch({
      batchSize: BACKFILL_TASK_LIMIT,
      cursorBeforeId: null,
      persistCursor: false,
    })
    backfill = {
      attempted: result.attempted,
      matched: result.matched,
      remaining: result.remaining ?? 0,
      error: result.error,
    }
    rows = db.select()
      .from(schema.videoGenerations)
      .where(and(...whereParts))
      .orderBy(desc(schema.videoGenerations.id))
      .all()
    if (onlyCompleted) {
      rows = rows.filter(r => isCompletedStatus(r.status))
    }
  }

  const userIds = [...new Set(rows.map(r => r.userId).filter((id): id is number => id != null))]
  const userMap = new Map<number, string>()
  if (userIds.length) {
    for (const u of db.select({
      id: schema.users.id,
      username: schema.users.username,
    }).from(schema.users).where(inArray(schema.users.id, userIds)).all()) {
      userMap.set(u.id, u.username || `#${u.id}`)
    }
  }

  const lines: Array<Record<string, unknown>> = []
  let totalRevenueYuan = 0
  let totalActualCostYuan = 0
  let totalEstimatedCostYuan = 0
  let profitTaskCount = 0
  let lossTaskCount = 0
  let breakevenTaskCount = 0
  let missingActualCostCount = 0
  let missingRevenueCount = 0
  let billableTaskCount = 0

  for (const row of rows) {
    const site = resolveSiteCreditCharge(row.creditTransactionId)
    const revenueYuan = yuanFromCredits(site.site_credits_net ?? site.site_credits)
    const actualCost = row.upstreamActualCostYuan != null && Number.isFinite(Number(row.upstreamActualCostYuan))
      ? roundMoney(Number(row.upstreamActualCostYuan))
      : null
    const estimatedCost = row.upstreamEstimatedCostYuan != null && Number.isFinite(Number(row.upstreamEstimatedCostYuan))
      ? roundMoney(Number(row.upstreamEstimatedCostYuan))
      : null

    totalRevenueYuan = roundMoney(totalRevenueYuan + revenueYuan)
    if (actualCost != null) totalActualCostYuan = roundMoney(totalActualCostYuan + actualCost)
    if (estimatedCost != null) totalEstimatedCostYuan = roundMoney(totalEstimatedCostYuan + estimatedCost)

    let profitYuan: number | null = null
    let outcome: string = 'unknown'

    if (actualCost != null && revenueYuan > 0) {
      profitYuan = roundMoney(revenueYuan - actualCost)
      billableTaskCount += 1
      if (profitYuan > 0.0001) {
        outcome = 'profit'
        profitTaskCount += 1
      } else if (profitYuan < -0.0001) {
        outcome = 'loss'
        lossTaskCount += 1
      } else {
        outcome = 'breakeven'
        breakevenTaskCount += 1
      }
    } else if (actualCost == null && isCompletedStatus(row.status)) {
      outcome = 'missing_actual_cost'
      missingActualCostCount += 1
    } else if (revenueYuan <= 0 && actualCost != null) {
      outcome = 'missing_revenue'
      missingRevenueCount += 1
      profitYuan = roundMoney(0 - actualCost)
    } else if (!isCompletedStatus(row.status)) {
      outcome = 'not_billable'
    }

    lines.push({
      video_id: row.id,
      task_id: row.taskId,
      user_id: row.userId,
      username: row.userId != null ? (userMap.get(row.userId) || `#${row.userId}`) : null,
      status: row.status,
      model: row.model,
      duration: row.duration,
      resolution: row.resolution,
      created_at: row.createdAt,
      completed_at: row.completedAt,
      site_credits: site.site_credits,
      site_credits_net: site.site_credits_net ?? site.site_credits,
      site_credits_refunded: site.site_credits_refunded,
      revenue_yuan: revenueYuan,
      estimated_cost_yuan: estimatedCost,
      actual_cost_yuan: actualCost,
      upstream_bill_id: row.upstreamBillId,
      profit_yuan: profitYuan,
      outcome,
      prompt_head: String(row.prompt || '').slice(0, 100),
    })
  }

  const netProfitYuan = roundMoney(totalRevenueYuan - totalActualCostYuan)
  const marginPct = totalActualCostYuan > 0
    ? roundMoney((netProfitYuan / totalActualCostYuan) * 100)
    : null

  const byModel = new Map<string, {
    count: number
    revenue_yuan: number
    actual_cost_yuan: number
    profit_yuan: number
    loss_count: number
    profit_count: number
    missing_actual_cost: number
  }>()

  const byUser = new Map<string, {
    user_id: number | null
    username: string
    count: number
    revenue_yuan: number
    actual_cost_yuan: number
    profit_yuan: number
    loss_count: number
    profit_count: number
  }>()

  for (const line of lines) {
    const model = String(line.model || 'unknown')
    const modelBucket = byModel.get(model) || {
      count: 0,
      revenue_yuan: 0,
      actual_cost_yuan: 0,
      profit_yuan: 0,
      loss_count: 0,
      profit_count: 0,
      missing_actual_cost: 0,
    }
    modelBucket.count += 1
    modelBucket.revenue_yuan = roundMoney(modelBucket.revenue_yuan + Number(line.revenue_yuan || 0))
    if (line.actual_cost_yuan != null) {
      modelBucket.actual_cost_yuan = roundMoney(modelBucket.actual_cost_yuan + Number(line.actual_cost_yuan))
    }
    if (line.outcome === 'missing_actual_cost') modelBucket.missing_actual_cost += 1
    if (line.profit_yuan != null) {
      modelBucket.profit_yuan = roundMoney(modelBucket.profit_yuan + Number(line.profit_yuan))
      if (line.outcome === 'loss') modelBucket.loss_count += 1
      if (line.outcome === 'profit') modelBucket.profit_count += 1
    }
    byModel.set(model, modelBucket)

    const userKey = line.user_id != null ? String(line.user_id) : 'orphan'
    const userBucket = byUser.get(userKey) || {
      user_id: line.user_id as number | null,
      username: String(line.username || '未关联用户'),
      count: 0,
      revenue_yuan: 0,
      actual_cost_yuan: 0,
      profit_yuan: 0,
      loss_count: 0,
      profit_count: 0,
    }
    userBucket.count += 1
    userBucket.revenue_yuan = roundMoney(userBucket.revenue_yuan + Number(line.revenue_yuan || 0))
    if (line.actual_cost_yuan != null) {
      userBucket.actual_cost_yuan = roundMoney(userBucket.actual_cost_yuan + Number(line.actual_cost_yuan))
    }
    if (line.profit_yuan != null) {
      userBucket.profit_yuan = roundMoney(userBucket.profit_yuan + Number(line.profit_yuan))
      if (line.outcome === 'loss') userBucket.loss_count += 1
      if (line.outcome === 'profit') userBucket.profit_count += 1
    }
    byUser.set(userKey, userBucket)
  }

  const sorted = [...lines]
  if (sort === 'profit_desc') {
    sorted.sort((a, b) => Number(b.profit_yuan ?? -999999) - Number(a.profit_yuan ?? -999999))
  } else if (sort === 'date_desc') {
    sorted.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  } else {
    sorted.sort((a, b) => Number(a.profit_yuan ?? 999999) - Number(b.profit_yuan ?? 999999))
  }

  const pageLines = sorted.slice(offset, offset + limit)

  return {
    window: {
      days: days || null,
      all_time: !days,
      since: days ? new Date(Date.now() - days * 24 * 3600 * 1000).toISOString() : null,
    },
    assumptions: {
      credits_per_yuan: CREDITS_PER_YUAN,
      revenue: '本站实收 = credit_transactions 净扣积分 ÷ 100',
      cost: '上游实付 = video_generations.upstream_actual_cost_yuan（ListBillDetail PayableAmount）',
      profit: 'profit_yuan = revenue_yuan - actual_cost_yuan（仅双方齐全时计入盈亏任务）',
    },
    backfill,
    summary: {
      total_tasks: lines.length,
      billable_tasks: billableTaskCount,
      profit_tasks: profitTaskCount,
      loss_tasks: lossTaskCount,
      breakeven_tasks: breakevenTaskCount,
      missing_actual_cost: missingActualCostCount,
      missing_revenue: missingRevenueCount,
      total_revenue_yuan: totalRevenueYuan,
      total_actual_cost_yuan: totalActualCostYuan,
      total_estimated_cost_yuan: totalEstimatedCostYuan,
      net_profit_yuan: netProfitYuan,
      is_profit: netProfitYuan > 0.0001,
      is_loss: netProfitYuan < -0.0001,
      margin_pct_vs_cost: marginPct,
      coverage_pct: lines.length > 0
        ? roundMoney((billableTaskCount / lines.length) * 100)
        : null,
      totals_complete: missingActualCostCount === 0,
      note: missingActualCostCount > 0
        ? `仍有 ${missingActualCostCount} 条成功任务缺实付，汇总仅含已入库实付；后台每 1 分钟自动补拉 5 条（从新到旧）`
        : null,
    },
    bill_sync: getOfficialChannel2BillSyncStatus(),
    by_model: [...byModel.entries()]
      .map(([model, stats]) => ({ model, ...stats }))
      .sort((a, b) => a.profit_yuan - b.profit_yuan),
    by_user: [...byUser.values()]
      .sort((a, b) => a.profit_yuan - b.profit_yuan),
    top_losers: sorted
      .filter(l => l.outcome === 'loss')
      .slice(0, 20),
    top_winners: [...sorted]
      .filter(l => l.outcome === 'profit')
      .sort((a, b) => Number(b.profit_yuan) - Number(a.profit_yuan))
      .slice(0, 10),
    lines: pageLines,
    pagination: {
      limit,
      offset,
      total: sorted.length,
      has_more: offset + limit < sorted.length,
      sort,
    },
  }
}
