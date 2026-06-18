import { sanitizeUserFacingProviderError } from '~/utils/provider-error-sanitize.js'

export function formatImageGenerationError(raw) {
  const text = String(raw || '').trim()
  if (!text) return '图片生成失败'

  const jsonStart = text.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart))
      const message = parsed?.error?.message || parsed?.message
      if (message) return sanitizeUserFacingProviderError(String(message))
    } catch {}
  }

  return sanitizeUserFacingProviderError(
    text
      .replace(/^API error \d+:\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .trim() || '图片生成失败',
  )
}

export function formatVideoGenerationError(raw) {
  return formatImageGenerationError(raw || '视频生成失败')
}
