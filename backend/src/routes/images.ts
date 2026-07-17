import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, notFound, forbidden, now } from '../utils/response.js'
import { generateImage } from '../services/image-generation.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { denyUnlessAdmin, getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { tryChargeUser, tryChargeImageUser, tryRefundCharge, CREDIT_ACTIONS } from '../utils/credit-charge.js'
import { getActionCost } from '../services/credits.js'
import { resolveBillingImageModel } from '../utils/image-billing.js'
import { getActiveConfig, getConfigById } from '../services/ai.js'
import { resolveImageGenerationConfig } from '../utils/image-config-routing.js'
import { parseStudioImageResolution, STUDIO_IMAGE_RESOLUTIONS } from '../constants/apimart.js'
import {
  APIMART_IMAGE_1K_CREDIT_COST,
  APIMART_IMAGE_2K_CREDIT_COST,
} from '../constants/credit-actions.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { getTeamMemberUserIds } from '../services/team-audit.js'
import { attachGeneratedImageToEntity } from '../services/image-entity-attach.js'
import { listImageLedger, invalidateImageOwnerMapsCache } from '../services/image-ledger.js'
import { toSnakeCase } from '../utils/transform.js'
import { resolveDisplayMediaUrl } from '../utils/media-display-url.js'
import { getImageSizeForAspectRatio } from '../utils/image-size.js'
import { getMaxImageReferenceCount } from '../utils/image-reference-limits.js'
import { supportsImageReference, imageReferenceSupportHint } from '../utils/image-reference-support.js'
import { sanitizeUserFacingProviderError } from '../utils/provider-error-sanitize.js'
import { canViewAllImageStudio } from '../utils/image-studio-access.js'

const app = new Hono()

function resolveImageConfigId(body: Record<string, unknown>): number | undefined {
  let configId = body.config_id != null ? Number(body.config_id) : undefined
  if (body.storyboard_id) {
    const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id))).all()
    if (sb) {
      const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
      if (ep?.imageConfigId != null) configId = ep.imageConfigId
    }
  }
  return configId
}

function resolveImageConfig(body: Record<string, unknown>, model?: string) {
  const configId = resolveImageConfigId(body)
  return resolveImageGenerationConfig({
    configId,
    model: model || String(body.model || '').trim() || undefined,
  })
}

function formatImageRecord(row: typeof schema.imageGenerations.$inferSelect | null | undefined) {
  if (!row) return null
  const rawImage = row.localPath || row.imageUrl
  return toSnakeCase({
    ...row,
    errorMsg: sanitizeUserFacingProviderError(row.errorMsg),
    display_image_url: resolveDisplayMediaUrl(rawImage),
  })
}

// POST /images — Generate image
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.prompt) return badRequest(c, 'prompt is required')

  const isStudio = !body.storyboard_id

  let imageConfig
  try {
    imageConfig = resolveImageConfig(body)
  } catch (err: any) {
    return badRequest(c, err?.message || '图片服务配置不可用')
  }
  if (!imageConfig) return badRequest(c, 'No active image AI config')

  let model: string
  try {
    model = resolveImageModel(body, imageConfig)
  } catch (err: any) {
    return badRequest(c, err.message || '无效的图片模型')
  }

  imageConfig = resolveImageConfig(body, model) || imageConfig

  const studioResolution = isStudio ? parseStudioImageResolution(String(body.resolution || '')) : null
  if (isStudio && body.resolution != null && String(body.resolution).trim() && !studioResolution) {
    return badRequest(c, '分辨率仅支持 1k 或 2k')
  }
  const resolution = studioResolution || parseStudioImageResolution(String(body.resolution || '')) || undefined

  const billed = tryChargeImageUser(c, CREDIT_ACTIONS.IMAGE_GENERATE, model, {
    summary: isStudio ? '工作台图片生成' : '生成镜头图',
    dramaId: body.drama_id ? Number(body.drama_id) : undefined,
    resourceType: isStudio ? 'image_studio' : 'storyboard',
    resourceId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
  }, imageConfig?.provider, resolution || (isStudio ? '1k' : undefined))
  if (billed.error) return billed.error

  try {
    let configId: number | undefined = resolveImageConfigId(body) ?? (body.config_id != null ? Number(body.config_id) : undefined)
    let dramaId: number | undefined = body.drama_id ? Number(body.drama_id) : undefined
    if (body.storyboard_id) {
      const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id))).all()
      if (sb) {
        const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
        if (!dramaId && ep) dramaId = ep.dramaId
      }
    }

    const size = body.size
      || (body.aspect_ratio ? getImageSizeForAspectRatio(body.aspect_ratio) : undefined)

    const referenceImages = Array.isArray(body.reference_images)
      ? body.reference_images.map(String).filter(Boolean)
      : undefined

    if (referenceImages?.length) {
      const refConfig = imageConfig
        ? { provider: imageConfig.provider, model: model || imageConfig.model }
        : null
      const maxRefs = getMaxImageReferenceCount(refConfig)
      if (referenceImages.length > maxRefs) {
        return badRequest(c, `参考图最多 ${maxRefs} 张`)
      }
      if (imageConfig && !supportsImageReference(imageConfig.provider, model)) {
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
      model,
      size,
      resolution: resolution || (isStudio ? '1k' : undefined),
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
    invalidateImageOwnerMapsCache()
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
    return badRequest(c, sanitizeUserFacingProviderError(err.message))
  }
})

