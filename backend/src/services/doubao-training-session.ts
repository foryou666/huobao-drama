import { randomUUID } from 'crypto'
import { getAppMeta, setAppMeta } from '../db/index.js'
import { extractDoubaoSessionIdFromCookie, normalizeDoubaoCookie } from '../utils/doubao-cookie.js'

export const DOUBAO_TRAINING_SESSION_META_KEY = 'doubao_training_session'

export interface DoubaoTrainingSession {
  id: string
  sessionId: string
  cookie?: string | null
  label?: string | null
  updatedAt: string
}

interface DoubaoSessionStore {
  activeId: string | null
  sessions: DoubaoTrainingSession[]
}

function loadDoubaoSessionStore(): DoubaoSessionStore {
  const raw = getAppMeta(DOUBAO_TRAINING_SESSION_META_KEY)
  if (!raw?.trim()) return { activeId: null, sessions: [] }
  try {
    const parsed = JSON.parse(raw) as DoubaoSessionStore
    if (parsed && Array.isArray(parsed.sessions)) {
      const sessions = parsed.sessions
        .map(item => normalizeSessionEntry(item))
        .filter(Boolean) as DoubaoTrainingSession[]
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

function normalizeSessionEntry(raw: unknown): DoubaoTrainingSession | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const sessionId = String(item.sessionId || item.session_id || '').trim()
  if (!sessionId) return null
  return {
    id: String(item.id || '').trim() || randomUUID(),
    sessionId,
    cookie: item.cookie ? normalizeDoubaoCookie(String(item.cookie)) : null,
    label: item.label ? String(item.label).trim() : null,
    updatedAt: String(item.updatedAt || item.updated_at || new Date().toISOString()),
  }
}

function saveDoubaoSessionStore(store: DoubaoSessionStore) {
  setAppMeta(DOUBAO_TRAINING_SESSION_META_KEY, JSON.stringify(store))
}

export function listDoubaoTrainingSessions(): DoubaoTrainingSession[] {
  return loadDoubaoSessionStore().sessions
}

export function getActiveDoubaoTrainingSessionId(): string | null {
  return loadDoubaoSessionStore().activeId
}

export function getDoubaoTrainingSession(sessionIdOrInternalId?: string | null): DoubaoTrainingSession | null {
  const store = loadDoubaoSessionStore()
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

export function setDoubaoTrainingSession(input: {
  id?: string
  session_id?: string
  sessionId?: string
  cookie?: string
  label?: string
  set_active?: boolean | number | string
}): DoubaoTrainingSession {
  const cookie = String(input.cookie || '').trim()
  const sessionId = String(input.session_id || input.sessionId || '').trim()
    || (cookie ? extractDoubaoSessionIdFromCookie(cookie) || '' : '')
  if (!sessionId) throw new Error('请提供 sessionid 或完整 Cookie')

  const store = loadDoubaoSessionStore()
  const targetId = String(input.id || '').trim()
  const existingIndex = targetId
    ? store.sessions.findIndex(item => item.id === targetId)
    : store.sessions.findIndex(item => item.sessionId === sessionId)

  const next: DoubaoTrainingSession = {
    id: existingIndex >= 0 ? store.sessions[existingIndex].id : randomUUID(),
    sessionId,
    cookie: cookie ? normalizeDoubaoCookie(cookie) : (existingIndex >= 0 ? store.sessions[existingIndex].cookie : null),
    label: input.label != null
      ? (String(input.label).trim() || null)
      : (existingIndex >= 0 ? store.sessions[existingIndex].label : null),
    updatedAt: new Date().toISOString(),
  }

  if (existingIndex >= 0) store.sessions[existingIndex] = next
  else store.sessions.unshift(next)

  if (input.set_active !== false && input.set_active !== 0 && input.set_active !== '0') {
    store.activeId = next.id
  } else if (!store.activeId) {
    store.activeId = next.id
  }

  saveDoubaoSessionStore(store)
  return next
}

export function setActiveDoubaoTrainingSession(id: string): DoubaoTrainingSession {
  const store = loadDoubaoSessionStore()
  const session = store.sessions.find(item => item.id === id)
  if (!session) throw new Error('Session 不存在')
  store.activeId = id
  saveDoubaoSessionStore(store)
  return session
}

export function deleteDoubaoTrainingSession(id: string): boolean {
  const store = loadDoubaoSessionStore()
  const index = store.sessions.findIndex(item => item.id === id)
  if (index < 0) return false
  store.sessions.splice(index, 1)
  if (store.activeId === id) store.activeId = store.sessions[0]?.id ?? null
  saveDoubaoSessionStore(store)
  return true
}

export function clearDoubaoTrainingSessions(): void {
  setAppMeta(DOUBAO_TRAINING_SESSION_META_KEY, '')
}

export function hasDoubaoTrainingSession(): boolean {
  return loadDoubaoSessionStore().sessions.length > 0
}

export function maskDoubaoSessionId(sessionId: string): string {
  const raw = String(sessionId || '').trim()
  if (raw.length <= 8) return '****'
  return `${raw.slice(0, 4)}…${raw.slice(-4)}`
}

export function toPublicDoubaoTrainingSession(session: DoubaoTrainingSession, activeId: string | null) {
  return {
    id: session.id,
    session_id_masked: maskDoubaoSessionId(session.sessionId),
    label: session.label || null,
    updated_at: session.updatedAt || null,
    has_full_cookie: !!session.cookie,
    is_active: session.id === activeId,
  }
}

export { extractDoubaoSessionIdFromCookie as extractSessionIdFromCookie }
