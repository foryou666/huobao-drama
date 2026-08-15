/** 归一化为 480p / 720p 展示标签 */
export function normalizeVideoResolutionLabel(raw) {
  const s = String(raw || '').trim().toLowerCase()
  if (s === '480p' || s === '720p') return s
  if (s.includes('480')) return '480p'
  if (s.includes('720')) return '720p'
  return ''
}

/** 从 ledger 行推断分辨率；无字段时按通道默认（通道2=480p，通道4=720p）或宽高回退 */
export function inferVideoResolutionLabel(item) {
  const fromField = normalizeVideoResolutionLabel(item?.resolution)
  if (fromField) return fromField

  const h = Number(item?.height)
  const w = Number(item?.width)
  if (Number.isFinite(h) && h > 0) {
    if (h <= 488 || (Number.isFinite(w) && w > 0 && w <= 864)) return '480p'
    return '720p'
  }

  const provider = String(item?.provider || '').trim()
  if (provider === 'jimeng_web') return '720p'
  if (provider === 'volcengine') return '480p'
  return ''
}

export function modelTagWithResolution(item, modelLabelFn) {
  const label = modelLabelFn(item?.model)
  if (!label) return ''
  const res = inferVideoResolutionLabel(item)
  return res ? `${label} ${res}` : label
}
