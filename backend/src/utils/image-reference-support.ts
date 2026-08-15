const IMAGE_REFERENCE_SUPPORTED = new Set(['gemini', 'minimax', 'volcengine'])

export function supportsImageReference(provider?: string | null, model?: string | null): boolean {
  const p = String(provider || '').toLowerCase()
  const m = String(model || '').toLowerCase()
  if (IMAGE_REFERENCE_SUPPORTED.has(p)) return true
  if (/gpt-image|chatgpt-image/.test(m)) return true
  if (/nano-banana/.test(m)) return true
  if (/gemini/.test(m) && (p === 'gemini' || !p)) return true
  if (/seedream|seed-edit|doubao-seed|dream5\.0/.test(m)) return true
  if (p === 'jimeng_web') return true
  if (/minimax|image-01|image-02/.test(m)) return true
  return false
}

export function imageReferenceSupportHint(): string {
  return '参考图生图需 Gemini / MiniMax / 火山 Seedream、dream5.0 pro（即梦通道4），或 gpt-image-2 等 GPT Image 模型'
}
