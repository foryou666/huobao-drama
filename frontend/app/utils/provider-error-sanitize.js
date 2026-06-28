/** 上游余额/额度不足时展示给用户的固定文案（不暴露真实成本与金额） */
export const UPSTREAM_BALANCE_SHORTAGE_USER_MESSAGE = '生成失败：服务账户余额不足，请联系管理员'

export function isUpstreamBalanceOrPriceLeak(message) {
  const text = String(message || '').trim()
  if (!text) return false

  if (text === UPSTREAM_BALANCE_SHORTAGE_USER_MESSAGE) return false

  if (/^积分不足：本次需要\s+\d+\s+积分/.test(text)) return false
  if (/^积分不足：批量操作需要/.test(text)) return false

  const lower = text.toLowerCase()

  if (/元/.test(text)) return true
  if (/💰/.test(text)) return true
  if (/预扣费|剩余额度|需要预扣费/.test(text)) return true
  if (/上游未返回任务/.test(text)) return true
  if (/可用余额/.test(text) && /元|余额不足/.test(text)) return true

  if (/余额不足|额度不足|次数.*用完|充值|insufficient|quota|depleted|no\s*credit/.test(lower)) {
    return true
  }
  if (/requires\s+[\d.]+/i.test(text)) return true
  if (/"required"\s*:\s*[\d.]+/.test(text) && /"balance"\s*:\s*[\d.]+/.test(text)) {
    return true
  }
  if (/上游未返回任务/.test(text) && /积分不足|余额/.test(text)) {
    return true
  }
  if (/(?:balance|required|amount|cost|price|yuan|rmb|¥)/i.test(text)
    && /(?:不足|insufficient|not enough|exceed|用完)/i.test(text)) {
    return true
  }

  return false
}

export function sanitizeUserFacingProviderError(message) {
  const text = String(message || '').trim()
  if (!text) return text
  if (isUpstreamBalanceOrPriceLeak(text)) return UPSTREAM_BALANCE_SHORTAGE_USER_MESSAGE
  return text
}
