import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { findRechargePackage, yuanToFen } from '../constants/recharge.js'
import { createNativePayOrder, queryWechatOrder } from './wechat-pay.js'
import { createAlipayPagePayOrder, queryAlipayOrder } from './alipay-pay.js'
import { grantCreditsFromPayment } from './credits.js'
import { logTaskError, logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'

function generateOrderNo(): string {
  const stamp = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `HG${stamp}${rand}`.slice(0, 32)
}

export function getPaymentOrderById(id: number) {
  const [row] = db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.id, id)).all()
  return row || null
}

export function getPaymentOrderByOrderNo(orderNo: string) {
  const [row] = db.select().from(schema.paymentOrders)
    .where(eq(schema.paymentOrders.orderNo, orderNo))
    .all()
  return row || null
}

export function formatPaymentOrder(row: typeof schema.paymentOrders.$inferSelect) {
  return {
    id: row.id,
    order_no: row.orderNo,
    provider: row.provider,
    package_id: row.packageId,
    amount_yuan: row.amountFen / 100,
    amount_fen: row.amountFen,
    credits: row.credits,
    status: row.status,
    code_url: row.codeUrl,
    wx_transaction_id: row.wxTransactionId,
    paid_at: row.paidAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    error_msg: row.errorMsg,
  }
}

