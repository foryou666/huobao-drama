import { randomUUID } from 'crypto'
import { getAppMeta, setAppMeta } from '../db/index.js'
import { normalizeCozeCookie } from '../utils/coze-cookie.js'
import { COZE_API_BASE_URL } from '../constants/coze-web.js'

export const COZE_SESSION_META_KEY = 'coze_web_session'

export interface CozeWebSession {
  id: string
  /** 网页 Cookie（可与 PAT 二选一或同时） */
  cookie?: string | null
  /** Personal Access Token */
  apiKey?: string | null
  /** 可选 API 根地址，默认 https://api.coze.cn */
  baseUrl?: string | null
  label?: string | null
  updatedAt: string
}

interface CozeSessionStore {
  activeId: string | null
  sessions: CozeWebSession[]
}

function normalizeApiKey(raw: string): string {
  let key = String(raw || '').trim()
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, '').trim()
  return key
}

function normalizeBaseUrl(raw?: string | null): string | null {
  const value = String(raw || '').trim().replace(/\/+$/, '')
  if (!value) return null
  return value
}

function loadCozeSessionStore(): CozeSessionStore {
  const raw = getAppMeta(COZE_SESSION_META_KEY)
  if (!raw?.trim()) return { activeId: null, sessions: [] }
  try {
    const parsed = JSON.parse(raw) as CozeSessionStore
    if (parsed && Array.isArray(parsed.sessions)) {
      const sessions = parsed.sessions
        .map(item => normalizeSessionEntry(item))
        .filter(Boolean) as CozeWebSession[]
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

function normalizeSessionEntry(raw: unknown): CozeWebSession | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const cookieRaw = item.cookie != null ? String(item.cookie) : ''
  const cookie = cookieRaw.trim() ? normalizeCozeCookie(cookieRaw) : null
  const apiKey = normalizeApiKey(String(item.apiKey || item.api_key || item.pat || item.token || ''))
  if (!cookie && !apiKey) return null
  return {
    id: String(item.id || '').trim() || randomUUID(),
    cookie: cookie || null,
    apiKey: apiKey || null,
    baseUrl: normalizeBaseUrl(item.baseUrl != null ? String(item.baseUrl) : (item.base_url != null ? String(item.base_url) : null)),
    label: item.label ? String(item.label).trim() : null,
    updatedAt: String(item.updatedAt || item.updated_at || new Date().toISOString()),
  }
}

function saveCozeSessionStore(store: CozeSessionStore) {
  setAppMeta(COZE_SESSION_META_KEY, JSON.stringify(store))
}

export function listCozeWebSessions(): CozeWebSession[] {
  return loadCozeSessionStore().sessions
}

export function getActiveCozeSessionId(): string | null {
  return loadCozeSessionStore().activeId
}

export function getCozeWebSession(sessionId?: string | null): CozeWebSession | null {
  const store = loadCozeSessionStore()
  if (!store.sessions.length) return null
  const key = String(sessionId || '').trim()
  if (key) {
    return store.sessions.find(item => item.id === key) || null
  }
  if (store.activeId) {
    return store.sessions.find(item => item.id === store.activeId) || store.sessions[0]
  }
  return store.sessions[0]
}

export function setCozeWebSession(input: {
  id?: string
  cookie?: string | null
  api_key?: string
  apiKey?: string
  pat?: string
  base_url?: string | null
  baseUrl?: string | null
  label?: string
  set_active?: boolean | number | string
}): CozeWebSession {
  const store = loadCozeSessionStore()
  const targetId = String(input.id || '').trim()
  const existingIndex = targetId
    ? store.sessions.findIndex(item => item.id === targetId)
    : -1
  const existing = existingIndex >= 0 ? store.sessions[existingIndex] : null

  let cookie: string | null | undefined = existing?.cookie ?? null
  if (input.cookie !== undefined) {
    const raw = input.cookie == null ? '' : String(input.cookie)
    cookie = raw.trim() ? normalizeCozeCookie(raw) : null
  }

  const incomingKey = normalizeApiKey(String(input.api_key || input.apiKey || input.pat || ''))
  let apiKey: string | null | undefined = existing?.apiKey ?? null
  if (incomingKey) {
    apiKey = incomingKey
  } else if (Object.prototype.hasOwnProperty.call(input, 'api_key')
    || Object.prototype.hasOwnProperty.call(input, 'apiKey')
    || Object.prototype.hasOwnProperty.call(input, 'pat')) {
    // 显式传空则清空
    if (!incomingKey && (input.api_key === '' || input.apiKey === '' || input.pat === '')) {
      apiKey = null
    }
  }

  let baseUrl: string | null | undefined = existing?.baseUrl ?? null
  if (input.base_url !== undefined || input.baseUrl !== undefined) {
    const raw = input.base_url !== undefined ? input.base_url : input.baseUrl
    baseUrl = normalizeBaseUrl(raw == null ? '' : String(raw))
  }

  if (!cookie && !apiKey) {
    throw new Error('请至少提供 Cookie 或 Personal Access Token（PAT）')
  }

  const next: CozeWebSession = {
    id: existing?.id || randomUUID(),
    cookie: cookie || null,
    apiKey: apiKey || null,
    baseUrl: baseUrl || null,
    label: input.label != null
      ? (String(input.label).trim() || null)
      : (existing?.label ?? null),
    updatedAt: new Date().toISOString(),
  }

  if (existingIndex >= 0) store.sessions[existingIndex] = next
  else store.sessions.unshift(next)

  const setActive = input.set_active !== false && input.set_active !== 0 && input.set_active !== '0'
  if (setActive || !store.activeId) store.activeId = next.id

  saveCozeSessionStore(store)
  return next
}

export function setActiveCozeWebSession(id: string): CozeWebSession {
  const store = loadCozeSessionStore()
  const session = store.sessions.find(item => item.id === id)
  if (!session) throw new Error('扣子 Session 不存在')
  store.activeId = id
  saveCozeSessionStore(store)
  return session
}

export function deleteCozeWebSession(id: string): boolean {
  const store = loadCozeSessionStore()
  const index = store.sessions.findIndex(item => item.id === id)
  if (index < 0) return false
  store.sessions.splice(index, 1)
  if (store.activeId === id) store.activeId = store.sessions[0]?.id ?? null
  saveCozeSessionStore(store)
  return true
}

export function clearCozeWebSession(): void {
  setAppMeta(COZE_SESSION_META_KEY, '')
}

export function hasCozeWebSession(): boolean {
  return loadCozeSessionStore().sessions.length > 0
}

export function maskCozeSecret(value: string): string {
  const raw = String(value || '').trim()
  if (raw.length <= 10) return '****'
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`
}

export function toPublicCozeSession(session: CozeWebSession, activeId: string | null) {
  return {
    id: session.id,
    cookie_masked: session.cookie ? maskCozeSecret(session.cookie) : null,
    api_key_masked: session.apiKey ? maskCozeSecret(session.apiKey) : null,
    has_cookie: Boolean(session.cookie && String(session.cookie).trim()),
    has_api_key: Boolean(session.apiKey && String(session.apiKey).trim()),
    base_url: session.baseUrl || COZE_API_BASE_URL,
    label: session.label || null,
    updated_at: session.updatedAt || null,
    is_active: session.id === activeId,
  }
}
