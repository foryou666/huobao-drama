/** 上游余额/额度不足时展示给用户的固定文案（不暴露真实成本与金额） */
export const UPSTREAM_BALANCE_SHORTAGE_USER_MESSAGE = '生成失败：服务账户余额不足，请联系管理员'

/** 检测是否含上游余额、金额、额度等敏感定价信息 */
export function isUpstreamBalanceOrPriceLeak(message?: string | null): boolean {
  const text = String(message || '').trim()
  if (!text) return false

  // 已是脱敏后的固定文案
  if (text === UPSTREAM_BALANCE_SHORTAGE_USER_MESSAGE) return false

  // 本平台积分扣费提示（非上游），保留原样
  if (/^积分不足：本次需要\s+\d+\s+积分/.test(text)) return false
  if (/^积分不足：批量操作需要/.test(text)) return false

  const lower = text.toLowerCase()

  // 上游常返回人民币金额
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

/** 面向用户的错误文案：屏蔽上游余额与真实金额，并隐藏上游品牌名 */
export function sanitizeUserFacingProviderError(message?: string | null): string {
  let text = String(message || '').trim()
  if (!text) return text
  if (isUpstreamBalanceOrPriceLeak(text)) return UPSTREAM_BALANCE_SHORTAGE_USER_MESSAGE
  // 对外统一用导航名，不暴露上游品牌
  text = text.replace(/小云雀/g, 'S通道5')
  return text
}
