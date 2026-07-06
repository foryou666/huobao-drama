import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { logTaskError, logTaskProgress } from '../utils/task-logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, '../..')

export type WechatPayMode = 'direct' | 'partner'

export interface WechatPayConfig {
  mode: WechatPayMode
  mchId: string
  appId: string
  subMchId?: string
  apiV3Key: string
  serialNo: string
  privateKeyPem: string
  merchantCertPem: string
  platformCertPem: string
  notifyUrl: string
  merchantName: string
}

function readPemFromEnvOrFile(fileEnv: string | undefined, inlineEnv: string | undefined): string {
  const inline = String(inlineEnv || '').trim()
  if (inline) return inline.replace(/\\n/g, '\n')
  const filePath = String(fileEnv || '').trim()
  if (!filePath) return ''
  const abs = path.isAbsolute(filePath) ? filePath : path.join(backendRoot, filePath)
  if (!fs.existsSync(abs)) return ''
  return fs.readFileSync(abs, 'utf8')
}

function serialFromCertPem(certPem: string): string {
  const pem = String(certPem || '').trim()
  if (!pem) return ''
  try {
    const cert = new crypto.X509Certificate(pem)
    return cert.serialNumber.replace(/:/g, '').toUpperCase()
  } catch {
    return ''
  }
}

function resolveWechatPayMode(): WechatPayMode {
  const explicit = String(process.env.WECHATPAY_MODE || '').trim().toLowerCase()
  if (explicit === 'partner' || explicit === 'direct') return explicit
  if (String(process.env.WECHATPAY_SP_MCH_ID || '').trim()) return 'partner'
  return 'direct'
}

export function getWechatPayConfig(): WechatPayConfig | null {
  const mode = resolveWechatPayMode()
  const apiV3Key = String(process.env.WECHATPAY_API_V3_KEY || '').trim()
  const privateKeyPem = readPemFromEnvOrFile(
    process.env.WECHATPAY_PRIVATE_KEY_PATH,
    process.env.WECHATPAY_PRIVATE_KEY,
  )
  const merchantCertPem = readPemFromEnvOrFile(
    process.env.WECHATPAY_CERT_PATH,
    process.env.WECHATPAY_CERT,
  )
  const platformCertPem = readPemFromEnvOrFile(
    process.env.WECHATPAY_PLATFORM_CERT_PATH,
    process.env.WECHATPAY_PLATFORM_CERT,
  )
  const publicBase = String(process.env.PUBLIC_BASE_URL || 'https://ai.weikuaiche.cn').trim().replace(/\/+$/, '')
  const notifyUrl = String(process.env.WECHATPAY_NOTIFY_URL || `${publicBase}/api/v1/payments/wechat/notify`).trim()
  const merchantName = String(process.env.WECHATPAY_MERCHANT_NAME || '鲸灵科技').trim()

  let serialNo = String(process.env.WECHATPAY_SERIAL_NO || '').trim()
  if (!serialNo && merchantCertPem) serialNo = serialFromCertPem(merchantCertPem)

  if (mode === 'partner') {
    const spMchId = String(process.env.WECHATPAY_SP_MCH_ID || '').trim()
    const spAppId = String(process.env.WECHATPAY_SP_APP_ID || process.env.WECHATPAY_APP_ID || '').trim()
    const subMchId = String(process.env.WECHATPAY_SUB_MCH_ID || process.env.WECHATPAY_MCH_ID || '1114942867').trim()
    if (!spMchId || !spAppId || !apiV3Key || !serialNo || !privateKeyPem) return null
    return {
      mode,
      mchId: spMchId,
      appId: spAppId,
      subMchId,
      apiV3Key,
      serialNo,
      privateKeyPem,
      merchantCertPem,
      platformCertPem,
      notifyUrl,
      merchantName,
    }
  }

  const mchId = String(process.env.WECHATPAY_MCH_ID || '1114942867').trim()
  const appId = String(process.env.WECHATPAY_APP_ID || '').trim()
  if (!mchId || !appId || !apiV3Key || !serialNo || !privateKeyPem) return null

  return {
    mode,
    mchId,
    appId,
    apiV3Key,
    serialNo,
    privateKeyPem,
    merchantCertPem,
    platformCertPem,
    notifyUrl,
    merchantName,
  }
}

