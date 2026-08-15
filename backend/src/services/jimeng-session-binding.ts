/**
 * 通道4 即梦 Session 按「用户 + 项目」粘滞分配，实现创作隔离。
 * 同一用户同一剧复用同一 Session；新用户或新剧优先分配池中尚未占用的 Session。
 * 若绑定账号积分耗尽，自动改分到池中仍有积分的 Session。
 * （无法自动创建即梦账号，仅从管理员配置的 Session 池中分配。）
 */
import { getAppMeta, setAppMeta } from '../db/index.js'
import { getJimengUserCredit } from './jimeng-web-client.js'
import {
  getActiveJimengSessionId,
  getJimengWebSession,
  listJimengWebSessions,
  type JimengWebSession,
} from './jimeng-web-session.js'
import { logTaskWarn } from '../utils/task-logger.js'

export const JIMENG_SESSION_BINDING_META_KEY = 'jimeng_session_bindings'
/** 强制全员使用指定 Session（覆盖按用户+项目粘滞分配） */
export const JIMENG_FORCE_SESSION_META_KEY = 'jimeng_force_session_id'

/** 即梦上游至少需约此 VIP/购买积分才够跑一单 Seedance VIP（赠送积分通常不够，低于此改分） */
export const JIMENG_MIN_USABLE_CREDIT = 80

export function getJimengForceSessionId(): string | null {
  const raw = String(getAppMeta(JIMENG_FORCE_SESSION_META_KEY) || '').trim()
  return raw || null
}

export function setJimengForceSessionId(sessionId: string | null): string | null {
  const id = String(sessionId || '').trim()
  if (!id) {
    setAppMeta(JIMENG_FORCE_SESSION_META_KEY, '')
    return null
  }
  const session = getJimengWebSession(id)
  if (!session) throw new Error('所选即梦 Session 不存在')
  setAppMeta(JIMENG_FORCE_SESSION_META_KEY, session.id)
  return session.id
}

export function clearJimengForceSessionId(): void {
  setAppMeta(JIMENG_FORCE_SESSION_META_KEY, '')
}

/** 若强制号已被删除则自动清除强制设置，返回当前有效的强制 Session id */
export function resolveLiveJimengForceSessionId(): string | null {
  const id = getJimengForceSessionId()
  if (!id) return null
  if (!getJimengWebSession(id)) {
    clearJimengForceSessionId()
    return null
  }
  return id
}

interface BindingEntry {
  sessionId: string
  updatedAt: string
}

interface BindingStore {
  /** key = `${userId}:${dramaId}` */
  bindings: Record<string, BindingEntry>
}

function bindingKey(userId: number, dramaId: number): string {
  return `${userId}:${dramaId}`
}

function loadStore(): BindingStore {
  const raw = getAppMeta(JIMENG_SESSION_BINDING_META_KEY)
  if (!raw?.trim()) return { bindings: {} }
  try {
    const parsed = JSON.parse(raw) as BindingStore
    if (parsed && typeof parsed === 'object' && parsed.bindings && typeof parsed.bindings === 'object') {
      return { bindings: parsed.bindings }
    }
  } catch { /* ignore */ }
  return { bindings: {} }
}

function saveStore(store: BindingStore) {
  setAppMeta(JIMENG_SESSION_BINDING_META_KEY, JSON.stringify(store))
}

function pruneDeadBindings(store: BindingStore, liveIds: Set<string>) {
  let changed = false
  for (const [key, entry] of Object.entries(store.bindings)) {
    if (!entry?.sessionId || !liveIds.has(entry.sessionId)) {
      delete store.bindings[key]
      changed = true
    }
  }
  return changed
}

function countBindingsPerSession(store: BindingStore): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of Object.values(store.bindings)) {
    const id = entry.sessionId
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  return counts
}

/** 通道4 VIP 视频优先看 vip + purchase；过低视为不可用并改分 */
function hasUsableJimengCredit(credit: { totalCredit: number; vipCredit: number; purchaseCredit: number } | null): boolean | null {
  if (!credit) return null
  const usable = credit.vipCredit + credit.purchaseCredit
  return usable >= JIMENG_MIN_USABLE_CREDIT
}

function rankSessionsForBinding(
  sessions: JimengWebSession[],
  store: BindingStore,
  creditById: Map<string, number>,
): JimengWebSession[] {
  const counts = countBindingsPerSession(store)
  const activeId = getActiveJimengSessionId()
  return [...sessions].sort((a, b) => {
    const ca = creditById.get(a.id) ?? -1
    const cb = creditById.get(b.id) ?? -1
    const aHas = ca > 0 ? 1 : 0
    const bHas = cb > 0 ? 1 : 0
    if (aHas !== bHas) return bHas - aHas
    if (ca !== cb) return cb - ca

    const ba = counts.get(a.id) || 0
    const bb = counts.get(b.id) || 0
    if (ba !== bb) return ba - bb

    if (a.id === activeId) return 1
    if (b.id === activeId) return -1
    return String(a.updatedAt).localeCompare(String(b.updatedAt))
  })
}

async function pickSessionForNewBinding(
  sessions: JimengWebSession[],
  store: BindingStore,
  excludeIds: Set<string>,
): Promise<JimengWebSession> {
  const candidates = sessions.filter(s => !excludeIds.has(s.id))
  const pool = candidates.length ? candidates : sessions

  const creditById = new Map<string, number>()
  await Promise.all(pool.map(async (session) => {
    const credit = await getJimengUserCredit(session)
    const usable = credit ? credit.vipCredit + credit.purchaseCredit : -1
    creditById.set(session.id, usable)
  }))

  const ranked = rankSessionsForBinding(pool, store, creditById)
  const withCredit = ranked.filter(s => (creditById.get(s.id) ?? -1) >= JIMENG_MIN_USABLE_CREDIT)
  if (withCredit.length) {
    const counts = countBindingsPerSession(store)
    const unused = withCredit.filter(s => !counts.get(s.id))
    return unused[0] || withCredit[0]
  }

  // 池内均查不到正积分：仍返回最优候选，由上游返回明确错误
  return ranked[0]
}

