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

function normalizeOutfitCandidate(raw) {
  if (!raw || typeof raw !== 'object') return null
  const url = normalizePath(raw.url)
  const id = String(raw.id || '').trim()
  if (!url || !id) return null
  return {
    id,
    url,
    label: raw.label ? String(raw.label) : undefined,
    created_at: raw.created_at,
  }
}

function normalizeOutfitEntry(item) {
  const outfitId = String(item.outfit_id || '').trim()
  if (!outfitId) return null

  const url = normalizePath(item.url || '')
  const rawCandidates = Array.isArray(item.candidates) ? item.candidates : []
  const candidates = rawCandidates
    .map(normalizeOutfitCandidate)
    .filter(Boolean)
    .filter((entry, index, list) => list.findIndex(other => normalizePath(other.url) === normalizePath(entry.url)) === index)

  if (!candidates.length && url) {
    candidates.push({ id: 'default', url, label: '定稿', created_at: item.created_at })
  }

  const resolvedUrl = url || candidates[0]?.url || ''
  if (!resolvedUrl) return null

  return {
    kind: 'outfit',
    outfit_id: outfitId,
    label: String(item.label || '服装'),
    url: resolvedUrl,
    costume_asset_id: item.costume_asset_id ?? null,
    candidates,
    variants: item.variants && typeof item.variants === 'object' ? item.variants : {},
    created_at: item.created_at,
  }
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
  if (isOutfitEntry(item)) return normalizeOutfitEntry(item)
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

function pushUniqueImage(items, next) {
  const url = normalizePath(next.url)
  if (!url) return
  if (items.some(item => normalizePath(item.url) === url)) return
  items.push(next)
}

export function listCharacterImages(char) {
  const primaryUrl = normalizePath(char?.image_url || char?.imageUrl || char?.local_path || char?.localPath || '')
  const items = []
  if (primaryUrl) items.push({ url: primaryUrl, label: '原图', variant: 'primary', source: 'primary' })

  for (const entry of parseCharacterReferenceEntries(char?.reference_images ?? char?.referenceImages)) {
    if (isOutfitEntry(entry)) {
      const defaultUrl = normalizePath(entry.url)
      if (defaultUrl) {
        pushUniqueImage(items, {
          url: defaultUrl,
          label: `${entry.label} · 定稿`,
          outfit_id: entry.outfit_id,
          source: 'outfit',
          is_default: true,
          created_at: entry.created_at,
        })
      }

      for (const candidate of entry.candidates || []) {
        const candidateUrl = normalizePath(candidate.url)
        if (!candidateUrl || candidateUrl === defaultUrl) continue
        pushUniqueImage(items, {
          url: candidateUrl,
          label: `${entry.label} · ${candidate.label || '备选'}`,
          outfit_id: entry.outfit_id,
          candidate_id: candidate.id,
          source: 'outfit',
          created_at: candidate.created_at,
        })
      }

      for (const [variantId, variant] of Object.entries(entry.variants || {})) {
        const url = normalizePath(variant?.url || '')
        if (!url) continue
        pushUniqueImage(items, {
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
    pushUniqueImage(items, { ...entry, source: 'primary' })
  }
  return items
}

export function listPrimaryCharacterImages(char) {
  return listCharacterImages(char).filter(item => item.source === 'primary')
}

export function characterImageTagType(img) {
  if (img?.variant === 'primary') return 'primary'
  if (img?.is_default) return 'outfit-default'
  if (img?.variant) return 'transform'
  if (img?.outfit_id) return 'outfit-candidate'
  return 'variant'
}

export function characterImageTagLabel(img, options = {}) {
  if (!img) return '图片'
  const short = !!options.short
  if (img.variant === 'primary') return short ? '原图' : '基准原图'
  if (img.is_default) {
    const outfitName = String(img.label || '').replace(/ · 定稿$/, '') || '服装'
    return short ? `${outfitName}·定稿` : (img.label || `${outfitName} · 定稿`)
  }
  if (img.variant) {
    const parts = String(img.label || '').split(' · ')
    return short ? (parts[parts.length - 1] || img.label || '风格') : (img.label || '风格')
  }
  if (img.outfit_id) {
    const parts = String(img.label || '').split(' · ')
    return short ? (parts[parts.length - 1] || '备选') : (img.label || '备选')
  }
  return img.label || '变体'
}

function parseOutfitLabelFromImage(img) {
  const raw = String(img?.label || img?.tag || '').trim()
  if (!raw) return ''
  return raw
    .replace(/ · 定稿$/, '')
    .replace(/·定稿$/, '')
    .split(' · ')[0]
    .split('·')[0]
    .trim()
}

/** 从资产库 character_media 还原服装分组（兼容旧 API 无 outfit_previews） */
export function resolveOutfitPreviewsFromMedia(media) {
  if (!media) return []
  const direct = media.outfit_previews || media.outfitPreviews
  if (direct?.length) return direct

  const images = media.preview_images || media.previewImages || []
  const groups = new Map()

  for (const img of images) {
    const outfitId = img.outfit_id || img.outfitId
    if (!outfitId) continue

    let group = groups.get(outfitId)
    if (!group) {
      group = {
        outfit_id: outfitId,
        label: parseOutfitLabelFromImage(img) || outfitId,
        url: '',
        candidate_count: 0,
        candidates: [],
      }
      groups.set(outfitId, group)
    }

    const isDefault = !!(img.is_default || img.isDefault || String(img.tag || '').includes('定稿'))
    const candLabel = isDefault
      ? '定稿'
      : (String(img.label || '').split(' · ').pop() || img.tag || '备选')
    group.candidates.push({
      id: img.candidate_id || img.candidateId || img.url,
      url: img.url,
      label: candLabel,
      is_default: isDefault,
    })
    if (isDefault || !group.url) group.url = img.url
    if (!group.label || group.label === outfitId) {
      const parsed = parseOutfitLabelFromImage(img)
      if (parsed) group.label = parsed
    }
  }

  return [...groups.values()].map(group => {
    const url = normalizePath(group.url || group.candidates[0]?.url || '')
    const candidates = group.candidates.map(candidate => ({
      ...candidate,
      is_default: normalizePath(candidate.url) === url,
    }))
    return {
      ...group,
      url,
      candidate_count: candidates.length,
      candidates,
    }
  })
}

export function listCharacterOutfitPreviews(char) {
  return listCharacterOutfits(char).map(outfit => ({
    outfit_id: outfit.outfit_id,
    label: outfit.label,
    url: outfit.url,
    candidate_count: outfit.candidates?.length || 0,
    candidates: (outfit.candidates || []).map(candidate => ({
      id: candidate.id,
      url: candidate.url,
      label: candidate.label || '备选',
      is_default: normalizePath(candidate.url) === normalizePath(outfit.url),
    })),
  }))
}

export function summarizeCharacterMedia(char) {
  const outfits = listCharacterOutfits(char)
  const images = listCharacterImages(char)
  const primaryUrl = normalizePath(char?.image_url || char?.imageUrl || char?.local_path || char?.localPath || '') || null
  return {
    outfit_count: outfits.length,
    candidate_count: outfits.reduce((sum, outfit) => sum + (outfit.candidates?.length || 0), 0),
    transform_count: images.filter(item => item.variant && item.variant !== 'primary').length,
    image_count: images.length,
    primary_url: primaryUrl,
    outfit_previews: listCharacterOutfitPreviews(char),
    // 与 listCharacterOutfitPreviews 相同；供资产库直接读取
    preview_images: images.map(item => ({
      url: item.url,
      label: item.label,
      tag: characterImageTagLabel(item, { short: true }),
      tag_type: characterImageTagType(item),
      source: item.source,
      is_default: item.is_default,
      outfit_id: item.outfit_id,
      variant: item.variant,
    })),
  }
}

export function characterCoverBadgeText(char) {
  const hasPrimary = !!(char?.image_url || char?.imageUrl || char?.local_path || char?.localPath)
  const summary = summarizeCharacterMedia(char)
  if (!hasPrimary) return '待生成'
  if (summary.outfit_count > 0) return `基准+${summary.outfit_count}套`
  if (summary.image_count > 1) return `${summary.image_count}张造型`
  return '基准图'
}

export function isOutfitCandidateDefault(outfit, candidate) {
  if (!outfit || !candidate) return false
  return normalizePath(outfit.url) === normalizePath(candidate.url)
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
  if (item.is_default) return item.label?.replace(/ · 定稿$/, '') ? `${item.label}` : '定稿'
  return item.label || '变体'
}

export function charTransformKey(charId, transformId, source = 'primary') {
  return `${charId}:${source}:${transformId}`
}

export function charOutfitKey(charId, outfitId) {
  return `${charId}:outfit:${outfitId}`
}

export function slugifyOutfitId(name, assetId = null) {
  const base = String(name || 'outfit')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .slice(0, 32) || 'outfit'
  return assetId ? `costume_${assetId}` : `${base}_${Date.now()}`
}