export function isWechatPayConfigured(): boolean {
  return getWechatPayConfig() != null
}

function randomNonce(length = 32): string {
  return crypto.randomBytes(length / 2).toString('hex')
}

function signMessage(privateKeyPem: string, message: string): string {
  return crypto.createSign('RSA-SHA256').update(message).sign(privateKeyPem, 'base64')
}

function buildAuthorization(
  config: WechatPayConfig,
  method: string,
  canonicalUrl: string,
  body: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = randomNonce()
  const message = `${method}\n${canonicalUrl}\n${timestamp}\n${nonce}\n${body}\n`
  const signature = signMessage(config.privateKeyPem, message)
  const params = [
    `mchid="${config.mchId}"`,
    `nonce_str="${nonce}"`,
    `signature="${signature}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${config.serialNo}"`,
  ].join(',')
  return `WECHATPAY2-SHA256-RSA2048 ${params}`
}

async function wechatPayRequest<T>(
  config: WechatPayConfig,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<T> {
  const bodyText = body == null ? '' : JSON.stringify(body)
  const authorization = buildAuthorization(config, method, pathname, bodyText)
  const resp = await fetch(`https://api.mch.weixin.qq.com${pathname}`, {
    method,
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
      'Accept-Language': 'zh-CN',
      'Content-Type': 'application/json',
      'User-Agent': 'hongguoduanju/1.0',
    },
    body: method === 'GET' ? undefined : bodyText,
  })
  const json = await resp.json().catch(() => ({})) as Record<string, unknown>
  if (!resp.ok) {
    const message = String(json?.message || json?.detail || `HTTP ${resp.status}`)
    throw new Error(message)
  }
  return json as T
}

