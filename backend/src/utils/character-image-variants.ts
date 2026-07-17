import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from './response.js'
import { getCharacterTransformPreset } from './character-image-transforms.js'

export interface CharacterImageVariant {
  url: string
  label: string
  variant?: string
  outfit_id?: string
  candidate_id?: string
  is_default?: boolean
  source?: 'primary' | 'outfit'
  created_at?: string
}

export interface CharacterOutfitVariant {
  url: string
  created_at?: string
}

export interface CharacterOutfitCandidate {
  id: string
  url: string
  label?: string
  created_at?: string
}

export interface CharacterOutfit {
  kind: 'outfit'
  outfit_id: string
  label: string
  url: string
  costume_asset_id?: number | null
  candidates?: CharacterOutfitCandidate[]
  variants?: Record<string, CharacterOutfitVariant>
  created_at?: string
}

type ReferenceEntry = CharacterImageVariant | CharacterOutfit

function normalizePath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function isOutfitEntry(item: unknown): item is CharacterOutfit {
  return !!item && typeof item === 'object' && (item as CharacterOutfit).kind === 'outfit'
}

function normalizeOutfitCandidate(raw: unknown): CharacterOutfitCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as CharacterOutfitCandidate
  const url = normalizePath(item.url || '')
  const id = String(item.id || '').trim()
  if (!url || !id) return null
  return {
    id,
    url,
    label: item.label ? String(item.label) : undefined,
    created_at: item.created_at ? String(item.created_at) : undefined,
  }
}

function normalizeOutfitEntry(item: CharacterOutfit): CharacterOutfit | null {
  const outfitId = String(item.outfit_id || '').trim()
  if (!outfitId) return null

  const url = normalizePath(item.url || '')
  const rawCandidates = Array.isArray(item.candidates) ? item.candidates : []
  const candidates = rawCandidates
    .map(normalizeOutfitCandidate)
    .filter((entry): entry is CharacterOutfitCandidate => !!entry)
    .filter((entry, index, list) => list.findIndex(other => normalizePath(other.url) === normalizePath(entry.url)) === index)

  if (!candidates.length && url) {
    candidates.push({
      id: 'default',
      url,
      label: '定稿',
      created_at: item.created_at,
    })
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
    created_at: item.created_at ? String(item.created_at) : undefined,
  }
}

export function parseCharacterReferenceEntries(raw?: string | null): ReferenceEntry[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const items: ReferenceEntry[] = []
    for (const item of parsed) {
      if (typeof item === 'string') {
        const url = normalizePath(item)
        if (url) items.push({ url, label: '变体' })
        continue
      }
      if (isOutfitEntry(item)) {
        const outfit = normalizeOutfitEntry(item)
        if (outfit) items.push(outfit)
        continue
      }
      const url = normalizePath(item?.url || '')
      if (!url) continue
      items.push({
        url,
        label: String(item?.label || item?.variant || '变体'),
        variant: item?.variant ? String(item.variant) : undefined,
        created_at: item?.created_at ? String(item.created_at) : undefined,
      })
    }
    return items
  } catch {
    return []
  }
}

/** @deprecated use parseCharacterReferenceEntries */
export function parseCharacterImageVariants(raw?: string | null): CharacterImageVariant[] {
  return parseCharacterReferenceEntries(raw).filter((item): item is CharacterImageVariant => !isOutfitEntry(item))
}

export function serializeCharacterReferenceEntries(items: ReferenceEntry[]): string {
  return JSON.stringify(items)
}

export function listCharacterOutfits(raw?: string | null): CharacterOutfit[] {
  return parseCharacterReferenceEntries(raw).filter(isOutfitEntry)
}

export function findCharacterOutfit(raw: string | null | undefined, outfitId: string): CharacterOutfit | null {
  return listCharacterOutfits(raw).find(item => item.outfit_id === outfitId) || null
}

export function findCharacterOutfitByAssetId(raw: string | null | undefined, assetId: number): CharacterOutfit | null {
  return listCharacterOutfits(raw).find(item => item.costume_asset_id === assetId) || null
}

