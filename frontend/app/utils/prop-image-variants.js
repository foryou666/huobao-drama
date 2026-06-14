function normalizePath(raw) {
  return String(raw || '').trim().replace(/^\/+/, '')
}

export function parsePropViewImages(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(item => ({
        view_id: String(item?.view_id || item?.viewId || item?.angle_id || item?.angleId || ''),
        label: String(item?.label || '参考图'),
        url: normalizePath(item?.url || ''),
      }))
      .filter(item => item.view_id && item.url)
  } catch {
    return []
  }
}

export function listPropImages(prop) {
  const primaryUrl = normalizePath(prop?.image_url || prop?.imageUrl || prop?.local_path || prop?.localPath || '')
  const items = []
  if (primaryUrl) items.push({ view_id: 'hero', label: '主图', url: primaryUrl })
  for (const entry of parsePropViewImages(prop?.reference_images || prop?.referenceImages)) {
    if (!items.some(item => item.view_id === entry.view_id)) items.push(entry)
  }
  return items
}

export function resolvePropImageUrl(prop, refs = {}) {
  const propId = Number(prop?.id)
  const selected = Number.isFinite(propId) ? refs[propId] : null
  if (selected) return normalizePath(selected)
  const images = listPropImages(prop)
  return images.find(img => img.view_id === 'hero')?.url || images[0]?.url || ''
}

export function parseStoryboardPropImageRefs(sb) {
  const raw = sb?.prop_image_refs ?? sb?.propImageRefs
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(raw)
        .map(([key, value]) => [Number(key), normalizePath(String(value || ''))])
        .filter(([key, value]) => Number.isFinite(key) && value),
    )
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parseStoryboardPropImageRefs({ prop_image_refs: parsed })
      }
    } catch { /* ignore */ }
  }
  return {}
}

export function resolvePropImageForStoryboard(prop, storyboard) {
  const refs = parseStoryboardPropImageRefs(storyboard)
  return normalizePath(resolvePropImageUrl(prop, refs)) || ''
}