function decryptAesGcmResource(
  apiV3Key: string,
  resource: { ciphertext?: string; associated_data?: string; nonce?: string },
): string {
  const ciphertext = String(resource.ciphertext || '')
  const associatedData = String(resource.associated_data || '')
  const nonce = String(resource.nonce || '')
  if (!ciphertext || !nonce) throw new Error('resource 字段不完整')

  const key = Buffer.from(apiV3Key, 'utf8')
  const data = Buffer.from(ciphertext, 'base64')
  const authTag = data.subarray(data.length - 16)
  const encrypted = data.subarray(0, data.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'))
  decipher.setAuthTag(authTag)
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'))
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

let platformCertCache: string | null = null

export async function ensureWechatPlatformCert(config?: WechatPayConfig | null): Promise<string> {
  const cfg = config || getWechatPayConfig()
  if (!cfg) return ''
  if (platformCertCache) return platformCertCache
  if (cfg.platformCertPem) {
    platformCertCache = cfg.platformCertPem
    return platformCertCache
  }

  try {
    const result = await wechatPayRequest<{ data?: Array<{
      serial_no?: string
      encrypt_certificate?: { ciphertext?: string; associated_data?: string; nonce?: string }
    }> }>(cfg, 'GET', '/v3/certificates')
    const first = result.data?.[0]?.encrypt_certificate
    if (!first) return ''
    const pem = decryptAesGcmResource(cfg.apiV3Key, first)
    platformCertCache = pem
    const certPath = String(process.env.WECHATPAY_PLATFORM_CERT_PATH || './certs/wechatpay_platform.pem').trim()
    const abs = path.isAbsolute(certPath) ? certPath : path.join(backendRoot, certPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, pem, 'utf8')
    return pem
  } catch (err: any) {
    logTaskError('WechatPay', 'fetch-platform-cert-failed', { error: err?.message || String(err) })
    return ''
  }
}

export async function createNativePayOrder(params: {
  outTradeNo: string
  description: string
  amountFen: number
  attach?: string
}): Promise<{ codeUrl: string; prepayId?: string }> {
  const config = getWechatPayConfig()
  if (!config) throw new Error('微信支付未配置，请联系管理员填写 WECHATPAY_* 环境变量')

  logTaskProgress('WechatPay', 'native-create', {
    mode: config.mode,
    outTradeNo: params.outTradeNo,
    amountFen: params.amountFen,
    subMchId: config.subMchId,
  })

  if (config.mode === 'partner') {
    const result = await wechatPayRequest<{ code_url?: string; prepay_id?: string }>(
      config,
      'POST',
      '/v3/pay/partner/transactions/native',
      {
        sp_appid: config.appId,
        sp_mchid: config.mchId,
        sub_mchid: config.subMchId,
        description: params.description.slice(0, 127),
        out_trade_no: params.outTradeNo,
        notify_url: config.notifyUrl,
        amount: {
          total: params.amountFen,
          currency: 'CNY',
        },
        attach: params.attach?.slice(0, 128),
      },
    )
    const codeUrl = String(result?.code_url || '').trim()
    if (!codeUrl) throw new Error('微信未返回 code_url')
    return { codeUrl, prepayId: result.prepay_id }
  }

  const result = await wechatPayRequest<{ code_url?: string; prepay_id?: string }>(
    config,
    'POST',
    '/v3/pay/transactions/native',
    {
      appid: config.appId,
      mchid: config.mchId,
      description: params.description.slice(0, 127),
      out_trade_no: params.outTradeNo,
      notify_url: config.notifyUrl,
      amount: {
        total: params.amountFen,
        currency: 'CNY',
      },
      attach: params.attach?.slice(0, 128),
    },
  )

  const codeUrl = String(result?.code_url || '').trim()
  if (!codeUrl) throw new Error('微信未返回 code_url')
  return { codeUrl, prepayId: result.prepay_id }
}

export async function queryWechatOrder(outTradeNo: string): Promise<{
  tradeState: string
  transactionId?: string
}> {
  const config = getWechatPayConfig()
  if (!config) throw new Error('微信支付未配置')

  if (config.mode === 'partner') {
    const pathname = `/v3/pay/partner/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?sp_mchid=${encodeURIComponent(config.mchId)}&sub_mchid=${encodeURIComponent(config.subMchId || '')}`
    const result = await wechatPayRequest<{ trade_state?: string; transaction_id?: string }>(
      config,
      'GET',
      pathname,
    )
    return {
      tradeState: String(result.trade_state || '').trim(),
      transactionId: result.transaction_id ? String(result.transaction_id) : undefined,
    }
  }

  const pathname = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(config.mchId)}`
  const result = await wechatPayRequest<{ trade_state?: string; transaction_id?: string }>(
    config,
    'GET',
    pathname,
  )
  return {
    tradeState: String(result.trade_state || '').trim(),
    transactionId: result.transaction_id ? String(result.transaction_id) : undefined,
  }
}

export function decryptNotifyResource(resource: {
  ciphertext?: string
  associated_data?: string
  nonce?: string
}): Record<string, unknown> {
  const config = getWechatPayConfig()
  if (!config?.apiV3Key) throw new Error('缺少 WECHATPAY_API_V3_KEY')
  const plain = decryptAesGcmResource(config.apiV3Key, resource)
  return JSON.parse(plain) as Record<string, unknown>
}

export async function verifyWechatNotifySignature(params: {
  timestamp: string
  nonce: string
  signature: string
  body: string
  serial: string
}): Promise<boolean> {
  if (process.env.WECHATPAY_SKIP_VERIFY === '1') return true

  const config = getWechatPayConfig()
  if (!config) return false

  let platformCertPem = config.platformCertPem || platformCertCache || ''
  if (!platformCertPem) platformCertPem = await ensureWechatPlatformCert(config)
  if (!platformCertPem) {
    logTaskError('WechatPay', 'notify-verify-missing-platform-cert', { serial: params.serial })
    return false
  }

  try {
    const message = `${params.timestamp}\n${params.nonce}\n${params.body}\n`
    return crypto.createVerify('RSA-SHA256')
      .update(message)
      .verify(platformCertPem, params.signature, 'base64')
  } catch (err: any) {
    logTaskError('WechatPay', 'notify-verify-failed', { error: err?.message || String(err) })
    return false
  }
}
