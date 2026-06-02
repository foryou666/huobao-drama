import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from './response.js'
import { getCharacterTransformPreset } from './character-image-transforms.js'

export interface CharacterImageVariant {
  url: string
  label: string
  variant?: string
  outfit_id?: string
  source?: 'primary' | 'outfit'
  created_at?: string
}

export interface CharacterOutfitVariant {
  url: string
  created_at?: string
}

export interface CharacterOutfit {
  kind: 'outfit'
  outfit_id: string
  label: string
  url: string
  costume_asset_id?: number | null
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
        const url = normalizePath(item.url || '')
        if (!url || !item.outfit_id) continue
        items.push({
          kind: 'outfit',
          outfit_id: String(item.outfit_id),
          label: String(item.label || '服装'),
          url,
          costume_asset_id: item.costume_asset_id ?? null,
          variants: item.variants && typeof item.variants === 'object' ? item.variants : {},
          created_at: item.created_at ? String(item.created_at) : undefined,
        })
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
        const preset = getCharacterTransformPreset(variantId)
        const url = normalizePath(variant?.url || '')
        if (!url) continue
        if (items.some(item => normalizePath(item.url) === url)) continue
        items.push({
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

    if (items.some(item => normalizePath(item.url) === normalizePath(entry.url))) continue
    items.push({ ...entry, source: 'primary' })
  }
  return items
}

function writeReferenceEntries(characterId: number, entries: ReferenceEntry[]) {
  db.update(schema.characters)
    .set({ referenceImages: serializeCharacterReferenceEntries(entries), updatedAt: now() })
    .where(eq(schema.characters.id, characterId))
    .run()
}

export function appendCharacterImageVariant(
  characterId: number,
  url: string,
  variantId?: string | null,
  label?: string | null,
): CharacterImageVariant[] {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char) return []

  const preset = variantId ? getCharacterTransformPreset(variantId) : null
  const resolvedLabel = label || preset?.label || '变体'
  const normalizedUrl = normalizePath(url)
  const existing = parseCharacterReferenceEntries(char.referenceImages)
  const styleVariants = existing.filter(item => !isOutfitEntry(item)) as CharacterImageVariant[]
  const outfits = existing.filter(isOutfitEntry)
  const nextStyles = styleVariants.filter(item => item.variant !== variantId)
  nextStyles.push({
    url: normalizedUrl,
    label: resolvedLabel,
    variant: variantId || undefined,
    created_at: now(),
  })

  writeReferenceEntries(characterId, [...nextStyles, ...outfits])
  return listCharacterImages({ ...char, referenceImages: serializeCharacterReferenceEntries([...nextStyles, ...outfits]) })
}

export function upsertCharacterOutfit(
  characterId: number,
  input: {
    outfitId: string
    label: string
    url: string
    costumeAssetId?: number | null
  },
): CharacterOutfit[] {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char) return []

  const existing = parseCharacterReferenceEntries(char.referenceImages)
  const styleVariants = existing.filter(item => !isOutfitEntry(item))
  const outfits = existing.filter(isOutfitEntry)
  const normalizedUrl = normalizePath(input.url)
  const idx = outfits.findIndex(item => item.outfit_id === input.outfitId)
  const prev = idx >= 0 ? outfits[idx] : null
  const nextOutfit: CharacterOutfit = {
    kind: 'outfit',
    outfit_id: input.outfitId,
    label: input.label,
    url: normalizedUrl,
    costume_asset_id: input.costumeAssetId ?? prev?.costume_asset_id ?? null,
    variants: prev?.variants || {},
    created_at: prev?.created_at || now(),
  }
  if (idx >= 0) outfits[idx] = nextOutfit
  else outfits.push(nextOutfit)

  writeReferenceEntries(characterId, [...styleVariants, ...outfits])
  return listCharacterOutfits(serializeCharacterReferenceEntries([...styleVariants, ...outfits]))
}

export function appendCharacterOutfitVariant(
  characterId: number,
  outfitId: string,
  url: string,
  variantId: string,
): CharacterImageVariant[] {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char) return []

  const existing = parseCharacterReferenceEntries(char.referenceImages)
  const styleVariants = existing.filter(item => !isOutfitEntry(item))
  const outfits = existing.filter(isOutfitEntry)
  const idx = outfits.findIndex(item => item.outfit_id === outfitId)
  if (idx < 0) return listCharacterImages(char)

  const outfit = outfits[idx]
  outfits[idx] = {
    ...outfit,
    variants: {
      ...(outfit.variants || {}),
      [variantId]: { url: normalizePath(url), created_at: now() },
    },
  }

  writeReferenceEntries(characterId, [...styleVariants, ...outfits])
  return listCharacterImages({ ...char, referenceImages: serializeCharacterReferenceEntries([...styleVariants, ...outfits]) })
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
