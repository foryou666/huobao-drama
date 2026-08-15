import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { isAssetCategory } from '../constants/asset-categories.js'
import { formatSceneAssetName } from './asset-library.js'
import {
  resolveCharacterCoverUrl,
  summarizeCharacterMediaForAssetList,
} from '../utils/character-image-variants.js'
import { summarizeSceneMedia } from '../utils/scene-image-variants.js'
import { summarizePropMedia } from '../utils/prop-image-variants.js'
import { thumbPathForSource } from '../utils/thumbnail.js'

export interface AssetListQuery {
  dramaId?: number
  type?: string
  q?: string
}

function normalizePath(raw?: string | null): string | null {
  const value = String(raw || '').trim().replace(/^\/+/, '')
  return value || null
}

function buildAssetWhere(query: AssetListQuery): SQL | undefined {
  const conditions: SQL[] = [isNull(schema.assets.deletedAt)]
  if (query.dramaId && Number.isFinite(query.dramaId) && query.dramaId > 0) {
    conditions.push(eq(schema.assets.dramaId, query.dramaId))
  }
  if (query.type && isAssetCategory(query.type)) {
    conditions.push(eq(schema.assets.type, query.type))
  }
  if (query.q) {
    const pattern = `%${query.q}%`
    conditions.push(or(
      sql`lower(${schema.assets.name}) like ${pattern}`,
      sql`lower(coalesce(${schema.assets.description}, '')) like ${pattern}`,
    )!)
  }
  return and(...conditions)
}

export function queryAssetTypeCounts(query: AssetListQuery): Record<string, number> {
  const where = buildAssetWhere({ dramaId: query.dramaId, q: query.q })
  const rows = db.select({
    type: schema.assets.type,
    count: sql<number>`count(*)`.mapWith(Number),
  })
    .from(schema.assets)
    .where(where)
    .groupBy(schema.assets.type)
    .all()

  const counts: Record<string, number> = {}
  for (const row of rows) {
    if (row.type) counts[row.type] = row.count
  }
  return counts
}

export function queryAssetRows(query: AssetListQuery) {
  const where = buildAssetWhere(query)
  return db.select()
    .from(schema.assets)
    .where(where)
    .orderBy(desc(schema.assets.updatedAt))
    .all()
}

type CharacterRow = typeof schema.characters.$inferSelect
type SceneRow = typeof schema.scenes.$inferSelect
type PropRow = typeof schema.props.$inferSelect

interface EntityLookupMaps {
  charactersById: Map<number, CharacterRow>
  charactersByDramaName: Map<string, CharacterRow>
  scenesById: Map<number, SceneRow>
  scenesByDramaName: Map<string, SceneRow>
  propsById: Map<number, PropRow>
  propsByDramaName: Map<string, PropRow>
}

function buildEntityLookupMaps(dramaIds: number[]): EntityLookupMaps {
  const charactersById = new Map<number, CharacterRow>()
  const charactersByDramaName = new Map<string, CharacterRow>()
  const scenesById = new Map<number, SceneRow>()
  const scenesByDramaName = new Map<string, SceneRow>()
  const propsById = new Map<number, PropRow>()
  const propsByDramaName = new Map<string, PropRow>()

  if (!dramaIds.length) {
    return {
      charactersById,
      charactersByDramaName,
      scenesById,
      scenesByDramaName,
      propsById,
      propsByDramaName,
    }
  }

  for (const char of db.select().from(schema.characters)
    .where(and(inArray(schema.characters.dramaId, dramaIds), isNull(schema.characters.deletedAt)))
    .all()) {
    if (!char.dramaId) continue
    charactersById.set(char.id, char)
    charactersByDramaName.set(`${char.dramaId}:${char.name}`, char)
  }

  for (const scene of db.select().from(schema.scenes)
    .where(and(inArray(schema.scenes.dramaId, dramaIds), isNull(schema.scenes.deletedAt)))
    .all()) {
    if (!scene.dramaId) continue
    scenesById.set(scene.id, scene)
    scenesByDramaName.set(`${scene.dramaId}:${scene.location}`, scene)
    scenesByDramaName.set(`${scene.dramaId}:${formatSceneAssetName(scene.location, scene.time)}`, scene)
  }

  for (const prop of db.select().from(schema.props)
    .where(and(inArray(schema.props.dramaId, dramaIds), isNull(schema.props.deletedAt)))
    .all()) {
    if (!prop.dramaId) continue
    propsById.set(prop.id, prop)
    propsByDramaName.set(`${prop.dramaId}:${prop.name}`, prop)
  }

  return {
    charactersById,
    charactersByDramaName,
    scenesById,
    scenesByDramaName,
    propsById,
    propsByDramaName,
  }
}