function pushUniqueImage(items: CharacterImageVariant[], next: CharacterImageVariant) {
  const url = normalizePath(next.url)
  if (!url) return
  if (items.some(item => normalizePath(item.url) === url)) return
  items.push(next)
}

export function listCharacterImages(char: {
  imageUrl?: string | null
  localPath?: string | null
  referenceImages?: string | null
}): CharacterImageVariant[] {
  const primaryUrl = normalizePath(char.imageUrl || char.localPath || '')
  const items: CharacterImageVariant[] = []
  if (primaryUrl) {
    items.push({ url: primaryUrl, label: '原图', variant: 'primary', source: 'primary' })
  }

  for (const entry of parseCharacterReferenceEntries(char.referenceImages)) {
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
        const preset = getCharacterTransformPreset(variantId)
        const url = normalizePath(variant?.url || '')
        if (!url) continue
        pushUniqueImage(items, {
          url,
          label: `${entry.label} · ${preset?.label || variantId}`,
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

export function listPrimaryCharacterImages(char: {
  imageUrl?: string | null
  localPath?: string | null
  referenceImages?: string | null
}): CharacterImageVariant[] {
  return listCharacterImages(char).filter(item => item.source === 'primary')
}

export type CharacterImageTagType = 'primary' | 'outfit-default' | 'outfit-candidate' | 'transform' | 'variant'

export function characterImageTagType(img: CharacterImageVariant): CharacterImageTagType {
  if (img.variant === 'primary') return 'primary'
  if (img.is_default) return 'outfit-default'
  if (img.variant) return 'transform'
  if (img.outfit_id) return 'outfit-candidate'
  return 'variant'
}

export function characterImageTagLabel(
  img: CharacterImageVariant,
  options?: { short?: boolean },
): string {
  if (!img) return '图片'
  const short = !!options?.short
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

export interface CharacterOutfitPreview {
  outfit_id: string
  label: string
  url: string
  candidate_count: number
  candidates: Array<{
    id: string
    url: string
    label: string
    is_default: boolean
  }>
}

export interface CharacterMediaSummary {
  outfit_count: number
  candidate_count: number
  transform_count: number
  image_count: number
  primary_url: string | null
  /** 列表封面：基准图优先，否则取造型定稿 */
  cover_url?: string | null
  outfit_previews: CharacterOutfitPreview[]
  preview_images: Array<{
    url: string
    label: string
    tag: string
    tag_type: CharacterImageTagType
    source?: 'primary' | 'outfit'
    is_default?: boolean
    outfit_id?: string
    variant?: string
  }>
}

export function resolveCharacterCoverUrl(media?: {
  primary_url?: string | null
  primaryUrl?: string | null
  cover_url?: string | null
  coverUrl?: string | null
  preview_images?: Array<{ url?: string | null }>
  previewImages?: Array<{ url?: string | null }>
  outfit_previews?: Array<{ url?: string | null }>
  outfitPreviews?: Array<{ url?: string | null }>
} | null): string | null {
  if (!media) return null
  const explicit = normalizePath(media.cover_url || media.coverUrl || '')
  if (explicit) return explicit
  const primary = normalizePath(media.primary_url || media.primaryUrl || '')
  if (primary) return primary
  const previews = media.preview_images || media.previewImages || []
  const previewUrl = normalizePath(previews[0]?.url || '')
  if (previewUrl) return previewUrl
  const outfits = media.outfit_previews || media.outfitPreviews || []
  for (const outfit of outfits) {
    const url = normalizePath(outfit?.url || '')
    if (url) return url
  }
  return null
}

export function listCharacterOutfitPreviews(char: {
  imageUrl?: string | null
  localPath?: string | null
  referenceImages?: string | null
}): CharacterOutfitPreview[] {
  return listCharacterOutfits(char.referenceImages).map(outfit => ({
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

export function summarizeCharacterMedia(char: {
  imageUrl?: string | null
  localPath?: string | null
  referenceImages?: string | null
}): CharacterMediaSummary {
  const outfits = listCharacterOutfits(char.referenceImages)
  const images = listCharacterImages(char)
  const primaryUrl = normalizePath(char.imageUrl || char.localPath || '') || null
  const outfitPreviews = listCharacterOutfitPreviews(char)
  const summary: CharacterMediaSummary = {
    outfit_count: outfits.length,
    candidate_count: outfits.reduce((sum, outfit) => sum + (outfit.candidates?.length || 0), 0),
    transform_count: images.filter(item => item.variant && item.variant !== 'primary').length,
    image_count: images.length,
    primary_url: primaryUrl,
    outfit_previews: outfitPreviews,
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
  summary.cover_url = resolveCharacterCoverUrl(summary)
  return summary
}

/** 资产库列表：省略冗余 preview_images，降低 JSON 体积与序列化开销 */
export function summarizeCharacterMediaForAssetList(char: {
  imageUrl?: string | null
  localPath?: string | null
  referenceImages?: string | null
}): CharacterMediaSummary {
  const outfits = listCharacterOutfits(char.referenceImages)
  const primaryUrl = normalizePath(char.imageUrl || char.localPath || '') || null
  const outfitPreviews = listCharacterOutfitPreviews(char)
  let candidateCount = 0
  let transformCount = 0
  for (const outfit of outfits) {
    candidateCount += outfit.candidates?.length || 0
    transformCount += Object.keys(outfit.variants || {}).length
  }
  const imageCount = (primaryUrl ? 1 : 0)
    + outfitPreviews.reduce((sum, outfit) => sum + Math.max(1, outfit.candidate_count || 0), 0)
    + transformCount

  const summary: CharacterMediaSummary = {
    outfit_count: outfits.length,
    candidate_count: candidateCount,
    transform_count: transformCount,
    image_count: imageCount,
    primary_url: primaryUrl,
    outfit_previews: outfitPreviews,
    preview_images: outfits.length === 0 && primaryUrl
      ? [{
          url: primaryUrl,
          label: '原图',
          tag: '原图',
          tag_type: 'primary',
          source: 'primary',
        }]
      : [],
  }
  summary.cover_url = resolveCharacterCoverUrl(summary)
  return summary
}

function writeReferenceEntries(characterId: number, entries: ReferenceEntry[]) {
  db.update(schema.characters)
    .set({ referenceImages: serializeCharacterReferenceEntries(entries), updatedAt: now() })
    .where(eq(schema.characters.id, characterId))
    .run()
}

function loadCharacterEntries(characterId: number) {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char) return null
  const existing = parseCharacterReferenceEntries(char.referenceImages)
  return {
    char,
    styleVariants: existing.filter(item => !isOutfitEntry(item)) as CharacterImageVariant[],
    outfits: existing.filter(isOutfitEntry),
  }
}

export function appendCharacterImageVariant(
  characterId: number,
  url: string,
  variantId?: string | null,
  label?: string | null,
): CharacterImageVariant[] {
  const loaded = loadCharacterEntries(characterId)
  if (!loaded) return []

  const preset = variantId ? getCharacterTransformPreset(variantId) : null
  const resolvedLabel = label || preset?.label || '变体'
  const normalizedUrl = normalizePath(url)
  const nextStyles = loaded.styleVariants.filter(item => item.variant !== variantId)
  nextStyles.push({
    url: normalizedUrl,
    label: resolvedLabel,
    variant: variantId || undefined,
    created_at: now(),
  })

  writeReferenceEntries(characterId, [...nextStyles, ...loaded.outfits])
  return listCharacterImages({
    ...loaded.char,
    referenceImages: serializeCharacterReferenceEntries([...nextStyles, ...loaded.outfits]),
  })
}

export function appendCharacterOutfitImage(
  characterId: number,
  input: {
    outfitId: string
    label: string
    url: string
    costumeAssetId?: number | null
    candidateLabel?: string
    setAsDefault?: boolean
  },
): CharacterOutfit[] {
  const loaded = loadCharacterEntries(characterId)
  if (!loaded) return []

  const normalizedUrl = normalizePath(input.url)
  if (!normalizedUrl) return listCharacterOutfits(loaded.char.referenceImages)

  const outfits = [...loaded.outfits]
  const idx = outfits.findIndex(item => item.outfit_id === input.outfitId)
  const prev = idx >= 0 ? outfits[idx] : null
  const candidates = [...(prev?.candidates || [])]
  const existingCandidate = candidates.find(item => normalizePath(item.url) === normalizedUrl)
  const candidateId = existingCandidate?.id || `v_${Date.now()}`
  const candidateLabel = input.candidateLabel
    || existingCandidate?.label
    || (prev ? `备选${candidates.length + 1}` : '定稿')

  if (!existingCandidate) {
    candidates.push({
      id: candidateId,
      url: normalizedUrl,
      label: candidateLabel,
      created_at: now(),
    })
  }

  const setAsDefault = input.setAsDefault !== false
  const nextOutfit: CharacterOutfit = {
    kind: 'outfit',
    outfit_id: input.outfitId,
    label: input.label,
    url: setAsDefault ? normalizedUrl : (prev?.url || normalizedUrl),
    costume_asset_id: input.costumeAssetId ?? prev?.costume_asset_id ?? null,
    candidates,
    variants: prev?.variants || {},
    created_at: prev?.created_at || now(),
  }

  if (idx >= 0) outfits[idx] = nextOutfit
  else outfits.push(nextOutfit)

  writeReferenceEntries(characterId, [...loaded.styleVariants, ...outfits])
  return listCharacterOutfits(serializeCharacterReferenceEntries([...loaded.styleVariants, ...outfits]))
}

export function upsertCharacterOutfit(
  characterId: number,
  input: {
    outfitId: string
    label: string
    url: string
    costumeAssetId?: number | null
    candidateLabel?: string
    setAsDefault?: boolean
  },
): CharacterOutfit[] {
  return appendCharacterOutfitImage(characterId, input)
}

export function setCharacterOutfitDefault(
  characterId: number,
  outfitId: string,
  candidateId: string,
): CharacterOutfit | null {
  const loaded = loadCharacterEntries(characterId)
  if (!loaded) return null

  const outfits = [...loaded.outfits]
  const idx = outfits.findIndex(item => item.outfit_id === outfitId)
  if (idx < 0) return null

  const outfit = outfits[idx]
  const candidate = (outfit.candidates || []).find(item => item.id === candidateId)
  if (!candidate) return null

  outfits[idx] = {
    ...outfit,
    url: normalizePath(candidate.url),
  }

  writeReferenceEntries(characterId, [...loaded.styleVariants, ...outfits])
  return outfits[idx]
}

export function removeCharacterOutfitCandidate(
  characterId: number,
  outfitId: string,
  candidateId: string,
): CharacterOutfit | null {
  const loaded = loadCharacterEntries(characterId)
  if (!loaded) return null

  const outfits = [...loaded.outfits]
  const idx = outfits.findIndex(item => item.outfit_id === outfitId)
  if (idx < 0) return null

  const outfit = outfits[idx]
  const removed = (outfit.candidates || []).find(item => item.id === candidateId)
  if (!removed) return null

  const nextCandidates = (outfit.candidates || []).filter(item => item.id !== candidateId)
  const removedDefault = normalizePath(removed.url) === normalizePath(outfit.url)

  if (!nextCandidates.length) {
    outfits.splice(idx, 1)
    writeReferenceEntries(characterId, [...loaded.styleVariants, ...outfits])
    return null
  }

  const nextUrl = removedDefault
    ? normalizePath(nextCandidates[nextCandidates.length - 1].url)
    : normalizePath(outfit.url)

  const nextOutfit: CharacterOutfit = {
    ...outfit,
    url: nextUrl,
    candidates: nextCandidates,
  }
  outfits[idx] = nextOutfit
  writeReferenceEntries(characterId, [...loaded.styleVariants, ...outfits])
  return nextOutfit
}

export function clearCharacterPrimaryImage(characterId: number) {
  db.update(schema.characters)
    .set({ imageUrl: null, localPath: null, updatedAt: now() })
    .where(eq(schema.characters.id, characterId))
    .run()
}

export function removeCharacterStyleVariant(characterId: number, variantId: string): boolean {
  const loaded = loadCharacterEntries(characterId)
  if (!loaded) return false
  const target = String(variantId || '').trim()
  if (!target) return false
  const nextStyles = loaded.styleVariants.filter(item => item.variant !== target)
  if (nextStyles.length === loaded.styleVariants.length) return false
  writeReferenceEntries(characterId, [...nextStyles, ...loaded.outfits])
  return true
}

export function removeCharacterOutfitVariant(
  characterId: number,
  outfitId: string,
  variantId: string,
): boolean {
  const loaded = loadCharacterEntries(characterId)
  if (!loaded) return false
  const outfits = [...loaded.outfits]
  const idx = outfits.findIndex(item => item.outfit_id === outfitId)
  if (idx < 0) return false
  const outfit = outfits[idx]
  const variants = { ...(outfit.variants || {}) }
  const target = String(variantId || '').trim()
  if (!target || !variants[target]) return false
  delete variants[target]
  outfits[idx] = { ...outfit, variants }
  writeReferenceEntries(characterId, [...loaded.styleVariants, ...outfits])
  return true
}

export function removeCharacterImageByUrl(characterId: number, rawUrl: string): boolean {
  const url = normalizePath(rawUrl)
  if (!url) return false
  const loaded = loadCharacterEntries(characterId)
  if (!loaded) return false

  const primaryUrl = normalizePath(loaded.char.imageUrl || loaded.char.localPath || '')
  if (primaryUrl && primaryUrl === url) {
    clearCharacterPrimaryImage(characterId)
    return true
  }

  for (const outfit of loaded.outfits) {
    for (const candidate of outfit.candidates || []) {
      if (normalizePath(candidate.url) !== url) continue
      removeCharacterOutfitCandidate(characterId, outfit.outfit_id, candidate.id)
      return true
    }
    for (const [variantId, variant] of Object.entries(outfit.variants || {})) {
      if (normalizePath(variant?.url || '') === url) {
        return removeCharacterOutfitVariant(characterId, outfit.outfit_id, variantId)
      }
    }
  }

  for (const style of loaded.styleVariants) {
    if (normalizePath(style.url) === url && style.variant) {
      return removeCharacterStyleVariant(characterId, style.variant)
    }
  }

  return false
}

export function appendCharacterOutfitVariant(
  characterId: number,
  outfitId: string,
  url: string,
  variantId: string,
): CharacterImageVariant[] {
  const loaded = loadCharacterEntries(characterId)
  if (!loaded) return []

  const outfits = [...loaded.outfits]
  const idx = outfits.findIndex(item => item.outfit_id === outfitId)
  if (idx < 0) return listCharacterImages(loaded.char)

  const outfit = outfits[idx]
  outfits[idx] = {
    ...outfit,
    variants: {
      ...(outfit.variants || {}),
      [variantId]: { url: normalizePath(url), created_at: now() },
    },
  }

  writeReferenceEntries(characterId, [...loaded.styleVariants, ...outfits])
  return listCharacterImages({
    ...loaded.char,
    referenceImages: serializeCharacterReferenceEntries([...loaded.styleVariants, ...outfits]),
  })
}

export function resolveCharacterImageSource(
  char: { imageUrl?: string | null; localPath?: string | null; referenceImages?: string | null },
  source: string,
): string | null {
  if (!source || source === 'primary') {
    return normalizePath(char.imageUrl || char.localPath || '') || null
  }
  const outfit = findCharacterOutfit(char.referenceImages, source)
  return outfit ? normalizePath(outfit.url) : null
}

export function parseStoryboardCharacterImageRefs(raw?: string | null): Record<number, string> {
  if (!raw?.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: Record<number, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const id = Number(key)
      const url = normalizePath(String(value || ''))
      if (Number.isFinite(id) && id > 0 && url) map[id] = url
    }
    return map
  } catch {
    return {}
  }
}

export function resolveCharacterImageForStoryboard(
  char: { id: number; imageUrl?: string | null; localPath?: string | null; referenceImages?: string | null },
  storyboardRefs?: Record<number, string> | null,
): string | null {
  const selected = storyboardRefs?.[char.id]
  if (selected) return normalizePath(selected)
  return normalizePath(char.imageUrl || char.localPath || '') || null
}
