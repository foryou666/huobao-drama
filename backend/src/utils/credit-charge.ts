import type { Context } from 'hono'
import { CREDIT_ACTIONS } from '../constants/credit-actions.js'
import { chargeCredits, getActionCost, getUserBalance, refundCreditTransaction, type ChargeContext } from '../services/credits.js'
import { getAuthUser } from '../middleware/auth.js'
import { paymentRequired } from '../utils/response.js'

export { CREDIT_ACTIONS, refundCreditTransaction }

export function tryChargeUser(
  c: Context,
  action: string,
  context: ChargeContext = {},
) {
  const user = getAuthUser(c)
  const result = chargeCredits(user.id, action, context)
  if (!result.ok) {
    return {
      error: paymentRequired(c, result.message || '积分不足', {
        required: result.cost,
        balance: result.balance,
      }),
    }
  }
  return { charge: result, user }
}

export function tryRefundCharge(
  transactionId: number | undefined,
  context: ChargeContext & { metadata?: Record<string, unknown> } = {},
) {
  if (!transactionId) return null
  return refundCreditTransaction(transactionId, context)
}

/** 批量生成前校验余额是否足够（按张数 × 单价） */
export function tryPreflightBatchCharge(c: Context, action: string, count: number) {
  const user = getAuthUser(c)
  const unitCost = getActionCost(action, 1)
  const required = getActionCost(action, count)
  const balance = getUserBalance(user.id)
  if (balance < required) {
    return {
      error: paymentRequired(c, `积分不足：批量操作需要 ${required} 积分（${count} 张 × ${unitCost}），当前 ${balance} 积分`, {
        required,
        balance,
      }),
    }
  }
  return { user, unitCost, required, balance }
}

/** 批量中单张扣费（quantity=1，便于失败时按张退款） */
export function chargeBatchItem(userId: number, action: string, context: ChargeContext = {}) {
  return chargeCredits(userId, action, { ...context, quantity: 1 })
}
