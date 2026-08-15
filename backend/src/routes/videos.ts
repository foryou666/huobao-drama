import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, forbidden } from '../utils/response.js'
import { cancelVideoTask, generateVideo, refreshVideoFromProvider } from '../services/video-generation.js'
import { getActiveConfig, getConfigById } from '../services/ai.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { tryChargeUser, tryRefundCharge } from '../utils/credit-charge.js'
import {
  resolveVideoCreditCharge,
  resolveVideoBillingSeconds,
  resolveGrokVideoCreditAction,
  resolveOfficialChannel2CreditAction,
  resolveOfficialChannel2UserCreditCost,
  buildOfficialChannel2CreditCostMatrix,
  CREDIT_ACTIONS,
  VIDEO_BILLING_SECONDS,
} from '../constants/credit-actions.js'
import { isChengmengProvider, CHENGMENG_VIDEO_MODELS, CHENGMENT_DOC_URL } from '../constants/chengmeng.js'
import {
  SEEDANCE_ARK_BASE_URL,
  SEEDANCE_DOC_URL,
  OFFICIAL_CHANNEL2_DEFAULT_MODEL,
  OFFICIAL_CHANNEL2_LOCKED_MODEL,
  OFFICIAL_CHANNEL2_LOCKED_RESOLUTION,
  OFFICIAL_CHANNEL2_MINI_MODEL,
  OFFICIAL_CHANNEL2_RESOLUTION_CHOICES,
  OFFICIAL_CHANNEL2_STANDARD_MODEL,
  OFFICIAL_CHANNEL2_V25_MODEL,
  OFFICIAL_SEEDANCE_2_5_REF_LIMITS,
  resolveOfficialChannel2Model,
  resolveOfficialChannel2Resolution,
  seedanceDurationBounds,
} from '../constants/seedance.js'
import { getActionCost, type ChargeContext } from '../services/credits.js'
import { assertSeedanceReferenceImageDimensions } from '../utils/seedance-ref-image-validate.js'
import {
  DuplicateVideoSubmitError,
  findRecentUserVideoSubmit,
  VideoSubmitRateLimitError,
} from '../utils/video-submit-dedup.js'
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
import { findChengmengVideoConfigRow, getChengmengVideoModelOptions, isChengmengConfigId, isChengmengPerSecondBilling, isChengmengVideoModelAllowed, listChengmengModelOptionsForApi, findChengmengModelOption, pickChengmengChannel1UiModels, resolveChengmengUserCreditCost, syncChengmengModelCreditPricing } from '../utils/chengmeng-video-options.js'
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
import { evaluateJimengSubmitAccess, resolveJimengSuccessRateForUser } from '../utils/jimeng-access-settings.js'
import { isJimengVideoModel, isJimengEnabledVideoModel, isJimengSeedance25Model, JIMENG_REF_LIMITS, JIMENG_ASPECT_RATIOS, JIMENG_DEFAULT_ASPECT_RATIO, formatJimengRefLimitsHint, jimengRefLimitsForModel, SEEDANCE_25_USER_REF_VIDEO_MULTIPLIER, applySeedance25UserRefVideoDiscount, resolveJimengUserCreditCost, JIMENG_SEEDANCE_2_0_WITH_REF_VIDEO_CREDIT_COST, JIMENG_SEEDANCE_2_0_REF_VIDEO_MULTIPLIER, isJimengSeedance20VipModel } from '../constants/jimeng-web.js'
import { buildJimengVirtualConfig } from '../services/jimeng-web-video.js'
import { buildXyqVirtualConfig } from '../services/xyq-web-video.js'
import { buildCozeVirtualConfig } from '../services/coze-web-video.js'
import { buildFunshionVirtualConfig } from '../services/funshion-web-video.js'
import { buildXingyuemengVirtualConfig } from '../services/xingyuemeng-web-video.js'
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
import { isXyqVideoModel, isXyqEnabledVideoModel, isXyqPerSecondBilling, XYQ_REF_LIMITS, XYQ_ASPECT_RATIOS, XYQ_DEFAULT_ASPECT_RATIO } from '../constants/xyq-web.js'
import { getActiveCozeSessionId, getCozeWebSession } from '../services/coze-web-session.js'
import {
  assertCozeSessionConfigured,
  assertCozeReferencesAllowed,
  isCozeVideoRequest,
  listCozeSessionSummaries,
  listCozeVideoModelOptions,
  normalizeCozeSubmitModel,
} from '../utils/coze-web-video-options.js'
import { isCozeVideoModel, isCozeEnabledVideoModel, COZE_REF_LIMITS, COZE_ASPECT_RATIOS, COZE_DEFAULT_ASPECT_RATIO } from '../constants/coze-web.js'
import { getActiveFunshionSessionId, getFunshionWebSession } from '../services/funshion-web-session.js'
import {
  assertFunshionSessionConfigured,
  assertFunshionReferencesAllowed,
  isFunshionVideoRequest,
  listFunshionSessionSummaries,
  listFunshionVideoModelOptions,
  normalizeFunshionSubmitModel,
} from '../utils/funshion-web-video-options.js'
import { isFunshionVideoModel, FUNSHION_REF_LIMITS, FUNSHION_ASPECT_RATIOS, FUNSHION_DEFAULT_ASPECT_RATIO, FUNSHION_RESOLUTIONS, FUNSHION_DEFAULT_CLARITY, FUNSHION_SITE_URL, funshionResolutionsForModel, FUNSHION_DEFAULT_VIDEO_MODEL } from '../constants/funshion-web.js'
import { canAccessFunshionChannel } from '../utils/funshion-access.js'
import { getActiveXingyuemengSessionId, getXingyuemengWebSession } from '../services/xingyuemeng-web-session.js'
import {
  assertXingyuemengSessionConfigured,
  assertXingyuemengReferencesAllowed,
  isXingyuemengVideoRequest,
  listXingyuemengSessionSummaries,
  listXingyuemengVideoModelOptions,
  normalizeXingyuemengSubmitModel,
} from '../utils/xingyuemeng-web-video-options.js'
import {
  isXingyuemengVideoModel,
  XINGYUEMENG_REF_LIMITS,
  XINGYUEMENG_ASPECT_RATIOS,
  XINGYUEMENG_DEFAULT_ASPECT_RATIO,
  XINGYUEMENG_RESOLUTIONS,
  XINGYUEMENG_DEFAULT_RESOLUTION,
  XINGYUEMENG_SITE_URL,
  XINGYUEMENG_DEFAULT_VIDEO_MODEL,
  resolveXingyuemengUserCreditCost,
  buildXingyuemengCreditCostMatrix,
} from '../constants/xingyuemeng-web.js'
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
  resolveAistarslabBillingUnit,
  isAistarslabSelectionAllowed,
  bodyHasReferenceVideo,
  syncAistarslabModelCreditPricing,
  syncAistarslabChannelsFromProvider,
} from '../utils/aistarslab-video-options.js'
import {
  applyAistarslabChannelVisibility,
  isAistarslabChannelEnabled,
} from '../utils/aistarslab-channel-settings.js'
import { AISTARSLAB_DOC_URL, AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER } from '../constants/aistarslab.js'
import {
  assertAigcccApiKey,
  findAigcccVideoConfigRow,
  getAigcccVideoOptionsPayload,
  isAigcccConfigId,
  isAigcccVideoModel,
  isAigcccVideoRequest,
  resolveAigcccCreditAction,
  resolveAigcccUserCreditCost,
  resolveAigcccVideoConfigId,
} from '../utils/aigccc-video-options.js'
import { normalizeAigcccMode } from '../constants/aigccc.js'