function writeBinding(store: BindingStore, key: string, sessionId: string) {
  store.bindings[key] = { sessionId, updatedAt: new Date().toISOString() }
  saveStore(store)
}

export type ResolveJimengSessionResult = {
  session: JimengWebSession
  /** reused = 复用旧绑定；assigned = 新分配；reassigned = 原号无积分改分；override = 管理员指定；forced = 全局强制；fallback = 无项目等回退 */
  source: 'reused' | 'assigned' | 'reassigned' | 'override' | 'forced' | 'fallback'
  bindingKey: string | null
  previousSessionId?: string | null
}

export function isJimengUpstreamCreditError(message?: string | null): boolean {
  const text = String(message || '')
  return /积分不足|没有相关权益|余额不足|credit/i.test(text)
}

/**
 * 解析通道4应使用的 Session。
 * - 全局强制 Session（设置页）：所有用户发布一律用该号，忽略粘滞分配与改分
 * - 有 userId + dramaId：按粘滞规则复用 / 新分配；绑定号无积分时自动改分
 * - preferredSessionId（管理员）：强制该 Session，并写入粘滞绑定（全局强制开启时仍优先生效）
 * - 无 dramaId：回退全局启用 Session，不写绑定
 * - excludeSessionIds：强制避开（例如提交时积分不足后重试；全局强制时不改分）
 */
export async function resolveJimengSessionForUserDrama(opts: {
  userId: number
  dramaId?: number | null
  preferredSessionId?: string | null
  excludeSessionIds?: string[] | null
}): Promise<ResolveJimengSessionResult> {
  const sessions = listJimengWebSessions()
  if (!sessions.length) {
    throw new Error('即梦 Session 未配置，请管理员在「设置 → AI 服务 → 即梦 Session」中配置')
  }

  const liveIds = new Set(sessions.map(s => s.id))
  const store = loadStore()
  if (pruneDeadBindings(store, liveIds)) saveStore(store)

  const excludeIds = new Set(
    (opts.excludeSessionIds || []).map(id => String(id || '').trim()).filter(Boolean),
  )

  const userId = Number(opts.userId)
  const dramaId = opts.dramaId != null ? Number(opts.dramaId) : NaN
  const hasDrama = Number.isFinite(dramaId) && dramaId > 0
  const key = hasDrama && Number.isFinite(userId) && userId > 0
    ? bindingKey(userId, dramaId)
    : null

  const preferred = String(opts.preferredSessionId || '').trim()
  if (preferred) {
    const session = getJimengWebSession(preferred)
    if (!session) throw new Error('所选即梦 Session 不存在')
    if (key) writeBinding(store, key, session.id)
    return { session, source: 'override', bindingKey: key }
  }

  const forceId = resolveLiveJimengForceSessionId()
  if (forceId) {
    const session = getJimengWebSession(forceId)
    if (!session) throw new Error('强制使用的即梦 Session 不存在，请在设置中重新指定')
    if (key) writeBinding(store, key, session.id)
    return { session, source: 'forced', bindingKey: key }
  }

  if (key) {
    const existing = store.bindings[key]
    if (existing?.sessionId && !excludeIds.has(existing.sessionId)) {
      const session = getJimengWebSession(existing.sessionId)
      if (session) {
        const credit = await getJimengUserCredit(session)
        const usable = hasUsableJimengCredit(credit)
        if (usable !== false) {
          store.bindings[key] = { sessionId: session.id, updatedAt: new Date().toISOString() }
          saveStore(store)
          return { session, source: 'reused', bindingKey: key }
        }

        excludeIds.add(session.id)
        logTaskWarn('JimengBind', 'session-no-credit', {
          bindingKey: key,
          sessionId: session.id,
          label: session.label,
          total: credit?.totalCredit ?? 0,
          vip: credit?.vipCredit ?? 0,
        })
        const next = await pickSessionForNewBinding(sessions, store, excludeIds)
        writeBinding(store, key, next.id)
        return {
          session: next,
          source: 'reassigned',
          bindingKey: key,
          previousSessionId: session.id,
        }
      }
    }

    const session = await pickSessionForNewBinding(sessions, store, excludeIds)
    writeBinding(store, key, session.id)
    const wasRebound = existing?.sessionId && existing.sessionId !== session.id
    return {
      session,
      source: wasRebound ? 'reassigned' : 'assigned',
      bindingKey: key,
      previousSessionId: wasRebound ? existing.sessionId : null,
    }
  }

  const usablePool = sessions.filter(s => !excludeIds.has(s.id))
  const ranked = await pickSessionForNewBinding(usablePool.length ? usablePool : sessions, store, excludeIds)
  return { session: ranked, source: 'fallback', bindingKey: null }
}

export function listJimengSessionBindings() {
  const sessions = listJimengWebSessions()
  const liveIds = new Set(sessions.map(s => s.id))
  const store = loadStore()
  if (pruneDeadBindings(store, liveIds)) saveStore(store)
  return Object.entries(store.bindings).map(([key, entry]) => {
    const [uid, did] = key.split(':').map(Number)
    return {
      key,
      user_id: uid,
      drama_id: did,
      session_id: entry.sessionId,
      updated_at: entry.updatedAt,
    }
  })
}
