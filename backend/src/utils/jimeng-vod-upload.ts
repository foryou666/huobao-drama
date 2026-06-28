import { createHash, createHmac, randomBytes } from 'crypto'
import type { JimengUploadCredentials } from './jimeng-imagex-upload.js'

const VOD_HOST = 'https://vod.bytedanceapi.com'
const VOD_REGION = 'cn-north-1'
const VOD_SERVICE = 'vod'
const JIMENG_ORIGIN = 'https://jimeng.jianying.com'
const JIMENG_REFERER = 'https://jimeng.jianying.com/ai-tool/generate?type=video'

export interface JimengVodUploadResult {
  vid: string
  width: number
  height: number
  durationMs: number
  fps: number
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

function amzTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function createVodSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  accessKeyId: string,
  secretAccessKey: string,
  payload = '',
): string {
  const urlObj = new URL(url)
  const timestamp = headers['x-amz-date']
  const date = timestamp.slice(0, 8)

  const queryParams: Array<[string, string]> = []
  urlObj.searchParams.forEach((value, key) => {
    queryParams.push([key, value])
  })
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const canonicalQueryString = queryParams.map(([k, v]) => `${k}=${v}`).join('&')

  const headersToSign: Record<string, string> = { 'x-amz-date': timestamp }
  if (headers['x-amz-security-token']) {
    headersToSign['x-amz-security-token'] = headers['x-amz-security-token']
  }

  let payloadHash = createHash('sha256').update('').digest('hex')
  if (method.toUpperCase() === 'POST' && payload) {
    payloadHash = createHash('sha256').update(payload, 'utf8').digest('hex')
    headersToSign['x-amz-content-sha256'] = payloadHash
  }

  const signedHeaders = Object.keys(headersToSign).map(k => k.toLowerCase()).sort().join(';')
  const canonicalHeaders = Object.keys(headersToSign)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(key => `${key.toLowerCase()}:${headersToSign[key]!.trim()}\n`)
    .join('')

  const canonicalRequest = [
    method.toUpperCase(),
    urlObj.pathname || '/',
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${date}/${VOD_REGION}/${VOD_SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    credentialScope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n')

  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(date).digest()
  const kRegion = createHmac('sha256', kDate).update(VOD_REGION).digest()
  const kService = createHmac('sha256', kRegion).update(VOD_SERVICE).digest()
  const signingKey = createHmac('sha256', kService).update('aws4_request').digest()
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

function parseAudioDurationMs(buffer: Buffer): number {
  if (buffer.length >= 44 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') {
    const byteRate = buffer.readUInt32LE(28)
    if (byteRate > 0) return Math.round((buffer.length - 44) / byteRate * 1000)
  }
  return Math.round(buffer.length / (128 * 1000 / 8) * 1000)
}

async function parseJsonResponse(resp: Response, step: string): Promise<any> {
  const text = await resp.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`即梦 VOD 上传 ${step} 响应非 JSON (${resp.status}): ${text.slice(0, 200)}`)
  }
  if (!resp.ok) {
    throw new Error(`即梦 VOD 上传 ${step} HTTP ${resp.status}: ${text.slice(0, 200)}`)
  }
  return payload
}

/** 通过 ByteDance VOD 上传视频/音频，返回 vid 与元信息 */
export async function uploadJimengMediaViaVod(
  auth: JimengUploadCredentials & { space_name?: string },
  buffer: Buffer,
  mediaType: 'video' | 'audio',
): Promise<JimengVodUploadResult> {
  const label = mediaType === 'audio' ? '音频' : '视频'
  const spaceName = auth.space_name || 'dreamina'
  const fileSize = buffer.length

  const timestamp = amzTimestamp()
  const randomStr = randomBytes(6).toString('hex').slice(0, 10)
  const applyUrl = `${VOD_HOST}/?Action=ApplyUploadInner&Version=2020-11-19&SpaceName=${spaceName}&FileType=video&IsInner=1&FileSize=${fileSize}&s=${randomStr}`

  const applyHeaders = {
    'x-amz-date': timestamp,
    'x-amz-security-token': auth.session_token,
  }
  const applyAuth = createVodSignature('GET', applyUrl, applyHeaders, auth.access_key_id, auth.secret_access_key)

  const applyResp = await fetch(applyUrl, {
    method: 'GET',
    headers: {
      accept: '*/*',
      authorization: applyAuth,
      origin: JIMENG_ORIGIN,
      referer: JIMENG_REFERER,
      'x-amz-date': timestamp,
      'x-amz-security-token': auth.session_token,
    },
  })
  const applyResult = await parseJsonResponse(applyResp, `申请${label}上传`)
  if (applyResult?.ResponseMetadata?.Error) {
    throw new Error(`申请${label}上传失败: ${JSON.stringify(applyResult.ResponseMetadata.Error)}`)
  }

  const uploadNode = applyResult?.Result?.InnerUploadAddress?.UploadNodes?.[0]
  const storeInfo = uploadNode?.StoreInfos?.[0]
  if (!uploadNode?.UploadHost || !storeInfo?.StoreUri || !storeInfo?.Auth || !uploadNode?.SessionKey) {
    throw new Error(`获取${label}上传节点失败`)
  }

  const uploadUrl = `https://${uploadNode.UploadHost}/upload/v1/${storeInfo.StoreUri}`
  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: storeInfo.Auth,
      'Content-Crc32': crc32Hex(buffer),
      'Content-Type': 'application/octet-stream',
      Origin: JIMENG_ORIGIN,
      Referer: JIMENG_REFERER,
    },
    body: new Uint8Array(buffer),
  })
  const uploadResult = await parseJsonResponse(uploadResp, `上传${label}`)
  if (uploadResult?.code != null && Number(uploadResult.code) !== 2000) {
    throw new Error(`${label}上传失败: ${uploadResult.message || uploadResult.code}`)
  }

  const commitUrl = `${VOD_HOST}/?Action=CommitUploadInner&Version=2020-11-19&SpaceName=${spaceName}`
  const commitTimestamp = amzTimestamp()
  const commitPayload = JSON.stringify({ SessionKey: uploadNode.SessionKey, Functions: [] })
  const commitHeaders = {
    'x-amz-date': commitTimestamp,
    'x-amz-security-token': auth.session_token,
    'x-amz-content-sha256': createHash('sha256').update(commitPayload, 'utf8').digest('hex'),
  }
  const commitAuth = createVodSignature(
    'POST',
    commitUrl,
    commitHeaders,
    auth.access_key_id,
    auth.secret_access_key,
    commitPayload,
  )

  const commitResp = await fetch(commitUrl, {
    method: 'POST',
    headers: {
      accept: '*/*',
      authorization: commitAuth,
      'content-type': 'application/json',
      origin: JIMENG_ORIGIN,
      referer: JIMENG_REFERER,
      'x-amz-date': commitTimestamp,
      'x-amz-security-token': auth.session_token,
      'x-amz-content-sha256': commitHeaders['x-amz-content-sha256'],
    },
    body: commitPayload,
  })
  const commitResult = await parseJsonResponse(commitResp, `提交${label}上传`)
  if (commitResult?.ResponseMetadata?.Error) {
    throw new Error(`提交${label}上传失败: ${JSON.stringify(commitResult.ResponseMetadata.Error)}`)
  }

  const result = commitResult?.Result?.Results?.[0]
  if (!result?.Vid) throw new Error(`提交${label}上传未返回 Vid`)

  const videoMeta = result.VideoMeta || {}
  let durationMs = videoMeta.Duration ? Math.round(Number(videoMeta.Duration) * 1000) : 0
  if (durationMs <= 0 && mediaType === 'audio') {
    durationMs = parseAudioDurationMs(buffer)
  }

  if (mediaType === 'video' && videoMeta.Duration && Number(videoMeta.Duration) > 15) {
    throw new Error(`参考视频时长 ${Number(videoMeta.Duration).toFixed(1)}s 超过 15 秒上限`)
  }

  return {
    vid: String(result.Vid),
    width: Number(videoMeta.Width || 0),
    height: Number(videoMeta.Height || 0),
    durationMs,
    fps: Number(videoMeta.Fps || 0),
  }
}