const app = new Hono()

function resolveVideoConfig(body: Record<string, unknown>) {
  if (isJimengVideoRequest(body)) {
    return buildJimengVirtualConfig(body.model ? String(body.model) : undefined)
  }
  if (isXyqVideoRequest(body)) {
    return buildXyqVirtualConfig(body.model ? String(body.model) : undefined)
  }
  if (isCozeVideoRequest(body)) {
    return buildCozeVirtualConfig(body.model ? String(body.model) : undefined)
  }
  if (isFunshionVideoRequest(body)) {
    return buildFunshionVirtualConfig(body.model ? String(body.model) : undefined)
  }
  if (isXingyuemengVideoRequest(body)) {
    return buildXingyuemengVirtualConfig(body.model ? String(body.model) : undefined)
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

  const aigcccConfigId = resolveAigcccVideoConfigId(body)
  if (aigcccConfigId != null) {
    return getConfigById(aigcccConfigId, { includeInactive: true })
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
      || isAigcccConfigId(configId)
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
    // 通道2 默认 Fast；全员可选 Seedance 2.0 / Mini / 2.5；分辨率 480p/720p
    const authUser = getAuthUser(c)
    body.model = resolveOfficialChannel2Model(
      body.model,
      authUser?.username,
      authUser?.role,
    )
    body.resolution = resolveOfficialChannel2Resolution(
      body.resolution,
      authUser?.username,
      authUser?.role,
      body.model,
    )
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
    const accessUser = getAuthUser(c)
    const accessDenied = evaluateJimengSubmitAccess(accessUser)
    if (accessDenied) {
      logTaskWarn('JimengAccess', 'submit-gated', {
        userId: accessUser.id,
        rate: resolveJimengSuccessRateForUser(accessUser.id).successRate,
      })
      return badRequest(c, accessDenied)
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

  if (isCozeVideoRequest(body)) {
    if (!body.model || !isCozeVideoModel(String(body.model))) {
      return badRequest(c, 'S通道7视频生成需选择对应模型')
    }
    if (!isCozeEnabledVideoModel(String(body.model))) {
      return badRequest(c, '所选S通道7模型不可用，请刷新页面后重选')
    }
    try {
      assertCozeReferencesAllowed(body)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    try {
      assertCozeSessionConfigured()
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    const cozeSessionId = String(body.coze_session_id || body.cozeSessionId || '').trim()
    if (cozeSessionId) {
      const user = getAuthUser(c)
      if (user.role !== 'admin') {
        delete body.coze_session_id
        delete body.cozeSessionId
      } else if (!getCozeWebSession(cozeSessionId)) {
        return badRequest(c, '所选S通道7 Session 不存在')
      }
    }
    body.provider = 'coze_web'
    normalizeCozeSubmitModel(body)
  }

  if (isFunshionVideoRequest(body)) {
    const user = getAuthUser(c)
    if (!canAccessFunshionChannel(user)) {
      return badRequest(c, 'S通道8 暂未开放')
    }
    if (!body.model || !isFunshionVideoModel(String(body.model))) {
      return badRequest(c, 'S通道8视频生成需选择对应模型')
    }
    try {
      assertFunshionReferencesAllowed(body)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    try {
      assertFunshionSessionConfigured()
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    const funshionSessionId = String(body.funshion_session_id || body.funshionSessionId || '').trim()
    if (funshionSessionId) {
      if (user.role !== 'admin') {
        delete body.funshion_session_id
        delete body.funshionSessionId
      } else if (!getFunshionWebSession(funshionSessionId)) {
        return badRequest(c, '所选S通道8 Session 不存在')
      }
    }
    body.provider = 'funshion_web'
    normalizeFunshionSubmitModel(body)
  }

  if (isXingyuemengVideoRequest(body)) {
    const user = getAuthUser(c)
    if (!body.model || !isXingyuemengVideoModel(String(body.model))) {
      return badRequest(c, 'S通道9视频生成需选择对应模型')
    }
    try {
      assertXingyuemengReferencesAllowed(body)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    try {
      assertXingyuemengSessionConfigured()
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    const xingyuemengSessionId = String(body.xingyuemeng_session_id || body.xingyuemengSessionId || '').trim()
    if (xingyuemengSessionId) {
      if (user.role !== 'admin') {
        delete body.xingyuemeng_session_id
        delete body.xingyuemengSessionId
      } else if (!getXingyuemengWebSession(xingyuemengSessionId)) {
        return badRequest(c, '所选S通道9 Session 不存在')
      }
    }
    body.provider = 'xingyuemeng_web'
    normalizeXingyuemengSubmitModel(body)
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
    // 预热上游线路缓存，供按秒/按条扣费判断
    try {
      await loadAistarslabVideoConfigFromProvider(row, { refresh: false })
    } catch {
      // 扣费可回退到积分定价表
    }
  }

  if (isAigcccVideoRequest(body)) {
    if (!body.model || !isAigcccVideoModel(String(body.model))) {
      return badRequest(c, 'S通道6 需选择 Mini 或 Pro 档位')
    }
    body.model = normalizeAigcccMode(String(body.model))
    const row = findAigcccVideoConfigRow()
    if (!row) {
      return badRequest(c, '未配置 S通道6 视频服务，请在设置中添加视频配置')
    }
    if (body.config_id != null && !isAigcccConfigId(body.config_id)) {
      return badRequest(c, 'S通道6 需使用对应通道配置')
    }
    const aigcccConfigId = resolveAigcccVideoConfigId(body)
    if (!aigcccConfigId) {
      return badRequest(c, '未找到 S通道6 视频配置')
    }
    body.config_id = aigcccConfigId
    const refUrls = Array.isArray(body.reference_image_urls) ? body.reference_image_urls : []
    const contentRefs = Array.isArray(body.content_refs) ? body.content_refs : []
    const hasImageRef = !!(
      body.image_url
      || body.first_frame_url
      || body.last_frame_url
      || refUrls.some((u: unknown) => String(u || '').trim())
      || contentRefs.some((ref: any) => String(ref?.type || '').toLowerCase() === 'image' && String(ref?.url || '').trim())
    )
    if (!hasImageRef) {
      return badRequest(c, 'S通道6 至少需要 1 张参考图')
    }
  }

  let videoConfig = resolveVideoConfig(body)
  // 通道1：忽略前端/分集缓存的失效 config_id，强制走当前启用的橙盟 Key
  if (
    isChengmengProvider(videoConfig?.provider)
    || (body.config_id != null && isChengmengConfigId(body.config_id))
  ) {
    const activeRow = findChengmengVideoConfigRow()
    if (!activeRow?.isActive) {
      return badRequest(c, '橙盟视频配置未启用，请联系管理员')
    }
    if (body.config_id != null && Number(body.config_id) !== activeRow.id) {
      logTaskWarn('VideoAPI', 'chengmeng-stale-config-redirect', {
        fromConfigId: body.config_id,
        toConfigId: activeRow.id,
      })
    }
    body.config_id = activeRow.id
    videoConfig = getConfigById(activeRow.id) || videoConfig
  }
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
  if (isCozeVideoRequest(body) && videoConfig?.provider !== 'coze_web') {
    return badRequest(c, 'S通道7视频通道不正确')
  }
  if (isFunshionVideoRequest(body) && videoConfig?.provider !== 'funshion_web') {
    return badRequest(c, 'S通道8视频通道不正确')
  }
  if (isXingyuemengVideoRequest(body) && videoConfig?.provider !== 'xingyuemeng_web') {
    return badRequest(c, 'S通道9视频通道不正确')
  }
  if (isDoubaoTrainingVideoRequest(body) && videoConfig?.provider !== 'doubao_training') {
    return badRequest(c, '豆包培训视频通道不正确')
  }
  if (isAistarslabVideoRequest(body) && videoConfig?.provider !== 'aistarslab') {
    return badRequest(c, 'Seedance VIP 视频通道配置不正确')
  }
  if (isAigcccVideoRequest(body) && videoConfig?.provider !== 'aigccc') {
    return badRequest(c, 'S通道6 视频通道配置不正确')
  }
  if (isChengmengProvider(videoConfig?.provider) && body.model) {
    const model = String(body.model).trim()
    if (!isChengmengModelEnabled(model)) {
      return badRequest(c, '该模型已停用，请联系管理员在「设置 → 积分」中启用')
    }
    const remoteModels = await getChengmengVideoModelOptions(videoConfig)
    syncChengmengModelCreditPricing(remoteModels)
    const allowedModels = pickChengmengChannel1UiModels(remoteModels)
    const modelError = assertChengmengVideoModel(body, allowedModels)
    if (modelError) return badRequest(c, modelError)
  }
  if (isOfficialVideoRequest(body)) {
    try {
      assertOfficialVolcengineApiKey(videoConfig)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
    const authUser = getAuthUser(c)
    body.model = resolveOfficialChannel2Model(
      body.model,
      authUser?.username,
      authUser?.role,
    )
    body.resolution = resolveOfficialChannel2Resolution(
      body.resolution,
      authUser?.username,
      authUser?.role,
      body.model,
    )
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
  if (isAigcccVideoRequest(body)) {
    try {
      assertAigcccApiKey(videoConfig)
    } catch (err: any) {
      return badRequest(c, err.message)
    }
  }

  // Seedance 系通道：提交前校验参考图宽高（300–6000），避免上游审核失败后退款
  const needsSeedanceImageDimCheck = isOfficialVideoRequest(body)
    || isJimengVideoRequest(body)
    || isXyqVideoRequest(body)
    || isCozeVideoRequest(body)
    || isFunshionVideoRequest(body)
    || isXingyuemengVideoRequest(body)
    || isAistarslabVideoRequest(body)
    || isChengmengProvider(videoConfig?.provider)
    || isDoubaoTrainingVideoRequest(body)
  if (needsSeedanceImageDimCheck) {
    try {
      await assertSeedanceReferenceImageDimensions(body)
    } catch (err: any) {
      return badRequest(c, err?.message || '参考图尺寸不符合要求')
    }
  }

  const effectiveModel = resolveEffectiveVideoModel(body, videoConfig)
  const billing = resolveVideoCreditCharge(
    videoConfig?.provider,
    effectiveModel,
    body.duration != null ? Number(body.duration) : undefined,
    (isOfficialVideoRequest(body) || isXingyuemengVideoRequest(body))
      ? (body.resolution != null ? String(body.resolution) : undefined)
      : undefined,
  )

  const aistarslabRequest = isAistarslabVideoRequest(body)
  const aigcccRequest = isAigcccVideoRequest(body)
  const jimengRequest = isJimengVideoRequest(body)
  const xyqRequest = isXyqVideoRequest(body)
  const cozeRequest = isCozeVideoRequest(body)
  const funshionRequest = isFunshionVideoRequest(body)
  const xingyuemengRequest = isXingyuemengVideoRequest(body)
  const officialRequest = isOfficialVideoRequest(body)
  const chengmengRequest = isChengmengProvider(videoConfig?.provider)
  const aistarslabBillingUnit = aistarslabRequest ? resolveAistarslabBillingUnit(body) : null
  const chengmengBillingUnit = chengmengRequest
    ? (isChengmengPerSecondBilling(findChengmengModelOption(effectiveModel)) ? 'second' : 'flat')
    : null
  const xyqBillingUnit = xyqRequest
    ? (isXyqPerSecondBilling(effectiveModel) ? 'second' : 'flat')
    : null
  const seedance25UserRefDiscount = (
    (jimengRequest && isJimengSeedance25Model(effectiveModel))
    || (xyqRequest && isXyqPerSecondBilling(effectiveModel))
  ) && bodyHasReferenceVideo(body)
  const seedance25FlatCost = seedance25UserRefDiscount
    ? applySeedance25UserRefVideoDiscount(
      getActionCost(billing.action, billing.quantity),
      true,
    )
    : null
  const jimengHasUserRefVideo = jimengRequest && bodyHasReferenceVideo(body)
  const jimengVipRefBump = jimengHasUserRefVideo && isJimengSeedance20VipModel(effectiveModel)
  const jimengUnitCost = jimengRequest ? getActionCost(billing.action, 1) : null
  const jimengFlatCost = jimengRequest
    ? resolveJimengUserCreditCost(
      effectiveModel,
      body.duration != null ? Number(body.duration) : undefined,
      jimengUnitCost,
      !!jimengHasUserRefVideo,
    )
    : null
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
      resolution: (isOfficialVideoRequest(body) || xingyuemengRequest)
        ? (body.resolution != null ? String(body.resolution) : undefined)
        : undefined,
      billing_unit: aistarslabRequest
        ? aistarslabBillingUnit
        : aigcccRequest
          ? 'flat'
          : chengmengBillingUnit
            ?? xyqBillingUnit
            ?? (xingyuemengRequest || officialRequest
              ? 'duration_resolution'
              : (jimengRequest || cozeRequest || funshionRequest ? 'second' : undefined)),
      ...(aistarslabRequest
        ? {
            has_reference_video: bodyHasReferenceVideo(body),
            reference_video_multiplier: bodyHasReferenceVideo(body)
              ? AISTARSLAB_REFERENCE_VIDEO_MULTIPLIER
              : 1,
          }
        : {}),
      ...(seedance25UserRefDiscount
        ? {
            has_reference_video: true,
            reference_video_multiplier: SEEDANCE_25_USER_REF_VIDEO_MULTIPLIER,
          }
        : {}),
      ...(jimengVipRefBump
        ? {
            has_reference_video: true,
            reference_video_multiplier: JIMENG_SEEDANCE_2_0_REF_VIDEO_MULTIPLIER,
            credit_cost_per_second_with_ref_video: JIMENG_SEEDANCE_2_0_WITH_REF_VIDEO_CREDIT_COST,
          }
        : {}),
    },
    ...(aistarslabRequest ? { flatCost: resolveAistarslabUserCreditCost(body) } : {}),
    ...(aigcccRequest ? { flatCost: resolveAigcccUserCreditCost(effectiveModel) } : {}),
    ...(chengmengRequest
      ? {
          flatCost: resolveChengmengUserCreditCost(
            effectiveModel,
            body.duration != null ? Number(body.duration) : undefined,
          ),
        }
      : {}),
    ...(jimengFlatCost != null ? { flatCost: jimengFlatCost } : {}),
    ...(seedance25FlatCost != null ? { flatCost: seedance25FlatCost } : {}),
    ...(xingyuemengRequest
      ? {
          flatCost: resolveXingyuemengUserCreditCost(
            effectiveModel,
            body.duration != null ? Number(body.duration) : undefined,
            body.resolution != null ? String(body.resolution) : undefined,
          ),
        }
      : {}),
    ...(officialRequest
      ? {
          flatCost: resolveOfficialChannel2UserCreditCost(
            effectiveModel,
            body.duration != null ? Number(body.duration) : undefined,
            body.resolution != null ? String(body.resolution) : undefined,
          ),
        }
      : {}),
  }

  const chargeAction = aistarslabRequest
    ? resolveAistarslabCreditAction(body.aistarslab_channel || body.channel, effectiveModel)
    : aigcccRequest
      ? resolveAigcccCreditAction(effectiveModel)
    : billing.action

  const dedupProvider = jimengRequest
    ? 'jimeng_web'
    : xyqRequest
      ? 'xyq_web'
      : cozeRequest
        ? 'coze_web'
        : funshionRequest
          ? 'funshion_web'
          : xingyuemengRequest
            ? 'xingyuemeng_web'
            : isDoubaoTrainingVideoRequest(body)
              ? 'doubao_training'
              : (videoConfig?.provider || null)

  // 扣费前限流：同用户 1 分钟内仅 1 条（权威校验仍在 generateVideo）
  {
    const authUserForDedup = getAuthUser(c)
    const recent = findRecentUserVideoSubmit(authUserForDedup.id)
    if (recent) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((Date.parse(recent.createdAt) + 60_000 - Date.now()) / 1000) || 60,
      )
      logTaskWarn('VideoAPI', 'submit-rate-limited', {
        userId: authUserForDedup.id,
        existingId: recent.id,
        retryAfterSec,
        provider: dedupProvider,
        model: effectiveModel,
      })
      return badRequest(c, `提交过于频繁，请 ${retryAfterSec} 秒后再试（最近任务 #${recent.id}）`)
    }
  }

  const billed = tryChargeUser(c, chargeAction, chargeContext)
  if (billed.error) return billed.error

  try {
    let configId: number | undefined = body.config_id != null ? Number(body.config_id) : undefined
    if (!isOfficialVideoRequest(body) && body.storyboard_id && !isChengmengProvider(videoConfig?.provider)) {
      const [sb] = db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id))).all()
      if (sb) {
        const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId)).all()
        if (ep?.videoConfigId != null) configId = ep.videoConfigId
      }
    }
    if (isChengmengProvider(videoConfig?.provider)) {
      const activeRow = findChengmengVideoConfigRow()
      if (activeRow?.isActive) configId = activeRow.id
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
    let cozeSessionId: string | undefined
    if (isCozeVideoRequest(body)) {
      const preferred = authUser.role === 'admin'
        ? String(body.coze_session_id || body.cozeSessionId || '').trim() || undefined
        : undefined
      const session = getCozeWebSession(preferred)
      if (!session) {
        return badRequest(c, 'S通道7 Session 未配置')
      }
      cozeSessionId = session.id
      logTaskPayload('VideoAPI', 'coze session pick', {
        userId: authUser.id,
        sessionId: session.id,
        label: session.label,
      })
    }
    let funshionSessionId: string | undefined
    if (isFunshionVideoRequest(body)) {
      const preferred = authUser.role === 'admin'
        ? String(body.funshion_session_id || body.funshionSessionId || '').trim() || undefined
        : undefined
      const session = getFunshionWebSession(preferred)
      if (!session) {
        return badRequest(c, 'S通道8 Session 未配置')
      }
      funshionSessionId = session.id
      logTaskPayload('VideoAPI', 'funshion session pick', {
        userId: authUser.id,
        sessionId: session.id,
        label: session.label,
      })
    }
    let xingyuemengSessionId: string | undefined
    if (isXingyuemengVideoRequest(body)) {
      const preferred = authUser.role === 'admin'
        ? String(body.xingyuemeng_session_id || body.xingyuemengSessionId || '').trim() || undefined
        : undefined
      const session = getXingyuemengWebSession(preferred)
      if (!session) {
        return badRequest(c, 'S通道9 Session 未配置')
      }
      xingyuemengSessionId = session.id
      logTaskPayload('VideoAPI', 'xingyuemeng session pick', {
        userId: authUser.id,
        sessionId: session.id,
        label: session.label,
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
      resolution: body.resolution,
      configId,
      provider: isJimengVideoRequest(body)
        ? 'jimeng_web'
        : isXyqVideoRequest(body)
          ? 'xyq_web'
          : isCozeVideoRequest(body)
            ? 'coze_web'
          : isFunshionVideoRequest(body)
            ? 'funshion_web'
          : isXingyuemengVideoRequest(body)
            ? 'xingyuemeng_web'
          : isDoubaoTrainingVideoRequest(body)
            ? 'doubao_training'
            : undefined,
      aistarslabChannel: isAistarslabVideoRequest(body)
        ? String(body.aistarslab_channel || body.channel || '').trim() || undefined
        : undefined,
      jimengSessionId,
      xyqSessionId,
      cozeSessionId,
      funshionSessionId,
      xingyuemengSessionId,
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
    if (err instanceof DuplicateVideoSubmitError
      || err instanceof VideoSubmitRateLimitError
      || /相同内容|提交过于频繁/.test(String(err?.message || ''))) {
      return badRequest(c, err.message)
    }
    return badRequest(c, sanitizeUserFacingProviderError(err.message))
  }
})

// GET /videos/chengmeng-options — 橙盟视频页：从上游 /api/models 拉取模型与定价
app.get('/chengmeng-options', async (c) => {
  const row = findChengmengVideoConfigRow()
  const configId = row?.id ?? null
  let configError: string | null = null
  let remoteModels = await getChengmengVideoModelOptions(row, { refresh: true })

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
  const user = getAuthUser(c)
  const sessions = await listJimengSessionSummaries()
  const activeId = getActiveJimengSessionId()
  const hasValidSession = sessions.some(item => item.valid)
  const models = listJimengVideoModelOptions().map(item => ({
    ...item,
    billing_unit: 'second',
    credit_cost: getActionCost(item.credit_action, 1),
    credit_cost_per_second: getActionCost(item.credit_action, 1),
  }))

  return success(c, {
    available: sessions.length > 0 && hasValidSession,
    session_configured: sessions.length > 0,
    session_valid: hasValidSession,
    // Session 明细仅管理员可见（普通用户走自动绑定，不下发账号列表）
    active_id: user.role === 'admin' ? activeId : null,
    sessions: user.role === 'admin' ? sessions : [],
    session_count: sessions.length,
    doc_url: 'https://jimeng.jianying.com',
    site_url: 'https://jimeng.jianying.com',
    models,
    credit_cost_default: getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG_SEEDANCE_2_0_FAST, 1),
    credit_cost_per_second_default: getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_JIMENG_SEEDANCE_2_0_FAST, 1),
    reference_video_multiplier: SEEDANCE_25_USER_REF_VIDEO_MULTIPLIER,
    vip_reference_video_multiplier: JIMENG_SEEDANCE_2_0_REF_VIDEO_MULTIPLIER,
    vip_credit_cost_per_second_with_ref_video: JIMENG_SEEDANCE_2_0_WITH_REF_VIDEO_CREDIT_COST,
    ref_limits: JIMENG_REF_LIMITS,
    ref_limits_hint: formatJimengRefLimitsHint(),
    ref_limits_by_model: Object.fromEntries(
      models.map(item => [item.id, item.ref_limits || jimengRefLimitsForModel(item.id)]),
    ),
    aspect_ratios: [...JIMENG_ASPECT_RATIOS],
    default_aspect_ratio: JIMENG_DEFAULT_ASPECT_RATIO,
  })
})

// GET /videos/xyq-options — 小云雀视频页：模型与 Access Key 可用性
app.get('/xyq-options', async (c) => {
  const user = getAuthUser(c)
  const sessions = await listXyqSessionSummaries()
  const activeId = getActiveXyqSessionId()
  const hasValidSession = sessions.some(item => item.valid)
  const models = listXyqVideoModelOptions().map(item => {
    const unit = getActionCost(item.credit_action, 1)
    const perSecond = item.billing_unit === 'second'
    return {
      ...item,
      credit_cost: unit,
      credit_cost_flat: perSecond ? null : unit,
      credit_cost_per_second: perSecond ? unit : null,
    }
  })

  return success(c, {
    available: sessions.length > 0 && hasValidSession,
    session_configured: sessions.length > 0,
    session_valid: hasValidSession,
    active_id: user.role === 'admin' ? activeId : null,
    sessions: user.role === 'admin' ? sessions : [],
    session_count: sessions.length,
    doc_url: 'https://xyq.jianying.com',
    site_url: 'https://xyq.jianying.com',
    models,
    credit_cost_default: getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_MINI_TRIAL, 1),
    credit_cost_per_second_default: getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_XYQ_SEEDANCE_2_5, 1),
    reference_video_multiplier: SEEDANCE_25_USER_REF_VIDEO_MULTIPLIER,
    ref_limits: XYQ_REF_LIMITS,
    ref_limits_hint: `${XYQ_REF_LIMITS.images}图 ${XYQ_REF_LIMITS.audios}音 ${XYQ_REF_LIMITS.videos}视频（S 2.5 最多 50 图，合计 ≤50）`,
    aspect_ratios: [...XYQ_ASPECT_RATIOS],
    default_aspect_ratio: XYQ_DEFAULT_ASPECT_RATIO,
  })
})

// GET /videos/coze-options — 扣子网页通道：模型与 Session 可用性
app.get('/coze-options', async (c) => {
  const user = getAuthUser(c)
  const sessions = await listCozeSessionSummaries()
  const activeId = getActiveCozeSessionId()
  const hasValidSession = sessions.some(item => item.valid)
  const models = listCozeVideoModelOptions().map(item => {
    const unit = getActionCost(item.credit_action, 1)
    return {
      ...item,
      credit_cost: unit,
      credit_cost_flat: null,
      credit_cost_per_second: unit,
    }
  })

  return success(c, {
    available: sessions.length > 0 && hasValidSession,
    session_configured: sessions.length > 0,
    session_valid: hasValidSession,
    active_id: user.role === 'admin' ? activeId : null,
    sessions: user.role === 'admin' ? sessions : [],
    session_count: sessions.length,
    doc_url: 'https://www.coze.cn',
    site_url: 'https://www.coze.cn',
    models,
    credit_cost_default: getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_COZE_SEEDANCE_2_0_FAST, 1),
    credit_cost_per_second_default: getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_COZE_SEEDANCE_2_0_FAST, 1),
    ref_limits: COZE_REF_LIMITS,
    ref_limits_hint: `${COZE_REF_LIMITS.images}图 ${COZE_REF_LIMITS.audios}音 ${COZE_REF_LIMITS.videos}视频`,
    aspect_ratios: [...COZE_ASPECT_RATIOS],
    default_aspect_ratio: COZE_DEFAULT_ASPECT_RATIO,
  })
})