const STUDIO_IMAGE_MODELS = ['gpt-image-2'] as const

function resolveStudioModels() {
  return [...STUDIO_IMAGE_MODELS]
}

function resolveImageModel(body: Record<string, unknown>, config: ReturnType<typeof getActiveConfig>) {
  const requested = String(body.model || '').trim()
  if (!requested) return config?.model || STUDIO_IMAGE_MODELS[0]
  const configured = config?.models?.length
    ? config.models
    : (config?.model ? [config.model] : [...STUDIO_IMAGE_MODELS])
  const studioAllowed = resolveStudioModels()
  const allowed = new Set([...configured, ...studioAllowed])
  if (!allowed.has(requested)) {
    throw new Error(`模型 ${requested} 不在当前图片服务配置中`)
  }
  return requested
}

// GET /images/studio/capabilities — 工作台能力（参考图上限等）
app.get('/studio/capabilities', async (c) => {
  const user = getAuthUser(c)
  const studioModels = resolveStudioModels()
  const defaultModel = studioModels[0] || STUDIO_IMAGE_MODELS[0]
  let config
  try {
    config = resolveImageGenerationConfig({ model: defaultModel })
  } catch {
    config = getActiveConfig('image')
  }
  const maxReferenceImages = getMaxImageReferenceCount(config)
  const canViewAll = canViewAllImageStudio(user)
  let userFilterOptions: { id: number; username: string; display_name: string }[] = []
  if (canViewAll) {
    userFilterOptions = db.select({
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      isActive: schema.users.isActive,
    })
      .from(schema.users)
      .orderBy(desc(schema.users.id))
      .all()
      .filter(row => row.isActive)
      .map(row => ({
        id: row.id,
        username: row.username,
        display_name: row.displayName || row.username,
      }))
  }
  const credit1k = getActionCost(CREDIT_ACTIONS.IMAGE_GENERATE_APIMART_1K) || APIMART_IMAGE_1K_CREDIT_COST
  const credit2k = getActionCost(CREDIT_ACTIONS.IMAGE_GENERATE_APIMART_2K) || APIMART_IMAGE_2K_CREDIT_COST
  return success(c, {
    max_reference_images: maxReferenceImages,
    supports_reference: config ? supportsImageReference(config.provider, defaultModel) : false,
    reference_hint: imageReferenceSupportHint(),
    provider: config?.provider || null,
    model: defaultModel,
    models: studioModels,
    resolutions: STUDIO_IMAGE_RESOLUTIONS.map(id => ({
      id,
      label: id.toUpperCase(),
      credit_cost: id === '2k' ? credit2k : credit1k,
    })),
    default_resolution: '1k',
    aspect_ratios: ['16:9', '9:16'],
    default_aspect_ratio: '16:9',
    can_view_all_studio: true,
    user_filter_options: canViewAll ? userFilterOptions : [],
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
  const userIdParam = c.req.query('user_id') ? Number(c.req.query('user_id')) : undefined
  let filterUserId: number | undefined
  if (userIdParam && Number.isFinite(userIdParam) && userIdParam > 0) {
    if (userIdParam === user.id) {
      filterUserId = userIdParam
    } else if (canViewAllImageStudio(user)) {
      filterUserId = userIdParam
    } else {
      const teamId = activeTeamId
      if (!teamId) return forbidden(c, '需要选择团队后才能查看其他成员')
      const memberIds = getTeamMemberUserIds(teamId)
      if (!memberIds.includes(user.id)) {
        return forbidden(c, '无权查看团队成员图片')
      }
      if (!memberIds.includes(userIdParam)) {
        return forbidden(c, '该用户不在当前团队')
      }
      filterUserId = userIdParam
    }
  }

  const mineOnly = filterUserId
    ? false
    : mineOnlyRaw == null || mineOnlyRaw === ''
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
    userId: filterUserId,
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

// POST /images/:id/attach — 将已生成图片添加到角色/场景/道具分组
app.post('/:id/attach', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, 'invalid id')

  const body = await c.req.json()
  const entityType = String(body.entity_type || body.entityType || '').trim() as 'character' | 'scene' | 'prop'
  if (!['character', 'scene', 'prop'].includes(entityType)) {
    return badRequest(c, 'entity_type 须为 character / scene / prop')
  }

  const entityIdRaw = body.entity_id ?? body.entityId
  const entityId = entityIdRaw != null && String(entityIdRaw).trim() !== ''
    ? Number(entityIdRaw)
    : undefined
  const dramaIdRaw = body.drama_id ?? body.dramaId
  const dramaId = dramaIdRaw != null && String(dramaIdRaw).trim() !== ''
    ? Number(dramaIdRaw)
    : undefined
  const createEntity = body.create_entity ?? body.createEntity ?? null

  if ((!entityId || !Number.isFinite(entityId) || entityId <= 0) && !createEntity) {
    return badRequest(c, 'entity_id 或 create_entity 必填')
  }

  try {
    const user = getAuthUser(c)
    const activeTeamId = resolveActiveTeamId(c, user)
    const result = attachGeneratedImageToEntity({
      generationId: id,
      entityType,
      entityId,
      dramaId,
      createEntity,
      groupId: body.group_id ?? body.groupId,
      groupLabel: body.group_label ?? body.groupLabel,
      setAsDefault: body.set_as_default ?? body.setAsDefault,
      user,
      activeTeamId,
    })

    const typeLabel = entityType === 'character' ? '角色' : entityType === 'scene' ? '场景' : '道具'
    logActivity(user, {
      action: 'image.attach_entity',
      summary: `图片 #${id} ${result.created_entity ? '新建并添加至' : '添加到'}${typeLabel}「${result.entity_label}」· ${result.group_label}`,
      resourceType: 'image_generation',
      resourceId: id,
      metadata: {
        entity_type: entityType,
        entity_id: result.entity_id,
        group_id: result.group_id,
        created_entity: result.created_entity,
      },
    })
    return success(c, result)
  } catch (err: any) {
    return badRequest(c, err.message || '添加失败')
  }
})

// POST /images/:id/pin — 管理员置顶
app.post('/:id/pin', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, 'invalid id')

  const [row] = db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.id, id)).all()
  if (!row) return notFound(c, '图片不存在')

  const ts = now()
  db.update(schema.imageGenerations)
    .set({ isPinned: 1, pinnedAt: ts, updatedAt: ts })
    .where(eq(schema.imageGenerations.id, id))
    .run()

  const [updated] = db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.id, id)).all()
  return success(c, formatImageRecord(updated))
})

// DELETE /images/:id/pin — 管理员取消置顶
app.delete('/:id/pin', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, 'invalid id')

  const [row] = db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.id, id)).all()
  if (!row) return notFound(c, '图片不存在')

  const ts = now()
  db.update(schema.imageGenerations)
    .set({ isPinned: 0, pinnedAt: null, updatedAt: ts })
    .where(eq(schema.imageGenerations.id, id))
    .run()

  const [updated] = db.select().from(schema.imageGenerations)
    .where(eq(schema.imageGenerations.id, id)).all()
  return success(c, formatImageRecord(updated))
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
