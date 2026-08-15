/**
 * 3D 导演台场景持久化（按用户 + instance_id）
 */
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db, schema } from '../db/index.js'
import { getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { badRequest, notFound, now, success } from '../utils/response.js'

const app = new Hono<{ Variables: AuthVariables }>()

const MAX_STATE_JSON_CHARS = 8_000_000

function normalizeInstanceId(raw: unknown) {
  const value = String(raw || '').trim()
  if (!value || value.length > 200) return ''
  if (!/^[a-zA-Z0-9:._-]+$/.test(value)) return ''
  return value
}

function optionalId(raw: unknown) {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

function serializeScene(row: typeof schema.directorDeskScenes.$inferSelect) {
  let state: unknown = null
  try {
    state = JSON.parse(row.stateJson)
  } catch {
    state = null
  }
  return {
    id: row.id,
    instance_id: row.instanceId,
    user_id: row.userId,
    drama_id: row.dramaId,
    episode_id: row.episodeId,
    storyboard_id: row.storyboardId,
    state,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

function isEphemeralMediaUrl(url: unknown) {
  const value = String(url || '').trim()
  return !value || value.startsWith('blob:') || (value.startsWith('data:') && value.length > 200_000)
}

/** 去掉 blob / 超大 data URL，避免把临时对象存进库 */
function sanitizeDirectorState(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null
  const cloned = JSON.parse(JSON.stringify(raw)) as Record<string, any>
  const project = cloned.project
  if (project && Array.isArray(project.assets)) {
    project.assets = project.assets.map((asset: any) => {
      if (!asset || typeof asset !== 'object') return asset
      if (!isEphemeralMediaUrl(asset.url)) return asset
      return {
        ...asset,
        url: '',
        _host_media_pending: true,
      }
    })
  }
  return cloned
}

// GET /director-desk/scenes?instance_id=
app.get('/scenes', (c) => {
  const user = getAuthUser(c)
  const instanceId = normalizeInstanceId(c.req.query('instance_id'))
  if (!instanceId) return badRequest(c, 'instance_id 无效')

  const row = db
    .select()
    .from(schema.directorDeskScenes)
    .where(and(
      eq(schema.directorDeskScenes.userId, user.id),
      eq(schema.directorDeskScenes.instanceId, instanceId),
    ))
    .get()

  if (!row) return success(c, { scene: null })
  return success(c, { scene: serializeScene(row) })
})

// PUT /director-desk/scenes/:instanceId
app.put('/scenes/:instanceId', async (c) => {
  const user = getAuthUser(c)
  const instanceId = normalizeInstanceId(c.req.param('instanceId'))
  if (!instanceId) return badRequest(c, 'instance_id 无效')

  const body = await c.req.json().catch(() => ({}))
  const sanitized = sanitizeDirectorState(body?.state)
  if (!sanitized) return badRequest(c, 'state 无效')

  const stateJson = JSON.stringify(sanitized)
  if (stateJson.length > MAX_STATE_JSON_CHARS) {
    return badRequest(c, '场景数据过大，请减少本地大图/模型后重试')
  }

  const dramaId = optionalId(body?.drama_id)
  const episodeId = optionalId(body?.episode_id)
  const storyboardId = optionalId(body?.storyboard_id)
  const ts = now()

  const existing = db
    .select()
    .from(schema.directorDeskScenes)
    .where(and(
      eq(schema.directorDeskScenes.userId, user.id),
      eq(schema.directorDeskScenes.instanceId, instanceId),
    ))
    .get()

  if (existing) {
    db.update(schema.directorDeskScenes)
      .set({
        stateJson,
        dramaId,
        episodeId,
        storyboardId,
        updatedAt: ts,
      })
      .where(eq(schema.directorDeskScenes.id, existing.id))
      .run()
    const row = db.select().from(schema.directorDeskScenes).where(eq(schema.directorDeskScenes.id, existing.id)).get()
    return success(c, { scene: row ? serializeScene(row) : null })
  }

  const result = db.insert(schema.directorDeskScenes).values({
    instanceId,
    userId: user.id,
    dramaId,
    episodeId,
    storyboardId,
    stateJson,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const row = db
    .select()
    .from(schema.directorDeskScenes)
    .where(eq(schema.directorDeskScenes.id, Number(result.lastInsertRowid)))
    .get()

  return success(c, { scene: row ? serializeScene(row) : null })
})

// DELETE /director-desk/scenes/:instanceId
app.delete('/scenes/:instanceId', (c) => {
  const user = getAuthUser(c)
  const instanceId = normalizeInstanceId(c.req.param('instanceId'))
  if (!instanceId) return badRequest(c, 'instance_id 无效')

  const existing = db
    .select()
    .from(schema.directorDeskScenes)
    .where(and(
      eq(schema.directorDeskScenes.userId, user.id),
      eq(schema.directorDeskScenes.instanceId, instanceId),
    ))
    .get()

  if (!existing) return notFound(c, '场景不存在')
  db.delete(schema.directorDeskScenes).where(eq(schema.directorDeskScenes.id, existing.id)).run()
  return success(c, { ok: true })
})

export default app
