/** 规范化扣子网页 Cookie */

export function extractCozeCookieField(cookie: string, name: string): string {
  const re = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`)
  const m = String(cookie || '').match(re)
  if (!m?.[1]) return ''
  try {
    return decodeURIComponent(m[1].trim())
  } catch {
    return m[1].trim()
  }
}

export function normalizeCozeCookie(raw: string): string {
  let cookie = String(raw || '').trim()
  if (!cookie) return ''
  if (/^cookie\s*:/i.test(cookie)) {
    cookie = cookie.replace(/^cookie\s*:/i, '').trim()
  }
  return cookie.replace(/\s*\n+\s*/g, '; ').replace(/;\s*;/g, ';').replace(/^;\s*|;\s*$/g, '').trim()
}

export function hasCozeLoginCookie(cookie?: string | null): boolean {
  const raw = normalizeCozeCookie(String(cookie || ''))
  if (!raw) return false
  return Boolean(
    extractCozeCookieField(raw, 'sessionid')
    || extractCozeCookieField(raw, 'session_key')
    || extractCozeCookieField(raw, 'i18next')
    || raw.includes('='),
  )
}
