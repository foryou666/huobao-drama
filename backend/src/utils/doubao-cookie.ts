import { DOUBAO_TRAINING_BASE_URL } from '../constants/doubao-training.js'

export function normalizeDoubaoCookie(raw: string): string {
  let cookie = String(raw || '').trim()
  if (/^cookie\s*:/i.test(cookie)) {
    cookie = cookie.replace(/^cookie\s*:/i, '').trim()
  }
  return cookie.replace(/\s*\n+\s*/g, '; ').replace(/;\s*;/g, ';').replace(/^;\s*|;\s*$/g, '')
}

export function extractDoubaoSessionIdFromCookie(cookie: string): string | null {
  const raw = normalizeDoubaoCookie(cookie)
  if (!raw) return null
  const match = raw.match(/(?:^|;\s*)sessionid=([^;]+)/i)
    || raw.match(/(?:^|;\s*)sessionid_ss=([^;]+)/i)
  if (match?.[1]) return decodeURIComponent(match[1].trim())
  if (!raw.includes('=') && raw.length >= 16) return raw
  return null
}

export function extractDoubaoCookieField(cookie: string, name: string): string | null {
  const raw = normalizeDoubaoCookie(cookie)
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`, 'i')
  const match = raw.match(re)
  return match?.[1] ? decodeURIComponent(match[1].trim()) : null
}

export function buildDoubaoCookie(sessionId: string, cookie?: string | null): string {
  if (cookie?.trim()) return normalizeDoubaoCookie(cookie)
  const token = String(sessionId || '').trim()
  return [
    `sessionid=${token}`,
    `sessionid_ss=${token}`,
  ].join('; ')
}

export function parseDoubaoCookiesForBrowser(cookie: string) {
  const normalized = normalizeDoubaoCookie(cookie)
  const host = new URL(DOUBAO_TRAINING_BASE_URL).hostname
  return normalized.split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const idx = part.indexOf('=')
      if (idx <= 0) return null
      const name = part.slice(0, idx).trim()
      const value = part.slice(idx + 1).trim()
      if (!name || !value) return null
      return {
        name,
        value,
        domain: host.startsWith('.') ? host : `.${host.replace(/^www\./, '')}`,
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'Lax' as const,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
}
