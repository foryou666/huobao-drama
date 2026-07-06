import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { logTaskError, logTaskProgress } from '../utils/task-logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '../..')

export interface AlipayConfig {
  appId: string
  pid: string
  privateKeyPem: string
  alipayPublicKeyPem: string
  notifyUrl: string
  returnUrl: string
  gateway: string
}

function readTextFromEnvOrFile(fileEnv: string | undefined, inlineEnv: string | undefined): string {
  const inline = String(inlineEnv || '').trim()
  if (inline) return inline.replace(/\\n/g, '\n')
  const filePath = String(fileEnv || '').trim()
  if (!filePath) return ''
  const abs = path.isAbsolute(filePath) ? filePath : path.join(backendRoot, filePath)
  if (!fs.existsSync(abs)) return ''
  return fs.readFileSync(abs, 'utf8').trim()
}

function wrapPem(content: string, label: 'PRIVATE KEY' | 'PUBLIC KEY'): string {
  const body = String(content || '').trim()
    .replace(/-----BEGIN[\s\S]+?-----/g, '')
    .replace(/-----END[\s\S]+?-----/g, '')
    .replace(/\s+/g, '')
  if (!body) return ''
  const lines = body.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

function normalizePrivateKeyPem(raw: string): string {
  const text = String(raw || '').trim()
  if (text.includes('BEGIN PRIVATE KEY') || text.includes('BEGIN RSA PRIVATE KEY')) return text
  return wrapPem(text, 'PRIVATE KEY')
}

function normalizePublicKeyPem(raw: string): string {
  const text = String(raw || '').trim()
  if (text.includes('BEGIN PUBLIC KEY')) return text
  return wrapPem(text, 'PUBLIC KEY')
}

export function getAlipayConfig(): AlipayConfig | null {
  const appId = String(process.env.ALIPAY_APP_ID || '').trim()
  const pid = String(process.env.ALIPAY_PID || '').trim()
  const privateKeyPem = normalizePrivateKeyPem(readTextFromEnvOrFile(
    process.env.ALIPAY_PRIVATE_KEY_PATH,
    process.env.ALIPAY_PRIVATE_KEY,
  ))
  const alipayPublicKeyPem = normalizePublicKeyPem(readTextFromEnvOrFile(
    process.env.ALIPAY_PUBLIC_KEY_PATH,
    process.env.ALIPAY_PUBLIC_KEY,
  ))
  const publicBase = String(process.env.PUBLIC_BASE_URL || 'https://ai.weikuaiche.cn').trim().replace(/\/+$/, '')
  const notifyUrl = String(process.env.ALIPAY_NOTIFY_URL || `${publicBase}/api/v1/payments/alipay/notify`).trim()
  const returnUrl = String(process.env.ALIPAY_RETURN_URL || `${publicBase}/recharge`).trim().replace(/\/+$/, '')
  const gateway = String(process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do').trim()

  if (!appId || !pid || !privateKeyPem || !alipayPublicKeyPem) return null
  return { appId, pid, privateKeyPem, alipayPublicKeyPem, notifyUrl, returnUrl, gateway }
}

export function isAlipayConfigured(): boolean {
  return getAlipayConfig() != null
}

function formatYuanAmount(yuan: number): string {
  return yuan.toFixed(2)
}

function buildSignedParams(
  config: AlipayConfig,
  method: string,
  bizContent: Record<string, unknown>,
  extra: Record<string, string> = {},
) {
  const params: Record<string, string> = {
    app_id: config.appId,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
    version: '1.0',
    biz_content: JSON.stringify(bizContent),
    ...extra,
  }
  const signContent = Object.keys(params)
    .filter(key => params[key] !== '' && params[key] != null)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&')
  const sign = crypto.createSign('RSA-SHA256')
    .update(signContent, 'utf8')
    .sign(config.privateKeyPem, 'base64')
  params.sign = sign
  return params
}

async function alipayRequest<T>(config: AlipayConfig, method: string, bizContent: Record<string, unknown>): Promise<T> {
  const params = buildSignedParams(config, method, bizContent)
  const body = new URLSearchParams(params)
  const resp = await fetch(config.gateway, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  })
  const json = await resp.json().catch(() => ({})) as Record<string, any>
  const responseKey = method.replace(/\./g, '_') + '_response'
  const payload = json?.[responseKey] || {}
  if (String(payload.code) !== '10000') {
    throw new Error(String(payload.sub_msg || payload.msg || `支付宝接口错误 ${payload.code || resp.status}`))
  }
  return payload as T
}

/** 电脑网站支付：生成跳转支付宝收银台的 URL */
export function createAlipayPagePayOrder(params: {
  outTradeNo: string
  subject: string
  amountYuan: number
  returnUrl?: string
}): { payUrl: string } {
  const config = getAlipayConfig()
  if (!config) throw new Error('支付宝未配置，请联系管理员填写 ALIPAY_* 环境变量')

  logTaskProgress('Alipay', 'page-pay', {
    outTradeNo: params.outTradeNo,
    amountYuan: params.amountYuan,
  })

  const signedParams = buildSignedParams(config, 'alipay.trade.page.pay', {
    out_trade_no: params.outTradeNo,
    product_code: 'FAST_INSTANT_TRADE_PAY',
    total_amount: formatYuanAmount(params.amountYuan),
    subject: params.subject.slice(0, 127),
  }, {
    notify_url: config.notifyUrl,
    return_url: String(params.returnUrl || config.returnUrl).trim(),
  })

  const query = Object.keys(signedParams)
    .filter(key => signedParams[key] !== '' && signedParams[key] != null)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(signedParams[key])}`)
    .join('&')

  const payUrl = `${config.gateway}?${query}`
  if (!payUrl.includes('sign=')) throw new Error('支付宝支付链接生成失败')
  return { payUrl }
}

export async function queryAlipayOrder(outTradeNo: string): Promise<{
  tradeStatus: string
  transactionId?: string
}> {
  const config = getAlipayConfig()
  if (!config) throw new Error('支付宝未配置')

  const result = await alipayRequest<{ trade_status?: string; trade_no?: string }>(
    config,
    'alipay.trade.query',
    { out_trade_no: outTradeNo },
  )
  return {
    tradeStatus: String(result.trade_status || '').trim(),
    transactionId: result.trade_no ? String(result.trade_no) : undefined,
  }
}

export function verifyAlipayNotifyParams(params: Record<string, string>): boolean {
  if (process.env.ALIPAY_SKIP_VERIFY === '1') return true
  const config = getAlipayConfig()
  if (!config) return false

  const sign = String(params.sign || '').trim()
  if (!sign) return false

  const signContent = Object.keys(params)
    .filter(key => key !== 'sign' && key !== 'sign_type' && params[key] !== '' && params[key] != null)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&')

  try {
    return crypto.createVerify('RSA-SHA256')
      .update(signContent, 'utf8')
      .verify(config.alipayPublicKeyPem, sign, 'base64')
  } catch (err: any) {
    logTaskError('Alipay', 'notify-verify-failed', { error: err?.message || String(err) })
    return false
  }
}

export function parseAlipayNotifyBody(bodyText: string, contentType: string): Record<string, string> {
  const ct = String(contentType || '').toLowerCase()
  const text = String(bodyText || '').trim()
  if (!text) return {}

  if (ct.includes('application/json')) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>
      return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, String(v ?? '')]))
    } catch {
      return {}
    }
  }

  const params = new URLSearchParams(text)
  const out: Record<string, string> = {}
  for (const [k, v] of params.entries()) out[k] = v
  return out
}
