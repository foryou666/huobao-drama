import { createHash } from 'crypto'
import {
  XYQ_API_PATHS,
  XYQ_BASE_URL,
  XYQ_HOME_URL,
  XYQ_WEB_AID,
  XYQ_WEB_APPVR,
  XYQ_WEB_PF,
  XYQ_WEB_SIGN_VER,
} from '../constants/xyq-web.js'
import { hasXyqLoginCookie, normalizeXyqCookie } from '../utils/xyq-cookie.js'
import type { XyqWebSession } from './xyq-web-session.js'

function authHeaders(session: XyqWebSession, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.accessKey}`,
    Accept: 'application/json',
  }
  if (contentType) headers['Content-Type'] = contentType
  return headers
}

function parseXyqPayload(payload: any, path: string): any {
  const ret = payload?.ret
  if (ret != null && String(ret) !== '0') {
    throw new Error(String(payload?.errmsg || `小云雀 API 错误 ret=${ret} ${path}`))
  }
  return payload?.data ?? payload
}

export async function xyqJsonRequest(
  session: XyqWebSession,
  path: string,
  body: Record<string, unknown>,
): Promise<any> {
  const url = `${XYQ_BASE_URL}${path}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: authHeaders(session, 'application/json'),
    body: JSON.stringify(body || {}),
  })
  const text = await resp.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`小云雀 API 响应非 JSON (${resp.status}) ${path}: ${text.slice(0, 200)}`)
  }
  if (resp.status >= 400) {
    throw new Error(`小云雀 API HTTP ${resp.status} ${path}: ${payload?.errmsg || text.slice(0, 200)}`)
  }
  return parseXyqPayload(payload, path)
}

/** Access Key 是否可用（无效 Key 固定返回「未查询到有效的Ak明细」） */
export async function validateXyqSession(session: XyqWebSession): Promise<boolean> {
  try {
    const url = `${XYQ_BASE_URL}${XYQ_API_PATHS.getThread}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: authHeaders(session, 'application/json'),
      body: JSON.stringify({ thread_id: 'ping', run_id: 'ping', after_seq: 0 }),
    })
    const text = await resp.text()
    let payload: any
    try {
      payload = JSON.parse(text)
    } catch {
      return false
    }
    const errmsg = String(payload?.errmsg || '')
    if (errmsg.includes('未查询到有效的Ak') || errmsg.includes('Ak明细')) return false
    // 有效 Key 常见：thread/run 不存在等业务错误，或 ret=0
    return true
  } catch {
    return false
  }
}

export async function uploadXyqAsset(
  session: XyqWebSession,
  file: { buffer: Buffer; filename: string; mimeType: string },
): Promise<string> {
  const mime = String(file.mimeType || '').toLowerCase()
  const isVideo = mime.startsWith('video/')
  const isImage = mime.startsWith('image/')
  if (!isVideo && !isImage) throw new Error('小云雀仅支持上传图片或视频')

  const assetType = isVideo ? 1 : 2
  const boundary = `----XyqUpload${Date.now().toString(16)}`
  const filename = file.filename || (isVideo ? 'reference.mp4' : 'reference.png')
  const parts: Buffer[] = []
  const push = (s: string | Buffer) => parts.push(typeof s === 'string' ? Buffer.from(s) : s)

  push(`--${boundary}\r\n`)
  push('Content-Disposition: form-data; name="asset_type"\r\n\r\n')
  push(`${assetType}\r\n`)
  push(`--${boundary}\r\n`)
  push(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`)
  push(`Content-Type: ${mime || 'application/octet-stream'}\r\n\r\n`)
  push(file.buffer)
  push(`\r\n--${boundary}--\r\n`)

  const url = `${XYQ_BASE_URL}${XYQ_API_PATHS.uploadFile}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessKey}`,
      Accept: 'application/json',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat(parts),
  })
  const text = await resp.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`小云雀上传响应非 JSON (${resp.status}): ${text.slice(0, 200)}`)
  }
  const data = parseXyqPayload(payload, XYQ_API_PATHS.uploadFile)
  const assetId = String(data?.pippit_asset_id || data?.asset_id || '').trim()
  if (!assetId) throw new Error('小云雀上传未返回 asset_id')
  return assetId
}

export interface XyqSubmitResult {
  threadId: string
  runId: string
  webThreadLink: string
}

