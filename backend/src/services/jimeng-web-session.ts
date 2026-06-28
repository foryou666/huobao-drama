import { randomUUID } from 'crypto'
import { getAppMeta, setAppMeta } from '../db/index.js'

export const JIMENG_SESSION_META_KEY = 'jimeng_web_session'

export interface JimengWebSession {
  id: string
  sessionId: string
  cookie?: string | null
  label?: string | null
  updatedAt: string
}

interface JimengSessionStore {
  activeId: string | null
  sessions: JimengWebSession[]
}

function normalizeCookieInput(raw: string): string {
  let cookie = String(raw || '').trim()
  if (/^cookie\s*:/i.test(cookie)) {
    cookie = cookie.replace(/^cookie\s*:/i, '').trim()
  }
  return cookie.replace(/\s*\n+\s*/g, '; ').replace(/;\s*;/g, ';').replace(/^;\s*|;\s*$/g, '')
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

function parseLegacySession(raw: string): JimengWebSession | null {
  try {
    const parsed = JSON.parse(raw)
    const sessionId = String(parsed.sessionId || parsed.session_id || '').trim()
    if (!sessionId) return null
    return {
      id: randomUUID(),
      sessionId,
      cookie: parsed.cookie ? String(parsed.cookie) : null,
      label: parsed.label ? String(parsed.label) : null,
      updatedAt: String(parsed.updatedAt || parsed.updated_at || new Date().toISOString()),
    }
  } catch {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.includes('=')) return null
    return {
      id: randomUUID(),
      sessionId: trimmed,
      cookie: null,
      label: null,
      updatedAt: new Date().toISOString(),
    }
  }
}

function loadJimengSessionStore(): JimengSessionStore {
  const raw = getAppMeta(JIMENG_SESSION_META_KEY)
  if (!raw?.trim()) {
    return { activeId: null, sessions: [] }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as JimengSessionStore).sessions)) {
      const store = parsed as JimengSessionStore
      const sessions = store.sessions
        .map(item => normalizeSessionEntry(item))
        .filter(Boolean) as JimengWebSession[]
      let activeId = store.activeId ? String(store.activeId) : null
      if (activeId && !sessions.some(item => item.id === activeId)) {
        activeId = sessions[0]?.id ?? null
      }
      if (!activeId && sessions.length) activeId = sessions[0].id
      return { activeId, sessions }
    }
  } catch {
    /* fall through to legacy */
  }

  const legacy = parseLegacySession(raw)
  if (!legacy) return { activeId: null, sessions: [] }
  return { activeId: legacy.id, sessions: [legacy] }
}

function normalizeSessionEntry(raw: unknown): JimengWebSession | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const sessionId = String(item.sessionId || item.session_id || '').trim()
  if (!sessionId) return null
  const id = String(item.id || '').trim() || randomUUID()
  return {
    id,
    sessionId,
    cookie: item.cookie ? normalizeCookieInput(String(item.cookie)) : null,
    label: item.label ? String(item.label).trim() : null,
    updatedAt: String(item.updatedAt || item.updated_at || new Date().toISOString()),
  }
}

function saveJimengSessionStore(store: JimengSessionStore) {
  setAppMeta(JIMENG_SESSION_META_KEY, JSON.stringify(store))
}

export function listJimengWebSessions(): JimengWebSession[] {
  return loadJimengSessionStore().sessions
}

export function getActiveJimengSessionId(): string | null {
  return loadJimengSessionStore().activeId
}

export function getJimengWebSession(sessionIdOrInternalId?: string | null): JimengWebSession | null {
  const store = loadJimengSessionStore()
  if (!store.sessions.length) return null

  const key = String(sessionIdOrInternalId || '').trim()
  if (key) {
    return store.sessions.find(item => item.id === key || item.sessionId === key) || null
  }

  if (store.activeId) {
    return store.sessions.find(item => item.id === store.activeId) || store.sessions[0]
  }
  return store.sessions[0]
}

export function setJimengWebSession(input: {
  id?: string
  session_id?: string
  sessionId?: string
  cookie?: string
  label?: string
  set_active?: boolean
}): JimengWebSession {
  const cookie = String(input.cookie || '').trim()
  const sessionId = String(input.session_id || input.sessionId || '').trim()
    || (cookie ? extractSessionIdFromCookie(cookie) || '' : '')
  if (!sessionId) throw new Error('请提供 sessionid 或完整 Cookie')

  const store = loadJimengSessionStore()
  const targetId = String(input.id || '').trim()
  const existingIndex = targetId
    ? store.sessions.findIndex(item => item.id === targetId)
    : store.sessions.findIndex(item => item.sessionId === sessionId)

  const next: JimengWebSession = {
    id: existingIndex >= 0 ? store.sessions[existingIndex].id : randomUUID(),
    sessionId,
    cookie: cookie ? normalizeCookieInput(cookie) : (existingIndex >= 0 ? store.sessions[existingIndex].cookie : null),
    label: input.label != null
      ? (String(input.label).trim() || null)
      : (existingIndex >= 0 ? store.sessions[existingIndex].label : null),
    updatedAt: new Date().toISOString(),
  }

  if (existingIndex >= 0) {
    store.sessions[existingIndex] = next
  } else {
    store.sessions.unshift(next)
  }

  const shouldActivate = input.set_active !== false || !store.activeId || existingIndex >= 0
  if (shouldActivate || input.set_active === true) {
    store.activeId = next.id
  } else if (!store.activeId) {
    store.activeId = next.id
  }

  saveJimengSessionStore(store)
  return next
}

export function setActiveJimengWebSession(id: string): JimengWebSession {
  const store = loadJimengSessionStore()
  const session = store.sessions.find(item => item.id === id)
  if (!session) throw new Error('Session 不存在')
  store.activeId = id
  saveJimengSessionStore(store)
  return session
}

export function deleteJimengWebSession(id: string): boolean {
  const store = loadJimengSessionStore()
  const index = store.sessions.findIndex(item => item.id === id)
  if (index < 0) return false
  store.sessions.splice(index, 1)
  if (store.activeId === id) {
    store.activeId = store.sessions[0]?.id ?? null
  }
  saveJimengSessionStore(store)
  return true
}

export function clearJimengWebSession(): void {
  setAppMeta(JIMENG_SESSION_META_KEY, '')
}

export function hasJimengWebSession(): boolean {
  return loadJimengSessionStore().sessions.length > 0
}

export function maskJimengSessionId(sessionId: string): string {
  const raw = String(sessionId || '').trim()
  if (raw.length <= 8) return '****'
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`
}

export function toPublicJimengSession(session: JimengWebSession, activeId: string | null) {
  return {
    id: session.id,
    session_id_masked: maskJimengSessionId(session.sessionId),
    label: session.label || null,
    updated_at: session.updatedAt || null,
    has_full_cookie: !!session.cookie,
    is_active: session.id === activeId,
  }
}
