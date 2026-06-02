import { Hono } from 'hono'
import { eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { ASSET_CATEGORIES, isAssetCategory } from '../constants/asset-categories.js'
import {
  applyAssetToCharacter,
  applyAssetToScene,
  syncDramaAssets,
  upsertLibraryAsset,
} from '../services/asset-library.js'
import { saveUploadedFile } from '../utils/storage.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'

const app = new Hono()

app.get('/categories', (c) => success(c, ASSET_CATEGORIES))

app.get('/', async (c) => {
  const dramaId = c.req.query('drama_id')
  const type = c.req.query('type')
  const q = String(c.req.query('q') || '').trim().toLowerCase()

  let rows = db.select().from(schema.assets).where(isNull(schema.assets.deletedAt)).all()
  if (dramaId) {
    const id = Number(dramaId)
    if (Number.isFinite(id) && id > 0) {
      // 项目筛选时始终保留跨项目资产（drama_id 为空）
      rows = rows.filter(row => row.dramaId == null || row.dramaId === id)
    }
  }
  if (type && isAssetCategory(type)) rows = rows.filter(row => row.type === type)
  if (q) {
    rows = rows.filter(row =>
      String(row.name || '').toLowerCase().includes(q)
      || String(row.description || '').toLowerCase().includes(q),
    )
  }
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return success(c, toSnakeCaseArray(rows))
})

app.post('/', async (c) => {
  const body = await c.req.json()
  const type = String(body.type || 'prop')
  if (!isAssetCategory(type)) return badRequest(c, '无效的资产分类')
  if (!body.name?.trim()) return badRequest(c, 'name is required')

  const id = upsertLibraryAsset({
    dramaId: body.drama_id ? Number(body.drama_id) : null,
    name: String(body.name).trim(),
    description: body.description || null,
    type,
    category: body.category || type,
    url: body.url || null,
    localPath: body.local_path || body.url || null,
    sourceType: 'manual',
  })

  logActivity(getAuthUser(c), {
    action: 'asset.create',
    summary: `添加资产：${body.name}`,
    resourceType: 'asset',
    resourceId: id,
    dramaId: body.drama_id ? Number(body.drama_id) : undefined,
  })
  const [row] = db.select().from(schema.assets).where(eq(schema.assets.id, id)).all()
  return created(c, toSnakeCase(row))
})

app.post('/upload', async (c) => {
  const body = await c.req.parseBody()
  const file = body['file']
  const type = String(body['type'] || 'prop')
  const name = String(body['name'] || '').trim()
  const dramaId = body['drama_id'] ? Number(body['drama_id']) : null
  const description = String(body['description'] || '').trim() || null

  if (!file || !(file instanceof File)) return badRequest(c, 'file is required')
  if (!isAssetCategory(type)) return badRequest(c, '无效的资产分类')
  if (!name) return badRequest(c, 'name is required')

  const buffer = await file.arrayBuffer()
  const path = await saveUploadedFile(buffer, 'assets', file.name)
  const id = upsertLibraryAsset({
    dramaId,
    name,
    description,
    type,
    category: type,
    url: path,
    localPath: path,
    sourceType: 'manual',
  })

  const [row] = db.select().from(schema.assets).where(eq(schema.assets.id, id)).all()
  return created(c, toSnakeCase(row))
})

app.post('/sync', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const dramaId = body.drama_id ? Number(body.drama_id) : null
  if (!dramaId) return badRequest(c, 'drama_id is required')
  const synced = syncDramaAssets(dramaId)
  return success(c, { synced })
})

app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [row] = db.select().from(schema.assets).where(eq(schema.assets.id, id)).all()
  if (!row || row.deletedAt) return badRequest(c, 'Asset not found')

  const updates: Record<string, unknown> = { updatedAt: now() }
  if (body.name !== undefined) updates.name = String(body.name).trim()
  if (body.description !== undefined) updates.description = body.description
  if (body.type !== undefined) {
    if (!isAssetCategory(body.type)) return badRequest(c, '无效的资产分类')
    updates.type = body.type
    updates.category = body.category || body.type
  }
  if (body.url !== undefined) updates.url = body.url
  if (body.local_path !== undefined) updates.localPath = body.local_path
  if (body.is_favorite !== undefined) updates.isFavorite = !!body.is_favorite

  db.update(schema.assets).set(updates).where(eq(schema.assets.id, id)).run()
  const [next] = db.select().from(schema.assets).where(eq(schema.assets.id, id)).all()
  return success(c, toSnakeCase(next))
})

app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  db.update(schema.assets)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(eq(schema.assets.id, id))
    .run()
  return success(c)
})

app.post('/:id/apply-character', async (c) => {
  const assetId = Number(c.req.param('id'))
  const body = await c.req.json()
  const characterId = Number(body.character_id)
  if (!characterId) return badRequest(c, 'character_id is required')
  try {
    const url = applyAssetToCharacter(characterId, assetId)
    return success(c, { image_url: url })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

app.post('/:id/apply-scene', async (c) => {
  const assetId = Number(c.req.param('id'))
  const body = await c.req.json()
  const sceneId = Number(body.scene_id)
  if (!sceneId) return badRequest(c, 'scene_id is required')
  try {
    const url = applyAssetToScene(sceneId, assetId)
    return success(c, { image_url: url })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

export default app
