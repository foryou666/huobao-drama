import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from './response.js'
import { getSceneAnglePreset, listBatchSceneAngleIds } from '../constants/scene-angles.js'

export interface SceneAngleImage {
  angle_id: string
  label: string
  url: string
  created_at?: string
}

function normalizePath(raw: string): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

export function parseSceneAngleImages(raw?: string | null): SceneAngleImage[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: any) => ({
        angle_id: String(item?.angle_id || item?.angleId || ''),
        label: String(item?.label || getSceneAnglePreset(String(item?.angle_id || ''))?.label || '角度'),
        url: normalizePath(item?.url || ''),
        created_at: item?.created_at ? String(item.created_at) : undefined,
      }))
      .filter(item => item.angle_id && item.url)
  } catch {
    return []
  }
}

export function serializeSceneAngleImages(items: SceneAngleImage[]): string {
  return JSON.stringify(items)
}

export function listSceneImages(scene: {
  imageUrl?: string | null
  localPath?: string | null
  referenceImages?: string | null
}): SceneAngleImage[] {
  const primaryUrl = normalizePath(scene.imageUrl || scene.localPath || '')
  const items: SceneAngleImage[] = []
  if (primaryUrl) {
    items.push({ angle_id: 'hero', label: '主视角', url: primaryUrl })
  }
  for (const entry of parseSceneAngleImages(scene.referenceImages)) {
    if (!items.some(item => item.angle_id === entry.angle_id)) {
      items.push(entry)
    }
  }
  return items
}

export function upsertSceneAngleImage(sceneId: number, angleId: string, url: string, label?: string) {
  const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId)).all()
  if (!scene) return

  const preset = getSceneAnglePreset(angleId)
  const entry: SceneAngleImage = {
    angle_id: angleId,
    label: label || preset?.label || angleId,
    url: normalizePath(url),
    created_at: now(),
  }

  const existing = parseSceneAngleImages(scene.referenceImages)
  const next = [...existing.filter(item => item.angle_id !== angleId), entry]
  db.update(schema.scenes)
    .set({ referenceImages: serializeSceneAngleImages(next), updatedAt: now() })
    .where(eq(schema.scenes.id, sceneId))
    .run()
}

export function resolveSceneImageUrl(
  scene: {
    imageUrl?: string | null
    localPath?: string | null
    referenceImages?: string | null
  },
  angleId?: string | null,
): string | null {
  const normalizedAngle = String(angleId || '').trim()
  if (!normalizedAngle || normalizedAngle === 'hero') {
    return normalizePath(scene.imageUrl || scene.localPath || '') || null
  }
  const match = parseSceneAngleImages(scene.referenceImages).find(item => item.angle_id === normalizedAngle)
  if (match?.url) return match.url
  return normalizePath(scene.imageUrl || scene.localPath || '') || null
}

export function resolveSceneImageForStoryboard(
  scene: {
    imageUrl?: string | null
    localPath?: string | null
    referenceImages?: string | null
  },
  storyboard?: { sceneAngleId?: string | null } | null,
): string | null {
  return resolveSceneImageUrl(scene, storyboard?.sceneAngleId)
}

export function listMissingSceneAngleIds(scene: {
  referenceImages?: string | null
}, angleIds: string[] = listBatchSceneAngleIds()): string[] {
  const existing = new Set(parseSceneAngleImages(scene.referenceImages).map(item => item.angle_id))
  return angleIds.filter(id => !existing.has(id))
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

export function summarizeSceneMedia(scene: {
  imageUrl?: string | null
  localPath?: string | null
  referenceImages?: string | null
}): EntityMediaSummary {
  const views = listSceneImages(scene)
  const primaryUrl = views.find(item => item.angle_id === 'hero')?.url || views[0]?.url || null
  return {
    view_count: views.length,
    image_count: views.length,
    primary_url: primaryUrl,
    view_previews: views.map(view => ({
      view_id: view.angle_id,
      label: view.label,
      url: view.url,
    })),
    preview_images: views.map(view => ({
      url: view.url,
      label: view.label,
      tag: view.angle_id === 'hero' ? '主视角' : view.label,
      view_id: view.angle_id,
      is_primary: view.angle_id === 'hero',
    })),
  }
}
