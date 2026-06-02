import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import type { AssetCategory } from '../constants/asset-categories.js'

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

  const payload = {
    dramaId,
    episodeId: input.episodeId ?? null,
    name: input.name,
    description: input.description ?? null,
    type: input.type,
    category: input.category ?? input.type,
    url,
    localPath,
    thumbnailUrl: normalizePath(input.thumbnailUrl) || url,
    sourceType: input.sourceType ?? 'manual',
    sourceId: input.sourceId ?? null,
    imageGenId: input.imageGenId ?? null,
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
    name: scene.location,
    description: scene.prompt || scene.time || null,
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
  syncCharacterAsset(characterId)
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
  syncSceneAsset(sceneId)
  return url
}
