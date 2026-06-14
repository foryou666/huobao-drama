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
import {
  resolveVideoCreditCharge,
  resolveVideoBillingSeconds,
  CREDIT_ACTIONS,
  VIDEO_BILLING_SECONDS,
} from '../constants/credit-actions.js'
import { CHENGMENG_VIDEO_MODELS, isChengmengProvider, isChengmengVideoModelId, CHENGMENT_DOC_URL } from '../constants/chengmeng.js'
import { SEEDANCE_MODELS, SEEDANCE_ARK_BASE_URL, SEEDANCE_DOC_URL } from '../constants/seedance.js'
import { getActionCost } from '../services/credits.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { listVideoLedger } from '../services/video-ledger.js'
import { toSnakeCase } from '../utils/transform.js'
import {
  findOfficialVolcengineConfigForModel,
  findOfficialVolcengineConfigRow,
  isOfficialSeedanceModel,
  assertOfficialVolcengineApiKey,
  isOfficialVideoRequest,
  isOfficialVolcengineConfigId,
  isPlaceholderApiKey,
  listOfficialVolcengineConfigRows,
  resolveOfficialVideoConfigId,
} from '../utils/official-volcengine-video.js'
import { findChengmengVideoConfigRow } from '../utils/chengmeng-video-options.js'

const app = new Hono()

function resolveVideoConfig(body: Record<string, unknown>) {
  const officialConfigId = resolveOfficialVideoConfigId(body)
  if (officialConfigId != null) {
    return getConfigById(officialConfigId, { includeInactive: true })
  }

  let configId = body.config_id != null ? Number(body.config_id) : undefined
  if (body.storyboard_id) {
    const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id))).all()
    if (sb) {
      const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
      if (ep?.videoConfigId != null) configId = ep.videoConfigId
    }
  }
  if (configId) {
    const includeInactive = isOfficialVolcengineConfigId(configId)
      || isOfficialSeedanceModel(body.model)
    return getConfigById(configId, includeInactive ? { includeInactive: true } : undefined)
  }
  return getActiveConfig('video')
}

function resolveEffectiveVideoModel(body: Record<string, unknown>, config: ReturnType<typeof getConfigById>) {
  if (body.model) return String(body.model)
  if (isChengmengProvider(config?.provider)) {
    return CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST
  }
  return config?.model || null
}

function assertChengmengVideoModel(body: Record<string, unknown>) {
  if (!body.model) return null
  const model = String(body.model).trim()
  if (!isChengmengVideoModelId(model)) {
    return `不支持的橙盟视频模型：${model}`
  }
  return null
}

