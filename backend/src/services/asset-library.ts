import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import type { AssetCategory } from '../constants/asset-categories.js'
import { thumbPathForSource } from '../utils/thumbnail.js'

/** 从资产名称解析场景地点与时间，如「养心殿（日）」「王府书房·夜」 */
export function parseSceneAssetName(name: string): { location: string; time: string } {
  const raw = String(name || '').trim()
  const parenMatch = raw.match(/^(.+?)\s*[（(]([^）)]+)[）)]\s*$/)
  if (parenMatch) {
    return { location: parenMatch[1].trim(), time: parenMatch[2].trim() }
  }
  const dotMatch = raw.match(/^(.+?)[·•](.+)$/)
  if (dotMatch) {
    return { location: dotMatch[1].trim(), time: dotMatch[2].trim() }
  }
  return { location: raw, time: '' }
}

/** 场景资产统一命名，与项目内展示一致 */
export function formatSceneAssetName(location: string, time?: string | null): string {
  const loc = String(location || '').trim()
  const t = String(time || '').trim()
  if (!loc) return ''
  if (!t) return loc
  return `${loc}（${t}）`
}

export interface UpsertAssetInput {
  dramaId?: number | null
  episodeId?: number | null
  name: string
  description?: string | null
  type: AssetCategory
  category?: string | null
  url?: string | null
  localPath?: string | null
  thumbnailUrl?: string | null
  sourceType?: string | null
  sourceId?: number | null
  imageGenId?: number | null
  mimeType?: string | null
  duration?: number | null
  fileSize?: number | null
}

function normalizePath(raw?: string | null): string | null {
  const value = String(raw || '').trim().replace(/^\/+/, '')
  return value || null
}

function findSyncedAsset(dramaId: number, sourceType: string, sourceId: number) {
  const rows = db.select().from(schema.assets).where(
    and(
      eq(schema.assets.dramaId, dramaId),
      eq(schema.assets.sourceType, sourceType),
      eq(schema.assets.sourceId, sourceId),
      isNull(schema.assets.deletedAt),
    ),
  ).all()
  return rows[0] || null
}

export function upsertLibraryAsset(input: UpsertAssetInput) {
  const ts = now()
  const url = normalizePath(input.url || input.localPath)
  const localPath = normalizePath(input.localPath || input.url)
  const dramaId = input.dramaId ?? null

  let existing = null as typeof schema.assets.$inferSelect | null
  if (dramaId && input.sourceType && input.sourceId) {
    existing = findSyncedAsset(dramaId, input.sourceType, input.sourceId)
  }

  const preservedUrl = existing
    ? normalizePath(existing.url || existing.localPath)
    : null
  const finalUrl = url || preservedUrl
  const finalLocalPath = localPath || preservedUrl
  const payload = {
    dramaId,
    episodeId: input.episodeId ?? null,
    name: input.name,
    description: input.description ?? null,
    type: input.type,
    category: input.category ?? input.type,
    url: finalUrl,
    localPath: finalLocalPath,
    thumbnailUrl: normalizePath(input.thumbnailUrl)
      || (finalUrl && input.type !== 'voice' ? thumbPathForSource(finalUrl) : null)
      || (existing && !finalUrl ? normalizePath(existing.thumbnailUrl) : null),
    sourceType: input.sourceType ?? 'manual',
    sourceId: input.sourceId ?? null,
    imageGenId: input.imageGenId ?? null,
    mimeType: input.mimeType ?? null,
    duration: input.duration != null ? Math.round(Number(input.duration)) : null,
    fileSize: input.fileSize ?? null,
    updatedAt: ts,
  }

  if (existing) {
    db.update(schema.assets)
      .set(payload)
      .where(eq(schema.assets.id, existing.id))
      .run()
    return existing.id
  }

  const res = db.insert(schema.assets).values({
    ...payload,
    createdAt: ts,
  }).run()
  return Number(res.lastInsertRowid)
}

function formatReferenceAssetName(originalName?: string | null): string {
  const base = String(originalName || '参考图').trim()
  const stem = base.replace(/\.[^.]+$/, '') || '参考图'
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  return `参考图-${stem}-${stamp}`
}

