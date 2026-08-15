import { randomUUID } from 'crypto'
import { getAppMeta, setAppMeta } from '../db/index.js'
import { normalizeFunshionAuthHeader, resolveFunshionApiBaseUrl } from '../constants/funshion-web.js'

export const FUNSHION_SESSION_META_KEY = 'funshion_web_session'

export interface FunshionWebSession {
  id: string
  /** Authorization 头原值（可含 Bearer） */
  token: string
  baseUrl?: string | null
  /** 视频页 URL 中的项目 ID，如 /ai-app/video/{projectId} */
  projectId?: string | null
  /** 可选：自动创建项目时的 appId（从 Network appbox/create 抓取） */
  appId?: string | null
  label?: string | null
  updatedAt: string
}

interface FunshionSessionStore {
  activeId: string | null
  sessions: FunshionWebSession[]
}

function loadStore(): FunshionSessionStore {
  const raw = getAppMeta(FUNSHION_SESSION_META_KEY)
  if (!raw?.trim()) return { activeId: null, sessions: [] }
  try {
    const parsed = JSON.parse(raw) as FunshionSessionStore
    if (parsed && Array.isArray(parsed.sessions)) {
      const sessions = parsed.sessions
        .map(item => normalizeSessionEntry(item))
        .filter(Boolean) as FunshionWebSession[]
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

function normalizeSessionEntry(raw: unknown): FunshionWebSession | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const token = normalizeFunshionAuthHeader(
    String(item.token || item.authorization || item.apiKey || item.api_key || ''),
  )
  if (!token) return null
  return {
    id: String(item.id || '').trim() || randomUUID(),
    token,
    baseUrl: resolveFunshionApiBaseUrl(
      item.baseUrl != null ? String(item.baseUrl) : (item.base_url != null ? String(item.base_url) : null),
    ),
    projectId: item.projectId != null
      ? String(item.projectId).trim() || null
      : (item.project_id != null ? String(item.project_id).trim() || null : null),
    appId: item.appId != null
      ? String(item.appId).trim() || null
      : (item.app_id != null ? String(item.app_id).trim() || null : null),
    label: item.label ? String(item.label).trim() : null,
    updatedAt: String(item.updatedAt || item.updated_at || new Date().toISOString()),
  }
}

function saveStore(store: FunshionSessionStore) {
  setAppMeta(FUNSHION_SESSION_META_KEY, JSON.stringify(store))
}

export function listFunshionWebSessions(): FunshionWebSession[] {
  return loadStore().sessions
}

export function getActiveFunshionSessionId(): string | null {
  return loadStore().activeId
}

export function getFunshionWebSession(sessionId?: string | null): FunshionWebSession | null {
  const store = loadStore()
  if (!store.sessions.length) return null
  const key = String(sessionId || '').trim()
  if (key) return store.sessions.find(item => item.id === key) || null
  if (store.activeId) {
    return store.sessions.find(item => item.id === store.activeId) || store.sessions[0]
  }
  return store.sessions[0]
}

export function setFunshionWebSession(input: {
  id?: string
  token?: string
  authorization?: string
  base_url?: string | null
  baseUrl?: string | null
  project_id?: string | null
  projectId?: string | null
  app_id?: string | null
  appId?: string | null
  label?: string
  set_active?: boolean | number | string
}): FunshionWebSession {
  const store = loadStore()
  const targetId = String(input.id || '').trim()
  const existingIndex = targetId
    ? store.sessions.findIndex(item => item.id === targetId)
    : -1
  const existing = existingIndex >= 0 ? store.sessions[existingIndex] : null

  const tokenRaw = input.token ?? input.authorization
  const token = tokenRaw !== undefined
    ? normalizeFunshionAuthHeader(tokenRaw)
    : (existing?.token || '')
  if (!token) throw new Error('请粘贴视频页 Network 中的 Authorization / localStorage.token')

  const baseUrl = input.base_url !== undefined || input.baseUrl !== undefined
    ? resolveFunshionApiBaseUrl(input.base_url ?? input.baseUrl)
    : (existing?.baseUrl || resolveFunshionApiBaseUrl(null))

  const projectId = input.project_id !== undefined || input.projectId !== undefined
    ? (String(input.project_id ?? input.projectId ?? '').trim() || null)
    : (existing?.projectId ?? null)

  const appId = input.app_id !== undefined || input.appId !== undefined
    ? (String(input.app_id ?? input.appId ?? '').trim() || null)
    : (existing?.appId ?? null)

  const next: FunshionWebSession = {
    id: existing?.id || targetId || randomUUID(),
    token,
    baseUrl,
    projectId,
    appId,
    label: input.label !== undefined
      ? (String(input.label || '').trim() || null)
      : (existing?.label ?? null),
    updatedAt: new Date().toISOString(),
  }

  if (existingIndex >= 0) store.sessions[existingIndex] = next
  else store.sessions.push(next)

  const setActive = input.set_active !== false && input.set_active !== 0 && input.set_active !== '0'
  if (setActive || !store.activeId) store.activeId = next.id
  saveStore(store)
  return next
}

export function setActiveFunshionWebSession(id: string): FunshionWebSession {
  const store = loadStore()
  const session = store.sessions.find(item => item.id === id)
  if (!session) throw new Error('Session 不存在')
  store.activeId = id
  saveStore(store)
  return session
}

export function deleteFunshionWebSession(id: string): boolean {
  const store = loadStore()
  const before = store.sessions.length
  store.sessions = store.sessions.filter(item => item.id !== id)
  if (store.activeId === id) store.activeId = store.sessions[0]?.id ?? null
  saveStore(store)
  return store.sessions.length < before
}

export function clearFunshionWebSession() {
  saveStore({ activeId: null, sessions: [] })
}

export function maskFunshionToken(token?: string | null): string {
  const raw = String(token || '').replace(/^bearer\s+/i, '').trim()
  if (!raw) return ''
  if (raw.length <= 12) return `${raw.slice(0, 2)}***`
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`
}

export function toPublicFunshionSession(
  session: FunshionWebSession,
  activeId?: string | null,
) {
  return {
    id: session.id,
    label: session.label,
    base_url: session.baseUrl || null,
    project_id: session.projectId || null,
    app_id: session.appId || null,
    token_masked: maskFunshionToken(session.token),
    has_token: !!session.token,
    is_active: session.id === (activeId || getActiveFunshionSessionId()),
    updated_at: session.updatedAt,
  }
}
