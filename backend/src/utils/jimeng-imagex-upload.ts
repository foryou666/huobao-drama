import { createHash, createHmac } from 'crypto'

const IMAGEX_BASE = 'https://imagex.bytedanceapi.com/'
const IMAGEX_SERVICE_ID = 'tb4s082cfz'
const IMAGEX_REGION = 'cn-north-1'
const IMAGEX_SERVICE = 'imagex'

export interface JimengUploadCredentials {
  access_key_id: string
  secret_access_key: string
  session_token: string
}

function randomString(length: number): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function httpBuildQuery(params: Record<string, unknown>): string {
  return Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&')
}

function buildCanonicalHeaders(headers: Record<string, string>): string {
  return Object.keys(headers)
    .sort()
    .map(key => `${key.toLowerCase()}:${headers[key]}`)
    .join('\n') + '\n'
}

function buildSignedHeaders(headers: Record<string, string>): string {
  return Object.keys(headers).map(k => k.toLowerCase()).sort().join(';')
}

function generateAuthorization(
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string,
  method: string,
  params: Record<string, unknown>,
  data?: Record<string, unknown>,
): { headers: Record<string, string>; query: string } {
  const amzDate = new Date().toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const amzDay = amzDate.slice(0, 8)
  const bodyHash = data && Object.keys(data).length
    ? createHash('sha256').update(JSON.stringify(data)).digest('hex')
    : createHash('sha256').update('').digest('hex')

  const requestHeaders: Record<string, string> = {
    'x-amz-date': amzDate,
    'x-amz-security-token': sessionToken,
  }
  if (data && Object.keys(data).length) {
    requestHeaders['x-amz-content-sha256'] = bodyHash
  }

  const canonicalQueryString = httpBuildQuery(params)
  const canonicalHeaders = buildCanonicalHeaders(requestHeaders)
  const signedHeaders = buildSignedHeaders(requestHeaders)
  const canonicalRequest = [
    method.toUpperCase(),
    '/',
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join('\n')

  const credentialScope = `${amzDay}/${IMAGEX_REGION}/${IMAGEX_SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(amzDay).digest()
  const kRegion = createHmac('sha256', kDate).update(IMAGEX_REGION).digest()
  const kService = createHmac('sha256', kRegion).update(IMAGEX_SERVICE).digest()
  const signingKey = createHmac('sha256', kService).update('aws4_request').digest()
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ')

  return {
    query: canonicalQueryString,
    headers: {
      Authorization: authorization,
      'X-Amz-Date': amzDate,
      'X-Amz-Security-Token': sessionToken,
      'X-Amz-Content-Sha256': bodyHash,
    },
  }
}

function crc32Hex(buffer: Buffer): string {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i]!
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

async function parseJsonResponse(resp: Response, step: string): Promise<any> {
  const text = await resp.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`即梦图片上传 ${step} 响应非 JSON (${resp.status}): ${text.slice(0, 200)}`)
  }
  if (!resp.ok) {
    throw new Error(`即梦图片上传 ${step} HTTP ${resp.status}: ${payload?.message || payload?.errmsg || text.slice(0, 200)}`)
  }
  return payload
}

/** 通过 ImageX 四步流程上传图片，返回 image_uri */
export async function uploadJimengImageViaImagex(
  auth: JimengUploadCredentials,
  buffer: Buffer,
): Promise<string> {
  const applyParams = {
    Action: 'ApplyImageUpload',
    FileSize: buffer.length,
    ServiceId: IMAGEX_SERVICE_ID,
    Version: '2018-08-01',
    s: randomString(11),
  }
  const applySigned = generateAuthorization(
    auth.access_key_id,
    auth.secret_access_key,
    auth.session_token,
    'GET',
    applyParams,
  )

  const applyResp = await fetch(`${IMAGEX_BASE}?${applySigned.query}`, {
    method: 'GET',
    headers: applySigned.headers,
  })
  const applyResult = await parseJsonResponse(applyResp, 'ApplyImageUpload')
  if (applyResult?.Response?.Error) {
    throw new Error(`即梦图片上传 ApplyImageUpload 失败: ${applyResult.Response.Error.Message || '未知错误'}`)
  }

  const uploadAddress = applyResult?.Result?.UploadAddress
  const storeInfo = uploadAddress?.StoreInfos?.[0]
  const uploadHost = uploadAddress?.UploadHosts?.[0]
  if (!storeInfo?.StoreUri || !storeInfo?.Auth || !uploadHost) {
    throw new Error('即梦图片上传凭证结构无效')
  }

  const uploadUrl = `https://${uploadHost}/upload/v1/${storeInfo.StoreUri}`
  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: storeInfo.Auth,
      'Content-Crc32': crc32Hex(buffer),
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(buffer),
  })
  const uploadResult = await parseJsonResponse(uploadResp, '上传数据')
  if (uploadResult?.code != null && Number(uploadResult.code) !== 2000) {
    throw new Error(`即梦图片上传失败: ${uploadResult.message || uploadResult.code}`)
  }

  const commitParams = {
    Action: 'CommitImageUpload',
    ServiceId: IMAGEX_SERVICE_ID,
    Version: '2018-08-01',
  }
  const commitBody = { SessionKey: uploadAddress.SessionKey }
  const commitSigned = generateAuthorization(
    auth.access_key_id,
    auth.secret_access_key,
    auth.session_token,
    'POST',
    commitParams,
    commitBody,
  )

  const commitResp = await fetch(`${IMAGEX_BASE}?${commitSigned.query}`, {
    method: 'POST',
    headers: {
      ...commitSigned.headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commitBody),
  })
  const commitResult = await parseJsonResponse(commitResp, 'CommitImageUpload')
  if (commitResult?.Response?.Error) {
    throw new Error(`即梦图片提交失败: ${commitResult.Response.Error.Message || '未知错误'}`)
  }

  const uri = commitResult?.Result?.PluginResult?.[0]?.ImageUri
  if (!uri) throw new Error('即梦图片上传未返回 ImageUri')
  return String(uri)
}
