export function formatProviderError(raw: string): string {
  const text = String(raw || '').trim()
  if (!text) return '图片生成失败'

  const jsonStart = text.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart))
      const message = parsed?.error?.message || parsed?.message
      if (message) return String(message)
    } catch {}
  }

  return text
    .replace(/^API error \d+:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim() || '图片生成失败'
}
