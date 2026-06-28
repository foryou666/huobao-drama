export function normalizeJimengCookie(raw: string): string {
  let cookie = String(raw || '').trim()
  if (/^cookie\s*:/i.test(cookie)) {
    cookie = cookie.replace(/^cookie\s*:/i, '').trim()
  }
  return cookie.replace(/\s*\n+\s*/g, '; ').replace(/;\s*;/g, ';').replace(/^;\s*|;\s*$/g, '')
}

export function extractJimengCookieField(cookie: string, name: string): string | null {
  const normalized = normalizeJimengCookie(cookie)
  const pattern = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`)
  const match = normalized.match(pattern)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1].trim())
  } catch {
    return match[1].trim()
  }
}

export function parseJimengCookiesForBrowser(cookieString: string) {
  const domain = '.jianying.com'
  return normalizeJimengCookie(cookieString)
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const eq = part.indexOf('=')
      if (eq <= 0) return null
      const name = part.slice(0, eq).trim()
      let value = part.slice(eq + 1).trim()
      try {
        value = decodeURIComponent(value)
      } catch { /* keep raw */ }
      return { name, value, domain, path: '/' }
    })
    .filter((item): item is { name: string; value: string; domain: string; path: string } => !!item?.name)
}
