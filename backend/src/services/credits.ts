import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { DEFAULT_CREDIT_PRICING, DEFAULT_USER_CREDITS, CREDIT_ACTIONS, VIDEO_BILLING_SECONDS, type CreditAction, isVideoCreditAction, applyMinUserVideoCreditCost } from '../constants/credit-actions.js'
import { AISTARSLAB_DEFAULT_CREDIT_COST } from '../constants/aistarslab.js'
import { now } from '../utils/response.js'
import { getAppMeta, setAppMeta } from '../db/index.js'

const CREDIT_PRICING_MIGRATION_KEY = 'credit_pricing_defaults_v2'
const SEEDANCE_PER_SECOND_MIGRATION_KEY = 'credit_pricing_seedance_per_second_v1'
const JIMENG_PRICING_LABEL_KEY = 'credit_pricing_jimeng_label_v1'
const JIMENG_PER_MODEL_PRICING_KEY = 'credit_pricing_jimeng_per_model_v1'
const AISTARSLAB_PRICING_FLAT_FIX_KEY = 'credit_pricing_aistarslab_flat_fix_v1'
const AISTARSLAB_REF_VIDEO_PRICING_LABEL_KEY = 'credit_pricing_aistarslab_ref_video_v1'
const MIN_VIDEO_CREDIT_FLOOR_KEY = 'credit_pricing_min_video_750_v1'

/** 将库内已有视频定价项抬升到最低 750（一次性迁移 + 后续由 updateCreditPricing 保底） */
export function clampVideoCreditPricingToMinimum() {
  if (getAppMeta(MIN_VIDEO_CREDIT_FLOOR_KEY)) return
  const rows = db.select().from(schema.creditPricing).all()
  for (const row of rows) {
    if (!isVideoCreditAction(row.action)) continue
    if ((row.cost ?? 0) <= 0) continue
    const next = applyMinUserVideoCreditCost(row.cost ?? 0, row.action)
    if (next !== row.cost) {
      updateCreditPricing(row.action, next, row.label ?? undefined, row.description ?? undefined)
    }
  }
  setAppMeta(MIN_VIDEO_CREDIT_FLOOR_KEY, now())
}

/** 从旧即梦统一定价项复制单价到分项模型定价 */
function migrateJimengPerModelPricing() {
  if (getAppMeta(JIMENG_PER_MODEL_PRICING_KEY)) return
  const [legacy] = db.select().from(schema.creditPricing)
    .where(eq(schema.creditPricing.action, CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG))
    .all()
  const legacyCost = legacy?.cost ?? 0
  for (const action of [
    CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG_SEEDANCE_2_0_FAST,
    CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG_SEEDANCE_2_0,
  ]) {
    const [row] = db.select().from(schema.creditPricing).where(eq(schema.creditPricing.action, action)).all()
    if (row && row.cost === 0 && legacyCost > 0) {
      db.update(schema.creditPricing)
        .set({ cost: legacyCost, updatedAt: now() })
        .where(eq(schema.creditPricing.action, action))
        .run()
    }
  }
  setAppMeta(JIMENG_PER_MODEL_PRICING_KEY, now())
}

/** 将即梦定价项标签与导航「视频生成(即梦)」对齐 */
function migrateJimengPricingLabel() {
  if (getAppMeta(JIMENG_PRICING_LABEL_KEY)) return
  const def = DEFAULT_CREDIT_PRICING.find(item => item.action === CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG)
  if (!def) return
  const [row] = db.select().from(schema.creditPricing)
    .where(eq(schema.creditPricing.action, CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG))
    .all()
  if (row) {
    db.update(schema.creditPricing)
      .set({
        label: def.label,
        description: def.description,
        updatedAt: now(),
      })
      .where(eq(schema.creditPricing.action, CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG))
      .run()
  }
  setAppMeta(JIMENG_PRICING_LABEL_KEY, now())
}

