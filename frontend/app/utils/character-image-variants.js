import { CHARACTER_IMAGE_TRANSFORMS } from './character-image-transforms.js'

const TRANSFORM_LABELS = Object.fromEntries(
  CHARACTER_IMAGE_TRANSFORMS.map(item => [item.id, item.label]),
)

function normalizePath(raw) {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function isOutfitEntry(item) {
  return item?.kind === 'outfit'
}

export function parseCharacterReferenceEntries(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(normalizeReferenceEntry).filter(Boolean)
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeReferenceEntry).filter(Boolean)
  } catch {
    return []
  }
}

/** @deprecated */
export function parseCharacterImageVariants(raw) {
  return parseCharacterReferenceEntries(raw).filter(item => !isOutfitEntry(item))
}

function normalizeReferenceEntry(item) {
  if (typeof item === 'string') {
    const url = normalizePath(item)
    return url ? { url, label: '变体' } : null
  }
  if (isOutfitEntry(item)) {
    const url = normalizePath(item.url)
    if (!url || !item.outfit_id) return null
    return {
      kind: 'outfit',
      outfit_id: String(item.outfit_id),
      label: String(item.label || '服装'),
      url,
      costume_asset_id: item.costume_asset_id ?? null,
      variants: item.variants && typeof item.variants === 'object' ? item.variants : {},
      created_at: item.created_at,
    }
  }
  const url = normalizePath(item?.url || '')
  if (!url) return null
  return {
    url,
    label: String(item?.label || item?.variant || '变体'),
    variant: item?.variant ? String(item.variant) : undefined,
    created_at: item?.created_at,
  }
}

export function listCharacterOutfits(char) {
  const raw = char?.reference_images ?? char?.referenceImages
  return parseCharacterReferenceEntries(raw).filter(isOutfitEntry)
}

export function listCharacterImages(char) {
  const primaryUrl = normalizePath(char?.image_url || char?.imageUrl || char?.local_path || char?.localPath || '')
  const items = []
  if (primaryUrl) items.push({ url: primaryUrl, label: '原图', variant: 'primary', source: 'primary' })

  for (const entry of parseCharacterReferenceEntries(char?.reference_images ?? char?.referenceImages)) {
    if (isOutfitEntry(entry)) {
      if (!items.some(item => normalizePath(item.url) === normalizePath(entry.url))) {
        items.push({
          url: entry.url,
          label: entry.label,
          outfit_id: entry.outfit_id,
          source: 'outfit',
          created_at: entry.created_at,
        })
      }
      for (const [variantId, variant] of Object.entries(entry.variants || {})) {
        const url = normalizePath(variant?.url || '')
        if (!url || items.some(item => normalizePath(item.url) === url)) continue
        items.push({
          url,
          label: `${entry.label} · ${TRANSFORM_LABELS[variantId] || variantId}`,
          variant: variantId,
          outfit_id: entry.outfit_id,
          source: 'outfit',
          created_at: variant.created_at,
        })
      }
      continue
    }
    if (items.some(item => normalizePath(item.url) === normalizePath(entry.url))) continue
    items.push({ ...entry, source: 'primary' })
  }
  return items
}

export function parseStoryboardCharacterImageRefs(sb) {
  const raw = sb?.character_image_refs ?? sb?.characterImageRefs
  if (!raw) return {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const map = {}
    for (const [key, value] of Object.entries(raw)) {
      const id = Number(key)
      const url = normalizePath(value)
      if (Number.isFinite(id) && id > 0 && url) map[id] = url
    }
    return map
  }
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map = {}
    for (const [key, value] of Object.entries(parsed)) {
      const id = Number(key)
      const url = normalizePath(value)
      if (Number.isFinite(id) && id > 0 && url) map[id] = url
    }
    return map
  } catch {
    return {}
  }
}

export function resolveCharacterImageUrl(char, storyboardRefs) {
  const selected = storyboardRefs?.[char?.id]
  if (selected) return normalizePath(selected)
  return normalizePath(char?.image_url || char?.imageUrl || '') || null
}

export function variantLabel(item) {
  if (!item) return '图片'
  if (item.variant === 'primary') return '原图'
  return item.label || '变体'
}

export function charTransformKey(charId, transformId, source = 'primary') {
  return `${charId}:${source}:${transformId}`
}

export function charOutfitKey(charId, outfitId) {
  return `${charId}:outfit:${outfitId}`
}
