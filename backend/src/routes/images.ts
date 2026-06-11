import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest } from '../utils/response.js'
import { generateImage } from '../services/image-generation.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { tryChargeUser, tryRefundCharge, CREDIT_ACTIONS } from '../utils/credit-charge.js'
import { getActiveConfig, getConfigById } from '../services/ai.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { listImageLedger } from '../services/image-ledger.js'
import { toSnakeCase } from '../utils/transform.js'
import { resolveDisplayMediaUrl } from '../utils/media-display-url.js'
import { getImageSizeForAspectRatio } from '../utils/image-size.js'
import { getMaxImageReferenceCount } from '../utils/image-reference-limits.js'
import { supportsImageReference, imageReferenceSupportHint } from '../utils/image-reference-support.js'

const app = new Hono()

function resolveImageConfig(body: Record<string, unknown>) {
  let configId = body.config_id != null ? Number(body.config_id) : undefined
  let dramaId: number | undefined = body.drama_id ? Number(body.drama_id) : undefined
  if (body.storyboard_id) {
    const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id))).all()
    if (sb) {
      const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
      if (ep?.imageConfigId != null) configId = ep.imageConfigId
      if (!dramaId && ep) dramaId = ep.dramaId
    }
  }
  if (configId) return getConfigById(configId)
  return getActiveConfig('image')
}

function formatImageRecord(row: typeof schema.imageGenerations.$inferSelect | null | undefined) {
  if (!row) return null
  const rawImage = row.localPath || row.imageUrl
  return toSnakeCase({
    ...row,
    display_image_url: resolveDisplayMediaUrl(rawImage),
  })
}

// POST /images — Generate image
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.prompt) return badRequest(c, 'prompt is required')

  const isStudio = !body.storyboard_id
  const billed = tryChargeUser(c, CREDIT_ACTIONS.IMAGE_GENERATE, {
    summary: isStudio ? '工作台图片生成' : '生成镜头图',
    dramaId: body.drama_id ? Number(body.drama_id) : undefined,
    resourceType: isStudio ? 'image_studio' : 'storyboard',
    resourceId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
  })
  if (billed.error) return billed.error

  try {
    const imageConfig = resolveImageConfig(body)
    let configId: number | undefined = body.config_id
    let dramaId: number | undefined = body.drama_id ? Number(body.drama_id) : undefined
    if (body.storyboard_id) {
      const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id))).all()
      if (sb) {
        const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
        if (ep?.imageConfigId != null) configId = ep.imageConfigId
        if (!dramaId && ep) dramaId = ep.dramaId
      }
    }

    const size = body.size
      || (body.aspect_ratio ? getImageSizeForAspectRatio(body.aspect_ratio) : undefined)

    const referenceImages = Array.isArray(body.reference_images)
      ? body.reference_images.map(String).filter(Boolean)
      : undefined

    if (referenceImages?.length) {
      const maxRefs = getMaxImageReferenceCount(imageConfig)
      if (referenceImages.length > maxRefs) {
        return badRequest(c, `参考图最多 ${maxRefs} 张`)
      }
      if (imageConfig && !supportsImageReference(imageConfig.provider, imageConfig.model)) {
        return badRequest(c, imageReferenceSupportHint())
      }
    }

    const imageType = body.image_type || (isStudio ? 'studio' : undefined)

    logTaskStart('ImageAPI', 'generate', {
      storyboardId: body.storyboard_id,
      sceneId: body.scene_id,
      characterId: body.character_id,
      dramaId,
      frameType: body.frame_type,
      imageType,
      studio: isStudio,
    })
    logTaskPayload('ImageAPI', 'request body', body)
    const id = await generateImage({
      storyboardId: body.storyboard_id,
      dramaId,
      sceneId: body.scene_id,
      characterId: body.character_id,
      prompt: body.prompt,
      model: body.model,
      size,
      referenceImages,
      frameType: body.frame_type,
      imageType,
      configId,
      creditTransactionId: billed.charge.transactionId,
    })

    const [record] = db.select().from(schema.imageGenerations)
      .where(eq(schema.imageGenerations.id, id)).all()
    logTaskSuccess('ImageAPI', 'generate', { generationId: id, provider: record?.provider })
    logActivity(getAuthUser(c), {
      action: 'image.generate',
      summary: isStudio ? '工作台图片生成' : '生成镜头图片',
      resourceType: isStudio ? 'image_studio' : 'storyboard',
      resourceId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
      dramaId,
      creditCost: billed.charge.cost,
      metadata: {
        generation_id: id,
        frame_type: body.frame_type,
        image_type: imageType,
        credit_tx_id: billed.charge.transactionId,
        studio: isStudio,
      },
    })
    return created(c, {
      ...formatImageRecord(record),
      credits_balance: billed.charge.balance,
    })
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '图片生成失败退款',
      dramaId: body.drama_id ? Number(body.drama_id) : undefined,
      resourceType: isStudio ? 'image_studio' : 'storyboard',
      resourceId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
      metadata: { reason: err.message },
    })
    logTaskError('ImageAPI', 'generate', { error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /images/studio/capabilities — 工作台能力（参考图上限等）
app.get('/studio/capabilities', async (c) => {
  const config = getActiveConfig('image')
  const maxReferenceImages = getMaxImageReferenceCount(config)
  return success(c, {
    max_reference_images: maxReferenceImages,
    supports_reference: config ? supportsImageReference(config.provider, config.model) : false,
    reference_hint: imageReferenceSupportHint(),
    provider: config?.provider || null,
    model: config?.model || null,
    aspect_ratios: ['9:16', '16:9'],
  })
})

// GET /images/ledger — 图片生成流水
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
  const studioOnlyRaw = c.req.query('studio_only')
  const studioOnly = studioOnlyRaw != null
    && !['0', 'false', 'no'].includes(String(studioOnlyRaw).toLowerCase())

  const result = listImageLedger({
    user,
    activeTeamId,
    dramaId: Number.isFinite(dramaId) ? dramaId : undefined,
    episodeId: Number.isFinite(episodeId) ? episodeId : undefined,
    status,
    keyword,
    limit,
    offset,
    mineOnly,
    studioOnly,
  })
  return success(c, result)
})

// GET /images — List by storyboard_id or drama_id
app.get('/', async (c) => {
  const storyboardId = c.req.query('storyboard_id')
  const dramaId = c.req.query('drama_id')

  let rows = db.select().from(schema.imageGenerations).all()

  if (storyboardId) rows = rows.filter(r => r.storyboardId === Number(storyboardId))
  if (dramaId) rows = rows.filter(r => r.dramaId === Number(dramaId))
  rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  return success(c, rows.map(row => formatImageRecord(row)))
})

// GET /images/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, 'invalid id')
  const [row] = db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.id, id)).all()
  return success(c, formatImageRecord(row))
})

// DELETE /images/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  db.delete(schema.imageGenerations).where(eq(schema.imageGenerations.id, id)).run()
  return success(c)
})

export default app
