import { randomUUID } from 'crypto'
import { getAppMeta, setAppMeta } from '../db/index.js'
import {
  normalizeXingyuemengToken,
  resolveXingyuemengApiBaseUrl,
} from '../constants/xingyuemeng-web.js'

export const XINGYUEMENG_SESSION_META_KEY = 'xingyuemeng_web_session'

export interface XingyuemengWebSession {
  id: string
  token: string
  baseUrl?: string | null
  teamId?: string | null
  projectId?: string | null
  episodeId?: string | null
  label?: string | null
  updatedAt: string
}

interface XingyuemengSessionStore {
  activeId: string | null
  sessions: XingyuemengWebSession[]
}

function loadStore(): XingyuemengSessionStore {
  const raw = getAppMeta(XINGYUEMENG_SESSION_META_KEY)
  if (!raw?.trim()) return { activeId: null, sessions: [] }
  try {
    const parsed = JSON.parse(raw) as XingyuemengSessionStore
    if (parsed && Array.isArray(parsed.sessions)) {
      const sessions = parsed.sessions
        .map(item => normalizeSessionEntry(item))
        .filter(Boolean) as XingyuemengWebSession[]
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

function normalizeSessionEntry(raw: unknown): XingyuemengWebSession | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const token = normalizeXingyuemengToken(
    String(item.token || item.authorization || item.apiKey || item.api_key || ''),
  )
  if (!token) return null
  return {
    id: String(item.id || '').trim() || randomUUID(),
    token,
    baseUrl: resolveXingyuemengApiBaseUrl(
      item.baseUrl != null ? String(item.baseUrl) : (item.base_url != null ? String(item.base_url) : null),
    ),
    teamId: item.teamId != null
      ? String(item.teamId).trim() || '0'
      : (item.team_id != null ? String(item.team_id).trim() || '0' : '0'),
    projectId: item.projectId != null
      ? String(item.projectId).trim() || null
      : (item.project_id != null ? String(item.project_id).trim() || null : null),
    episodeId: item.episodeId != null
      ? String(item.episodeId).trim() || null
      : (item.episode_id != null ? String(item.episode_id).trim() || null : null),
    label: item.label ? String(item.label).trim() : null,
    updatedAt: String(item.updatedAt || item.updated_at || new Date().toISOString()),
  }
}

function saveStore(store: XingyuemengSessionStore) {
  setAppMeta(XINGYUEMENG_SESSION_META_KEY, JSON.stringify(store))
}

export function listXingyuemengWebSessions(): XingyuemengWebSession[] {
  return loadStore().sessions
}

export function getActiveXingyuemengSessionId(): string | null {
  return loadStore().activeId
}

export function getXingyuemengWebSession(sessionId?: string | null): XingyuemengWebSession | null {
  const store = loadStore()
  if (!store.sessions.length) return null
  const key = String(sessionId || '').trim()
  if (key) return store.sessions.find(item => item.id === key) || null
  if (store.activeId) {
    return store.sessions.find(item => item.id === store.activeId) || store.sessions[0]
  }
  return store.sessions[0]
}

export function setXingyuemengWebSession(input: {
  id?: string
  token?: string
  authorization?: string
  base_url?: string | null
  baseUrl?: string | null
  team_id?: string | null
  teamId?: string | null
  project_id?: string | null
  projectId?: string | null
  episode_id?: string | null
  episodeId?: string | null
  label?: string
  set_active?: boolean | number | string
}): XingyuemengWebSession {
  const store = loadStore()
  const targetId = String(input.id || '').trim()
  const existingIndex = targetId
    ? store.sessions.findIndex(item => item.id === targetId)
    : -1
  const existing = existingIndex >= 0 ? store.sessions[existingIndex] : null

  const tokenRaw = input.token ?? input.authorization
  const token = tokenRaw !== undefined
    ? normalizeXingyuemengToken(tokenRaw)
    : (existing?.token || '')
  if (!token) throw new Error('请粘贴星月梦 localStorage.xymai_token')

  const baseUrl = input.base_url !== undefined || input.baseUrl !== undefined
    ? resolveXingyuemengApiBaseUrl(input.base_url ?? input.baseUrl)
    : (existing?.baseUrl || resolveXingyuemengApiBaseUrl(null))

  const teamId = input.team_id !== undefined || input.teamId !== undefined
    ? (String(input.team_id ?? input.teamId ?? '0').trim() || '0')
    : (existing?.teamId ?? '0')

  const projectId = input.project_id !== undefined || input.projectId !== undefined
    ? (String(input.project_id ?? input.projectId ?? '').trim() || null)
    : (existing?.projectId ?? null)

  const episodeId = input.episode_id !== undefined || input.episodeId !== undefined
    ? (String(input.episode_id ?? input.episodeId ?? '').trim() || null)
    : (existing?.episodeId ?? null)

  const next: XingyuemengWebSession = {
    id: existing?.id || targetId || randomUUID(),
    token,
    baseUrl,
    teamId,
    projectId,
    episodeId,
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

export function setActiveXingyuemengWebSession(id: string): XingyuemengWebSession {
  const store = loadStore()
  const session = store.sessions.find(item => item.id === id)
  if (!session) throw new Error('Session 不存在')
  store.activeId = id
  saveStore(store)
  return session
}

export function deleteXingyuemengWebSession(id: string): boolean {
  const store = loadStore()
  const before = store.sessions.length
  store.sessions = store.sessions.filter(item => item.id !== id)
  if (store.activeId === id) store.activeId = store.sessions[0]?.id ?? null
  saveStore(store)
  return store.sessions.length < before
}

export function clearXingyuemengWebSession() {
  saveStore({ activeId: null, sessions: [] })
}

export function maskXingyuemengToken(token?: string | null): string {
  const raw = normalizeXingyuemengToken(token)
  if (!raw) return ''
  if (raw.length <= 12) return `${raw.slice(0, 2)}***`
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`
}

export function toPublicXingyuemengSession(
  session: XingyuemengWebSession,
  activeId?: string | null,
) {
  return {
    id: session.id,
    label: session.label,
    base_url: session.baseUrl || null,
    team_id: session.teamId || '0',
    project_id: session.projectId || null,
    episode_id: session.episodeId || null,
    token_masked: maskXingyuemengToken(session.token),
    has_token: !!session.token,
    is_active: session.id === (activeId || getActiveXingyuemengSessionId()),
    updated_at: session.updatedAt,
  }
}
