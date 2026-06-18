/** 将火山方舟 / Seedance 官方 API 英文错误转为更易读的中文提示 */
import { sanitizeUserFacingProviderError } from './provider-error-sanitize.js'

export function formatVolcengineVideoError(raw: string, provider?: string): string {  const message = String(raw || '').trim()
  if (!message) return '视频生成失败'

  const lower = message.toLowerCase()

  if (lower.includes('reference media mode requires audio role to be reference_audio')) {
    return '参考音频格式不符合官方要求（需 reference_audio），请刷新页面后重试；若仍失败请联系管理员更新后端'
  }
  if (lower.includes('reference media mode requires') && lower.includes('reference_image')) {
    return '参考图格式不符合官方要求，请确认已绑定角色/场景参考图并重试'
  }
  if (lower.includes('real person') || lower.includes('inputimagesensitivecontentdetected.privacyinformation')) {
    return '参考图可能含真人肖像。官方 Seedance 需先将角色立绘「提交方舟素材库」后再用 asset:// 引用，或改用插画风格立绘'
  }
  if (lower.includes('sensitive') || lower.includes('inputtextsensitivecontentdetected')) {
    return '提示词或参考图触发内容安全审核，请调整描述或更换参考图后重试'
  }
  if (lower.includes('authenticationerror') || lower.includes('api key format is incorrect')) {
    if (provider === 'volcengine') {
      return '火山方舟 API Key 无效或格式错误，请在「设置 → AI 配置」中更新「火山方舟 Seedance-视频」的 API Key'
    }
    return 'API 认证失败，请检查服务配置中的 API Key'
  }

  return sanitizeUserFacingProviderError(message)
}

export function extractVolcengineApiErrorMessage(errText: string): string {
  try {
    const parsed = JSON.parse(errText)
    return String(
      parsed?.error?.message
      || parsed?.message
      || parsed?.error
      || '',
    ).trim()
  } catch {
    return errText.replace(/\s+/g, ' ').trim()
  }
}
