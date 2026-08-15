/**
 * 通道4 图片：优先选用「积分最低且可用」的即梦账号，尽快消化每日赠送积分。
 */
import { getJimengUserCredit, type JimengUserCredit } from './jimeng-web-client.js'
import {
  getActiveJimengSessionId,
  getJimengWebSession,
  listJimengWebSessions,
  type JimengWebSession,
} from './jimeng-web-session.js'
import { logTaskPayload, logTaskWarn } from '../utils/task-logger.js'

/** 图片任务仅轮询积分大于此值的账号（避免尾款号触发「积分不足或没有相关权益」） */
export const JIMENG_IMAGE_MIN_USABLE_CREDIT = 10

export type ResolveJimengImageSessionResult = {
  session: JimengWebSession
  source: 'override' | 'lowest_balance' | 'active_fallback' | 'any_fallback'
  balance: number | null
  giftCredit: number | null
  candidatesChecked: number
}

function usableBalance(credit: JimengUserCredit | null): number | null {
  if (!credit) return null
  // 图片走赠送/VIP/购买均可；与视频不同，优先消化赠送
  return Number(credit.totalCredit) || 0
}

export async function resolveJimengSessionForImageGeneration(opts: {
  preferredSessionId?: string | null
  minCredit?: number
}): Promise<ResolveJimengImageSessionResult> {
  const sessions = listJimengWebSessions()
  if (!sessions.length) {
    throw new Error('即梦通道4 Session 未配置，请联系管理员')
  }

  const preferred = String(opts.preferredSessionId || '').trim()
  if (preferred) {
    const session = getJimengWebSession(preferred)
    if (!session) throw new Error('所选即梦 Session 不存在')
    const credit = await getJimengUserCredit(session)
    return {
      session,
      source: 'override',
      balance: usableBalance(credit),
      giftCredit: credit?.giftCredit ?? null,
      candidatesChecked: 1,
    }
  }

  const minCredit = Math.max(1, Number(opts.minCredit) || JIMENG_IMAGE_MIN_USABLE_CREDIT)
  const activeId = getActiveJimengSessionId()
  const scored = await Promise.all(sessions.map(async (session) => {
    try {
      const credit = await getJimengUserCredit(session)
      return {
        session,
        total: usableBalance(credit),
        gift: credit?.giftCredit ?? 0,
      }
    } catch (err: any) {
      logTaskWarn('JimengImageBind', 'credit-query-failed', {
        sessionId: session.id,
        label: session.label,
        error: err?.message,
      })
      return { session, total: null as number | null, gift: 0 }
    }
  }))

  // 严格大于 minCredit（默认 10），跳过尾款号
  const withEnough = scored
    .filter(item => item.total != null && (item.total as number) > minCredit)
    .sort((a, b) => {
      const ta = a.total as number
      const tb = b.total as number
      if (ta !== tb) return ta - tb
      // 同分：赠送分更少（更接近耗尽）优先
      if (a.gift !== b.gift) return a.gift - b.gift
      if (a.session.id === activeId) return 1
      if (b.session.id === activeId) return -1
      return String(a.session.updatedAt || '').localeCompare(String(b.session.updatedAt || ''))
    })

  if (withEnough.length) {
    const best = withEnough[0]
    logTaskPayload('JimengImageBind', 'pick-lowest-balance', {
      sessionId: best.session.id,
      label: best.session.label,
      balance: best.total,
      gift: best.gift,
      minCredit,
      pool: withEnough.slice(0, 6).map(item => ({
        id: item.session.id,
        label: item.session.label,
        total: item.total,
        gift: item.gift,
      })),
    })
    return {
      session: best.session,
      source: 'lowest_balance',
      balance: best.total,
      giftCredit: best.gift,
      candidatesChecked: scored.length,
    }
  }

  logTaskWarn('JimengImageBind', 'no-session-above-min', {
    minCredit,
    pool: scored.map(item => ({
      id: item.session.id,
      label: item.session.label,
      total: item.total,
      gift: item.gift,
    })),
  })
  throw new Error(`即梦通道4 无积分大于 ${minCredit} 的可用账号，请联系管理员充值或补充 Session`)
}