/** 视频参考图上传默认入库（团队级，可选 drama 标签，不同步角色/场景） */
export function createReferenceUploadAsset(input: {
  dramaId?: number | null
  localPath: string
  originalName?: string | null
}): number {
  const localPath = normalizePath(input.localPath)
  if (!localPath) throw new Error('localPath is required')

  const [existing] = db.select().from(schema.assets).where(
    and(
      eq(schema.assets.localPath, localPath),
      eq(schema.assets.type, 'reference'),
      isNull(schema.assets.deletedAt),
    ),
  ).all()
  if (existing) return existing.id

  return upsertLibraryAsset({
    dramaId: input.dramaId ?? null,
    name: formatReferenceAssetName(input.originalName),
    type: 'reference',
    category: 'reference',
    url: localPath,
    localPath,
    sourceType: 'reference_upload',
  })
}

function normalizeAssetMediaPath(raw?: string | null): string | null {
  return normalizePath(raw)
}

/** 列表展示：资产无图时回退到已绑定的角色/场景实体图 */
export function resolveAssetDisplayMedia(asset: {
  url?: string | null
  localPath?: string | null
  thumbnailUrl?: string | null
  sourceType?: string | null
  sourceId?: number | null
  type?: string | null
}) {
  let url = normalizeAssetMediaPath(asset.url || asset.localPath)
  let thumbnailUrl = normalizeAssetMediaPath(asset.thumbnailUrl)

  if (!url && asset.sourceId) {
    if (asset.sourceType === 'character') {
      const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, asset.sourceId)).all()
      url = normalizeAssetMediaPath(char?.imageUrl || char?.localPath)
    } else if (asset.sourceType === 'scene') {
      const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, asset.sourceId)).all()
      url = normalizeAssetMediaPath(scene?.imageUrl || scene?.localPath)
    } else if (asset.sourceType === 'prop' && asset.type !== 'voice') {
      const [prop] = db.select().from(schema.props).where(eq(schema.props.id, asset.sourceId)).all()
      url = normalizeAssetMediaPath(prop?.imageUrl || prop?.localPath)
    }
  }

  if (url && !thumbnailUrl && asset.type !== 'voice') {
    thumbnailUrl = thumbPathForSource(url)
  }

  return { url, localPath: url, thumbnailUrl }
}

export function syncCharacterAsset(characterId: number) {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  if (!char || char.deletedAt) return null
  const url = normalizePath(char.imageUrl || char.localPath)
  return upsertLibraryAsset({
    dramaId: char.dramaId,
    name: char.name,
    description: char.appearance || char.description || char.role || null,
    type: 'character',
    category: char.role || 'character',
    url,
    localPath: url,
    sourceType: 'character',
    sourceId: char.id,
  })
}

export function syncSceneAsset(sceneId: number) {
  const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId)).all()
  if (!scene || scene.deletedAt) return null
  const url = normalizePath(scene.imageUrl || scene.localPath)
  return upsertLibraryAsset({
    dramaId: scene.dramaId,
    episodeId: scene.episodeId,
    name: formatSceneAssetName(scene.location, scene.time),
    description: scene.prompt || null,
    type: 'scene',
    category: scene.time || 'scene',
    url,
    localPath: url,
    sourceType: 'scene',
    sourceId: scene.id,
  })
}

export function syncPropAsset(propId: number) {
  const [prop] = db.select().from(schema.props).where(eq(schema.props.id, propId)).all()
  if (!prop || prop.deletedAt) return null
  const url = normalizePath(prop.imageUrl || prop.localPath)
  const type: AssetCategory = prop.type === 'costume' ? 'costume' : 'prop'
  return upsertLibraryAsset({
    dramaId: prop.dramaId,
    name: prop.name,
    description: prop.description || prop.prompt || null,
    type,
    category: prop.type || type,
    url,
    localPath: url,
    sourceType: 'prop',
    sourceId: prop.id,
  })
}

/** 将手动/导入资产合并为与项目实体绑定的同步资产，避免两侧各存一份 */
function finalizeEntityAssetLink(pickedAssetId: number, entityType: 'scene' | 'character', entityId: number) {
  const syncedId = entityType === 'scene'
    ? syncSceneAsset(entityId)
    : syncCharacterAsset(entityId)
  if (syncedId && syncedId !== pickedAssetId) {
    db.update(schema.assets)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(schema.assets.id, pickedAssetId))
      .run()
  }
  return syncedId
}

