import { createHash } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import {
  JIMENG_ASSISTANT_ID,
  JIMENG_BASE_URL,
  JIMENG_PLATFORM_CODE,
  JIMENG_VERSION_CODE,
} from '../constants/jimeng-web.js'
import type { JimengWebSession } from './jimeng-web-session.js'

const WEB_ID = String(Math.floor(Math.random() * 9e15) + 7e15)
const USER_ID = uuidv4().replace(/-/g, '')

const FAKE_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-language': 'zh-CN,zh;q=0.9',
  'Cache-control': 'no-cache',
  Appvr: JIMENG_VERSION_CODE,
  Pragma: 'no-cache',
  Priority: 'u=1, i',
  Pf: JIMENG_PLATFORM_CODE,
  'Sec-Ch-Ua': '"Google Chrome";v="142", "Chromium";v="142", "Not_A Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
}

function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000)
}

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

function buildSign(uri: string, deviceTime: number): string {
  return md5(`9e2c|${uri.slice(-7)}|${JIMENG_PLATFORM_CODE}|${JIMENG_VERSION_CODE}|${deviceTime}||11ac`)
}

export function buildJimengCookie(session: JimengWebSession): string {
  if (session.cookie?.trim()) return session.cookie.trim()
  const token = session.sessionId
  const ts = unixTimestamp()
  return [
    `_tea_web_id=${WEB_ID}`,
    'is_staff_user=false',
    `sid_guard=${token}%7C${ts}%7C5184000%7CMon%2C+03-Feb-2025+08%3A17%3A09+GMT`,
    `uid_tt=${USER_ID}`,
    `uid_tt_ss=${USER_ID}`,
    `sid_tt=${token}`,
    `sessionid=${token}`,
    `sessionid_ss=${token}`,
  ].join('; ')
}

export interface JimengRequestOptions {
  method?: string
  params?: Record<string, unknown>
  data?: unknown
  headers?: Record<string, string>
  noDefaultParams?: boolean
}

function buildDefaultParams(extra?: Record<string, unknown>) {
  return {
    aid: JIMENG_ASSISTANT_ID,
    device_platform: 'web',
    region: 'cn',
    webId: WEB_ID,
    da_version: '3.3.9',
    os: 'windows',
    web_component_open_flag: 1,
    web_version: '7.5.0',
    aigc_features: 'app_lip_sync',
    ...(extra || {}),
  }
}

export async function jimengRequest<T = unknown>(
  session: JimengWebSession,
  method: string,
  uri: string,
  options: JimengRequestOptions = {},
): Promise<T> {
  const deviceTime = unixTimestamp()
  const sign = buildSign(uri, deviceTime)
  const params = options.noDefaultParams
    ? (options.params || {})
    : buildDefaultParams(options.params)
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    query.set(key, String(value))
  }
  const url = `${JIMENG_BASE_URL}${uri}${query.size ? `?${query.toString()}` : ''}`

  const headers: Record<string, string> = {
    ...FAKE_HEADERS,
    Origin: JIMENG_BASE_URL,
    Referer: `${JIMENG_BASE_URL}/`,
    'App-Sdk-Version': '48.0.0',
    Appid: String(JIMENG_ASSISTANT_ID),
    Cookie: buildJimengCookie(session),
    'Device-Time': String(deviceTime),
    Lan: 'zh-Hans',
    Loc: 'cn',
    Sign: sign,
    'Sign-Ver': '1',
    Tdid: '',
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  const resp = await fetch(url, {
    method: method.toUpperCase(),
    headers,
    body: options.data != null ? JSON.stringify(options.data) : undefined,
  })

  const text = await resp.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`即梦 API 响应非 JSON (${resp.status}): ${text.slice(0, 200)}`)
  }

  if (!resp.ok) {
    throw new Error(`即梦 API HTTP ${resp.status}: ${payload?.errmsg || text.slice(0, 200)}`)
  }

  const ret = payload?.ret
  if (ret != null && String(ret) !== '0') {
    throw new Error(String(payload?.errmsg || `即梦 API 错误 ret=${ret}`))
  }

  return (payload?.data ?? payload) as T
}

export async function validateJimengSession(session: JimengWebSession): Promise<boolean> {
  try {
    const result = await jimengRequest<{ user_id?: string | number }>(session, 'POST', '/passport/account/info/v2', {
      params: { account_sdk_source: 'web' },
      data: {},
    })
    return !!result?.user_id
  } catch {
    return false
  }
}

export async function uploadJimengImage(
  session: JimengWebSession,
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const proofResult = await jimengRequest<{
    proof_info?: {
      headers?: Record<string, string>
      query_params?: Record<string, string>
      image_uri?: string
    }
  }>(session, 'POST', '/mweb/v1/get_upload_image_proof', {
    data: {
      scene: 'aigc_image',
      file_name: filename,
      file_size: buffer.length,
    },
  })

  const proof = proofResult?.proof_info
  if (!proof?.image_uri) throw new Error('即梦图片上传凭证无效')

  const form = new FormData()
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' })
  form.append('file', blob, filename)

  const uploadUrl = new URL('https://imagex.bytedanceapi.com/')
  if (proof.query_params) {
    for (const [key, value] of Object.entries(proof.query_params)) {
      uploadUrl.searchParams.set(key, String(value))
    }
  }

  const uploadResp = await fetch(uploadUrl.toString(), {
    method: 'POST',
    headers: proof.headers || {},
    body: form,
  })
  if (!uploadResp.ok) {
    const errText = await uploadResp.text()
    throw new Error(`即梦图片上传失败 (${uploadResp.status}): ${errText.slice(0, 200)}`)
  }

  return proof.image_uri
}

export function extractJimengVideoUrl(item: any): string | null {
  if (!item || typeof item !== 'object') return null
  return item?.common_attr?.transcoded_video?.origin?.video_url
    || item?.video?.transcoded_video?.origin?.video_url
    || item?.video?.play_url
    || item?.video?.download_url
    || item?.video?.url
    || null
}

export function parseJimengHistoryStatus(historyData: any): {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
} {
  if (!historyData) return { status: 'processing' }

  const code = Number(historyData.status)
  const itemList = Array.isArray(historyData.item_list) ? historyData.item_list : []

  if (code === 30) {
    return {
      status: 'failed',
      error: String(historyData.fail_starling_message || historyData.fail_msg || '即梦视频生成失败'),
    }
  }

  if (code === 10 || code === 50) {
    const videoUrl = itemList.length ? extractJimengVideoUrl(itemList[0]) : null
    if (videoUrl) return { status: 'completed', videoUrl }
  }

  if (itemList.length) {
    const videoUrl = extractJimengVideoUrl(itemList[0])
    if (videoUrl) return { status: 'completed', videoUrl }
  }

  if (code === 20 || code === 42 || code === 45) return { status: 'processing' }
  return { status: 'processing' }
}