export async function submitXyqRun(
  session: XyqWebSession,
  input: { message: string; assetIds?: string[]; threadId?: string },
): Promise<XyqSubmitResult> {
  const body: Record<string, unknown> = {
    message: String(input.message || '').trim(),
  }
  if (input.threadId) body.thread_id = input.threadId
  if (input.assetIds?.length) body.asset_ids = input.assetIds

  const data = await xyqJsonRequest(session, XYQ_API_PATHS.submitRun, body)
  const run = data?.run || {}
  const threadId = String(run.thread_id || data?.thread_id || '').trim()
  const runId = String(run.run_id || data?.run_id || '').trim()
  if (!threadId || !runId) throw new Error('小云雀未返回 thread_id/run_id')

  const webThreadLink = String(data?.web_thread_link || '').trim()
    || `${XYQ_HOME_URL}?tab_name=integrated-agent&thread_id=${encodeURIComponent(threadId)}&agent_name=pippit_nest_agent`

  return { threadId, runId, webThreadLink }
}

function normalizeRunState(value: unknown): 'completed' | 'failed' | 'canceled' | 'requires_action' | 'running' {
  const raw = typeof value === 'number' ? String(value) : String(value || '').trim().toLowerCase()
  if (['3', 'completed', 'complete', 'succeeded', 'success', 'done', 'runstate_completed'].includes(raw)) {
    return 'completed'
  }
  if (['4', 'failed', 'failure', 'error', 'runstate_failed'].includes(raw)) return 'failed'
  if (['5', 'canceled', 'cancelled', 'runstate_canceled'].includes(raw)) return 'canceled'
  if (['9', 'requires_action', 'requires_user_input', 'interaction_required', 'runstate_requires_action'].includes(raw)) {
    return 'requires_action'
  }
  return 'running'
}

function asList(value: unknown): any[] {
  return Array.isArray(value) ? value : []
}

function decodeContentData(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const stripped = value.trim()
  if (!stripped) return value
  if (!(stripped.startsWith('{') || stripped.startsWith('['))) return value
  try {
    return JSON.parse(stripped)
  } catch {
    return value
  }
}

function collectUrls(value: unknown, out: string[], seen: Set<string>) {
  if (!value) return
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && /\.(mp4|mov|webm)(\?|$)/i.test(value) && !seen.has(value)) {
      seen.add(value)
      out.push(value)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, out, seen)
    return
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const keyLower = key.toLowerCase()
      const isUrlKey = keyLower === 'url'
        || keyLower === 'download_url'
        || keyLower.endsWith('_url')
        || keyLower.endsWith('_urls')
      if (isUrlKey && typeof item === 'string' && /^https?:\/\//i.test(item) && !seen.has(item)) {
        seen.add(item)
        out.push(item)
      } else if (isUrlKey && Array.isArray(item)) {
        for (const url of item) {
          if (typeof url === 'string' && /^https?:\/\//i.test(url) && !seen.has(url)) {
            seen.add(url)
            out.push(url)
          }
        }
      } else {
        collectUrls(item, out, seen)
      }
    }
  }
}

function extractEntriesFromRun(run: Record<string, unknown>) {
  const matched: Array<{ id: string; role: string; content: any[] }> = []
  for (const entry of asList(run.entry_list)) {
    const message = (entry as any)?.message
    const artifact = (entry as any)?.artifact
    if (message) {
      matched.push({
        id: String(message.message_id || ''),
        role: String(message.role || ''),
        content: asList(message.content),
      })
    }
    if (artifact) {
      matched.push({
        id: String(artifact.artifact_id || ''),
        role: String(artifact.role || ''),
        content: asList(artifact.content),
      })
    }
  }
  return matched
}

function preferVideoUrl(urls: string[]): string | null {
  const mp4 = urls.find(u => /\.mp4(\?|$)/i.test(u))
  return mp4 || urls[0] || null
}

export async function pollXyqRunOnce(
  session: XyqWebSession,
  threadId: string,
  runId: string,
  afterSeq = 0,
): Promise<{ status: 'completed' | 'failed' | 'canceled' | 'requires_action' | 'running'; videoUrl?: string | null; error?: string }> {
  const data = await xyqJsonRequest(session, XYQ_API_PATHS.getThread, {
    thread_id: threadId,
    run_id: runId,
    after_seq: afterSeq,
  })
  const thread = data?.thread || {}
  const runList = asList(thread.run_list)
  const run = (runList.find((item: any) => String(item?.run_id || '') === runId) || runList[0] || {}) as Record<string, unknown>
  const status = normalizeRunState(run.state)
  const entries = extractEntriesFromRun(run)
  const urls: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (entry.role && entry.role !== 'assistant') continue
    for (const content of entry.content) {
      if (!content || typeof content !== 'object') continue
      const subType = String((content as any).sub_type || (content as any).subtype || '')
      if (subType.includes('upload')) continue
      collectUrls(decodeContentData((content as any).data), urls, seen)
      collectUrls(content, urls, seen)
    }
  }

  if (status === 'completed') {
    return { status, videoUrl: preferVideoUrl(urls) }
  }
  if (status === 'failed') {
    return { status, error: String(run.fail_reason || '小云雀视频生成失败') }
  }
  if (status === 'canceled') {
    return { status, error: '小云雀任务已取消' }
  }
  if (status === 'requires_action') {
    return { status: 'requires_action', error: '小云雀需要人工确认，请在官网会话中处理或调整提示词后重试' }
  }
  // 有时产物先到、状态仍在 running
  const early = preferVideoUrl(urls)
  if (early) return { status: 'completed', videoUrl: early }
  return { status: 'running' }
}

