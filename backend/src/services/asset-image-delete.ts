import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { removeCharacterImageByUrl } from '../utils/character-image-variants.js'
import { removeSceneImageByUrl } from '../utils/scene-image-variants.js'
import { removePropImageByUrl } from '../utils/prop-image-variants.js'
import { syncCharacterAsset, syncSceneAsset, syncPropAsset } from './asset-library.js'
import { formatSceneAssetName } from './asset-library.js'

function normalizePath(raw?: string | null): string {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function resolveCharacterId(asset: typeof schema.assets.$inferSelect): number | null {
  if (asset.sourceType === 'character' && asset.sourceId) return asset.sourceId
  if (!asset.dramaId || !asset.name) return null
  const [char] = db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, asset.dramaId))
    .all()
    .filter(row => !row.deletedAt && row.name === asset.name)
  return char?.id ?? null
}

function resolveSceneId(asset: typeof schema.assets.$inferSelect): number | null {
  if (asset.sourceType === 'scene' && asset.sourceId) return asset.sourceId
  if (!asset.dramaId || !asset.name) return null
  const location = String(asset.name).replace(/（[^）]+）$/, '').trim()
  const scenes = db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, asset.dramaId))
    .all()
    .filter(row => !row.deletedAt)
  const match = scenes.find(row =>
    formatSceneAssetName(row.location, row.time) === asset.name
    || row.location === asset.name
    || row.location === location,
  )
  return match?.id ?? null
}

function resolvePropId(asset: typeof schema.assets.$inferSelect): number | null {
  if ((asset.sourceType === 'prop' || asset.type === 'costume') && asset.sourceId) return asset.sourceId
  if (!asset.dramaId || !asset.name) return null
  const [prop] = db.select().from(schema.props)
    .where(eq(schema.props.dramaId, asset.dramaId))
    .all()
    .filter(row => !row.deletedAt && row.name === asset.name)
  return prop?.id ?? null
}

function clearAssetImage(assetId: number, url: string) {
  const [asset] = db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).all()
  if (!asset) return
  const current = normalizePath(asset.url || asset.localPath)
  if (current !== url) return
  db.update(schema.assets)
    .set({
      url: null,
      localPath: null,
      thumbnailUrl: null,
      updatedAt: now(),
    })
    .where(eq(schema.assets.id, assetId))
    .run()
}

export function deleteAssetLibraryImage(assetId: number, rawUrl: string) {
  const url = normalizePath(rawUrl)
  if (!url) throw new Error('请指定要删除的图片')

  const [asset] = db.select().from(schema.assets)
    .where(eq(schema.assets.id, assetId))
    .all()
  if (!asset || asset.deletedAt) throw new Error('资产不存在')
  if (asset.type === 'voice') throw new Error('音色资产请使用编辑功能替换')

  let deleted = false

  if (asset.type === 'character') {
    const characterId = resolveCharacterId(asset)
    if (characterId) {
      deleted = removeCharacterImageByUrl(characterId, url)
      if (deleted) syncCharacterAsset(characterId)
    }
  } else if (asset.type === 'scene') {
    const sceneId = resolveSceneId(asset)
    if (sceneId) {
      deleted = removeSceneImageByUrl(sceneId, url)
      if (deleted) syncSceneAsset(sceneId)
    }
  } else if (asset.type === 'prop' || asset.type === 'costume') {
    const propId = resolvePropId(asset)
    if (propId) {
      deleted = removePropImageByUrl(propId, url)
      if (deleted) syncPropAsset(propId)
    }
  }

  if (!deleted) {
    const assetPath = normalizePath(asset.url || asset.localPath)
    if (assetPath === url) {
      clearAssetImage(assetId, url)
      deleted = true
    }
  }

  if (!deleted) throw new Error('未找到匹配的图片，可能已被删除')

  const [fresh] = db.select().from(schema.assets)
    .where(eq(schema.assets.id, assetId))
    .all()
  if (fresh && !fresh.deletedAt && fresh.type !== 'voice') {
    const stillHasImage = !!normalizePath(fresh.url || fresh.localPath)
    if (!stillHasImage && fresh.sourceType === 'manual') {
      // 手动资产无图时保留条目，仅清空封面
    }
  }

  return { asset_id: assetId, url }
}
