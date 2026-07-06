import { CREDITS_PER_YUAN } from './credit-actions.js'

export interface RechargePackage {
  id: string
  label: string
  yuan: number
  credits: number
  bonusLabel?: string
}

/** 充值档位：1 元 = 100 积分，无赠送 */
export const RECHARGE_PACKAGES: RechargePackage[] = [
  { id: 'p1000', label: '1000 元', yuan: 1000, credits: 1000 * CREDITS_PER_YUAN },
  { id: 'p5000', label: '5000 元', yuan: 5000, credits: 5000 * CREDITS_PER_YUAN },
  { id: 'p10000', label: '10000 元', yuan: 10000, credits: 10000 * CREDITS_PER_YUAN },
  { id: 'p20000', label: '20000 元', yuan: 20000, credits: 20000 * CREDITS_PER_YUAN },
]

export function findRechargePackage(id?: string | null): RechargePackage | null {
  const key = String(id || '').trim()
  if (!key) return null
  return RECHARGE_PACKAGES.find(item => item.id === key) || null
}

export function yuanToFen(yuan: number): number {
  return Math.max(1, Math.round(yuan * 100))
}

/** 微信支付充值仅允许通过官方域名访问（非 IP 直连） */
export function isRechargeHost(host: string): boolean {
  const h = String(host || '').trim().toLowerCase().split(':')[0]
  if (!h) return false
  if (h === 'ai.weikuaiche.cn') return true
  if (h.endsWith('.weikuaiche.cn')) return true
  return false
}
