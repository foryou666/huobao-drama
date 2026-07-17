/**
 * 通道5：按本次上游预估消耗，优先选用「余额够用且尽量少」的小云雀号，
 * 以便尽快消化每日赠送积分（当天不用易过期）。
 */
import {
  estimateXyqUpstreamCredits,
  normalizeXyqDuration,
} from '../constants/xyq-web.js'
import { getXyqUserCredit, type XyqUserCredit } from './xyq-web-client.js'
import {
  getActiveXyqSessionId,
  getXyqWebSession,
  listXyqWebSessions,
  type XyqWebSession,
} from './xyq-web-session.js'
import { logTaskPayload, logTaskWarn } from '../utils/task-logger.js'

export type ResolveXyqSessionResult = {
  session: XyqWebSession
  source: 'override' | 'gift_low_balance' | 'enough_low_balance' | 'active_fallback' | 'any_fallback'
  estimatedNeed: number
  balance: number | null
  giftCredit: number | null
  freeCredit: number | null
  candidatesChecked: number
}

function usableBalance(credit: XyqUserCredit | null): number | null {
  if (!credit) return null
  return credit.totalCredit
}

/**
 * 优先：有足够余额的号里，余额越少越好（尽快用光赠送/尾款）。
 * 同分：赠送分优先；再偏非全局 active，分散热号。
 */
export async function resolveXyqSessionForGeneration(opts: {
  model?: string | null
  duration?: number | null
  preferredSessionId?: string | null
}): Promise<ResolveXyqSessionResult> {
  const sessions = listXyqWebSessions()
  if (!sessions.length) {
    throw new Error('S通道5 Access Key 未配置，请联系管理员')
  }

  const estimatedNeed = estimateXyqUpstreamCredits(opts.model, opts.duration)
  const preferred = String(opts.preferredSessionId || '').trim()
  if (preferred) {
    const session = getXyqWebSession(preferred)
    if (!session) throw new Error('所选S通道5 Access Key 不存在')
    const credit = await getXyqUserCredit(session)
    return {
      session,
      source: 'override',
      estimatedNeed,
      balance: usableBalance(credit),
      giftCredit: credit?.giftCredit ?? null,
      freeCredit: credit?.freeCredit ?? null,
      candidatesChecked: 1,
    }
  }

  const activeId = getActiveXyqSessionId()
  const scored = await Promise.all(sessions.map(async (session) => {
    const credit = await getXyqUserCredit(session)
    const total = usableBalance(credit)
    const gift = credit?.giftCredit ?? 0
    const free = credit?.freeCredit ?? 0
    // 免费/赠送额度更易过期，优先消化
    const perishable = gift + free
    return { session, credit, total, gift, free, perishable }
  }))

  // 有 free/gift 且够用的号优先；同档再按余额从少到多。
  const withEnough = scored
    .filter(item => item.total != null && item.total >= estimatedNeed)
    .sort((a, b) => {
      const aPerish = a.perishable > 0
      const bPerish = b.perishable > 0
      if (aPerish !== bPerish) return aPerish ? -1 : 1
      if (aPerish && bPerish && a.perishable !== b.perishable) {
        // 都有易过期额度时，先用易过期额度更少/更接近耗尽的号
        return a.perishable - b.perishable
      }
      const ta = a.total as number
      const tb = b.total as number
      if (ta !== tb) return ta - tb
      if (a.session.id === activeId) return 1
      if (b.session.id === activeId) return -1
      return String(a.session.updatedAt).localeCompare(String(b.session.updatedAt))
    })

  if (withEnough.length) {
    const best = withEnough[0]
    const source = (best.perishable > 0 && best.total != null && best.total < estimatedNeed * 3)
      ? 'gift_low_balance'
      : 'enough_low_balance'
    logTaskPayload('XyqBind', 'pick-low-balance', {
      sessionId: best.session.id,
      label: best.session.label,
      estimatedNeed,
      duration: normalizeXyqDuration(opts.duration),
      model: opts.model,
      balance: best.total,
      gift: best.gift,
      free: best.free,
      perishable: best.perishable,
      source,
      pool: withEnough.slice(0, 5).map(item => ({
        id: item.session.id,
        label: item.session.label,
        total: item.total,
        gift: item.gift,
        free: item.free,
      })),
    })
    return {
      session: best.session,
      source,
      estimatedNeed,
      balance: best.total,
      giftCredit: best.gift,
      freeCredit: best.free,
      candidatesChecked: scored.length,
    }
  }

  // 无人明确够用：退回 active / 第一个（可能 Cookie 未配导致余额未知）
  const unknown = scored.filter(item => item.total == null)
  const active = scored.find(item => item.session.id === activeId) || scored[0]
  const fallback = unknown[0] || active
  logTaskWarn('XyqBind', 'no-enough-balance', {
    estimatedNeed,
    model: opts.model,
    duration: normalizeXyqDuration(opts.duration),
    balances: scored.map(item => ({
      id: item.session.id,
      label: item.session.label,
      total: item.total,
      gift: item.gift,
      free: item.free,
    })),
    fallbackId: fallback.session.id,
  })
  return {
    session: fallback.session,
    source: unknown.length ? 'any_fallback' : 'active_fallback',
    estimatedNeed,
    balance: fallback.total,
    giftCredit: fallback.gift,
    freeCredit: fallback.free,
    candidatesChecked: scored.length,
  }
}
