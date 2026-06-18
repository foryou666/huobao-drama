import { getAppMeta, setAppMeta } from '../db/index.js'

export const JIMENG_SESSION_META_KEY = 'jimeng_web_session'

export interface JimengWebSession {
  sessionId: string
  cookie?: string | null
  label?: string | null
  updatedAt: string
}

function parseStored(raw: string | null): JimengWebSession | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw)
    const sessionId = String(parsed.sessionId || parsed.session_id || '').trim()
    if (!sessionId) return null
    return {
      sessionId,
      cookie: parsed.cookie ? String(parsed.cookie) : null,
      label: parsed.label ? String(parsed.label) : null,
      updatedAt: String(parsed.updatedAt || parsed.updated_at || ''),
    }
  } catch {
    const trimmed = raw.trim()
    if (!trimmed) return null
    return {
      sessionId: trimmed,
      cookie: null,
      label: null,
      updatedAt: '',
    }
  }
}

export function extractSessionIdFromCookie(cookie: string): string | null {
  const raw = String(cookie || '').trim()
  if (!raw) return null
  const match = raw.match(/(?:^|;\s*)sessionid=([^;]+)/i)
    || raw.match(/(?:^|;\s*)sessionid_ss=([^;]+)/i)
  if (match?.[1]) return decodeURIComponent(match[1].trim())
  if (!raw.includes('=') && raw.length >= 16) return raw
  return null
}

export function getJimengWebSession(): JimengWebSession | null {
  return parseStored(getAppMeta(JIMENG_SESSION_META_KEY))
}

export function setJimengWebSession(input: {
  session_id?: string
  sessionId?: string
  cookie?: string
  label?: string
}): JimengWebSession {
  const cookie = String(input.cookie || '').trim()
  const sessionId = String(input.session_id || input.sessionId || '').trim()
    || (cookie ? extractSessionIdFromCookie(cookie) : '')
  if (!sessionId) throw new Error('请提供 sessionid 或完整 Cookie')

  const next: JimengWebSession = {
    sessionId,
    cookie: cookie || null,
    label: input.label ? String(input.label).trim() : null,
    updatedAt: new Date().toISOString(),
  }
  setAppMeta(JIMENG_SESSION_META_KEY, JSON.stringify(next))
  return next
}

export function clearJimengWebSession(): void {
  setAppMeta(JIMENG_SESSION_META_KEY, '')
}

export function hasJimengWebSession(): boolean {
  return !!getJimengWebSession()?.sessionId
}

export function maskJimengSessionId(sessionId: string): string {
  const raw = String(sessionId || '').trim()
  if (raw.length <= 8) return '****'
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`
}
