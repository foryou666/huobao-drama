import { Hono } from 'hono'
import { success, badRequest, notFound } from '../utils/response.js'
import { requireAuth, getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { RECHARGE_PACKAGES, isRechargeHost } from '../constants/recharge.js'
import {
  createWechatRechargeOrder,
  createAlipayRechargeOrder,
  formatPaymentOrder,
  getPaymentOrderById,
  completePayment,
  refreshPaymentOrder,
} from '../services/payment-orders.js'
import {
  decryptNotifyResource,
  getWechatPayConfig,
  isWechatPayConfigured,
  verifyWechatNotifySignature,
} from '../services/wechat-pay.js'
import {
  getAlipayConfig,
  isAlipayEnabled,
  parseAlipayNotifyBody,
  verifyAlipayNotifyParams,
} from '../services/alipay-pay.js'
import { logTaskError } from '../utils/task-logger.js'

const app = new Hono<{ Variables: AuthVariables }>()

function requestAllowsRecharge(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const host = c.req.header('host') || c.req.header('x-forwarded-host') || ''
  return isRechargeHost(host)
}

// POST /payments/wechat/notify — 微信异步回调（无需登录）
app.post('/wechat/notify', async (c) => {
  const bodyText = await c.req.text()
  const timestamp = c.req.header('Wechatpay-Timestamp') || ''
  const nonce = c.req.header('Wechatpay-Nonce') || ''
  const signature = c.req.header('Wechatpay-Signature') || ''
  const serial = c.req.header('Wechatpay-Serial') || ''

  if (!await verifyWechatNotifySignature({ timestamp, nonce, signature, body: bodyText, serial })) {
    logTaskError('WechatPay', 'notify-bad-signature', { serial })
    return c.json({ code: 'FAIL', message: 'signature verification failed' }, 401)
  }

  try {
    const payload = JSON.parse(bodyText) as {
      event_type?: string
      resource?: { ciphertext?: string; associated_data?: string; nonce?: string }
    }
    if (payload.event_type !== 'TRANSACTION.SUCCESS') {
      return c.json({ code: 'SUCCESS', message: 'ignored' })
    }

    const plain = decryptNotifyResource(payload.resource || {})
    const orderNo = String(plain.out_trade_no || '').trim()
    const tradeState = String(plain.trade_state || 'SUCCESS').trim()
    const transactionId = plain.transaction_id ? String(plain.transaction_id) : undefined

    if (!orderNo) return c.json({ code: 'FAIL', message: 'missing out_trade_no' }, 400)
    if (tradeState !== 'SUCCESS') return c.json({ code: 'SUCCESS', message: 'not success' })

    completePayment({ orderNo, transactionId, source: 'notify' })
    return c.json({ code: 'SUCCESS', message: '成功' })
  } catch (err: any) {
    logTaskError('WechatPay', 'notify-error', { error: err?.message || String(err) })
    return c.json({ code: 'FAIL', message: err?.message || 'error' }, 500)
  }
})

// POST /payments/alipay/notify — 支付宝异步回调（无需登录）
app.post('/alipay/notify', async (c) => {
  const bodyText = await c.req.text()
  const contentType = c.req.header('content-type') || ''
  const params = parseAlipayNotifyBody(bodyText, contentType)

  if (!verifyAlipayNotifyParams(params)) {
    logTaskError('Alipay', 'notify-bad-signature', { orderNo: params.out_trade_no })
    return c.text('fail', 401)
  }

  try {
    const orderNo = String(params.out_trade_no || '').trim()
    const tradeStatus = String(params.trade_status || '').trim()
    const transactionId = params.trade_no ? String(params.trade_no) : undefined

    if (!orderNo) return c.text('fail', 400)
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      return c.text('success')
    }

    completePayment({ orderNo, transactionId, source: 'notify' })
    return c.text('success')
  } catch (err: any) {
    logTaskError('Alipay', 'notify-error', { error: err?.message || String(err) })
    return c.text('fail', 500)
  }
})