// GET /videos/funshion-options — S通道8 橙星梦工厂：模型与 Token Session
app.get('/funshion-options', async (c) => {
  const user = getAuthUser(c)
  if (!canAccessFunshionChannel(user)) {
    return badRequest(c, 'S通道8 暂未开放')
  }
  const sessions = await listFunshionSessionSummaries()
  const activeId = getActiveFunshionSessionId()
  const hasValidSession = sessions.some(item => item.valid)
  const models = listFunshionVideoModelOptions().map(item => {
    const unit = getActionCost(item.credit_action, 1)
    return {
      ...item,
      credit_cost: unit,
      credit_cost_flat: null,
      credit_cost_per_second: unit,
    }
  })

  return success(c, {
    available: sessions.length > 0 && hasValidSession,
    session_configured: sessions.length > 0,
    session_valid: hasValidSession,
    // Session 明细仅管理员可见（白名单用户走自动绑定）
    active_id: user.role === 'admin' ? activeId : null,
    sessions: user.role === 'admin' ? sessions : [],
    session_count: sessions.length,
    doc_url: FUNSHION_SITE_URL,
    site_url: FUNSHION_SITE_URL,
    models,
    credit_cost_default: getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_FUNSHION_SEEDANCE_2_0_FAST, 1),
    credit_cost_per_second_default: getActionCost(CREDIT_ACTIONS.VIDEO_GENERATE_FUNSHION_SEEDANCE_2_0_FAST, 1),
    ref_limits: FUNSHION_REF_LIMITS,
    ref_limits_hint: `${FUNSHION_REF_LIMITS.images}图 ${FUNSHION_REF_LIMITS.audios}音 ${FUNSHION_REF_LIMITS.videos}视频`,
    aspect_ratios: [...FUNSHION_ASPECT_RATIOS],
    default_aspect_ratio: FUNSHION_DEFAULT_ASPECT_RATIO,
    // Fast 默认仅 480p；满血模型在 models[].resolutions 内给出完整列表
    resolutions: funshionResolutionsForModel(FUNSHION_DEFAULT_VIDEO_MODEL),
    default_resolution: FUNSHION_DEFAULT_CLARITY,
    resolutions_by_model: Object.fromEntries(
      models.map(item => [item.id, item.resolutions || funshionResolutionsForModel(item.id)]),
    ),
  })
})