function pushAssetToScene(sceneId: number, input: {
  url?: string | null
  description?: string | null
  name?: string | null
}) {
  const ts = now()
  const updates: Record<string, unknown> = { updatedAt: ts }
  const url = normalizePath(input.url)
  if (url) {
    updates.imageUrl = url
    updates.localPath = url
    updates.status = 'completed'
  }
  if (input.description !== undefined) updates.prompt = input.description
  const name = String(input.name || '').trim()
  if (name) {
    const { location, time } = parseSceneAssetName(name)
    if (location) {
      updates.location = location
      updates.time = time
    }
  }
  db.update(schema.scenes).set(updates).where(eq(schema.scenes.id, sceneId)).run()
}

function pushAssetToCharacter(characterId: number, input: {
  url?: string | null
  description?: string | null
  name?: string | null
}) {
  const ts = now()
  const updates: Record<string, unknown> = { updatedAt: ts }
  const url = normalizePath(input.url)
  if (url) {
    updates.imageUrl = url
    updates.localPath = url
  }
  if (input.description !== undefined) updates.appearance = input.description
  const name = String(input.name || '').trim()
  if (name) updates.name = name
  db.update(schema.characters).set(updates).where(eq(schema.characters.id, characterId)).run()
}

/** 手动添加的角色资产同步为项目角色实体 */
export function ensureCharacterFromManualCharacterAsset(input: {
  dramaId: number
  name: string
  description?: string | null
  url?: string | null
  localPath?: string | null
  assetId?: number
}) {
  const dramaId = Number(input.dramaId)
  if (!Number.isFinite(dramaId) || dramaId <= 0) return null

  const name = String(input.name || '').trim()
  if (!name) return null

  const ts = now()
  const url = normalizePath(input.url || input.localPath)

  const existing = db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt)))
    .all()
    .find(c => c.name === name)

  let characterId: number
  if (existing) {
    characterId = existing.id
    const updates: Record<string, unknown> = { updatedAt: ts }
    if (url) {
      updates.imageUrl = url
      updates.localPath = url
    }
    if (input.description) updates.appearance = input.description
    db.update(schema.characters).set(updates).where(eq(schema.characters.id, characterId)).run()
  } else {
    const res = db.insert(schema.characters).values({
      dramaId,
      name,
      appearance: input.description || null,
      description: input.description || null,
      imageUrl: url,
      localPath: url,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    characterId = Number(res.lastInsertRowid)
  }

  if (input.assetId) finalizeEntityAssetLink(input.assetId, 'character', characterId)
  return characterId
}

/** 手动添加的场景资产同步为项目场景实体，便于在集内制作页直接使用 */
export function ensureSceneFromManualSceneAsset(input: {
  dramaId: number
  name: string
  description?: string | null
  url?: string | null
  localPath?: string | null
  assetId?: number
}) {
  const dramaId = Number(input.dramaId)
  if (!Number.isFinite(dramaId) || dramaId <= 0) return null

  const { location, time } = parseSceneAssetName(input.name)
  if (!location) return null

  const ts = now()
  const url = normalizePath(input.url || input.localPath)

  const existing = db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt)))
    .all()
    .find(s => s.location === location && (s.time || '') === time)

  let sceneId: number
  if (existing) {
    sceneId = existing.id
    const updates: Record<string, unknown> = { updatedAt: ts }
    if (url) {
      updates.imageUrl = url
      updates.localPath = url
      updates.status = 'completed'
    }
    if (input.description) updates.prompt = input.description
    db.update(schema.scenes).set(updates).where(eq(schema.scenes.id, sceneId)).run()
  } else {
    const res = db.insert(schema.scenes).values({
      dramaId,
      location,
      time,
      prompt: input.description || location,
      imageUrl: url,
      localPath: url,
      status: url ? 'completed' : 'pending',
      createdAt: ts,
      updatedAt: ts,
    }).run()
    sceneId = Number(res.lastInsertRowid)
  }

  if (input.assetId) finalizeEntityAssetLink(input.assetId, 'scene', sceneId)

  return sceneId
}

