import { Hono } from 'hono'
import { eq, isNull, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase, toSnakeCaseArray } from '../utils/transform.js'
import { ASSET_CATEGORIES, isAssetCategory } from '../constants/asset-categories.js'
import {
  applyAssetToCharacter,
  applyAssetToScene,
  ensureCharacterFromManualCharacterAsset,
  ensureSceneFromManualSceneAsset,
  ensurePropFromManualPropAsset,
  syncDramaAssets,
  syncEntityFromAsset,
  resolveAssetDisplayMedia,
  upsertLibraryAsset,
  formatSceneAssetName,
} from '../services/asset-library.js'
import { summarizeCharacterMedia } from '../utils/character-image-variants.js'
import { summarizeSceneMedia } from '../utils/scene-image-variants.js'
import { summarizePropMedia } from '../utils/prop-image-variants.js'
import { saveUploadedFile } from '../utils/storage.js'
import { syncCharacterPrimaryImage, syncProjectAsset, syncScenePrimaryImage } from '../utils/oss-entity-sync.js'
import { isOssConfigured } from '../utils/oss-upload.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import {
  getAudioDurationSeconds,
  validateVoiceRefDuration,
  resolveMediaFilePath,
} from '../utils/audio-duration.js'
import fs from 'fs'
import path from 'path'
import { thumbPathForSource } from '../utils/thumbnail.js'

const IMAGE_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])