// GET /videos/xingyuemeng-options — S通道9 星月梦：模型与 Token Session
app.get('/xingyuemeng-options', async (c) => {
  const user = getAuthUser(c)
  const sessions = await listXingyuemengSessionSummaries()
  const activeId = getActiveXingyuemengSessionId()
  const hasValidSession = sessions.some(item => item.valid)
  const models = listXingyuemengVideoModelOptions().map(item => {
    const creditCosts = buildXingyuemengCreditCostMatrix(item.id)
    const defaultCost = resolveXingyuemengUserCreditCost(
      item.id,
      item.duration_default,
      item.default_resolution,
    )
    return {
      ...item,
      billing_unit: 'duration_resolution',
      credit_cost: defaultCost,
      credit_cost_flat: null,
      credit_cost_per_second: null,
      credit_costs: creditCosts,
    }
  })

  return success(c, {
    available: sessions.length > 0 && hasValidSession,
    session_configured: sessions.length > 0,
    session_valid: hasValidSession,
    active_id: user.role === 'admin' ? activeId : null,
    sessions: user.role === 'admin' ? sessions : [],
    session_count: sessions.length,
    doc_url: XINGYUEMENG_SITE_URL,
    site_url: XINGYUEMENG_SITE_URL,
    models,
    default_model: XINGYUEMENG_DEFAULT_VIDEO_MODEL,
    credit_cost_default: resolveXingyuemengUserCreditCost(
      XINGYUEMENG_DEFAULT_VIDEO_MODEL,
      undefined,
      XINGYUEMENG_DEFAULT_RESOLUTION,
    ),
    credit_cost_per_second_default: null,
    ref_limits: XINGYUEMENG_REF_LIMITS,
    ref_limits_hint: `${XINGYUEMENG_REF_LIMITS.images}图 ${XINGYUEMENG_REF_LIMITS.audios}音 ${XINGYUEMENG_REF_LIMITS.videos}视频`,
    aspect_ratios: [...XINGYUEMENG_ASPECT_RATIOS],
    default_aspect_ratio: XINGYUEMENG_DEFAULT_ASPECT_RATIO,
    resolutions: [...XINGYUEMENG_RESOLUTIONS],
    default_resolution: XINGYUEMENG_DEFAULT_RESOLUTION,
  })
})

