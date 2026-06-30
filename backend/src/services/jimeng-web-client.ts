import { createHash } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import {
  JIMENG_ASSISTANT_ID,
  JIMENG_BASE_URL,
  JIMENG_PLATFORM_CODE,
  JIMENG_VERSION_CODE,
} from '../constants/jimeng-web.js'
import type { JimengWebSession } from './jimeng-web-session.js'
import { uploadJimengImageViaImagex, type JimengUploadCredentials } from '../utils/jimeng-imagex-upload.js'
import { uploadJimengMediaViaVod } from '../utils/jimeng-vod-upload.js'

const FALLBACK_WEB_ID = String(Math.floor(Math.random() * 9e15) + 7e15)
const FALLBACK_USER_ID = uuidv4().replace(/-/g, '')

import { normalizeJimengCookie, extractJimengCookieField } from '../utils/jimeng-cookie.js'

export { normalizeJimengCookie, extractJimengCookieField } from '../utils/jimeng-cookie.js'

function resolveJimengWebId(session: JimengWebSession): string {
  const cookie = session.cookie?.trim()
  if (cookie) {
    return extractJimengCookieField(cookie, '_tea_web_id')
      || extractJimengCookieField(cookie, '_v2_spipe_web_id')
      || FALLBACK_WEB_ID
  }
  return FALLBACK_WEB_ID
}

const WEB_ID = FALLBACK_WEB_ID
const USER_ID = FALLBACK_USER_ID

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
  if (session.cookie?.trim()) return normalizeJimengCookie(session.cookie)
  const token = session.sessionId
  const ts = unixTimestamp()
  const webId = resolveJimengWebId(session)
  return [
    `_tea_web_id=${webId}`,
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

function buildDefaultParams(webId: string, extra?: Record<string, unknown>) {
  return {
    aid: JIMENG_ASSISTANT_ID,
    device_platform: 'web',
    region: 'cn',
    webId,
    da_version: '3.3.9',
    os: 'windows',
    web_component_open_flag: 1,
    web_version: '7.5.0',
    aigc_features: 'app_lip_sync',
    ...(extra || {}),
  }
}

function buildJimengRequestContext(
  session: JimengWebSession,
  uri: string,
  options: JimengRequestOptions = {},
) {
  const deviceTime = unixTimestamp()
  const sign = buildSign(uri, deviceTime)
  const webId = resolveJimengWebId(session)
  const params = options.noDefaultParams
    ? (options.params || {})
    : buildDefaultParams(webId, options.params)
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
  return { url, headers, body: options.data != null ? JSON.stringify(options.data) : undefined }
}

function normalizeJimengApiErrorMessage(errmsg: string): string {
  const raw = String(errmsg || '').trim()
  if (raw.includes('需要安全确认')) {
    return '即梦返回「需要安全确认」：全能参考 + 参考图（尤其含人脸角色图）在即梦 Web 端需页面内人工确认，API 无法代点。建议：① 改选 Seedance 2.0 VIP 再试；② 减少真人脸参考，改用场景/站位图或插画风格立绘'
  }
  return raw
}

function parseJimengResponsePayload(payload: any, uri: string, httpStatus = 200): unknown {
  if (httpStatus >= 400) {
    throw new Error(`即梦 API HTTP ${httpStatus} ${uri}: ${payload?.errmsg || JSON.stringify(payload).slice(0, 200)}`)
  }
  const ret = payload?.ret
  if (ret != null && String(ret) !== '0') {
    const errmsg = normalizeJimengApiErrorMessage(String(payload?.errmsg || `即梦 API 错误 ret=${ret}`))
    throw new Error(errmsg)
  }
  return payload?.data ?? payload
}

export async function jimengRequest<T = unknown>(
  session: JimengWebSession,
  method: string,
  uri: string,
  options: JimengRequestOptions = {},
): Promise<T> {
  const { url, headers, body } = buildJimengRequestContext(session, uri, options)

  const resp = await fetch(url, {
    method: method.toUpperCase(),
    headers,
    body,
  })

  const text = await resp.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`即梦 API 响应非 JSON (${resp.status}) ${uri}: ${text.slice(0, 200)}`)
  }

  return parseJimengResponsePayload(payload, uri, resp.status) as T
}

