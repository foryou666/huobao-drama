/**
 * 火山引擎账户现金余额（管控面 OpenAPI，需 AK/SK，不能用方舟 API Key）
 * Action=QueryBalanceAcct Version=2022-01-01
 * @see https://www.volcengine.com/docs/6269/1223898
 */
import { createHash, createHmac } from 'crypto'

const BILLING_HOST = 'billing.volcengineapi.com'
const BILLING_REGION = 'cn-north-1'
const BILLING_SERVICE = 'billing'
const BILLING_VERSION = '2022-01-01'

/** 从 process.env 读取全局火山管控面 AK/SK（deploy/.env 常用 AccessKeyID / SecretAccessKey） */
export function resolveVolcengineBillingCredentialsFromEnv(): {
  access_key: string | null
  secret_key: string | null
} {
  const access_key = (
    process.env.VOLCENGINE_ACCESS_KEY_ID
    || process.env.VOLC_ACCESS_KEY
    || process.env.AccessKeyID
    || process.env.ACCESS_KEY_ID
    || ''
  ).trim() || null
  const secret_key = (
    process.env.VOLCENGINE_SECRET_ACCESS_KEY
    || process.env.VOLC_SECRET_KEY
    || process.env.SecretAccessKey
    || process.env.SECRET_ACCESS_KEY
    || ''
  ).trim() || null
  return { access_key, secret_key }
}

/** 按标识读取独立账单 AK/SK，如 huoshanak_lingjingkeji / huoshansk_lingjingkeji */
export function resolveVolcengineBillingPairFromEnv(label: string): {
  access_key: string
  secret_key: string
} | null {
  const suffix = String(label || '').trim()
  if (!suffix) return null
  const upper = suffix.toUpperCase()
  const access_key = (
    process.env[`huoshanak_${suffix}`]
    || process.env[`HUOSHAN_AK_${suffix}`]
    || process.env[`HUOSHANAK_${suffix}`]
    || process.env[`huoshan_ak_${suffix}`]
    || process.env[`VOLCENGINE_AK_${upper}`]
    || ''
  ).trim()
  const secret_key = (
    process.env[`huoshansk_${suffix}`]
    || process.env[`HUOSHAN_SK_${suffix}`]
    || process.env[`HUOSHANSK_${suffix}`]
    || process.env[`huoshan_sk_${suffix}`]
    || process.env[`VOLCENGINE_SK_${upper}`]
    || ''
  ).trim()
  if (!access_key || !secret_key) return null
  return { access_key, secret_key }
}

/** 扫描 env 中所有 huoshanak_* / huoshansk_* 配对 */
export function listVolcengineBillingPairsFromEnv(): Array<{
  label: string
  access_key: string
  secret_key: string
}> {
  const labels = new Set<string>()
  for (const name of Object.keys(process.env)) {
    const m = name.match(/^(?:huoshanak_|HUOSHAN_AK_|HUOSHANAK_|huoshan_ak_|VOLCENGINE_AK_)(.+)$/i)
    if (m?.[1]) labels.add(m[1])
  }
  const items: Array<{ label: string; access_key: string; secret_key: string }> = []
  for (const label of labels) {
    const pair = resolveVolcengineBillingPairFromEnv(label)
    if (pair) items.push({ label, ...pair })
  }
  return items
}

export interface VolcengineCashBalance {
  available_balance: number | null
  cash_balance: number | null
  freeze_amount: number | null
  arrears_balance: number | null
  currency: string
  raw?: Record<string, unknown>
}

