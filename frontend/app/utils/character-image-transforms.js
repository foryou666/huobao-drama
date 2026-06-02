const IMAGE_REFERENCE_SUPPORTED = new Set(['gemini', 'minimax', 'volcengine'])

export function supportsImageReference(provider, model = '') {
  const p = String(provider || '').toLowerCase()
  const m = String(model || '').toLowerCase()
  if (IMAGE_REFERENCE_SUPPORTED.has(p)) return true
  if (/gpt-image|chatgpt-image/.test(m)) return true
  if (/gemini/.test(m) && (p === 'gemini' || !p)) return true
  if (/seedream|seed-edit|doubao-seed/.test(m)) return true
  if (/minimax|image-01|image-02/.test(m)) return true
  return false
}

export function resolveImageConfigModel(config) {
  if (!config) return ''
  const raw = config.model
  if (Array.isArray(raw)) return raw[0] || ''
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed[0] || '') : (parsed || raw)
    } catch {
      return raw
    }
  }
  return ''
}

export function imageReferenceSupportHint() {
  return '参考图生图需 Gemini / MiniMax / 火山 Seedream，或 gpt-image-2 等 GPT Image 模型'
}

export const CHARACTER_IMAGE_TRANSFORMS = [
  { id: 'colored_pencil', label: '彩铅图', description: '转为彩铅手绘，适合 Seedance 2.0' },
  { id: 'face_red_lines', label: '脸部红线', description: '叠加红色面部定位线' },
  { id: 'face_white_mesh', label: '白色网格', description: '叠加白色网状辅助线' },
]