// POST /videos — Generate video
app.post('/', async (c) => {
  const body = await c.req.json()
  if (!body.prompt) return badRequest(c, 'prompt is required')

  if (isOfficialVideoRequest(body)) {
    if (!body.model || !isOfficialSeedanceModel(body.model)) {
      return badRequest(c, '官方视频生成需选择 Seedance 2.0 或 2.0 Fast 模型')
    }
    const candidates = listOfficialVolcengineConfigRows()
    if (!candidates.length) {
      return badRequest(c, '未配置火山官方 Seedance 视频服务，请联系管理员在设置中添加 provider=volcengine、Base URL 为 ark.cn-beijing.volces.com 的配置')
    }
    if (body.config_id != null && !isOfficialVolcengineConfigId(body.config_id)) {
      return badRequest(c, '官方 Seedance 模型需使用火山方舟官方视频配置')
    }
    const officialConfigId = resolveOfficialVideoConfigId(body)
    if (!officialConfigId) {
      return badRequest(c, '未找到与所选模型匹配的火山官方视频配置')
    }
    body.config_id = officialConfigId
  }

  const videoConfig = resolveVideoConfig(body)
  if (isOfficialVideoRequest(body) && videoConfig?.provider !== 'volcengine') {
    return badRequest(c, '官方视频必须使用火山方舟 API，当前配置通道不正确')
  }
  if (isChengmengProvider(videoConfig?.provider) && body.model) {
    const modelError = assertChengmengVideoModel(body)
    if (modelError) return badRequest(c, modelError)
  }
  if (isOfficialVideoRequest(body)) {
    try {
      assertOfficialVolcengineApiKey(videoConfig)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
  }
  const effectiveModel = resolveEffectiveVideoModel(body, videoConfig)
  const billing = resolveVideoCreditCharge(
    videoConfig?.provider,
    effectiveModel,
    body.duration != null ? Number(body.duration) : undefined,
  )

  const billed = tryChargeUser(c, billing.action, {
    summary: '生成镜头视频',
    quantity: billing.quantity,
    dramaId: body.drama_id ? Number(body.drama_id) : undefined,
    resourceType: 'storyboard',
    resourceId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
    metadata: {
      billed_seconds: billing.billedSeconds,
      provider: videoConfig?.provider || null,
      model: effectiveModel,
    },
  })
  if (billed.error) return billed.error

  try {
    let configId: number | undefined = body.config_id != null ? Number(body.config_id) : undefined
    if (!isOfficialVideoRequest(body) && body.storyboard_id) {
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
        model: effectiveModel,
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

// GET /videos/chengmeng-options — 橙盟视频页：模型与定价
app.get('/chengmeng-options', (c) => {
  const row = findChengmengVideoConfigRow()
  const models = [
    {
      id: CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST,
      label: 'Seedance 2.0 Fast',
      description: '快速版，9图过人脸',
      model_id: CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0_FAST,
      group_id: '15',
      credit_action: CREDIT_ACTIONS.VIDEO_GENERATE_CHENGMENT,
    },
    {
      id: CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0,
      label: 'Seedance 2.0',
      description: '标准版，画质优先',
      model_id: CHENGMENG_VIDEO_MODELS.SEEDANCE_2_0,
      group_id: '15',
      credit_action: CREDIT_ACTIONS.VIDEO_GENERATE_CHENGMENG_SEEDANCE_2_0,
    },
  ].map(item => ({
    ...item,
    config_id: row?.id ?? null,
    billing_unit: 'flat',
    billing_seconds: VIDEO_BILLING_SECONDS,
    credit_cost: getActionCost(item.credit_action, 1),
  }))

  return success(c, {
    available: !!row && row.isActive,
    config_id: row?.id ?? null,
    config_name: row?.name ?? null,
    config_inactive: !!(row && !row.isActive),
    doc_url: CHENGMENT_DOC_URL,
    models,
  })
})

// GET /videos/official-options — 官方 Seedance 页面：配置与模型定价
app.get('/official-options', (c) => {
  const candidates = listOfficialVolcengineConfigRows()
  const row = findOfficialVolcengineConfigRow()
  const models = [
    {
      id: SEEDANCE_MODELS.V2_0,
      label: 'Seedance 2.0',
      description: '标准版，画质优先',
      credit_action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0,
    },
    {
      id: SEEDANCE_MODELS.V2_0_FAST,
      label: 'Seedance 2.0 Fast',
      description: '快速版，速度优先',
      credit_action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST,
    },
  ].map(item => {
    const creditCostPerSecond = getActionCost(item.credit_action, 1)
    const billingSecondsMax = resolveVideoBillingSeconds(VIDEO_BILLING_SECONDS, item.id)
    return {
      ...item,
      config_id: findOfficialVolcengineConfigForModel(item.id)?.id ?? null,
      billing_unit: 'per_second',
      billing_seconds_min: 4,
      billing_seconds_max: VIDEO_BILLING_SECONDS,
      credit_cost_per_second: creditCostPerSecond,
      credit_cost: getActionCost(item.credit_action, billingSecondsMax),
    }
  })

  return success(c, {
    available: !!row && !isPlaceholderApiKey(row.apiKey),
    config_id: row?.id ?? null,
    config_name: row?.name ?? null,
    config_inactive: !!(row && !row.isActive),
    api_key_configured: !!(row && !isPlaceholderApiKey(row.apiKey)),
    doc_url: SEEDANCE_DOC_URL,
    ark_base_url: SEEDANCE_ARK_BASE_URL,
    models,
  })
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
  const provider = c.req.query('provider') || undefined
  const modelsRaw = c.req.query('models') || undefined
  const models = modelsRaw
    ? String(modelsRaw).split(',').map(item => item.trim()).filter(Boolean)
    : undefined

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
    provider,
    models,
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
