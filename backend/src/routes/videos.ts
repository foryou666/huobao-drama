import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, forbidden } from '../utils/response.js'
import { generateVideo, refreshVideoFromProvider } from '../services/video-generation.js'
import { getActiveConfig, getConfigById } from '../services/ai.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { tryChargeUser, tryRefundCharge } from '../utils/credit-charge.js'
import {
  resolveVideoCreditCharge,
  resolveVideoBillingSeconds,
  resolveGrokVideoCreditAction,
  CREDIT_ACTIONS,
  VIDEO_BILLING_SECONDS,
} from '../constants/credit-actions.js'
import { isChengmengProvider, CHENGMENG_VIDEO_MODELS, CHENGMENT_DOC_URL } from '../constants/chengmeng.js'
import { SEEDANCE_MODELS, SEEDANCE_ARK_BASE_URL, SEEDANCE_DOC_URL } from '../constants/seedance.js'
import { getActionCost, type ChargeContext } from '../services/credits.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { getTeamMemberUserIds } from '../services/team-audit.js'
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
import { findChengmengVideoConfigRow, getChengmengVideoModelOptions, isChengmengVideoModelAllowed, listChengmengModelOptionsForApi, pickChengmengChannel1UiModels, syncChengmengModelCreditPricing } from '../utils/chengmeng-video-options.js'
import { isChengmengModelEnabled } from '../utils/chengmeng-model-settings.js'
import { sanitizeUserFacingProviderError } from '../utils/provider-error-sanitize.js'
import {
  assertGeeknowGrokApiKey,
  findGeeknowGrokVideoConfigRow,
  isGeeknowConfigId,
  isGrokVideoModel,
  isGrokVideoRequest,
  listGrokVideoModelOptions,
  resolveGrokVideoConfigId,
} from '../utils/geeknow-grok-video-options.js'
import { GROK_VIDEO_DOC_URL } from '../constants/geeknow-grok.js'
import {
  assertJimengSessionConfigured,
  assertJimengReferencesAllowed,
  isJimengVideoRequest,
  listJimengSessionSummaries,
  listJimengVideoModelOptions,
  normalizeJimengSubmitModel,
} from '../utils/jimeng-web-video-options.js'
import { isJimengVideoModel, isJimengEnabledVideoModel, JIMENG_REF_LIMITS, JIMENG_ASPECT_RATIOS, JIMENG_DEFAULT_ASPECT_RATIO } from '../constants/jimeng-web.js'
import { buildJimengVirtualConfig } from '../services/jimeng-web-video.js'
import { buildXyqVirtualConfig } from '../services/xyq-web-video.js'
import { buildDoubaoTrainingVirtualConfig } from '../services/doubao-training-video.js'
import { getActiveJimengSessionId, getJimengWebSession } from '../services/jimeng-web-session.js'
import { resolveJimengSessionForUserDrama } from '../services/jimeng-session-binding.js'
import { getActiveXyqSessionId, getXyqWebSession } from '../services/xyq-web-session.js'
import { resolveXyqSessionForGeneration } from '../services/xyq-session-picker.js'
import {
  assertXyqSessionConfigured,
  assertXyqReferencesAllowed,
  isXyqVideoRequest,
  listXyqSessionSummaries,
  listXyqVideoModelOptions,
  normalizeXyqSubmitModel,
} from '../utils/xyq-web-video-options.js'
import { isXyqVideoModel, isXyqEnabledVideoModel, XYQ_REF_LIMITS, XYQ_ASPECT_RATIOS, XYQ_DEFAULT_ASPECT_RATIO } from '../constants/xyq-web.js'
import { getActiveDoubaoTrainingSessionId, getDoubaoTrainingSession } from '../services/doubao-training-session.js'
import { isDoubaoTrainingVideoModel, normalizeDoubaoTrainingModel } from '../constants/doubao-training.js'
import {
  assertDoubaoTrainingSessionConfigured,
  getDoubaoTrainingOptionsPayload,
  isDoubaoTrainingVideoRequest,
  listDoubaoTrainingModelOptions,
  listDoubaoTrainingSessionSummaries,
} from '../utils/doubao-training-video-options.js'
import {
  assertAistarslabApiKey,
  findAistarslabVideoConfigRow,
  isAistarslabConfigId,
  isAistarslabVideoModel,
  isAistarslabVideoRequest,
  listAistarslabModelOptionsForApi,
  loadAistarslabVideoConfigFromProvider,
  normalizeAistarslabVideoConfig,
  resolveAistarslabVideoConfigId,
  resolveDefaultAistarslabSelection,
  resolveAistarslabUserCreditCost,
  resolveAistarslabCreditAction,
  isAistarslabSelectionAllowed,
  bodyHasReferenceVideo,
  syncAistarslabModelCreditPricing,
} from '../utils/aistarslab-video-options.js'
import {
  applyAistarslabChannelVisibility,
  isAistarslabChannelEnabled,
} from '../utils/aistarslab-channel-settings.js'
import { AISTARSLAB_DOC_URL, AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER } from '../constants/aistarslab.js'