export async function createWechatRechargeOrder(userId: number, packageId: string) {
  const pkg = findRechargePackage(packageId)
  if (!pkg) throw new Error('无效的充值套餐')

  const ts = now()
  const orderNo = generateOrderNo()
  const amountFen = yuanToFen(pkg.yuan)

  const res = db.insert(schema.paymentOrders).values({
    orderNo,
    userId,
    provider: 'wechat',
    packageId: pkg.id,
    amountYuan: pkg.yuan,
    amountFen,
    credits: pkg.credits,
    status: 'pending',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const orderId = Number(res.lastInsertRowid)

  try {
    const { codeUrl, prepayId } = await createNativePayOrder({
      outTradeNo: orderNo,
      description: `鲸灵科技-积分充值${pkg.label}`,
      amountFen,
      attach: String(orderId),
    })

    db.update(schema.paymentOrders)
      .set({
        codeUrl,
        wxPrepayId: prepayId || null,
        updatedAt: now(),
      })
      .where(eq(schema.paymentOrders.id, orderId))
      .run()
  } catch (err: any) {
    db.update(schema.paymentOrders)
      .set({
        status: 'failed',
        errorMsg: err?.message || '创建微信支付失败',
        updatedAt: now(),
      })
      .where(eq(schema.paymentOrders.id, orderId))
      .run()
    throw err
  }

  const row = getPaymentOrderById(orderId)
  logTaskProgress('Payment', 'wechat-order-created', { orderId, orderNo, userId, yuan: pkg.yuan })
  return formatPaymentOrder(row!)
}

export function completePayment(params: {
  orderNo: string
  transactionId?: string
  source: 'notify' | 'query'
}): { ok: boolean; alreadyPaid?: boolean; order?: ReturnType<typeof formatPaymentOrder> } {
  const row = getPaymentOrderByOrderNo(params.orderNo)
  if (!row) return { ok: false }

  if (row.status === 'paid') {
    return { ok: true, alreadyPaid: true, order: formatPaymentOrder(row) }
  }

  const ts = now()
  const grant = grantCreditsFromPayment(row.userId, row.credits, {
    orderNo: row.orderNo,
    provider: row.provider,
    amountYuan: row.amountFen / 100,
    transactionId: params.transactionId,
    source: params.source,
  })
  if (!grant.ok) {
    logTaskError('Payment', 'grant-failed', { orderNo: params.orderNo, error: grant.message })
    return { ok: false }
  }

  db.update(schema.paymentOrders)
    .set({
      status: 'paid',
      wxTransactionId: params.transactionId || row.wxTransactionId,
      creditTransactionId: grant.transactionId ?? null,
      paidAt: ts,
      updatedAt: ts,
      errorMsg: null,
    })
    .where(eq(schema.paymentOrders.id, row.id))
    .run()

  const next = getPaymentOrderById(row.id)!
  logTaskSuccess('Payment', `${row.provider}-paid`, {
    orderNo: params.orderNo,
    userId: row.userId,
    credits: row.credits,
    transactionId: params.transactionId,
  })
  return { ok: true, order: formatPaymentOrder(next) }
}

/** @deprecated use completePayment */
export function completeWechatPayment(params: {
  orderNo: string
  transactionId?: string
  source: 'notify' | 'query'
}) {
  return completePayment(params)
}

export async function createAlipayRechargeOrder(userId: number, packageId: string) {
  const pkg = findRechargePackage(packageId)
  if (!pkg) throw new Error('无效的充值套餐')

  const ts = now()
  const orderNo = generateOrderNo()
  const amountFen = yuanToFen(pkg.yuan)

  const res = db.insert(schema.paymentOrders).values({
    orderNo,
    userId,
    provider: 'alipay',
    packageId: pkg.id,
    amountYuan: pkg.yuan,
    amountFen,
    credits: pkg.credits,
    status: 'pending',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const orderId = Number(res.lastInsertRowid)

  try {
    const publicBase = String(process.env.PUBLIC_BASE_URL || 'https://ai.weikuaiche.cn').trim().replace(/\/+$/, '')
    const { payUrl } = createAlipayPagePayOrder({
      outTradeNo: orderNo,
      subject: `鲸灵科技-积分充值${pkg.label}`,
      amountYuan: pkg.yuan,
      returnUrl: `${publicBase}/recharge?order_id=${orderId}`,
    })

    db.update(schema.paymentOrders)
      .set({
        codeUrl: payUrl,
        updatedAt: now(),
      })
      .where(eq(schema.paymentOrders.id, orderId))
      .run()
  } catch (err: any) {
    db.update(schema.paymentOrders)
      .set({
        status: 'failed',
        errorMsg: err?.message || '创建支付宝支付失败',
        updatedAt: now(),
      })
      .where(eq(schema.paymentOrders.id, orderId))
      .run()
    throw err
  }

  const row = getPaymentOrderById(orderId)
  logTaskProgress('Payment', 'alipay-order-created', { orderId, orderNo, userId, yuan: pkg.yuan })
  return formatPaymentOrder(row!)
}

export async function refreshPaymentOrder(orderId: number, userId: number) {
  const row = getPaymentOrderById(orderId)
  if (!row || row.userId !== userId) throw new Error('订单不存在')
  if (row.status === 'paid') return formatPaymentOrder(row)

  if (row.provider === 'wechat') {
    const remote = await queryWechatOrder(row.orderNo)
    if (remote.tradeState === 'SUCCESS') {
      const result = completePayment({
        orderNo: row.orderNo,
        transactionId: remote.transactionId,
        source: 'query',
      })
      return result.order || formatPaymentOrder(getPaymentOrderById(orderId)!)
    }
    if (remote.tradeState === 'CLOSED' || remote.tradeState === 'PAYERROR') {
      db.update(schema.paymentOrders)
        .set({ status: 'closed', updatedAt: now(), errorMsg: remote.tradeState })
        .where(eq(schema.paymentOrders.id, orderId))
        .run()
    }
    return formatPaymentOrder(getPaymentOrderById(orderId)!)
  }

  if (row.provider === 'alipay') {
    const remote = await queryAlipayOrder(row.orderNo)
    if (remote.tradeStatus === 'TRADE_SUCCESS' || remote.tradeStatus === 'TRADE_FINISHED') {
      const result = completePayment({
        orderNo: row.orderNo,
        transactionId: remote.transactionId,
        source: 'query',
      })
      return result.order || formatPaymentOrder(getPaymentOrderById(orderId)!)
    }
    if (remote.tradeStatus === 'TRADE_CLOSED') {
      db.update(schema.paymentOrders)
        .set({ status: 'closed', updatedAt: now(), errorMsg: remote.tradeStatus })
        .where(eq(schema.paymentOrders.id, orderId))
        .run()
    }
    return formatPaymentOrder(getPaymentOrderById(orderId)!)
  }

  throw new Error('不支持的支付方式')
}

/** @deprecated use refreshPaymentOrder */
export async function refreshWechatPaymentOrder(orderId: number, userId: number) {
  return refreshPaymentOrder(orderId, userId)
}