export interface XyqUserCredit {
  giftCredit: number
  /** 小云雀「免费积分 / 每日赠送」等，官网常单独展示；漏计会导致余额比实际少几十 */
  freeCredit: number
  purchaseCredit: number
  vipCredit: number
  totalCredit: number
  /** VIP/包月积分到期（Unix 秒） */
  creditExpireAt: number | null
  creditExpireAtIso: string | null
}

function md5Hex(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

function buildXyqWebSignHeaders(pathname: string): Record<string, string> {
  const deviceTime = Math.floor(Date.now() / 1000)
  const tdid = ''
  const sign = md5Hex(
    `9e2c|${pathname.slice(-7)}|${XYQ_WEB_PF}|${XYQ_WEB_APPVR}|${deviceTime}|${tdid}|11ac`,
  ).toLowerCase()
  return {
    sign,
    'device-time': String(deviceTime),
    'sign-ver': XYQ_WEB_SIGN_VER,
    pf: XYQ_WEB_PF,
    appvr: XYQ_WEB_APPVR,
    appid: XYQ_WEB_AID,
    'entrance-from': 'web',
  }
}

function asFiniteUnixSeconds(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null
  // 毫秒时间戳
  if (n > 1e12) return Math.floor(n / 1000)
  return Math.floor(n)
}

function collectLifeEnds(detail: unknown): number[] {
  if (!detail || typeof detail !== 'object') return []
  const bags = detail as Record<string, unknown>
  const ends: number[] = []
  for (const key of ['vip_credits', 'gift_credits', 'purchase_credits']) {
    const list = bags[key]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const end = asFiniteUnixSeconds((item as Record<string, unknown>)?.credits_life_end)
      if (end) ends.push(end)
    }
  }
  return ends
}

function resolveXyqCreditExpireAtFromDetail(
  creditPayload: Record<string, unknown> | null | undefined,
): number | null {
  const detail = (creditPayload?.credits_detail && typeof creditPayload.credits_detail === 'object')
    ? creditPayload.credits_detail as Record<string, unknown>
    : null
  if (!detail) return null
  const vipEnds: number[] = []
  const vipList = detail.vip_credits
  if (Array.isArray(vipList)) {
    for (const item of vipList) {
      const end = asFiniteUnixSeconds((item as Record<string, unknown>)?.credits_life_end)
      if (end) vipEnds.push(end)
    }
  }
  if (vipEnds.length) return Math.max(...vipEnds)
  const fallback = collectLifeEnds(detail)
  return fallback.length ? Math.max(...fallback) : null
}

function resolveXyqCreditExpireAtFromSubscription(
  subscriptionPayload: Record<string, unknown> | null | undefined,
): number | null {
  const sub = subscriptionPayload || {}
  const candidates = [
    asFiniteUnixSeconds(sub.vip_real_end),
    asFiniteUnixSeconds(sub.next_renewal_time),
    asFiniteUnixSeconds(sub.end_time),
  ].filter((n): n is number => n != null)
  return candidates.length ? Math.max(...candidates) : null
}

/**
 * 小云雀 user_credit 不返回 credits_detail；用「订阅积分」发放记录估算包月周期到期。
 * 官网流水：VIP_GIFT + title「订阅积分」，相邻两次发放间隔约 30 天。
 */
async function estimateXyqVipCreditExpireAt(cookie: string): Promise<number | null> {
  const grantTimes: number[] = []
  let cursor = '0'
  for (let page = 0; page < 12 && grantTimes.length < 2; page++) {
    const data = await xyqCommercePost(cookie, XYQ_API_PATHS.userCreditHistory, {
      count: 20,
      cursor,
      history_type: 1,
    })
    if (!data) break
    const records = Array.isArray(data.records) ? data.records : []
    for (const item of records) {
      const rec = item as Record<string, unknown>
      if (String(rec.trade_source || '') !== 'VIP_GIFT') continue
      if (String(rec.title || '') !== '订阅积分') continue
      const amount = Number(rec.amount || 0)
      const created = asFiniteUnixSeconds(rec.create_time)
      if (!created || !(amount > 0)) continue
      grantTimes.push(created)
      if (grantTimes.length >= 2) break
    }
    if (!data.has_more) break
    const next = String(data.new_cursor ?? '')
    if (!next || next === cursor) break
    cursor = next
  }
  if (!grantTimes.length) return null

  grantTimes.sort((a, b) => b - a)
  const latest = grantTimes[0]
  const prev = grantTimes[1]
  const defaultCycle = 30 * 86400
  const cycle = prev
    ? Math.max(20 * 86400, Math.min(40 * 86400, latest - prev))
    : defaultCycle
  let expireAt = latest + cycle
  const now = Math.floor(Date.now() / 1000)
  // 周期估算落在过去时，按同一周期向前滚动一轮（仍有 VIP 余额时）
  if (expireAt < now) expireAt += cycle
  return expireAt
}

