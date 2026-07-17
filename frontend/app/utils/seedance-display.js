/**
 * 用户可见文案：Seedance → S（如 Seedance 2.0 Fast VIP → S 2.0 Fast VIP）
 * 不改动内部 model id / API 字段。
 */
export function toSeedanceDisplayLabel(text) {
  const raw = String(text ?? '')
  if (!raw) return raw
  return raw
    .replace(/seedance/gi, 'S')
    .replace(/S(?=\d)/g, 'S ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * 通道3 线路标题：去掉 480P，再做 Seedance→S。
 * 例：视频-Seedance2.0-480P-推荐1 → 视频-S 2.0-推荐1
 */
export function toAistarslabChannelDisplayTitle(text) {
  const original = String(text ?? '').trim()
  if (!original) return original
  let value = original.replace(/480\s*[Pp]/g, '')
  value = value.replace(/[-—_·]{2,}/g, '-').replace(/^[-—_·\s]+|[-—_·\s]+$/g, '')
  value = value.replace(/\s{2,}/g, ' ').trim()
  return toSeedanceDisplayLabel(value || original)
}
