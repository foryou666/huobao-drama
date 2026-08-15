/**
 * 火山方舟私域素材库（管控面 OpenAPI）
 * Host: open.volcengineapi.com
 * 鉴权: Access Key / Secret Key（不是 ark- API Key）
 * 调用: POST /?Action=CreateAssetGroup&Version=2024-01-01
 * 文档: https://www.volcengine.com/docs/82379/2318271
 */
import { createHash, createHmac } from 'crypto'

export const VOLC_ARK_ASSET_HOST = 'open.volcengineapi.com'
export const VOLC_ARK_ASSET_REGION = 'cn-beijing'
export const VOLC_ARK_ASSET_SERVICE = 'ark'
export const VOLC_ARK_ASSET_VERSION = '2024-01-01'

export interface VolcArkAssetCredentials {
  accessKeyId: string
  secretAccessKey: string
}

function sha256Hex(payload: string) {
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

function hmacSha256(key: Buffer | string, data: string) {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function buildCanonicalQuery(params: Record<string, string>) {
  return Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]!)}`)
    .join('&')
}

/** 标准火山 OpenAPI 签名（密钥直接用 SK，不加 VolcEngine 前缀） */
function signOpenRequest(
  creds: VolcArkAssetCredentials,
  method: string,
  canonicalQuery: string,
  body: string,
) {
  const amzDate = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const amzDay = amzDate.slice(0, 8)
  const credentialScope = `${amzDay}/${VOLC_ARK_ASSET_REGION}/${VOLC_ARK_ASSET_SERVICE}/request`
  const bodyHash = sha256Hex(body)
  const canonicalHeaders = `host:${VOLC_ARK_ASSET_HOST}\nx-date:${amzDate}\n`
  const signedHeaders = 'host;x-date'
  const canonicalRequest = [
    method,
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n')
  const stringToSign = [
    'HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = hmacSha256(creds.secretAccessKey, amzDay)
  const kRegion = hmacSha256(kDate, VOLC_ARK_ASSET_REGION)
  const kService = hmacSha256(kRegion, VOLC_ARK_ASSET_SERVICE)
  const kSigning = hmacSha256(kService, 'request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  return {
    amzDate,
    authorization: [
      `HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', '),
  }
}

function extractError(json: any): string | null {
  const err = json?.ResponseMetadata?.Error ?? json?.error
  if (!err) return null
  const code = err.Code ?? err.code
  const message = err.Message ?? err.message
  if (!code && !message) return null
  return `${code || 'Error'}: ${message || 'Asset API failed'}`
}

/**
 * POST /?Action={Action}&Version=2024-01-01
 * 如 CreateAssetGroup / CreateAsset / GetAsset / DeleteAsset
 */
export async function volcArkAssetOpenAction(
  creds: VolcArkAssetCredentials,
  action: string,
  body: Record<string, unknown>,
): Promise<any> {
  const ak = String(creds.accessKeyId || '').trim()
  const sk = String(creds.secretAccessKey || '').trim()
  if (!ak || !sk) {
    throw new Error('缺少火山 Access Key / Secret Key（素材入库需管控面 AK/SK，不是 ark- API Key）')
  }

  const actionName = String(action || '').trim()
  if (!/^[A-Za-z0-9]+$/.test(actionName)) throw new Error(`无效素材 Action: ${action}`)

  const canonicalQuery = buildCanonicalQuery({
    Action: actionName,
    Version: VOLC_ARK_ASSET_VERSION,
  })
  const payload = JSON.stringify(body ?? {}, null, 0)
  const { amzDate, authorization } = signOpenRequest(
    { accessKeyId: ak, secretAccessKey: sk },
    'POST',
    canonicalQuery,
    payload,
  )

  const resp = await fetch(`https://${VOLC_ARK_ASSET_HOST}/?${canonicalQuery}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: VOLC_ARK_ASSET_HOST,
      'X-Date': amzDate,
      Authorization: authorization,
    },
    body: payload,
    signal: AbortSignal.timeout(60_000),
  })

  const text = await resp.text()
  let json: any = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`素材 API 非 JSON 响应（HTTP ${resp.status}）：${text.slice(0, 200)}`)
  }

  const apiErr = extractError(json)
  if (apiErr) throw new Error(apiErr)
  if (!resp.ok) {
    throw new Error(`素材 API 失败（HTTP ${resp.status}）：${JSON.stringify(json).slice(0, 300)}`)
  }

  return json.Result ?? json
}