// GET /videos/aigccc-options — S通道6 档位与积分
app.get('/aigccc-options', (c) => {
  return success(c, getAigcccVideoOptionsPayload())
})

// GET /videos/aistarslab-options — AIStartLab 视频页：线路与模型（每次拉取上游最新）
app.get('/aistarslab-options', async (c) => {
  const row = findAistarslabVideoConfigRow()
  const configId = row?.id ?? null
  let remoteConfig = normalizeAistarslabVideoConfig(null)
  let configError: string | null = null

  if (row && !isPlaceholderApiKey(row.apiKey)) {
    try {
      const loaded = await syncAistarslabChannelsFromProvider(row, { refresh: true })
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
    max_images: channel.maxImages,
    max_videos: channel.maxVideos,
    max_audios: channel.maxAudios,
    default_option: channel.defaultOption,
    models: channel.models.map(model => ({
      id: model.model,
      label: model.label,
      model: model.model,
      resolutions: model.resolutions,
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
  const row = findOfficialVolcengineConfigRow()

  const buildResolutionChoices = (modelId: string) => {
    // 全员开放普通(480p)/超分(720p)，与通道9 一致
    const choices = [...OFFICIAL_CHANNEL2_RESOLUTION_CHOICES]
    const creditAction = resolveOfficialChannel2CreditAction(modelId)
    const bounds = seedanceDurationBounds(modelId)
    const sampleSec = bounds.defaultSec
    return choices.map((item) => ({
      id: item.id,
      label: item.label,
      credit_action: creditAction,
      credit_cost_sample: resolveOfficialChannel2UserCreditCost(modelId, sampleSec, item.id),
      credit_cost_per_second: null,
    }))
  }

  const buildModel = (item: {
    id: string
    label: string
    description: string
    credit_action: string
    ref_limits?: { images: number; audios: number; videos: number; max_total?: number }
  }) => {
    const resolutionChoices = buildResolutionChoices(item.id)
    const bounds = seedanceDurationBounds(item.id)
    const creditCosts = buildOfficialChannel2CreditCostMatrix(item.id)
    const sampleCost = resolveOfficialChannel2UserCreditCost(
      item.id,
      bounds.defaultSec,
      OFFICIAL_CHANNEL2_LOCKED_RESOLUTION,
    )
    return {
      ...item,
      config_id: findOfficialVolcengineConfigForModel(item.id)?.id ?? null,
      billing_unit: 'duration_resolution',
      billing_seconds_min: bounds.min,
      billing_seconds_max: bounds.max,
      duration_default: bounds.defaultSec,
      credit_cost_per_second: null,
      credit_cost: sampleCost,
      credit_costs: creditCosts,
      resolutions: resolutionChoices.map(choice => choice.id),
      resolution_choices: resolutionChoices,
      default_resolution: OFFICIAL_CHANNEL2_LOCKED_RESOLUTION,
      locked_resolution: resolutionChoices.length <= 1,
      ref_limits: item.ref_limits || { images: 9, audios: 3, videos: 3, max_total: 15 },
    }
  }

  const models = [
    buildModel({
      id: OFFICIAL_CHANNEL2_V25_MODEL,
      label: 'Seedance 2.5',
      description: '通道2 · Seedance 2.5 · 4–30 秒 · 与通道9 同价（时长×分辨率）',
      credit_action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_5,
      ref_limits: {
        images: OFFICIAL_SEEDANCE_2_5_REF_LIMITS.images,
        audios: OFFICIAL_SEEDANCE_2_5_REF_LIMITS.audios,
        videos: OFFICIAL_SEEDANCE_2_5_REF_LIMITS.videos,
        max_total: OFFICIAL_SEEDANCE_2_5_REF_LIMITS.maxTotal,
      },
    }),
    buildModel({
      id: OFFICIAL_CHANNEL2_MINI_MODEL,
      label: 'Seedance 2.0 Mini',
      description: '通道2 Mini · 普通/超分 · 与通道9 同价',
      credit_action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_MINI,
    }),
    buildModel({
      id: OFFICIAL_CHANNEL2_DEFAULT_MODEL,
      label: 'Seedance 2.0 Fast',
      description: '通道2 Fast · 普通/超分 · 与通道9 同价',
      credit_action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0_FAST,
    }),
    buildModel({
      id: OFFICIAL_CHANNEL2_STANDARD_MODEL,
      label: 'Seedance 2.0',
      description: '通道2 · Seedance 2.0 · 普通/超分 · 对齐通道9 Pro 价',
      credit_action: CREDIT_ACTIONS.VIDEO_GENERATE_SEEDANCE_2_0,
    }),
  ]

  const defaultModel = models.find(m => m.id === OFFICIAL_CHANNEL2_V25_MODEL) || models[0]
  const resolutionChoices = defaultModel.resolution_choices

  return success(c, {
    available: !!row && !isPlaceholderApiKey(row.apiKey),
    config_id: row?.id ?? null,
    config_name: row?.name ?? null,
    config_inactive: !!(row && !row.isActive),
    api_key_configured: !!(row && !isPlaceholderApiKey(row.apiKey)),
    doc_url: SEEDANCE_DOC_URL,
    ark_base_url: SEEDANCE_ARK_BASE_URL,
    default_model: OFFICIAL_CHANNEL2_V25_MODEL,
    default_resolution: OFFICIAL_CHANNEL2_LOCKED_RESOLUTION,
    locked_model: null,
    locked_resolution: null,
    allow_hd_resolution: true,
    allow_standard_model: true,
    resolution_choices: resolutionChoices,
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
  const limitRaw = c.req.query('limit')
  const offsetRaw = c.req.query('offset')
  const limit = limitRaw != null && String(limitRaw) !== '' ? Number(limitRaw) : undefined
  const offset = offsetRaw != null && String(offsetRaw) !== '' ? Number(offsetRaw) : undefined
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

// POST /videos/:id/cancel — 取消排队中的上游任务并退款（方舟仅 queued 可取消）
app.post('/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, 'invalid id')
  const user = getAuthUser(c)
  try {
    const result = await cancelVideoTask(id, {
      userId: user?.id,
      isAdmin: String(user?.role || '').toLowerCase() === 'admin',
    })
    const [row] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, id)).all()
    if (user) {
      logActivity(user, {
        action: 'video.cancel',
        summary: `取消视频任务 #${id}`,
        resourceType: 'video_generation',
        resourceId: id,
      })
    }
    return success(c, {
      ...result,
      item: row ? toSnakeCase({
        ...row,
        errorMsg: sanitizeUserFacingProviderError(row.errorMsg),
      }) : null,
    })
  } catch (err: any) {
    return badRequest(c, err?.message || '取消失败')
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