/** 资产库 → 项目：将未绑定实体的手动/导入资产同步到项目角色/场景 */
export function reconcileOrphanAssets(dramaId: number) {
  const assets = db.select().from(schema.assets).where(
    and(
      eq(schema.assets.dramaId, dramaId),
      isNull(schema.assets.deletedAt),
    ),
  ).all()

  let reconciled = 0
  for (const asset of assets) {
    if (asset.sourceId) continue
    if (asset.sourceType !== 'manual' && asset.sourceType !== 'import') continue
    if (asset.type === 'scene') {
      ensureSceneFromManualSceneAsset({
        dramaId,
        name: String(asset.name || '').trim(),
        description: asset.description,
        url: asset.url,
        localPath: asset.localPath,
        assetId: asset.id,
      })
      reconciled += 1
    } else if (asset.type === 'character') {
      ensureCharacterFromManualCharacterAsset({
        dramaId,
        name: String(asset.name || '').trim(),
        description: asset.description,
        url: asset.url,
        localPath: asset.localPath,
        assetId: asset.id,
      })
      reconciled += 1
    }
  }
  return reconciled
}

/** 资产库变更后推送到项目实体（双向同步） */
export function syncEntityFromAsset(assetId: number) {
  const [asset] = db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).all()
  if (!asset || asset.deletedAt) return null

  const url = normalizePath(asset.url || asset.localPath)
  const description = asset.description ?? null
  const name = String(asset.name || '').trim() || null
  const entityPatch = { url, description, name }

  if (asset.sourceType === 'scene' && asset.sourceId) {
    pushAssetToScene(asset.sourceId, entityPatch)
    syncSceneAsset(asset.sourceId)
    return { type: 'scene' as const, id: asset.sourceId }
  }

  if (asset.sourceType === 'character' && asset.sourceId) {
    pushAssetToCharacter(asset.sourceId, entityPatch)
    syncCharacterAsset(asset.sourceId)
    return { type: 'character' as const, id: asset.sourceId }
  }

  if (!asset.dramaId) return null

  if (asset.type === 'scene') {
    const sceneId = ensureSceneFromManualSceneAsset({
      dramaId: asset.dramaId,
      name: String(asset.name || '').trim(),
      description,
      url,
      localPath: url,
      assetId: asset.id,
    })
    return sceneId ? { type: 'scene' as const, id: sceneId } : null
  }

  if (asset.type === 'character') {
    const characterId = ensureCharacterFromManualCharacterAsset({
      dramaId: asset.dramaId,
      name: String(asset.name || '').trim(),
      description,
      url,
      localPath: url,
      assetId: asset.id,
    })
    return characterId ? { type: 'character' as const, id: characterId } : null
  }

  return null
}

export function syncDramaAssets(dramaId: number) {
  const characters = db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt))).all()
  const scenes = db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt))).all()
  const props = db.select().from(schema.props)
    .where(and(eq(schema.props.dramaId, dramaId), isNull(schema.props.deletedAt))).all()

  let synced = 0
  for (const char of characters) {
    syncCharacterAsset(char.id)
    synced += 1
  }
  for (const scene of scenes) {
    syncSceneAsset(scene.id)
    synced += 1
  }
  for (const prop of props) {
    syncPropAsset(prop.id)
    synced += 1
  }
  reconcileOrphanAssets(dramaId)
  return synced
}

export function applyAssetToCharacter(characterId: number, assetId: number) {
  const [char] = db.select().from(schema.characters).where(eq(schema.characters.id, characterId)).all()
  const [asset] = db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).all()
  if (!char) throw new Error('Character not found')
  if (!asset || asset.deletedAt) throw new Error('Asset not found')
  const url = normalizePath(asset.url || asset.localPath)
  if (!url) throw new Error('资产没有可用图片')
  const ts = now()
  db.update(schema.characters)
    .set({ imageUrl: url, localPath: url, updatedAt: ts })
    .where(eq(schema.characters.id, characterId))
    .run()
  finalizeEntityAssetLink(assetId, 'character', characterId)
  return url
}

export function applyAssetToScene(sceneId: number, assetId: number) {
  const [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, sceneId)).all()
  const [asset] = db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).all()
  if (!scene) throw new Error('Scene not found')
  if (!asset || asset.deletedAt) throw new Error('Asset not found')
  const url = normalizePath(asset.url || asset.localPath)
  if (!url) throw new Error('资产没有可用图片')
  const ts = now()
  db.update(schema.scenes)
    .set({ imageUrl: url, localPath: url, status: 'completed', updatedAt: ts })
    .where(eq(schema.scenes.id, sceneId))
    .run()
  finalizeEntityAssetLink(assetId, 'scene', sceneId)
  return url
}