app.use('/*', requireAuth)

// GET /payments/config — 支付能力概览
app.get('/config', (c) => {
  const wechatConfig = getWechatPayConfig()
  const alipayConfig = getAlipayConfig()
  const rechargeAllowed = requestAllowsRecharge(c)
  return success(c, {
    wechat_enabled: rechargeAllowed && isWechatPayConfigured(),
    alipay_enabled: rechargeAllowed && isAlipayEnabled(),
    recharge_enabled: rechargeAllowed && (isWechatPayConfigured() || isAlipayEnabled()),
    mode: wechatConfig?.mode || null,
    mch_id: wechatConfig?.mode === 'partner' ? wechatConfig?.subMchId || null : wechatConfig?.mchId || null,
    sp_mch_id: wechatConfig?.mode === 'partner' ? wechatConfig?.mchId || null : null,
    alipay_app_id: alipayConfig?.appId || null,
    alipay_pid: alipayConfig?.pid || null,
    notify_url: wechatConfig?.notifyUrl || null,
    alipay_notify_url: alipayConfig?.notifyUrl || null,
    alipay_return_url: alipayConfig?.returnUrl || null,
    merchant_name: wechatConfig?.merchantName || '鲸灵科技',
    missing: [],
  })
})

// GET /payments/packages — 充值档位
app.get('/packages', (c) => {
  return success(c, {
    credits_per_yuan: 100,
    items: RECHARGE_PACKAGES.map(item => ({
      id: item.id,
      label: item.label,
      yuan: item.yuan,
      credits: item.credits,
      bonus_label: item.bonusLabel || null,
    })),
  })
})

// POST /payments/wechat/orders — 创建 Native 扫码订单
app.post('/wechat/orders', async (c) => {
  if (!requestAllowsRecharge(c)) {
    return badRequest(c, '请通过官方域名 https://ai.weikuaiche.cn 使用充值功能')
  }
  if (!isWechatPayConfigured()) {
    return badRequest(c, '微信支付尚未配置完成，请联系管理员')
  }

  const body = await c.req.json().catch(() => ({}))
  const packageId = String(body.package_id || '').trim()
  if (!packageId) return badRequest(c, 'package_id is required')

  try {
    const user = getAuthUser(c)
    const order = await createWechatRechargeOrder(user.id, packageId)
    return success(c, order)
  } catch (err: any) {
    return badRequest(c, err?.message || '创建订单失败')
  }
})

// POST /payments/alipay/orders — 创建电脑网站支付订单
app.post('/alipay/orders', async (c) => {
  if (!requestAllowsRecharge(c)) {
    return badRequest(c, '请通过官方域名 https://ai.weikuaiche.cn 使用充值功能')
  }
  if (!isAlipayEnabled()) {
    return badRequest(c, '支付宝支付暂未开放')
  }

  const body = await c.req.json().catch(() => ({}))
  const packageId = String(body.package_id || '').trim()
  if (!packageId) return badRequest(c, 'package_id is required')

  try {
    const user = getAuthUser(c)
    const order = await createAlipayRechargeOrder(user.id, packageId)
    return success(c, order)
  } catch (err: any) {
    return badRequest(c, err?.message || '创建订单失败')
  }
})

// GET /payments/orders/:id — 查询订单（未支付时会主动向支付平台查单）
app.get('/orders/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, 'invalid order id')

  const user = getAuthUser(c)
  const row = getPaymentOrderById(id)
  if (!row || row.userId !== user.id) return notFound(c, '订单不存在')

  try {
    if (row.status === 'pending' && (row.provider === 'wechat' || row.provider === 'alipay')) {
      const refreshed = await refreshPaymentOrder(id, user.id)
      return success(c, refreshed)
    }
    return success(c, formatPaymentOrder(row))
  } catch (err: any) {
    return badRequest(c, err?.message || '查询订单失败')
  }
})

export default app
