import { createHash, randomUUID } from 'crypto'
import { getAppMeta, setAppMeta } from '../db/index.js'
import { normalizeXyqCookie } from '../utils/xyq-cookie.js'

export const XYQ_SESSION_META_KEY = 'xyq_web_session'

export interface XyqWebSession {
  id: string
  /** Access Key fingerprint?sha256 ? 16 ?? */
  keyFingerprint: string
  accessKey: string
  /** ????? Cookie????????? / ???? */
  cookie?: string | null
  label?: string | null
  updatedAt: string
}

interface XyqSessionStore {
  activeId: string | null
  sessions: XyqWebSession[]
}

function fingerprintAccessKey(accessKey: string): string {
  return createHash('sha256').update(String(accessKey || '').trim()).digest('hex').slice(0, 16)
}

function normalizeAccessKey(raw: string): string {
  let key = String(raw || '').trim()
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, '').trim()
  return key
}

function loadXyqSessionStore(): XyqSessionStore {
  const raw = getAppMeta(XYQ_SESSION_META_KEY)
  if (!raw?.trim()) return { activeId: null, sessions: [] }
  try {
    const parsed = JSON.parse(raw) as XyqSessionStore
    if (parsed && Array.isArray(parsed.sessions)) {
      const sessions = parsed.sessions
        .map(item => normalizeSessionEntry(item))
        .filter(Boolean) as XyqWebSession[]
      let activeId = parsed.activeId ? String(parsed.activeId) : null
      if (activeId && !sessions.some(item => item.id === activeId)) {
        activeId = sessions[0]?.id ?? null
      }
      if (!activeId && sessions.length) activeId = sessions[0].id
      return { activeId, sessions }
    }
  } catch { /* ignore */ }
  return { activeId: null, sessions: [] }
}

function normalizeSessionEntry(raw: unknown): XyqWebSession | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const accessKey = normalizeAccessKey(String(item.accessKey || item.access_key || item.apiKey || item.api_key || ''))
  if (!accessKey) return null
  const cookieRaw = item.cookie != null ? String(item.cookie) : ''
  const cookie = cookieRaw.trim() ? normalizeXyqCookie(cookieRaw) : null
  return {
    id: String(item.id || '').trim() || randomUUID(),
    keyFingerprint: String(item.keyFingerprint || item.key_fingerprint || '').trim() || fingerprintAccessKey(accessKey),
    accessKey,
    cookie,
    label: item.label ? String(item.label).trim() : null,
    updatedAt: String(item.updatedAt || item.updated_at || new Date().toISOString()),
  }
}

function saveXyqSessionStore(store: XyqSessionStore) {
  setAppMeta(XYQ_SESSION_META_KEY, JSON.stringify(store))
}

export function listXyqWebSessions(): XyqWebSession[] {
  return loadXyqSessionStore().sessions
}

export function getActiveXyqSessionId(): string | null {
  return loadXyqSessionStore().activeId
}

export function getXyqWebSession(sessionIdOrInternalId?: string | null): XyqWebSession | null {
  const store = loadXyqSessionStore()
  if (!store.sessions.length) return null
  const key = String(sessionIdOrInternalId || '').trim()
  if (key) {
    return store.sessions.find(item => item.id === key || item.keyFingerprint === key) || null
  }
  if (store.activeId) {
    return store.sessions.find(item => item.id === store.activeId) || store.sessions[0]
  }
  return store.sessions[0]
}

export function setXyqWebSession(input: {
  id?: string
  access_key?: string
  accessKey?: string
  api_key?: string
  apiKey?: string
  cookie?: string | null
  label?: string
  set_active?: boolean | number | string
}): XyqWebSession {
  const store = loadXyqSessionStore()
  const targetId = String(input.id || '').trim()
  const incomingKey = normalizeAccessKey(
    String(input.access_key || input.accessKey || input.api_key || input.apiKey || ''),
  )
  const existingIndex = targetId
    ? store.sessions.findIndex(item => item.id === targetId)
    : (incomingKey
      ? store.sessions.findIndex(item => item.keyFingerprint === fingerprintAccessKey(incomingKey))
      : -1)

  const existing = existingIndex >= 0 ? store.sessions[existingIndex] : null
  const accessKey = incomingKey || existing?.accessKey || ''
  if (!accessKey || accessKey.length < 8) throw new Error('????????? Access Key')

  let cookie: string | null | undefined = existing?.cookie ?? null
  if (input.cookie !== undefined) {
    const raw = input.cookie == null ? '' : String(input.cookie)
    cookie = raw.trim() ? normalizeXyqCookie(raw) : null
  }

  const next: XyqWebSession = {
    id: existing?.id || randomUUID(),
    keyFingerprint: fingerprintAccessKey(accessKey),
    accessKey,
    cookie: cookie || null,
    label: input.label != null
      ? (String(input.label).trim() || null)
      : (existing?.label ?? null),
    updatedAt: new Date().toISOString(),
  }

  if (existingIndex >= 0) store.sessions[existingIndex] = next
  else store.sessions.unshift(next)

  const setActive = input.set_active !== false && input.set_active !== 0 && input.set_active !== '0'
  if (setActive || !store.activeId) store.activeId = next.id

  saveXyqSessionStore(store)
  return next
}

export function setActiveXyqWebSession(id: string): XyqWebSession {
  const store = loadXyqSessionStore()
  const session = store.sessions.find(item => item.id === id)
  if (!session) throw new Error('Access Key ???')
  store.activeId = id
  saveXyqSessionStore(store)
  return session
}

export function deleteXyqWebSession(id: string): boolean {
  const store = loadXyqSessionStore()
  const index = store.sessions.findIndex(item => item.id === id)
  if (index < 0) return false
  store.sessions.splice(index, 1)
  if (store.activeId === id) store.activeId = store.sessions[0]?.id ?? null
  saveXyqSessionStore(store)
  return true
}

export function clearXyqWebSession(): void {
  setAppMeta(XYQ_SESSION_META_KEY, '')
}

export function hasXyqWebSession(): boolean {
  return loadXyqSessionStore().sessions.length > 0
}

export function maskXyqAccessKey(accessKey: string): string {
  const raw = String(accessKey || '').trim()
  if (raw.length <= 10) return '****'
  return `${raw.slice(0, 4)}�${raw.slice(-4)}`
}

export function toPublicXyqSession(session: XyqWebSession, activeId: string | null) {
  return {
    id: session.id,
    access_key_masked: maskXyqAccessKey(session.accessKey),
    has_cookie: Boolean(session.cookie && String(session.cookie).trim()),
    label: session.label || null,
    updated_at: session.updatedAt || null,
    is_active: session.id === activeId,
  }
}