async function xyqCommercePost(
  cookie: string,
  path: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown> | null> {
  const signHeaders = buildXyqWebSignHeaders(path)
  const qs = new URLSearchParams({
    aid: XYQ_WEB_AID,
    device_platform: 'web',
    region: 'cn',
    da_version: XYQ_WEB_APPVR,
  })
  const url = `${XYQ_BASE_URL}${path}?${qs.toString()}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      Cookie: cookie,
      Referer: `${XYQ_HOME_URL}`,
      Origin: XYQ_BASE_URL,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      ...signHeaders,
    },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  let payload: any
  try {
    payload = JSON.parse(text)
  } catch {
    return null
  }
  const ret = payload?.ret
  if (ret != null && String(ret) !== '0') {
    // 偶发仍带 data；尽量向下解析
    const data = payload?.data
    const nested = typeof payload?.response === 'string'
      ? (() => { try { return JSON.parse(payload.response) } catch { return null } })()
      : payload?.response
    if (data && typeof data === 'object') return { ...payload, ...(nested && typeof nested === 'object' ? nested : {}), ...data }
    if (nested && typeof nested === 'object') return nested as Record<string, unknown>
    return null
  }
  const data = payload?.data
  if (data && typeof data === 'object') return data as Record<string, unknown>
  return payload as Record<string, unknown>
}

/**
 * 用网页 Cookie 查询小云雀账号剩余积分与包月到期。
 * Access Key 官方 Skill API 不提供积分查询，必须绑定 Cookie。
 */
export async function getXyqUserCredit(session: XyqWebSession): Promise<XyqUserCredit | null> {
  const cookie = normalizeXyqCookie(String(session.cookie || ''))
  if (!hasXyqLoginCookie(cookie)) return null
  try {
    const creditResult = await xyqCommercePost(cookie, XYQ_API_PATHS.userCredit, {})
    if (!creditResult) return null
    const credit = (creditResult.credit && typeof creditResult.credit === 'object')
      ? creditResult.credit as Record<string, unknown>
      : creditResult
    const gift = Number(credit.gift_credit ?? credit.giftCredit ?? 0)
    const free = Number(credit.free_credits ?? credit.free_credit ?? credit.freeCredit ?? 0)
    const purchase = Number(credit.purchase_credit ?? credit.purchaseCredit ?? 0)
    const vip = Number(credit.vip_credit ?? credit.vipCredit ?? 0)
    if (!Number.isFinite(gift + free + purchase + vip)) return null

    let expireAt = resolveXyqCreditExpireAtFromDetail(creditResult)
    if (!expireAt && vip > 0) {
      try {
        expireAt = await estimateXyqVipCreditExpireAt(cookie)
      } catch {
        expireAt = null
      }
    }
    if (!expireAt) {
      let subscription: Record<string, unknown> | null = null
      try {
        subscription = await xyqCommercePost(cookie, XYQ_API_PATHS.subscriptionUserInfo, {})
      } catch {
        subscription = null
      }
      expireAt = resolveXyqCreditExpireAtFromSubscription(subscription)
    }

    return {
      giftCredit: gift,
      freeCredit: free,
      purchaseCredit: purchase,
      vipCredit: vip,
      totalCredit: gift + free + purchase + vip,
      creditExpireAt: expireAt,
      creditExpireAtIso: expireAt ? new Date(expireAt * 1000).toISOString() : null,
    }
  } catch {
    return null
  }
}

export function encodeXyqTaskId(threadId: string, runId: string): string {
  return `${threadId}|${runId}`
}

export function decodeXyqTaskId(taskId?: string | null): { threadId: string; runId: string } | null {
  const raw = String(taskId || '').trim()
  if (!raw || !raw.includes('|')) return null
  const idx = raw.indexOf('|')
  const threadId = raw.slice(0, idx).trim()
  const runId = raw.slice(idx + 1).trim()
  if (!threadId || !runId) return null
  return { threadId, runId }
}