/** 修正 VIP 通道曾被误设为「单价乘数」的过低定价，恢复为按条 fallback 默认值 */
function migrateAistarslabPricingFlat() {
  if (getAppMeta(AISTARSLAB_PRICING_FLAT_FIX_KEY)) return
  const def = DEFAULT_CREDIT_PRICING.find(item => item.action === CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB)
  if (!def) return
  const [row] = db.select().from(schema.creditPricing)
    .where(eq(schema.creditPricing.action, CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB))
    .all()
  if (row && row.cost > 0 && row.cost < 500) {
    db.update(schema.creditPricing)
      .set({
        cost: AISTARSLAB_DEFAULT_CREDIT_COST,
        label: def.label,
        description: def.description,
        updatedAt: now(),
      })
      .where(eq(schema.creditPricing.action, CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB))
      .run()
  }
  setAppMeta(AISTARSLAB_PRICING_FLAT_FIX_KEY, now())
}

/** 同步 VIP 通道定价说明：参考视频 ×1.5 计入用户扣费 */
function migrateAistarslabRefVideoPricingLabel() {
  if (getAppMeta(AISTARSLAB_REF_VIDEO_PRICING_LABEL_KEY)) return
  const def = DEFAULT_CREDIT_PRICING.find(item => item.action === CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB)
  if (!def) return
  const [row] = db.select().from(schema.creditPricing)
    .where(eq(schema.creditPricing.action, CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB))
    .all()
  if (row) {
    db.update(schema.creditPricing)
      .set({
        label: def.label,
        description: def.description,
        updatedAt: now(),
      })
      .where(eq(schema.creditPricing.action, CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB))
      .run()
  }
  setAppMeta(AISTARSLAB_REF_VIDEO_PRICING_LABEL_KEY, now())
}

/** 将官方 Seedance 定价从「按次总价」迁移为「每秒单价」（仅当单价 ≥500 时视为旧数据） */
export function migrateSeedancePricingToPerSecond() {
  if (getAppMeta(SEEDANCE_PER_SECOND_MIGRATION_KEY)) return
  const ts = now()
  for (const action of [
    CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0,
    CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST,
  ]) {
    const [row] = db.select().from(schema.creditPricing).where(eq(schema.creditPricing.action, action)).all()
    if (!row || row.cost < 500) continue
    const perSecond = Math.max(1, Math.round(row.cost / VIDEO_BILLING_SECONDS))
    const def = DEFAULT_CREDIT_PRICING.find(item => item.action === action)
    db.update(schema.creditPricing)
      .set({
        cost: perSecond,
        description: def?.description || row.description,
        updatedAt: ts,
      })
      .where(eq(schema.creditPricing.action, action))
      .run()
  }
  setAppMeta(SEEDANCE_PER_SECOND_MIGRATION_KEY, ts)
}

export interface ChargeContext {
  summary?: string
  dramaId?: number
  episodeId?: number
  resourceType?: string
  resourceId?: number
  quantity?: number
  /** 按条/按次一口价（优先于单价 × quantity） */
  flatCost?: number
  metadata?: Record<string, unknown>
}

export interface ChargeResult {
  ok: boolean
  cost: number
  balance: number
  transactionId?: number
  message?: string
}

export function seedCreditPricing() {
  migrateSeedancePricingToPerSecond()
  migrateJimengPricingLabel()
  migrateAistarslabPricingFlat()
  migrateAistarslabRefVideoPricingLabel()
  const ts = now()
  for (const item of DEFAULT_CREDIT_PRICING) {
    const [existing] = db.select().from(schema.creditPricing).where(eq(schema.creditPricing.action, item.action)).all()
    if (existing) continue
    db.insert(schema.creditPricing).values({
      action: item.action,
      label: item.label,
      description: item.description,
      cost: item.defaultCost,
      updatedAt: ts,
    }).run()
  }
  migrateJimengPerModelPricing()
}

/** 一次性将已有库中的积分单价同步到最新默认值（不覆盖管理员后续手动调整前的首次迁移） */
export function applyCreditPricingDefaultsIfNeeded() {
  seedCreditPricing()
  if (getAppMeta(CREDIT_PRICING_MIGRATION_KEY)) return

  for (const item of DEFAULT_CREDIT_PRICING) {
    updateCreditPricing(item.action, item.defaultCost, item.label, item.description)
  }
  setAppMeta(CREDIT_PRICING_MIGRATION_KEY, now())
}

