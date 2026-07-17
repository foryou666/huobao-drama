/** 规范化小云雀网页 Cookie，供 commerce 积分查询使用 */

export function extractXyqCookieField(cookie: string, name: string): string {
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`)
  const m = String(cookie || '').match(re)
  return m ? decodeURIComponent(m[1].trim()) : ''
}

export function normalizeXyqCookie(raw: string): string {
  let cookie = String(raw || '').trim()
  if (!cookie) return ''
  // 允许只贴 token / sessionid=xxx
  if (!cookie.includes('=') && cookie.length >= 16) {
    cookie = [
      `sessionid=${cookie}`,
      `sessionid_ss=${cookie}`,
      `sid_tt=${cookie}`,
      `sessionid_pippitcn_web=${cookie}`,
    ].join('; ')
  }
  return cookie.replace(/\r?\n/g, ' ').replace(/;\s*;/g, '; ').trim()
}

export function hasXyqLoginCookie(cookie?: string | null): boolean {
  const raw = String(cookie || '').trim()
  if (!raw) return false
  return Boolean(
    extractXyqCookieField(raw, 'sessionid')
    || extractXyqCookieField(raw, 'sessionid_ss')
    || extractXyqCookieField(raw, 'sid_tt')
    || extractXyqCookieField(raw, 'sessionid_pippitcn_web'),
  )
}