function isUploadableImage(file: File): boolean {
  if (file.type?.startsWith('image/')) return true
  const ext = path.extname(file.name || '').toLowerCase()
  return IMAGE_UPLOAD_EXTS.has(ext)
}

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
      rows = rows.filter(row => row.dramaId === id)
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
  const enriched = rows.map((row) => {
    const media = resolveAssetDisplayMedia(row)
    const payload: Record<string, unknown> = {
      ...row,
      url: media.url ?? row.url,
      localPath: media.localPath ?? row.localPath,
      thumbnailUrl: media.thumbnailUrl ?? row.thumbnailUrl,
    }
    if (row.type === 'character') {
      let char = null as typeof schema.characters.$inferSelect | null
      if (row.sourceType === 'character' && row.sourceId) {
        [char] = db.select().from(schema.characters).where(eq(schema.characters.id, row.sourceId)).all()
      } else if (row.dramaId && row.name) {
        char = db.select().from(schema.characters)
          .where(and(eq(schema.characters.dramaId, row.dramaId), isNull(schema.characters.deletedAt)))
          .all()
          .find(item => item.name === row.name) || null
      }
      if (char && !char.deletedAt) {
        payload.characterMedia = summarizeCharacterMedia(char)
      }
    } else if (row.type === 'scene') {
      let scene = null as typeof schema.scenes.$inferSelect | null
      if (row.sourceType === 'scene' && row.sourceId) {
        [scene] = db.select().from(schema.scenes).where(eq(schema.scenes.id, row.sourceId)).all()
      } else if (row.dramaId && row.name) {
        const location = String(row.name).replace(/（[^）]+）$/, '').trim()
        scene = db.select().from(schema.scenes)
          .where(and(eq(schema.scenes.dramaId, row.dramaId), isNull(schema.scenes.deletedAt)))
          .all()
          .find(item => item.location === location || formatSceneAssetName(item.location, item.time) === row.name) || null
      }
      if (scene && !scene.deletedAt) {
        payload.sceneMedia = summarizeSceneMedia(scene)
      }
    } else if (row.type === 'prop') {
      let prop = null as typeof schema.props.$inferSelect | null
      if (row.sourceType === 'prop' && row.sourceId) {
        [prop] = db.select().from(schema.props).where(eq(schema.props.id, row.sourceId)).all()
      } else if (row.dramaId && row.name) {
        prop = db.select().from(schema.props)
          .where(and(eq(schema.props.dramaId, row.dramaId), isNull(schema.props.deletedAt)))
          .all()
          .find(item => item.name === row.name) || null
      }
      if (prop && !prop.deletedAt) {
        payload.propMedia = summarizePropMedia(prop)
      }
    }
    return toSnakeCase(payload)
  })
  return success(c, enriched)
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

  if (type === 'scene' && body.drama_id) {
    const sceneId = ensureSceneFromManualSceneAsset({
      dramaId: Number(body.drama_id),
      name: String(body.name).trim(),
      description: body.description || null,
      url: body.url || body.local_path || null,
      localPath: body.local_path || body.url || null,
      assetId: id,
    })
    const imagePath = body.url || body.local_path
    if (sceneId && imagePath) {
      await syncScenePrimaryImage(sceneId, String(imagePath)).catch(() => {})
    }
  } else if (type === 'character' && body.drama_id) {
    const characterId = ensureCharacterFromManualCharacterAsset({
      dramaId: Number(body.drama_id),
      name: String(body.name).trim(),
      description: body.description || null,
      url: body.url || body.local_path || null,
      localPath: body.local_path || body.url || null,
      assetId: id,
    })
    const imagePath = body.url || body.local_path
    if (characterId && imagePath) {
      await syncCharacterPrimaryImage(characterId, String(imagePath)).catch(() => {})
    }
  } else if (type === 'prop' && body.drama_id) {
    ensurePropFromManualPropAsset({
      dramaId: Number(body.drama_id),
      name: String(body.name).trim(),
      description: body.description || null,
      url: body.url || body.local_path || null,
      localPath: body.local_path || body.url || null,
      assetId: id,
    })
  }

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

  const mime = String(file.type || '').toLowerCase()
  const lowerName = String(file.name || '').toLowerCase()
  if (type === 'voice') {
    const isMp3 = mime.includes('mpeg') || mime.includes('mp3') || lowerName.endsWith('.mp3')
    if (!isMp3) return badRequest(c, '音色库仅支持 MP3 文件')
  }

  const buffer = await file.arrayBuffer()
  const path = await saveUploadedFile(buffer, 'assets', file.name)

  if (type === 'voice') {
    const duration = await getAudioDurationSeconds(path)
    const durationError = validateVoiceRefDuration(duration)
    if (durationError) {
      const abs = resolveMediaFilePath(path)
      if (abs && fs.existsSync(abs)) fs.unlinkSync(abs)
      return badRequest(c, durationError)
    }
    const id = upsertLibraryAsset({
      dramaId,
      name,
      description,
      type,
      category: type,
      url: path,
      localPath: path,
      sourceType: 'manual',
      mimeType: mime || 'audio/mpeg',
      duration: Math.round(duration),
      fileSize: buffer.byteLength,
    })
    if (dramaId && isOssConfigured()) {
      await syncProjectAsset(dramaId, path).catch(() => {})
    }
    const [row] = db.select().from(schema.assets).where(eq(schema.assets.id, id)).all()
    return created(c, toSnakeCase(row))
  }

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

  if (type === 'scene' && dramaId) {
    const sceneId = ensureSceneFromManualSceneAsset({
      dramaId,
      name,
      description,
      url: path,
      localPath: path,
      assetId: id,
    })
    if (sceneId) {
      await syncScenePrimaryImage(sceneId, path).catch(() => {})
    }
  } else if (type === 'character' && dramaId) {
    const characterId = ensureCharacterFromManualCharacterAsset({
      dramaId,
      name,
      description,
      url: path,
      localPath: path,
      assetId: id,
    })
    if (characterId) {
      await syncCharacterPrimaryImage(characterId, path).catch(() => {})
    }
  } else if (type === 'prop' && dramaId) {
    ensurePropFromManualPropAsset({
      dramaId,
      name,
      description,
      url: path,
      localPath: path,
      assetId: id,
    })
  }

  const [row] = db.select().from(schema.assets).where(eq(schema.assets.id, id)).all()
  return created(c, toSnakeCase(row))
})

app.post('/sync', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const dramaId = body.drama_id ? Number(body.drama_id) : null
  if (!dramaId) return badRequest(c, 'drama_id is required')
  const synced = syncDramaAssets(dramaId)
  const scenes = db.select().from(schema.scenes)
    .where(and(eq(schema.scenes.dramaId, dramaId), isNull(schema.scenes.deletedAt)))
    .all()
  for (const scene of scenes) {
    const path = scene.imageUrl || scene.localPath
    if (path) {
      await syncScenePrimaryImage(scene.id, path).catch(() => {})
    }
  }
  const characters = db.select().from(schema.characters)
    .where(and(eq(schema.characters.dramaId, dramaId), isNull(schema.characters.deletedAt)))
    .all()
  for (const char of characters) {
    const path = char.imageUrl || char.localPath
    if (path) {
      await syncCharacterPrimaryImage(char.id, path).catch(() => {})
    }
  }
  return success(c, { synced })
})