export function getActionCost(action: string, quantity = 1): number {
  const [row] = db.select().from(schema.creditPricing).where(eq(schema.creditPricing.action, action)).all()
  const unit = row?.cost ?? DEFAULT_CREDIT_PRICING.find(item => item.action === action)?.defaultCost ?? 0
  const total = Math.max(0, unit * Math.max(1, quantity))
  return applyMinUserVideoCreditCost(total, action)
}

export function getUserBalance(userId: number): number {
  const [user] = db.select().from(schema.users).where(eq(schema.users.id, userId)).all()
  return user?.creditsBalance ?? 0
}

export function listCreditPricing() {
  seedCreditPricing()
  const rows = db.select().from(schema.creditPricing).all()
  const labelMap = new Map(DEFAULT_CREDIT_PRICING.map(item => [item.action, item]))
  return rows
    .map(row => ({
      action: row.action,
      label: row.label || labelMap.get(row.action as CreditAction)?.label || row.action,
      description: row.description || labelMap.get(row.action as CreditAction)?.description || '',
      cost: row.cost,
      updated_at: row.updatedAt,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
}

export function updateCreditPricing(action: string, cost: number, label?: string, description?: string) {
  const normalized = applyMinUserVideoCreditCost(Math.max(0, Math.floor(cost)), action)
  const ts = now()
  const [existing] = db.select().from(schema.creditPricing).where(eq(schema.creditPricing.action, action)).all()
  const fallback = DEFAULT_CREDIT_PRICING.find(item => item.action === action)
  if (existing) {
    db.update(schema.creditPricing).set({
      cost: normalized,
      label: label ?? existing.label,
      description: description ?? existing.description,
      updatedAt: ts,
    }).where(eq(schema.creditPricing.action, action)).run()
  } else {
    db.insert(schema.creditPricing).values({
      action,
      label: label || fallback?.label || action,
      description: description || fallback?.description || '',
      cost: normalized,
      updatedAt: ts,
    }).run()
  }
}

export function chargeCredits(userId: number, action: string, context: ChargeContext = {}): ChargeResult {
  const quantity = Math.max(1, context.quantity ?? 1)
  let cost = context.flatCost != null && Number.isFinite(context.flatCost)
    ? Math.max(0, Math.floor(context.flatCost))
    : getActionCost(action, quantity)
  cost = applyMinUserVideoCreditCost(cost, action)
  if (cost <= 0) {
    return { ok: true, cost: 0, balance: getUserBalance(userId) }
  }

  return db.transaction(() => {
    const [user] = db.select().from(schema.users).where(eq(schema.users.id, userId)).all()
    if (!user) return { ok: false, cost, balance: 0, message: '用户不存在' }

    const balance = user.creditsBalance ?? 0
    if (balance < cost) {
      return {
        ok: false,
        cost,
        balance,
        message: `积分不足：本次需要 ${cost} 积分，当前余额 ${balance} 积分`,
      }
    }

    const newBalance = balance - cost
    const ts = now()
    db.update(schema.users)
      .set({ creditsBalance: newBalance, updatedAt: ts })
      .where(eq(schema.users.id, userId))
      .run()

    const res = db.insert(schema.creditTransactions).values({
      userId,
      amount: -cost,
      balanceAfter: newBalance,
      type: 'charge',
      action,
      summary: context.summary || null,
      dramaId: context.dramaId ?? null,
      episodeId: context.episodeId ?? null,
      resourceType: context.resourceType || null,
      resourceId: context.resourceId ?? null,
      metadata: context.metadata ? JSON.stringify(context.metadata) : null,
      createdAt: ts,
    }).run()

    return {
      ok: true,
      cost,
      balance: newBalance,
      transactionId: Number(res.lastInsertRowid),
    }
  })
}

export interface RefundResult {
  ok: boolean
  cost: number
  balance: number
  transactionId?: number
  message?: string
  alreadyRefunded?: boolean
}

function parseTransactionMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function findRefundForCharge(chargeTransactionId: number) {
  const refunds = db.select().from(schema.creditTransactions)
    .where(eq(schema.creditTransactions.type, 'refund'))
    .all()
  return refunds.find(row => parseTransactionMetadata(row.metadata).charge_tx_id === chargeTransactionId) || null
}

/** 将扣费交易退回用户余额（幂等：同一 charge 只退一次） */
export function refundCreditTransaction(
  chargeTransactionId: number,
  context: ChargeContext & { metadata?: Record<string, unknown> } = {},
): RefundResult | null {
  if (!chargeTransactionId) return null

  const existingRefund = findRefundForCharge(chargeTransactionId)
  if (existingRefund) {
    return {
      ok: true,
      cost: Math.abs(existingRefund.amount),
      balance: existingRefund.balanceAfter,
      transactionId: existingRefund.id,
      alreadyRefunded: true,
    }
  }

  const [charge] = db.select().from(schema.creditTransactions)
    .where(eq(schema.creditTransactions.id, chargeTransactionId))
    .all()
  if (!charge) return { ok: false, cost: 0, balance: 0, message: '扣费记录不存在' }
  if (charge.type !== 'charge') return { ok: false, cost: 0, balance: 0, message: '非扣费交易，无法退款' }

  const refundAmount = Math.abs(charge.amount)
  if (refundAmount <= 0) {
    return { ok: true, cost: 0, balance: getUserBalance(charge.userId) }
  }

  return db.transaction(() => {
    const [user] = db.select().from(schema.users).where(eq(schema.users.id, charge.userId)).all()
    if (!user) return { ok: false, cost: refundAmount, balance: 0, message: '用户不存在' }

    const balance = (user.creditsBalance ?? 0) + refundAmount
    const ts = now()
    db.update(schema.users)
      .set({ creditsBalance: balance, updatedAt: ts })
      .where(eq(schema.users.id, charge.userId))
      .run()

    const res = db.insert(schema.creditTransactions).values({
      userId: charge.userId,
      amount: refundAmount,
      balanceAfter: balance,
      type: 'refund',
      action: charge.action,
      summary: context.summary || `退款：${charge.summary || charge.action}`,
      dramaId: context.dramaId ?? charge.dramaId ?? null,
      episodeId: context.episodeId ?? charge.episodeId ?? null,
      resourceType: context.resourceType ?? charge.resourceType ?? null,
      resourceId: context.resourceId ?? charge.resourceId ?? null,
      metadata: JSON.stringify({
        charge_tx_id: chargeTransactionId,
        ...(context.metadata || {}),
      }),
      createdAt: ts,
    }).run()

    return {
      ok: true,
      cost: refundAmount,
      balance,
      transactionId: Number(res.lastInsertRowid),
    }
  })
}

export function grantCredits(
  userId: number,
  amount: number,
  operatorId: number,
  summary?: string,
): ChargeResult {
  const delta = Math.floor(amount)
  if (delta <= 0) return { ok: false, cost: 0, balance: getUserBalance(userId), message: '充值积分必须大于 0' }

  return db.transaction(() => {
    const [user] = db.select().from(schema.users).where(eq(schema.users.id, userId)).all()
    if (!user) return { ok: false, cost: 0, balance: 0, message: '用户不存在' }

    const balance = (user.creditsBalance ?? 0) + delta
    const ts = now()
    db.update(schema.users)
      .set({ creditsBalance: balance, updatedAt: ts })
      .where(eq(schema.users.id, userId))
      .run()

    const res = db.insert(schema.creditTransactions).values({
      userId,
      amount: delta,
      balanceAfter: balance,
      type: 'grant',
      action: 'admin.grant',
      summary: summary || `管理员充值 ${delta} 积分`,
      metadata: JSON.stringify({ operator_id: operatorId }),
      createdAt: ts,
    }).run()

    return { ok: true, cost: -delta, balance, transactionId: Number(res.lastInsertRowid) }
  })
}

export function grantCreditsFromPayment(
  userId: number,
  amount: number,
  meta: {
    orderNo: string
    provider: string
    amountYuan: number
    transactionId?: string | null
    source?: string
  },
): ChargeResult {
  const delta = Math.floor(amount)
  if (delta <= 0) return { ok: false, cost: 0, balance: getUserBalance(userId), message: '充值积分必须大于 0' }

  const existing = db.select().from(schema.creditTransactions)
    .where(eq(schema.creditTransactions.type, 'recharge'))
    .all()
    .find(row => {
      try {
        const parsed = row.metadata ? JSON.parse(row.metadata) : null
        return parsed?.order_no === meta.orderNo
      } catch {
        return false
      }
    })
  if (existing) {
    return { ok: true, cost: -delta, balance: existing.balanceAfter, transactionId: existing.id }
  }

  return db.transaction(() => {
    const [user] = db.select().from(schema.users).where(eq(schema.users.id, userId)).all()
    if (!user) return { ok: false, cost: 0, balance: 0, message: '用户不存在' }

    const balance = (user.creditsBalance ?? 0) + delta
    const ts = now()
    db.update(schema.users)
      .set({ creditsBalance: balance, updatedAt: ts })
      .where(eq(schema.users.id, userId))
      .run()

    const action = meta.provider === 'alipay' ? 'payment.alipay' : 'payment.wechat'
    const providerLabel = meta.provider === 'alipay' ? '支付宝' : '微信'
    const displayYuan = Number.isInteger(meta.amountYuan) ? String(meta.amountYuan) : meta.amountYuan.toFixed(2)

    const res = db.insert(schema.creditTransactions).values({
      userId,
      amount: delta,
      balanceAfter: balance,
      type: 'recharge',
      action,
      summary: `${providerLabel}支付充值 ${displayYuan} 元（${delta} 积分）`,
      metadata: JSON.stringify({
        order_no: meta.orderNo,
        provider: meta.provider,
        amount_yuan: meta.amountYuan,
        transaction_id: meta.transactionId || null,
        source: meta.source || 'notify',
      }),
      createdAt: ts,
    }).run()

    return { ok: true, cost: -delta, balance, transactionId: Number(res.lastInsertRowid) }
  })
}

export function listCreditTransactions(opts: {
  userId?: number
  userIds?: number[]
  limit?: number
  offset?: number
}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  let query = db.select().from(schema.creditTransactions).orderBy(desc(schema.creditTransactions.createdAt))
  if (opts.userIds?.length) {
    query = query.where(inArray(schema.creditTransactions.userId, opts.userIds)) as typeof query
  } else if (opts.userId) {
    query = query.where(eq(schema.creditTransactions.userId, opts.userId)) as typeof query
  }
  const rows = query.all()

  const slice = rows.slice(offset, offset + limit)
  const userIds = [...new Set(slice.map(row => row.userId))]
  const users = userIds.length
    ? db.select().from(schema.users).all().filter(u => userIds.includes(u.id))
    : []
  const userMap = new Map(users.map(u => [u.id, u]))
  const pricing = new Map(listCreditPricing().map(item => [item.action, item.label]))

  return {
    items: slice.map(row => {
      const meta = row.metadata ? JSON.parse(row.metadata) : null
      const u = userMap.get(row.userId)
      return {
        id: row.id,
        user_id: row.userId,
        username: u?.username,
        display_name: u?.displayName || u?.username,
        operator_id: row.userId,
        operator_name: u?.displayName || u?.username,
        amount: row.amount,
        balance_after: row.balanceAfter,
        type: row.type,
        action: row.action,
        action_label: row.type === 'refund'
          ? `${pricing.get(row.action) || row.action}（退款）`
          : (pricing.get(row.action) || row.action),
        summary: row.summary,
        drama_id: row.dramaId,
        episode_id: row.episodeId,
        resource_type: row.resourceType,
        resource_id: row.resourceId,
        metadata: meta,
        created_at: row.createdAt,
      }
    }),
    total: rows.length,
    limit,
    offset,
  }
}

export function ensureUserCredits(userId: number) {
  const [user] = db.select().from(schema.users).where(eq(schema.users.id, userId)).all()
  if (!user) return
  if (user.creditsBalance == null) {
    db.update(schema.users)
      .set({ creditsBalance: DEFAULT_USER_CREDITS, updatedAt: now() })
      .where(eq(schema.users.id, userId))
      .run()
  }
}