const app = new Hono()

function resolveVideoConfig(body: Record<string, unknown>) {
  if (isJimengVideoRequest(body)) {
    return buildJimengVirtualConfig(body.model ? String(body.model) : undefined)
  }
  if (isXyqVideoRequest(body)) {
    return buildXyqVirtualConfig(body.model ? String(body.model) : undefined)
  }
  if (isDoubaoTrainingVideoRequest(body)) {
    return buildDoubaoTrainingVirtualConfig(body.model ? String(body.model) : undefined)
  }

  const grokConfigId = resolveGrokVideoConfigId(body)
  if (grokConfigId != null) {
    return getConfigById(grokConfigId, { includeInactive: true })
  }

  const aistarslabConfigId = resolveAistarslabVideoConfigId(body)
  if (aistarslabConfigId != null) {
    return getConfigById(aistarslabConfigId, { includeInactive: true })
  }

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
      || isGeeknowConfigId(configId)
      || isGrokVideoModel(String(body.model || ''))
      || isAistarslabConfigId(configId)
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

function assertChengmengVideoModel(body: Record<string, unknown>, allowedModels: Awaited<ReturnType<typeof getChengmengVideoModelOptions>>) {
  if (!body.model) return null
  const model = String(body.model).trim()
  if (!isChengmengVideoModelAllowed(model, allowedModels)) {
    const allowed = allowedModels.map(item => item.id).join(', ')
    return `不支持的橙盟视频模型：${model}${allowed ? `（可用：${allowed}）` : ''}`
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

  if (isGrokVideoRequest(body)) {
    if (!body.model || !isGrokVideoModel(body.model)) {
      return badRequest(c, 'Grok 视频生成需选择 grok-video 模型')
    }
    const row = findGeeknowGrokVideoConfigRow()
    if (!row) {
      return badRequest(c, '未配置 GeekNow 服务，请在设置中添加 provider=geeknow 的图片或视频配置')
    }
    if (body.config_id != null && !isGeeknowConfigId(body.config_id)) {
      return badRequest(c, 'Grok 视频需使用 GeekNow 配置')
    }
    const grokConfigId = resolveGrokVideoConfigId(body)
    if (!grokConfigId) {
      return badRequest(c, '未找到 GeekNow Grok 视频配置')
    }
    body.config_id = grokConfigId
  }

  if (isJimengVideoRequest(body)) {
    if (!body.model || !isJimengVideoModel(String(body.model))) {
      return badRequest(c, '即梦视频生成需选择 jimeng-video 模型')
    }
    if (!isJimengEnabledVideoModel(String(body.model))) {
      return badRequest(c, '所选即梦模型不可用，请刷新页面后重选')
    }
    try {
      assertJimengReferencesAllowed(body)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    try {
      assertJimengSessionConfigured()
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    const jimengSessionId = String(body.jimeng_session_id || body.jimengSessionId || '').trim()
    if (jimengSessionId) {
      const user = getAuthUser(c)
      if (user.role !== 'admin') {
        delete body.jimeng_session_id
        delete body.jimengSessionId
      } else if (!getJimengWebSession(jimengSessionId)) {
        return badRequest(c, '所选即梦 Session 不存在')
      }
    }
    body.provider = 'jimeng_web'
    normalizeJimengSubmitModel(body)
  }

  if (isXyqVideoRequest(body)) {
    if (!body.model || !isXyqVideoModel(String(body.model))) {
      return badRequest(c, 'S通道5视频生成需选择对应模型')
    }
    if (!isXyqEnabledVideoModel(String(body.model))) {
      return badRequest(c, '所选S通道5模型不可用，请刷新页面后重选')
    }
    try {
      assertXyqReferencesAllowed(body)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    try {
      assertXyqSessionConfigured()
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    const xyqSessionId = String(body.xyq_session_id || body.xyqSessionId || '').trim()
    if (xyqSessionId) {
      const user = getAuthUser(c)
      if (user.role !== 'admin') {
        delete body.xyq_session_id
        delete body.xyqSessionId
      } else if (!getXyqWebSession(xyqSessionId)) {
        return badRequest(c, '所选S通道5 Access Key 不存在')
      }
    }
    body.provider = 'xyq_web'
    normalizeXyqSubmitModel(body)
  }

  if (isDoubaoTrainingVideoRequest(body)) {
    if (!body.model || !isDoubaoTrainingVideoModel(String(body.model))) {
      return badRequest(c, '豆包培训视频需选择培训模型（Seedance 2.0 Fast / Mini）')
    }
    body.model = normalizeDoubaoTrainingModel(String(body.model))
    try {
      assertDoubaoTrainingSessionConfigured()
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    const doubaoSessionId = String(body.doubao_training_session_id || body.doubaoTrainingSessionId || '').trim()
    if (doubaoSessionId && !getDoubaoTrainingSession(doubaoSessionId)) {
      return badRequest(c, '所选豆包培训 Session 不存在')
    }
    body.provider = 'doubao_training'
  }

  if (isAistarslabVideoRequest(body)) {
    if (!body.model || !isAistarslabVideoModel(String(body.model))) {
      return badRequest(c, 'Seedance VIP 视频生成需选择 Seedance 2.0 模型')
    }
    const row = findAistarslabVideoConfigRow()
    if (!row) {
      return badRequest(c, '未配置 Seedance VIP 视频服务，请在设置中添加视频配置')
    }
    if (body.config_id != null && !isAistarslabConfigId(body.config_id)) {
      return badRequest(c, 'Seedance VIP 视频需使用对应通道配置')
    }
    const aistarslabConfigId = resolveAistarslabVideoConfigId(body)
    if (!aistarslabConfigId) {
      return badRequest(c, '未找到 Seedance VIP 视频配置')
    }
    body.config_id = aistarslabConfigId
  }

  const videoConfig = resolveVideoConfig(body)
  if (isOfficialVideoRequest(body) && videoConfig?.provider !== 'volcengine') {
    return badRequest(c, '官方视频必须使用火山方舟 API，当前配置通道不正确')
  }
  if (isGrokVideoRequest(body) && videoConfig?.provider !== 'geeknow') {
    return badRequest(c, 'Grok 视频必须使用 GeekNow 配置')
  }
  if (isJimengVideoRequest(body) && videoConfig?.provider !== 'jimeng_web') {
    return badRequest(c, '即梦视频通道不正确')
  }
  if (isXyqVideoRequest(body) && videoConfig?.provider !== 'xyq_web') {
    return badRequest(c, 'S通道5视频通道不正确')
  }
  if (isDoubaoTrainingVideoRequest(body) && videoConfig?.provider !== 'doubao_training') {
    return badRequest(c, '豆包培训视频通道不正确')
  }
  if (isAistarslabVideoRequest(body) && videoConfig?.provider !== 'aistarslab') {
    return badRequest(c, 'Seedance VIP 视频通道配置不正确')
  }
  if (isChengmengProvider(videoConfig?.provider) && body.model) {
    const model = String(body.model).trim()
    if (!isChengmengModelEnabled(model)) {
      return badRequest(c, '该模型已停用，请联系管理员在「设置 → 积分」中启用')
    }
    const allowedModels = pickChengmengChannel1UiModels(await getChengmengVideoModelOptions(videoConfig))
    const modelError = assertChengmengVideoModel(body, allowedModels)
    if (modelError) return badRequest(c, modelError)
  }
  if (isOfficialVideoRequest(body)) {
    try {
      assertOfficialVolcengineApiKey(videoConfig)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
  }
  if (isGrokVideoRequest(body)) {
    try {
      assertGeeknowGrokApiKey(videoConfig)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
  }
  if (isAistarslabVideoRequest(body)) {
    try {
      assertAistarslabApiKey(videoConfig)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    const channel = String(body.aistarslab_channel || body.channel || '').trim()
    const model = String(body.model || '').trim()
    if (channel && !isAistarslabChannelEnabled(channel)) {
      return badRequest(c, '该线路已停用，请联系管理员在「设置 → 积分」中启用')
    }
    if (channel && model && videoConfig && !isPlaceholderApiKey(videoConfig.apiKey)) {
      try {
        const remote = applyAistarslabChannelVisibility(
          await loadAistarslabVideoConfigFromProvider(videoConfig),
        )
        if (remote.channels.length && !isAistarslabSelectionAllowed(remote, channel, model)) {
          return badRequest(c, '所选线路与模型不可用，请刷新页面后重选')
        }
      } catch {
        /* 配置拉取失败时仍允许提交，由上游校验 */
      }
    }
  }
  const effectiveModel = resolveEffectiveVideoModel(body, videoConfig)
  const billing = resolveVideoCreditCharge(
    videoConfig?.provider,
    effectiveModel,
    body.duration != null ? Number(body.duration) : undefined,
  )

  const aistarslabRequest = isAistarslabVideoRequest(body)
  const chargeContext: ChargeContext = {
    summary: '生成镜头视频',
    quantity: billing.quantity,
    dramaId: body.drama_id ? Number(body.drama_id) : undefined,
    resourceType: 'storyboard',
    resourceId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
    metadata: {
      billed_seconds: billing.billedSeconds,
      provider: videoConfig?.provider || null,
      model: effectiveModel,
      billing_unit: aistarslabRequest ? 'flat' : undefined,
      ...(aistarslabRequest
        ? {
            has_reference_video: bodyHasReferenceVideo(body),
            reference_video_multiplier: bodyHasReferenceVideo(body)
              ? AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER
              : 1,
          }
        : {}),
    },
    ...(aistarslabRequest ? { flatCost: resolveAistarslabUserCreditCost(body) } : {}),
  }

  const chargeAction = aistarslabRequest
    ? resolveAistarslabCreditAction(body.aistarslab_channel || body.channel, effectiveModel)
    : billing.action

  const billed = tryChargeUser(c, chargeAction, chargeContext)
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
    const authUser = getAuthUser(c)
    let jimengSessionId: string | undefined
    if (isJimengVideoRequest(body)) {
      const preferred = authUser.role === 'admin'
        ? String(body.jimeng_session_id || body.jimengSessionId || '').trim() || undefined
        : undefined
      const resolved = await resolveJimengSessionForUserDrama({
        userId: authUser.id,
        dramaId: body.drama_id != null ? Number(body.drama_id) : null,
        preferredSessionId: preferred,
      })
      jimengSessionId = resolved.session.id
      logTaskPayload('VideoAPI', 'jimeng session bind', {
        userId: authUser.id,
        dramaId: body.drama_id,
        sessionId: resolved.session.id,
        source: resolved.source,
        bindingKey: resolved.bindingKey,
        previousSessionId: resolved.previousSessionId || null,
      })
    }
    let xyqSessionId: string | undefined
    if (isXyqVideoRequest(body)) {
      const preferred = authUser.role === 'admin'
        ? String(body.xyq_session_id || body.xyqSessionId || '').trim() || undefined
        : undefined
      const resolved = await resolveXyqSessionForGeneration({
        model: body.model != null ? String(body.model) : null,
        duration: body.duration != null ? Number(body.duration) : null,
        preferredSessionId: preferred,
      })
      xyqSessionId = resolved.session.id
      logTaskPayload('VideoAPI', 'xyq session pick', {
        userId: authUser.id,
        sessionId: resolved.session.id,
        label: resolved.session.label,
        source: resolved.source,
        estimatedNeed: resolved.estimatedNeed,
        balance: resolved.balance,
        giftCredit: resolved.giftCredit,
        freeCredit: resolved.freeCredit,
        model: body.model,
        duration: body.duration,
      })
    }
    const doubaoTrainingSessionId = isDoubaoTrainingVideoRequest(body)
      ? String(body.doubao_training_session_id || body.doubaoTrainingSessionId || '').trim() || undefined
      : undefined
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
      provider: isJimengVideoRequest(body)
        ? 'jimeng_web'
        : isXyqVideoRequest(body)
          ? 'xyq_web'
          : isDoubaoTrainingVideoRequest(body)
            ? 'doubao_training'
            : undefined,
      aistarslabChannel: isAistarslabVideoRequest(body)
        ? String(body.aistarslab_channel || body.channel || '').trim() || undefined
        : undefined,
      jimengSessionId,
      xyqSessionId,
      doubaoTrainingSessionId,
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
    return badRequest(c, sanitizeUserFacingProviderError(err.message))
  }
})

// GET /videos/chengmeng-options — 橙盟视频页：从上游 /api/models 拉取模型与定价
app.get('/chengmeng-options', async (c) => {
  const row = findChengmengVideoConfigRow()
  const configId = row?.id ?? null
  let configError: string | null = null
  let remoteModels = await getChengmengVideoModelOptions(row, { refresh: false })

  if (row && row.apiKey && !isPlaceholderApiKey(row.apiKey)) {
    try {
      if (!remoteModels.length) {
        remoteModels = await getChengmengVideoModelOptions(row, { refresh: true })
      }
    } catch (err: any) {
      configError = err.message
      remoteModels = await getChengmengVideoModelOptions(null)
    }
  }

  syncChengmengModelCreditPricing(remoteModels)
  const models = listChengmengModelOptionsForApi(
    pickChengmengChannel1UiModels(remoteModels),
    configId,
  )
  const defaultModel = models.find(item => item.default_option)?.id
    || models[0]?.id
    || null

  return success(c, {
    available: !!row && row.isActive,
    config_id: configId,
    config_name: row?.name ?? null,
    config_inactive: !!(row && !row.isActive),
    api_key_configured: !!(row && !isPlaceholderApiKey(row.apiKey)),
    config_error: configError,
    doc_url: CHENGMENT_DOC_URL,
    default_model: defaultModel,
    models,
  })
})

// GET /videos/doubao-training-options — 通道5 培训页：模型与 Session 可用性
app.get('/doubao-training-options', async (c) => {
  const sessions = await listDoubaoTrainingSessionSummaries()
  const activeId = getActiveDoubaoTrainingSessionId()
  const hasValidSession = sessions.some(item => item.valid)
  const hasQuota = sessions.some(item => item.valid && (item.quota?.remaining_today ?? 0) > 0)
  const models = listDoubaoTrainingModelOptions().map(item => ({
    ...item,
    billing_unit: 'flat',
    credit_cost: getActionCost(item.credit_action, 1),
    credit_cost_flat: getActionCost(item.credit_action, 1),
  }))

  return success(c, {
    ...getDoubaoTrainingOptionsPayload(),
    available: sessions.length > 0 && hasValidSession && hasQuota,
    session_configured: sessions.length > 0,
    session_valid: hasValidSession,
    active_id: activeId,
    sessions,
    models,
  })
})

// GET /videos/jimeng-options — 即梦视频页：模型与服务可用性
app.get('/jimeng-options', async (c) => {
  const sessions = await listJimengSessionSummaries()
  const activeId = getActiveJimengSessionId()
  const hasValidSession = sessions.some(item => item.valid)
  const models = listJimengVideoModelOptions().map(item => ({
    ...item,
    billing_unit: 'flat',
    credit_cost: getActionCost(item.credit_action, 1),
    credit_cost_flat: getActionCost(item.credit_action, 1),
  }))

  return success(c, {
    available: sessions.length > 0 && hasValidSession,
    session_configured: sessions.length > 0,
    session_valid: hasValidSession,
    active_id: activeId,
    sessions,
    doc_url: 'https://jimeng.jianying.com',
    site_url: 'https://jimeng.jianying.com',
    models,
    credit_cost_default: getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG_SEEDANCE_2_0_FAST, 1),
    ref_limits: JIMENG_REF_LIMITS,
    ref_limits_hint: `${JIMENG_REF_LIMITS.images}图 ${JIMENG_REF_LIMITS.audios}音 ${JIMENG_REF_LIMITS.videos}视频`,
    aspect_ratios: [...JIMENG_ASPECT_RATIOS],
    default_aspect_ratio: JIMENG_DEFAULT_ASPECT_RATIO,
  })
})

// GET /videos/xyq-options — 小云雀视频页：模型与 Access Key 可用性
app.get('/xyq-options', async (c) => {
  const sessions = await listXyqSessionSummaries()
  const activeId = getActiveXyqSessionId()
  const hasValidSession = sessions.some(item => item.valid)
  const models = listXyqVideoModelOptions().map(item => ({
    ...item,
    billing_unit: 'flat',
    credit_cost: getActionCost(item.credit_action, 1),
    credit_cost_flat: getActionCost(item.credit_action, 1),
  }))

  return success(c, {
    available: sessions.length > 0 && hasValidSession,
    session_configured: sessions.length > 0,
    session_valid: hasValidSession,
    active_id: activeId,
    sessions,
    doc_url: 'https://xyq.jianying.com',
    site_url: 'https://xyq.jianying.com',
    models,
    credit_cost_default: getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_MINI_TRIAL, 1),
    ref_limits: XYQ_REF_LIMITS,
    ref_limits_hint: `${XYQ_REF_LIMITS.images}图 ${XYQ_REF_LIMITS.audios}音 ${XYQ_REF_LIMITS.videos}视频`,
    aspect_ratios: [...XYQ_ASPECT_RATIOS],
    default_aspect_ratio: XYQ_DEFAULT_ASPECT_RATIO,
  })
})

// GET /videos/aistarslab-options — AIStartLab 视频页：线路与模型
app.get('/aistarslab-options', async (c) => {
  const row = findAistarslabVideoConfigRow()
  const configId = row?.id ?? null
  let remoteConfig = normalizeAistarslabVideoConfig(null)
  let configError: string | null = null

  if (row && !isPlaceholderApiKey(row.apiKey)) {
    try {
      const loaded = await loadAistarslabVideoConfigFromProvider(row, { refresh: false })
      remoteConfig = applyAistarslabChannelVisibility(loaded)
    } catch (err: any) {
      configError = err.message
    }
  }

  const defaults = resolveDefaultAistarslabSelection(remoteConfig)
  const models = listAistarslabModelOptionsForApi(remoteConfig, configId)
  const channels = remoteConfig.channels.map(channel => ({
    channel: channel.channel,
    title: channel.title,
    description: channel.description,
    seconds_min: channel.secondsMin,
    seconds_max: channel.secondsMax,
    aspect_ratios: channel.aspectRatios,
    supported_mode_types: channel.supportedModeTypes,
    default_option: channel.defaultOption,
    models: channel.models.map(model => ({
      id: model.model,
      label: model.label,
      model: model.model,
      credits_per_second: model.creditsPerSecond,
      fixed_total_credits: model.fixedTotalCredits,
      default_option: model.defaultOption,
    })),
  }))

  return success(c, {
    available: !!row && row.isActive && !isPlaceholderApiKey(row.apiKey),
    config_id: configId,
    config_name: row?.name ?? null,
    config_inactive: !!(row && !row.isActive),
    api_key_configured: !!(row && !isPlaceholderApiKey(row.apiKey)),
    config_error: configError,
    doc_url: AISTARSLAB_DOC_URL,
    default_channel: defaults.channel,
    default_model: defaults.model,
    reference_video_multiplier: remoteConfig.referenceVideoCreditsMultiplier,
    user_price_multiplier: 1.5,
    credit_cost_default: models.find(item => item.default_option)?.credit_cost
      ?? getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_AISTARSLAB, 1),
    channels,
    models,
  })
})

// GET /videos/grok-options — Grok 视频页：配置与模型定价
app.get('/grok-options', (c) => {
  const row = findGeeknowGrokVideoConfigRow()
  const configId = row?.id ?? null
  const models = listGrokVideoModelOptions(configId).map(item => {
    const creditAction = resolveGrokVideoCreditAction(item.id)
    return {
      ...item,
      credit_action: creditAction,
      billing_unit: 'flat',
      credit_cost: getActionCost(creditAction, 1),
    }
  })

  return success(c, {
    available: !!row && !isPlaceholderApiKey(row.apiKey),
    config_id: configId,
    config_name: row?.name ?? null,
    config_inactive: !!(row && !row.isActive),
    config_service_type: row?.serviceType ?? null,
    api_key_configured: !!(row && !isPlaceholderApiKey(row.apiKey)),
    doc_url: GROK_VIDEO_DOC_URL,
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
  const userIdParam = c.req.query('user_id') ? Number(c.req.query('user_id')) : undefined
  let filterUserId: number | undefined
  if (userIdParam && Number.isFinite(userIdParam) && userIdParam > 0) {
    if (userIdParam === user.id) {
      filterUserId = userIdParam
    } else if (user.role === 'admin') {
      filterUserId = userIdParam
    } else {
      const teamId = activeTeamId
      if (!teamId) return forbidden(c, '需要选择团队后才能查看其他成员')
      const memberIds = getTeamMemberUserIds(teamId)
      if (!memberIds.includes(user.id)) {
        return forbidden(c, '无权查看团队成员视频')
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
    userId: filterUserId,
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
  if (!row) return success(c, null)
  return success(c, toSnakeCase({
    ...row,
    errorMsg: sanitizeUserFacingProviderError(row.errorMsg),
  }))
})

// DELETE /videos/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  db.delete(schema.videoGenerations).where(eq(schema.videoGenerations.id, id)).run()
  return success(c)
})

export default app