app.post('/:id/upload', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = db.select().from(schema.assets).where(eq(schema.assets.id, id)).all()
  if (!row || row.deletedAt) return badRequest(c, 'Asset not found')

  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) return badRequest(c, 'file is required')

  const mime = String(file.type || '').toLowerCase()
  const lowerName = String(file.name || '').toLowerCase()

  if (row.type === 'voice') {
    const isMp3 = mime.includes('mpeg') || mime.includes('mp3') || lowerName.endsWith('.mp3')
    if (!isMp3) return badRequest(c, '音色库仅支持 MP3 文件')
    const buffer = await file.arrayBuffer()
    const savedPath = await saveUploadedFile(buffer, 'assets', file.name)
    const duration = await getAudioDurationSeconds(savedPath)
    const durationError = validateVoiceRefDuration(duration)
    if (durationError) {
      const abs = resolveMediaFilePath(savedPath)
      if (abs && fs.existsSync(abs)) fs.unlinkSync(abs)
      return badRequest(c, durationError)
    }
    db.update(schema.assets).set({
      url: savedPath,
      localPath: savedPath,
      mimeType: mime || 'audio/mpeg',
      duration: Math.round(duration),
      fileSize: buffer.byteLength,
      thumbnailUrl: null,
      updatedAt: now(),
    }).where(eq(schema.assets.id, id)).run()
    if (row.dramaId && isOssConfigured()) {
      await syncProjectAsset(row.dramaId, savedPath).catch(() => {})
    }
  } else {
    if (!isUploadableImage(file)) return badRequest(c, '仅支持 JPG / PNG / WebP / GIF 等图片文件')
    const buffer = await file.arrayBuffer()
    const savedPath = await saveUploadedFile(buffer, 'assets', file.name)
    db.update(schema.assets).set({
      url: savedPath,
      localPath: savedPath,
      thumbnailUrl: thumbPathForSource(savedPath),
      mimeType: mime || null,
      fileSize: buffer.byteLength,
      updatedAt: now(),
    }).where(eq(schema.assets.id, id)).run()
  }

  const linked = syncEntityFromAsset(id)
  let [next] = db.select().from(schema.assets).where(eq(schema.assets.id, id)).all()
  if ((!next || next.deletedAt) && linked) {
    ;[next] = db.select().from(schema.assets).where(
      and(
        eq(schema.assets.sourceType, linked.type),
        eq(schema.assets.sourceId, linked.id),
        isNull(schema.assets.deletedAt),
      ),
    ).all()
  }
  let ossWarning: string | undefined
  if (linked?.type === 'scene') {
    const imagePath = next?.url || next?.localPath
    if (imagePath) {
      try {
        await syncScenePrimaryImage(linked.id, String(imagePath))
      } catch (err: any) {
        ossWarning = err?.message || String(err)
      }
    }
  } else if (linked?.type === 'character') {
    const imagePath = next?.url || next?.localPath
    if (imagePath) {
      try {
        await syncCharacterPrimaryImage(linked.id, String(imagePath))
      } catch (err: any) {
        ossWarning = err?.message || String(err)
      }
    }
  }

  logActivity(getAuthUser(c), {
    action: 'asset.upload',
    summary: `重新上传资产：${row.name}`,
    resourceType: 'asset',
    resourceId: id,
    dramaId: row.dramaId ?? undefined,
  })
  return success(c, {
    ...toSnakeCase(next),
    oss_warning: ossWarning,
  })
})

app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [row] = db.select().from(schema.assets).where(eq(schema.assets.id, id)).all()
  if (!row || row.deletedAt) return badRequest(c, 'Asset not found')

  const updates: Record<string, unknown> = { updatedAt: now() }
  if (body.name !== undefined) {
    const nextName = String(body.name).trim()
    if (!nextName) return badRequest(c, 'name is required')
    updates.name = nextName
  }
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
  const linked = syncEntityFromAsset(id)
  let [next] = db.select().from(schema.assets).where(eq(schema.assets.id, id)).all()
  if ((!next || next.deletedAt) && linked) {
    ;[next] = db.select().from(schema.assets).where(
      and(
        eq(schema.assets.sourceType, linked.type),
        eq(schema.assets.sourceId, linked.id),
        isNull(schema.assets.deletedAt),
      ),
    ).all()
  }
  if (linked?.type === 'scene') {
    const path = next?.url || next?.localPath
    if (path) await syncScenePrimaryImage(linked.id, path).catch(() => {})
  } else if (linked?.type === 'character') {
    const path = next?.url || next?.localPath
    if (path) await syncCharacterPrimaryImage(linked.id, path).catch(() => {})
  }
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
    await syncCharacterPrimaryImage(characterId, url).catch(() => {})
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
    await syncScenePrimaryImage(sceneId, url).catch(() => {})
    return success(c, { image_url: url })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

export default app