function resolveCharacterForAsset(
  row: typeof schema.assets.$inferSelect,
  maps: EntityLookupMaps,
): CharacterRow | null {
  if (row.sourceType === 'character' && row.sourceId) {
    const char = maps.charactersById.get(row.sourceId)
    if (char && !char.deletedAt) return char
  }
  if (row.dramaId && row.name) {
    return maps.charactersByDramaName.get(`${row.dramaId}:${row.name}`) || null
  }
  return null
}

function resolveSceneForAsset(
  row: typeof schema.assets.$inferSelect,
  maps: EntityLookupMaps,
): SceneRow | null {
  if (row.sourceType === 'scene' && row.sourceId) {
    const scene = maps.scenesById.get(row.sourceId)
    if (scene && !scene.deletedAt) return scene
  }
  if (row.dramaId && row.name) {
    const location = String(row.name).replace(/（[^）]+）$/, '').trim()
    return maps.scenesByDramaName.get(`${row.dramaId}:${row.name}`)
      || maps.scenesByDramaName.get(`${row.dramaId}:${location}`)
      || null
  }
  return null
}

function resolvePropForAsset(
  row: typeof schema.assets.$inferSelect,
  maps: EntityLookupMaps,
): PropRow | null {
  if (row.sourceType === 'prop' && row.sourceId) {
    const prop = maps.propsById.get(row.sourceId)
    if (prop && !prop.deletedAt) return prop
  }
  if (row.dramaId && row.name) {
    return maps.propsByDramaName.get(`${row.dramaId}:${row.name}`) || null
  }
  return null
}

function resolveAssetDisplayMediaFromMaps(
  asset: typeof schema.assets.$inferSelect,
  maps: EntityLookupMaps,
) {
  let url = normalizePath(asset.url || asset.localPath)
  let thumbnailUrl = normalizePath(asset.thumbnailUrl)

  if (!url && asset.sourceId) {
    if (asset.sourceType === 'character') {
      const char = maps.charactersById.get(asset.sourceId)
      url = normalizePath(char?.imageUrl || char?.localPath)
    } else if (asset.sourceType === 'scene') {
      const scene = maps.scenesById.get(asset.sourceId)
      url = normalizePath(scene?.imageUrl || scene?.localPath)
    } else if (asset.sourceType === 'prop' && asset.type !== 'voice') {
      const prop = maps.propsById.get(asset.sourceId)
      url = normalizePath(prop?.imageUrl || prop?.localPath)
    }
  }

  if (url && !thumbnailUrl && asset.type !== 'voice') {
    thumbnailUrl = thumbPathForSource(url)
  }

  return { url, localPath: url, thumbnailUrl }
}

function applyEntityUrlFallback(
  payload: Record<string, unknown>,
  entityUrl?: string | null,
) {
  if (payload.url) return
  const resolved = normalizePath(entityUrl)
  if (!resolved) return
  payload.url = resolved
  payload.localPath = resolved
  if (!payload.thumbnailUrl) payload.thumbnailUrl = thumbPathForSource(resolved)
}

export function listEnrichedAssets(query: AssetListQuery) {
  const rows = queryAssetRows(query)
  const dramaIds = [...new Set(rows.map(row => row.dramaId).filter((id): id is number => !!id))]
  const maps = buildEntityLookupMaps(dramaIds)
  const counts = queryAssetTypeCounts({ dramaId: query.dramaId, q: query.q })

  const items = rows.map((row) => {
    const media = resolveAssetDisplayMediaFromMaps(row, maps)
    const payload: Record<string, unknown> = {
      ...row,
      url: media.url ?? row.url,
      localPath: media.localPath ?? row.localPath,
      thumbnailUrl: media.thumbnailUrl ?? row.thumbnailUrl,
    }

    if (row.type === 'character') {
      const char = resolveCharacterForAsset(row, maps)
      if (char) {
        const characterMedia = summarizeCharacterMediaForAssetList(char)
        payload.characterMedia = characterMedia
        payload.linkedCharacterId = char.id
        payload.seedanceAssetId = char.seedanceAssetId
        payload.seedanceAssetGroupId = char.seedanceAssetGroupId
        payload.seedanceAssetStatus = char.seedanceAssetStatus
        payload.portraitType = char.portraitType
        applyEntityUrlFallback(payload, char.imageUrl || char.localPath)
        if (!payload.url) {
          applyEntityUrlFallback(payload, resolveCharacterCoverUrl(characterMedia))
        }
      }
    } else if (row.type === 'scene') {
      const scene = resolveSceneForAsset(row, maps)
      if (scene) {
        payload.sceneMedia = summarizeSceneMedia(scene)
        payload.linkedSceneId = scene.id
        applyEntityUrlFallback(payload, scene.imageUrl || scene.localPath)
      }
    } else if (row.type === 'prop' || row.type === 'costume') {
      const prop = resolvePropForAsset(row, maps)
      if (prop) {
        payload.propMedia = summarizePropMedia(prop)
        payload.linkedPropId = prop.id
        applyEntityUrlFallback(payload, prop.imageUrl || prop.localPath)
      }
    }

    return payload
  })

  return { items, counts }
}