/** Seedance generate 需浏览器 bdms 注入 msToken/a_bogus */
export async function jimengBrowserGenerateRequest<T = unknown>(
  session: JimengWebSession,
  uri: string,
  options: JimengRequestOptions = {},
): Promise<T> {
  const { jimengBrowserService } = await import('./jimeng-browser-service.js')
  const { url, headers, body } = buildJimengRequestContext(session, uri, options)
  const browserHeaders = { ...headers }
  delete browserHeaders.Cookie
  delete browserHeaders['Accept-Encoding']
  const payload = await jimengBrowserService.fetch(session, url, {
    method: 'POST',
    headers: browserHeaders,
    body,
  })
  return parseJimengResponsePayload(payload, uri) as T
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

export async function getJimengUploadCredentials(session: JimengWebSession, scene: 1 | 2): Promise<JimengUploadCredentials & { space_name?: string }> {
  const auth = await jimengRequest<JimengUploadCredentials & { space_name?: string }>(session, 'POST', '/mweb/v1/get_upload_token', {
    data: { scene },
  })

  const accessKeyId = auth?.access_key_id || (auth as any)?.accessKeyId
  const secretAccessKey = auth?.secret_access_key || (auth as any)?.secretAccessKey
  const sessionToken = auth?.session_token || (auth as any)?.sessionToken
  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw new Error('即梦上传凭证无效，请检查 Session 是否有效')
  }

  return {
    access_key_id: String(accessKeyId),
    secret_access_key: String(secretAccessKey),
    session_token: String(sessionToken),
    space_name: auth?.space_name || (auth as any)?.spaceName,
  }
}

export async function uploadJimengImage(
  session: JimengWebSession,
  buffer: Buffer,
  _filename: string,
): Promise<string> {
  const auth = await getJimengUploadCredentials(session, 2)
  const uri = await uploadJimengImageViaImagex(auth, buffer)
  await checkJimengImageContent(session, uri)
  return uri
}

export async function uploadJimengMedia(
  session: JimengWebSession,
  buffer: Buffer,
  mediaType: 'video' | 'audio',
) {
  const auth = await getJimengUploadCredentials(session, 1)
  return uploadJimengMediaViaVod(auth, buffer, mediaType)
}

/** 国内站上传参考图后需走 algo_proxy 人脸/IP 安全确认，否则 generate 会报「需要安全确认」 */
export async function checkJimengImageContent(session: JimengWebSession, imageUri: string): Promise<void> {
  const uri = String(imageUri || '').trim()
  if (!uri) return

  const babiParam = JSON.stringify({
    scenario: 'image_video_generation',
    feature_key: 'aigc_to_image',
    feature_entrance: 'to-generate',
    feature_entrance_detail: 'to-generate-algo_proxy',
  })

  try {
    await jimengRequest(session, 'POST', '/mweb/v1/algo_proxy', {
      params: { babi_param: babiParam },
      data: {
        scene: 'image_face_ip',
        options: { ip_check: true },
        req_key: 'benchmark_test_user_upload_image_input',
        file_list: [{ file_uri: uri }],
        req_params: {},
      },
    })
  } catch (err: any) {
    const message = String(err?.message || err || '')
    const isContentViolation = message.includes('2003')
      || /risk not pass/i.test(message)
      || /detected risk/i.test(message)
      || /违规|不合规|未通过/.test(message)
    if (isContentViolation) {
      throw new Error('参考图内容检测未通过，请更换图片后重试')
    }
    // 检测服务异常不阻塞生成，与 jimeng-api 一致
  }
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
    const raw = String(historyData.fail_starling_message || historyData.fail_msg || '即梦视频生成失败').trim()
    const failCode = String(historyData.fail_code || '').trim()
    let error = raw
    if (raw === 'Param' || failCode === '1001') {
      error = '即梦参数校验失败（Param）：常见原因包括参考音频总时长超过 15 秒、参考素材数量/格式不符或提示词过长，请检查后重试'
    } else if (raw === 'SystemBusy') {
      error = '即梦服务繁忙，请稍后重试'
    }
    return { status: 'failed', error }
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
