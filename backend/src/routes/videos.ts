import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest } from '../utils/response.js'
import { generateVideo, refreshVideoFromProvider } from '../services/video-generation.js'
import { getActiveConfig, getConfigById } from '../services/ai.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { tryChargeUser, tryRefundCharge } from '../utils/credit-charge.js'
import { resolveVideoCreditCharge } from '../constants/credit-actions.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { listVideoLedger } from '../services/video-ledger.js'
import { toSnakeCase } from '../utils/transform.js'

const app = new Hono()

function resolveVideoConfig(body: Record<string, unknown>) {
  let configId = body.config_id != null ? Number(body.config_id) : undefined
  if (body.storyboard_id) {
    const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id))).all()
    if (sb) {
      const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
      if (ep?.videoConfigId != null) configId = ep.videoConfigId
    }
  }
  if (configId) return getConfigById(configId)
  return getActiveConfig('video')
}

// POST /videos — Generate video
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.prompt) return badRequest(c, 'prompt is required')

  const videoConfig = resolveVideoConfig(body)
  const billing = resolveVideoCreditCharge(videoConfig?.provider)

  const billed = tryChargeUser(c, billing.action, {
    summary: '生成镜头视频',
    quantity: billing.quantity,
    dramaId: body.drama_id ? Number(body.drama_id) : undefined,
    resourceType: 'storyboard',
    resourceId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
    metadata: {
      billed_seconds: billing.billedSeconds,
      provider: videoConfig?.provider || null,
    },
  })
  if (billed.error) return billed.error

  try {
    let configId: number | undefined = body.config_id
    if (body.storyboard_id) {
      const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id))).all()
      if (sb) {
        const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
        if (ep?.videoConfigId != null) configId = ep.videoConfigId
      }
    }

    logTaskStart('VideoAPI', 'generate', {
      storyboardId: body.storyboard_id,
      dramaId: body.drama_id,
      referenceMode: body.reference_mode,
      duration: body.duration,
    })
    logTaskPayload('VideoAPI', 'request body', body)
    const id = await generateVideo({
      storyboardId: body.storyboard_id,
      dramaId: body.drama_id,
      prompt: body.prompt,
      model: body.model,
      referenceMode: body.reference_mode,
      imageUrl: body.image_url,
      firstFrameUrl: body.first_frame_url,
      lastFrameUrl: body.last_frame_url,
      referenceImageUrls: body.reference_image_urls,
      contentRefs: body.content_refs,
      duration: body.duration,
      aspectRatio: body.aspect_ratio,
      configId,
      creditTransactionId: billed.charge.transactionId,
      userId: getAuthUser(c).id,
    })

    const [record] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id)).all()
    logTaskSuccess('VideoAPI', 'generate', { generationId: id, provider: record?.provider })
    logActivity(getAuthUser(c), {
      action: 'video.generate',
      summary: '生成镜头视频',
      resourceType: 'storyboard',
      resourceId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
      dramaId: body.drama_id ? Number(body.drama_id) : undefined,
      creditCost: billed.charge.cost,
      metadata: {
        generation_id: id,
        credit_tx_id: billed.charge.transactionId,
        billed_seconds: billing.billedSeconds,
        billing_action: billing.action,
        provider: videoConfig?.provider || null,
      },
    })
    return created(c, record ? toSnakeCase(record) : null)
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '视频生成失败退款',
      dramaId: body.drama_id ? Number(body.drama_id) : undefined,
      resourceType: 'storyboard',
      resourceId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
      metadata: { reason: err.message },
    })
    logTaskError('VideoAPI', 'generate', { error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /videos/ledger — 全量视频生成流水（含已删除分镜的孤儿记录）
app.get('/ledger', async (c) => {
  const user = getAuthUser(c)
  const activeTeamId = resolveActiveTeamId(c, user)
  const dramaId = c.req.query('drama_id') ? Number(c.req.query('drama_id')) : undefined
  const episodeId = c.req.query('episode_id') ? Number(c.req.query('episode_id')) : undefined
  const status = c.req.query('status') || undefined
  const keyword = c.req.query('keyword') || undefined
  const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
  const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined
  const mineOnlyRaw = c.req.query('mine_only')
  const mineOnly = mineOnlyRaw == null || mineOnlyRaw === ''
    ? true
    : !['0', 'false', 'no'].includes(String(mineOnlyRaw).toLowerCase())

  const result = listVideoLedger({
    user,
    activeTeamId,
    dramaId: Number.isFinite(dramaId) ? dramaId : undefined,
    episodeId: Number.isFinite(episodeId) ? episodeId : undefined,
    status,
    keyword,
    limit,
    offset,
    mineOnly,
  })
  return success(c, result)
})

// GET /videos — List by storyboard_id or drama_id
app.get('/', async (c) => {
  const storyboardId = c.req.query('storyboard_id')
  const dramaId = c.req.query('drama_id')

  let rows = db.select().from(schema.videoGenerations).all()

  if (storyboardId) rows = rows.filter(r => r.storyboardId === Number(storyboardId))
  if (dramaId) rows = rows.filter(r => r.dramaId === Number(dramaId))
  rows = rows.filter(r => !r.deletedAt)
  rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  return success(c, rows.map(row => toSnakeCase(row)))
})

// POST /videos/:id/refresh — 用任务绑定的 Key 向服务商查询并补下载
app.post('/:id/refresh', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, 'invalid id')
  try {
    const row = await refreshVideoFromProvider(id)
    return success(c, row ? toSnakeCase(row) : null)
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// GET /videos/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, 'invalid id')
  const [row] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id)).all()
  return success(c, row ? toSnakeCase(row) : null)
})

// DELETE /videos/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  db.delete(schema.videoGenerations).where(eq(schema.videoGenerations.id, id)).run()
  return success(c)
})

export default app