function sha256Hex(payload: string) {
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

function hmac(key: Buffer | string, data: string) {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function buildQuery(params: Record<string, string>) {
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]!)}`)
    .join('&')
}

function parseMoney(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const n = Number(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

export async function callVolcengineBillingApi(
  accessKeyId: string,
  secretAccessKey: string,
  action: string,
  extraParams: Record<string, string | number | boolean | null | undefined> = {},
  options: { method?: 'GET' | 'POST' } = {},
): Promise<Record<string, unknown>> {
  const ak = String(accessKeyId || '').trim()
  const sk = String(secretAccessKey || '').trim()
  if (!ak || !sk) throw new Error('缺少火山 Access Key / Secret Key')

  const method = options.method || (action === 'QueryBalanceAcct' ? 'GET' : 'POST')
  const amzDate = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const amzDay = amzDate.slice(0, 8)
  const queryParams: Record<string, string> = {
    Action: action,
    Version: BILLING_VERSION,
  }
  const bodyParams: Record<string, string> = {}
  for (const [key, raw] of Object.entries(extraParams)) {
    if (raw == null || raw === '') continue
    const value = String(raw)
    queryParams[key] = value
    if (method === 'POST') bodyParams[key] = value
  }
  const canonicalQuery = buildQuery(queryParams)
  const body = method === 'POST' ? buildQuery(bodyParams) : ''
  const payloadHash = sha256Hex(body)
  const headersToSign: Record<string, string> = {
    host: BILLING_HOST,
    'x-date': amzDate,
  }
  if (method === 'POST') {
    headersToSign['content-type'] = 'application/x-www-form-urlencoded; charset=utf-8'
  }
  const signedHeaderNames = Object.keys(headersToSign).sort()
  const canonicalHeaders = signedHeaderNames
    .map((k) => `${k}:${headersToSign[k]}\n`)
    .join('')
  const signedHeaders = signedHeaderNames.join(';')
  const canonicalRequest = [
    method,
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${amzDay}/${BILLING_REGION}/${BILLING_SERVICE}/request`
  const stringToSign = [
    'HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = hmac(sk, amzDay)
  const kRegion = hmac(kDate, BILLING_REGION)
  const kService = hmac(kRegion, BILLING_SERVICE)
  const kSigning = hmac(kService, 'request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  const authorization = [
    `HMAC-SHA256 Credential=${ak}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ')

  const url = `https://${BILLING_HOST}/?${canonicalQuery}`
  const headers: Record<string, string> = {
    Host: BILLING_HOST,
    'X-Date': amzDate,
    Authorization: authorization,
  }
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=utf-8'
  }
  const resp = await fetch(url, {
    method,
    headers,
    body: method === 'POST' ? body : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const json = await resp.json().catch(() => ({})) as Record<string, any>
  if (!resp.ok) {
    const msg = json?.ResponseMetadata?.Error?.Message
      || json?.ResponseMetadata?.Error?.Code
      || json?.message
      || `HTTP ${resp.status}`
    throw new Error(String(msg))
  }
  const err = json?.ResponseMetadata?.Error
  if (err?.Code || err?.Message) {
    throw new Error(String(err.Message || err.Code || action))
  }
  return (json?.Result || json?.result || {}) as Record<string, unknown>
}

export async function fetchVolcengineAccountBalance(
  accessKeyId: string,
  secretAccessKey: string,
): Promise<VolcengineCashBalance> {
  const result = await callVolcengineBillingApi(accessKeyId, secretAccessKey, 'QueryBalanceAcct')
  return {
    available_balance: parseMoney(result.AvailableBalance ?? result.available_balance),
    cash_balance: parseMoney(result.CashBalance ?? result.cash_balance),
    freeze_amount: parseMoney(result.FreezeAmount ?? result.freeze_amount),
    arrears_balance: parseMoney(result.ArrearsBalance ?? result.arrears_balance),
    currency: 'CNY',
    raw: result,
  }
}

export interface VolcengineBillDetailQuery {
  billPeriod: string
  expenseDate?: string
  product?: string
  /** 0 计费项 · 1 实例 · 2 产品 · 3 账号 */
  groupTerm?: number
  /** 0 账期 · 1 按天 · 2 明细 */
  groupPeriod?: number
  limit?: number
  offset?: number
}

/** ListBillDetail — 分页查询账单明细（需 AK/SK） */
export async function fetchVolcengineBillDetails(
  accessKeyId: string,
  secretAccessKey: string,
  query: VolcengineBillDetailQuery,
) {
  const billPeriod = String(query.billPeriod || '').trim()
  if (!/^\d{4}-\d{2}$/.test(billPeriod)) {
    throw new Error('BillPeriod 须为 YYYY-MM')
  }
  const limit = Math.min(300, Math.max(1, Number(query.limit) || 20))
  const offset = Math.max(0, Number(query.offset) || 0)
  const groupTerm = Number.isFinite(Number(query.groupTerm)) ? Number(query.groupTerm) : 0
  const groupPeriod = Number.isFinite(Number(query.groupPeriod)) ? Number(query.groupPeriod) : 2
  const result = await callVolcengineBillingApi(accessKeyId, secretAccessKey, 'ListBillDetail', {
    BillPeriod: billPeriod,
    ExpenseDate: query.expenseDate || undefined,
    Product: query.product || undefined,
    GroupTerm: groupTerm,
    GroupPeriod: groupPeriod,
    Limit: limit,
    Offset: offset,
    NeedRecordNum: 1,
  })
  const list = Array.isArray(result.List) ? result.List : []
  return {
    items: list,
    total: Number(result.Total ?? list.length),
    limit: Number(result.Limit ?? limit),
    offset: Number(result.Offset ?? offset),
  }
}
