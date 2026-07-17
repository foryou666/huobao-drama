import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from './response.js'

export interface PropViewImage {
  view_id: string
  label: string
  url: string
  created_at?: string
}

function normalizePath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

export function parsePropViewImages(raw?: string | null): PropViewImage[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: any) => ({
        view_id: String(item?.view_id || item?.viewId || item?.angle_id || item?.angleId || ''),
        label: String(item?.label || '参考图'),
        url: normalizePath(item?.url || ''),
        created_at: item?.created_at ? String(item.created_at) : undefined,
      }))
      .filter(item => item.view_id && item.url)
  } catch {
    return []
  }
}

export function serializePropViewImages(items: PropViewImage[]): string {
  return JSON.stringify(items)
}

export function listPropImages(prop: {
  imageUrl?: string | null
  localPath?: string | null
  referenceImages?: string | null
}): PropViewImage[] {
  const primaryUrl = normalizePath(prop.imageUrl || prop.localPath || '')
  const items: PropViewImage[] = []
  if (primaryUrl) {
    items.push({ view_id: 'hero', label: '主图', url: primaryUrl })
  }
  for (const entry of parsePropViewImages(prop.referenceImages)) {
    if (!items.some(item => item.view_id === entry.view_id)) {
      items.push(entry)
    }
  }
  return items
}

export function upsertPropViewImage(propId: number, viewId: string, url: string, label?: string) {
  const [prop] = db.select().from(schema.props).where(eq(schema.props.id, propId)).all()
  if (!prop) return

  const entry: PropViewImage = {
    view_id: viewId,
    label: label || viewId,
    url: normalizePath(url),
    created_at: now(),
  }

  const existing = parsePropViewImages(prop.referenceImages)
  const next = [...existing.filter(item => item.view_id !== viewId), entry]
  db.update(schema.props)
    .set({ referenceImages: serializePropViewImages(next), updatedAt: now() })
    .where(eq(schema.props.id, propId))
    .run()
}

export function clearPropPrimaryImage(propId: number) {
  db.update(schema.props)
    .set({ imageUrl: null, localPath: null, updatedAt: now() })
    .where(eq(schema.props.id, propId))
    .run()
}

export function removePropViewImage(propId: number, viewId: string): boolean {
  const normalizedView = String(viewId || '').trim()
  if (!normalizedView) return false
  const [prop] = db.select().from(schema.props).where(eq(schema.props.id, propId)).all()
  if (!prop) return false

  if (normalizedView === 'hero') {
    clearPropPrimaryImage(propId)
    return true
  }

  const existing = parsePropViewImages(prop.referenceImages)
  const next = existing.filter(item => item.view_id !== normalizedView)
  if (next.length === existing.length) return false

  db.update(schema.props)
    .set({ referenceImages: serializePropViewImages(next), updatedAt: now() })
    .where(eq(schema.props.id, propId))
    .run()
  return true
}

export function removePropImageByUrl(propId: number, rawUrl: string): boolean {
  const url = normalizePath(rawUrl)
  if (!url) return false
  const [prop] = db.select().from(schema.props).where(eq(schema.props.id, propId)).all()
  if (!prop) return false

  const heroUrl = normalizePath(prop.imageUrl || prop.localPath || '')
  if (heroUrl && heroUrl === url) {
    clearPropPrimaryImage(propId)
    return true
  }

  const match = parsePropViewImages(prop.referenceImages).find(item => normalizePath(item.url) === url)
  if (!match) return false
  return removePropViewImage(propId, match.view_id)
}

export interface EntityViewPreview {
  view_id: string
  label: string
  url: string
}

export interface EntityMediaSummary {
  view_count: number
  image_count: number
  primary_url: string | null
  view_previews: EntityViewPreview[]
  preview_images: Array<{
    url: string
    label: string
    tag: string
    view_id: string
    is_primary?: boolean
  }>
}

export function summarizeEntityMediaFromViews(
  views: PropViewImage[],
  primaryViewId = 'hero',
): EntityMediaSummary {
  const primaryUrl = views.find(item => item.view_id === primaryViewId)?.url
    || views[0]?.url
    || null
  return {
    view_count: views.length,
    image_count: views.length,
    primary_url: primaryUrl,
    view_previews: views.map(view => ({
      view_id: view.view_id,
      label: view.label,
      url: view.url,
    })),
    preview_images: views.map(view => ({
      url: view.url,
      label: view.label,
      tag: view.view_id === primaryViewId ? '主图' : view.label,
      view_id: view.view_id,
      is_primary: view.view_id === primaryViewId,
    })),
  }
}

export function summarizePropMedia(prop: {
  imageUrl?: string | null
  localPath?: string | null
  referenceImages?: string | null
}): EntityMediaSummary {
  return summarizeEntityMediaFromViews(listPropImages(prop))
}

export function parseStoryboardPropImageRefs(raw?: string | Record<string, string> | null): Record<number, string> {
  if (!raw) return {}
  let obj: Record<string, unknown> = {}
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>
  } else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed
    } catch {
      return {}
    }
  } else {
    return {}
  }

  const refs: Record<number, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const id = Number(key)
    const url = normalizePath(String(value || ''))
    if (Number.isFinite(id) && url) refs[id] = url
  }
  return refs
}

export function resolvePropImageForStoryboard(
  prop: {
    id?: number
    imageUrl?: string | null
    localPath?: string | null
    referenceImages?: string | null
  },
  storyboard?: { propImageRefs?: string | null } | null,
): string | null {
  const refs = parseStoryboardPropImageRefs(storyboard?.propImageRefs)
  const propId = Number(prop?.id)
  const selected = Number.isFinite(propId) ? refs[propId] : null
  if (selected) return selected
  const images = listPropImages(prop)
  return images.find(item => item.view_id === 'hero')?.url || images[0]?.url || null
}
