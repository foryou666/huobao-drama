import { Hono } from 'hono'
import { eq, desc, and } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, notFound, created, badRequest, now } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { joinProviderUrl } from '../services/adapters/url.js'
import { redactUrl, logTaskError, logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'
import { SEEDANCE_VIDEO_PRESETS } from '../constants/video-presets.js'
import { SEEDANCE_DOC_URL, SEEDANCE_MODELS, SEEDANCE_ARK_BASE_URL } from '../constants/seedance.js'
import { denyUnlessAdmin, getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { AISTARSLAB_DEFAULT_BASE_URL, AISTARSLAB_DOC_URL } from '../constants/aistarslab.js'
import { CHENGMENT_DOC_URL } from '../constants/chengmeng.js'
import {
  listAistarslabModelOptionsForApi,
  listAistarslabVideoConfigRows,
  loadAistarslabVideoConfigFromProvider,
  normalizeAistarslabVideoConfig,
  syncAistarslabChannelsFromProvider,
  syncAistarslabModelCreditPricing,
} from '../utils/aistarslab-video-options.js'
import {
  getChengmengVideoModelOptions,
  listChengmengModelOptionsForApi,
  listChengmengVideoConfigRows,
  syncChengmengModelCreditPricing,
} from '../utils/chengmeng-video-options.js'
import { fetchChengmengTasks, fetchChengmengUserBalance } from '../services/chengmeng-client.js'
import { fetchAistarslabAccountCredits, fetchAistarslabTaskDetail } from '../services/aistarslab-client.js'
import {
  fetchAigcccAccountCreditsViaTask,
  fetchAigcccTaskStatus,
} from '../services/aigccc-client.js'
import { listAigcccVideoConfigRows } from '../utils/aigccc-video-options.js'
import { isPlaceholderApiKey, listOfficialVolcengineConfigRows } from '../utils/official-volcengine-video.js'
import {
  estimateSeedanceYuanFromTokens,
  isSeedance2FastModel,
  SEEDANCE_YUAN_PER_MILLION_TOKENS,
} from '../constants/seedance.js'
import { fetchVolcengineArkTaskDetail, listVolcengineArkTasks } from '../services/volcengine-ark-client.js'
import { downloadFile } from '../utils/storage.js'
import {
  activateOfficialVolcengineKey,
  createOfficialVolcengineKey,
  deleteOfficialVolcengineKey,
  formatOfficialKeyAccount,
  probeOfficialVolcengineKey,
  resolveOfficialKeyBalance,
  syncOfficialVolcengineKeysFromEnv,
  updateOfficialVolcengineKey,
} from '../services/official-volcengine-keys.js'
import {
  fetchVolcengineBillDetailsForAnchors,
  matchVolcengineBillToTask,
  resolveOfficialVolcengineBillingCredentials,
  resolveSiteCreditCharge,
} from '../services/volcengine-task-billing.js'
import { computeOfficialChannel2Pnl } from '../services/official-channel2-pnl.js'
import {
  getOfficialChannel2BillSyncStatus,
  runOfficialChannel2BillSyncBatch,
} from '../services/official-channel2-bill-sync.js'
import {
  isApimartProvider,
  isRetryableApimartFetchError,
  isRetryableApimartHttpStatus,
  listApimartApiBases,
} from '../constants/apimart.js'

function mapVolcengineUpstreamStatus(status?: string | null) {
  const s = String(status || '').toLowerCase()
  if (s === 'succeeded' || s === 'success' || s === 'completed') return 'completed'
  if (s === 'failed' || s === 'error' || s === 'cancelled' || s === 'canceled') return 'failed'
  if (s === 'queued' || s === 'pending' || s === 'running' || s === 'processing') return 'processing'
  return s || 'unknown'
}

const app = new Hono()

function formatAiConfig(row: typeof schema.aiServiceConfigs.$inferSelect, maskKey: boolean) {
  const item = {
    ...toSnakeCase(row),
    model: row.model ? JSON.parse(row.model) : [],
  } as Record<string, unknown>
  if (maskKey && item.api_key) item.api_key = '********'
  return item
}

const HUOBAO_PRESET_SERVICES = [
  { serviceType: 'text', name: '影光工场默认文本服务', label: '文本', provider: 'chatfire', baseUrl: 'https://api.chatfire.site', model: 'gemini-3-pro-preview', priority: 100 },
  { serviceType: 'image', name: '影光工场默认图片服务', label: '图片', provider: 'gemini', baseUrl: 'https://api.chatfire.site', model: 'gemini-3-pro-image-preview', priority: 99 },
  ...SEEDANCE_VIDEO_PRESETS,
  { serviceType: 'audio', name: '影光工场默认音频服务', label: '音频', provider: 'minimax', baseUrl: 'https://api.chatfire.site/minimax', model: 'speech-2.8-hd', priority: 97 },
] as const

const HUOBAO_AGENT_DEFAULTS = [
  { agentType: 'script_rewriter', name: '剧本改写', maxTokens: 4096 },
  { agentType: 'extractor', name: '角色场景提取', maxTokens: 4096 },
  { agentType: 'shot_plan_generator', name: '工业镜头列表', maxTokens: 32768 },
  { agentType: 'storyboard_breaker', name: '分镜拆解', maxTokens: 4096 },
  { agentType: 'voice_assigner', name: '音色分配', maxTokens: 4096 },
  { agentType: 'grid_prompt_generator', name: '图片提示词生成', maxTokens: 4096 },
] as const

const HUOBAO_AGENT_MODEL = 'gemini-3-pro-preview'

function bearerHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function geminiHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
    headers['x-goog-api-key'] = apiKey
  }
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function viduHeaders(apiKey?: string, withJson = false) {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Token ${apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

function buildProbe(serviceType: string, provider: string, baseUrl: string, model?: string, apiKey?: string) {
  const p = provider.toLowerCase()
  const m = model || ''

  if (p === 'gemini') {
    const url = new URL(joinProviderUrl(baseUrl, '/v1beta', `/models/${m || 'gemini-2.5-flash'}:generateContent`))
    if (apiKey) url.searchParams.set('key', apiKey)
    return { method: 'POST', url: url.toString(), headers: geminiHeaders(apiKey, true), body: {} }
  }

  if (p === 'openai' || p === 'openrouter' || p === 'chatfire' || p === 'geeknow' || p === 'qilingze' || p === 'apimart') {
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl, '/v1', '/models'),
      headers: bearerHeaders(apiKey),
      body: undefined,
    }
  }

  if (p === 'ali' || p.startsWith('ali-')) {
    const base = (baseUrl || '').replace(/\/+$/, '')
    if (serviceType === 'text' || base.includes('/compatible-mode')) {
      const modelsPath = base.includes('/compatible-mode') ? '/models' : '/compatible-mode/v1/models'
      return {
        method: 'GET',
        url: joinProviderUrl(baseUrl, '', modelsPath),
        headers: bearerHeaders(apiKey),
        body: undefined,
      }
    }
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v1', serviceType === 'video'
        ? '/services/aigc/video-generation/video-synthesis'
        : '/services/aigc/image-generation/generation'),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'volcengine' || p === 'volcengine_proxy') {
    const path = serviceType === 'video'
      ? '/contents/generations/tasks'
      : '/images/generations'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/api/v3', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'minimax') {
    const path = serviceType === 'audio'
      ? '/t2a_v2'
      : serviceType === 'video'
        ? '/video_generation'
        : '/image_generation'
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '/v1', path),
      headers: bearerHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'vidu') {
    return {
      method: 'POST',
      url: joinProviderUrl(baseUrl, '', '/ent/v2/img2video'),
      headers: viduHeaders(apiKey, true),
      body: {},
    }
  }

  if (p === 'chengmeng') {
    return {
      method: 'GET',
      url: joinProviderUrl(baseUrl, '', '/api/tasks'),
      headers: bearerHeaders(apiKey),
      body: undefined,
    }
  }

  return {
    method: 'GET',
    url: joinProviderUrl(baseUrl, '', m ? `/${m}` : '/'),
    headers: bearerHeaders(apiKey),
    body: undefined,
  }
}

// GET /ai-configs/seedance-models — Seedance 模型与官方文档
app.get('/seedance-models', (c) => {
  return success(c, {
    doc_url: SEEDANCE_DOC_URL,
    ark_base_url: SEEDANCE_ARK_BASE_URL,
    api_path: '/api/v3/contents/generations/tasks',
    models: [
      {
        id: SEEDANCE_MODELS.V2_5,
        label: 'Seedance 2.5',
        duration_seconds: [4, 30],
        description: '官方 Seedance 2.5 · 最长 30 秒 · 与通道9 同价矩阵',
      },
      {
        id: SEEDANCE_MODELS.V2_0_MINI,
        label: 'Seedance 2.0 Mini',
        duration_seconds: [4, 15],
        description: '高性价比 Mini · 仅 480p/720p · 与通道9 同价矩阵',
      },
      {
        id: SEEDANCE_MODELS.V2_0,
        label: 'Seedance 2.0',
        duration_seconds: [4, 15],
        description: '标准版，画质优先。官方文档：创建视频生成任务 API',
      },
      {
        id: SEEDANCE_MODELS.V2_0_FAST,
        label: 'Seedance 2.0 Fast',
        duration_seconds: [4, 15],
        description: '快速版，速度优先，接口与 2.0 相同',
      },
      {
        id: SEEDANCE_MODELS.V1_5_PRO,
        label: 'Seedance 1.5 Pro',
        duration_seconds: [4, 12],
        description: '上一代模型，ChatFire 等代理常用',
      },
    ],
  })
})

// GET /ai-configs/aistarslab-config — 从 OpenAPI 拉取线路与模型（设置页展示）
app.get('/aistarslab-config', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const apiKey = String(c.req.query('api_key') || '').trim()
  const baseUrl = String(c.req.query('base_url') || AISTARSLAB_DEFAULT_BASE_URL).trim()
  if (!apiKey || apiKey === '********') {
    return badRequest(c, '请填写有效的 API Key')
  }

  try {
    const config = await syncAistarslabChannelsFromProvider({ baseUrl, apiKey }, { refresh: true })
    const models = listAistarslabModelOptionsForApi(config, null)
    const channels = config.channels.map(channel => ({
      channel: channel.channel,
      title: channel.title,
      description: channel.description,
      seconds_min: channel.secondsMin,
      seconds_max: channel.secondsMax,
      aspect_ratios: channel.aspectRatios,
      supported_mode_types: channel.supportedModeTypes,
      default_option: channel.defaultOption,
      models: channel.models.map(model => ({
        model: model.model,
        label: model.label,
        resolutions: model.resolutions,
        credits_per_second: model.creditsPerSecond,
        fixed_total_credits: model.fixedTotalCredits,
        default_option: model.defaultOption,
      })),
    }))
    const modelIds = [...new Set(models.map(item => item.model))]

    return success(c, {
      doc_url: AISTARSLAB_DOC_URL,
      reference_video_multiplier: config.referenceVideoCreditsMultiplier,
      channels,
      models,
      model_ids: modelIds,
    })
  } catch (err: any) {
    return badRequest(c, err?.message || '拉取视频通道配置失败')
  }
})

// GET /ai-configs/chengmeng-config — 从橙盟 /api/models 拉取模型（设置页展示）
app.get('/chengmeng-config', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const apiKey = String(c.req.query('api_key') || '').trim()
  const baseUrl = String(c.req.query('base_url') || '').trim()
  if (!apiKey || apiKey === '********') {
    return badRequest(c, '请填写有效的 API Key')
  }

  try {
    const remoteModels = await getChengmengVideoModelOptions({ baseUrl, apiKey }, { refresh: true })
    syncChengmengModelCreditPricing(remoteModels)
    const models = listChengmengModelOptionsForApi(remoteModels, null)
    const modelIds = models.map(item => item.model_id)

    return success(c, {
      doc_url: CHENGMENT_DOC_URL,
      models,
      model_ids: modelIds,
    })
  } catch (err: any) {
    return badRequest(c, err?.message || '拉取橙盟模型列表失败')
  }
})

function mapAistarslabUpstreamStatus(status: number | string | null | undefined): string {
  const num = Number(status)
  if (num === 3) return 'success'
  if (num === 4) return 'failed'
  if (num === 1) return 'pending'
  if (num === 2 || num === 5) return 'processing'
  const text = String(status || '').trim().toLowerCase()
  return text || 'unknown'
}

/** 上游 costCredits 在失败任务上仍是预扣标价；退款信息多见于错误文案 */
function resolveAistarslabTaskBilling(opts: {
  statusLabel: string
  costCredits: number | null
  errorMessage?: string | null
}) {
  const listedCost = opts.costCredits
  const status = String(opts.statusLabel || '').toLowerCase()
  const err = String(opts.errorMessage || '')
  const explicitRefund = /退款|退还|已返还|已退回|refund/i.test(err)
  const failed = status === 'failed' || status === 'fail' || status === 'error'

  if (failed && explicitRefund) {
    return {
      cost: listedCost,
      net_cost: 0,
      refunded: true,
      refund_status: 'refunded' as const,
      cost_note: listedCost != null ? `已退还（原扣 ${listedCost}）` : '已退还',
    }
  }
  if (failed) {
    return {
      cost: listedCost,
      net_cost: 0,
      refunded: true,
      refund_status: 'likely_refunded' as const,
      cost_note: listedCost != null ? `失败不计实扣（标价 ${listedCost}）` : '失败不计实扣',
    }
  }
  return {
    cost: listedCost,
    net_cost: listedCost,
    refunded: false,
    refund_status: 'charged' as const,
    cost_note: null as string | null,
  }
}

function roundBalance(value: number, unit: 'yuan' | 'credit') {
  if (unit === 'yuan') return Math.round(value * 100) / 100
  return Math.round(value)
}

/**
 * 用「当前余额」从新到旧回推每条任务变动后的余额。
 * 假设列表按时间倒序，且净扣费仅来自这些任务（期间充值/其他消费会使更早推算偏离）。
 */
function attachRunningBalances<T extends { net_cost?: number | null }>(
  tasksNewestFirst: T[],
  currentBalance: number | null | undefined,
  unit: 'yuan' | 'credit',
): Array<T & {
  balance_after: number | null
  balance_before: number | null
  balance_delta: number | null
}> {
  if (currentBalance == null || !Number.isFinite(Number(currentBalance))) {
    return tasksNewestFirst.map(item => ({
      ...item,
      balance_after: null,
      balance_before: null,
      balance_delta: null,
    }))
  }

  let cursor = Number(currentBalance)
  return tasksNewestFirst.map((item) => {
    const rawNet = Number(item.net_cost)
    const net = Number.isFinite(rawNet) ? rawNet : 0
    const balanceAfter = roundBalance(cursor, unit)
    const balanceBefore = roundBalance(balanceAfter + net, unit)
    cursor = balanceBefore
    return {
      ...item,
      balance_after: balanceAfter,
      balance_before: balanceBefore,
      balance_delta: roundBalance(-net, unit),
    }
  })
}

function resolveChengmengNetCost(status: string | null | undefined, actualCost: number | null, estimatedCost: number | null) {
  const s = String(status || '').toLowerCase()
  if (s === 'failed' || s === 'expired' || s === 'fail' || s === 'error') return 0
  if (s === 'success' || s === 'completed') {
    if (actualCost != null && Number.isFinite(actualCost)) return actualCost
    if (estimatedCost != null && Number.isFinite(estimatedCost)) return estimatedCost
    return 0
  }
  // pending/running：可用余额侧通常已冻结，明细回推只计最终实扣
  return 0
}

// GET /ai-configs/chengmeng-balance — 通道1 上游余额 + 任务扣费明细
app.get('/chengmeng-balance', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const pageSize = Math.min(50, Math.max(1, Number(c.req.query('page_size') || 20) || 20))
  const rows = listChengmengVideoConfigRows()
  if (!rows.length) {
    return success(c, { accounts: [], tasks: [], tasks_config_id: null, total: 0 })
  }

  const accounts = await Promise.all(rows.map(async (row) => {
    const apiKey = String(row.apiKey || '').trim()
    if (!apiKey || isPlaceholderApiKey(apiKey)) {
      return {
        config_id: row.id,
        name: row.name,
        is_active: !!row.isActive,
        base_url: row.baseUrl || null,
        balance: null,
        error: '未配置 API Key',
      }
    }

    try {
      const balance = await fetchChengmengUserBalance({ baseUrl: row.baseUrl, apiKey })
      return {
        config_id: row.id,
        name: row.name,
        is_active: !!row.isActive,
        base_url: row.baseUrl || null,
        balance: {
          available_balance: balance.availableBalance,
          frozen_balance: balance.frozenBalance,
          total_recharge: balance.totalRecharge,
          total_spent: balance.totalSpent,
        },
        error: null,
      }
    } catch (err: any) {
      return {
        config_id: row.id,
        name: row.name,
        is_active: !!row.isActive,
        base_url: row.baseUrl || null,
        balance: null,
        error: String(err?.message || '查询余额失败'),
      }
    }
  }))

  const taskSource = rows.find(r => r.isActive && r.apiKey && !isPlaceholderApiKey(r.apiKey))
    || rows.find(r => r.apiKey && !isPlaceholderApiKey(r.apiKey))
    || null

  let tasks: any[] = []
  let tasksTotal = 0
  let tasksError: string | null = null
  let currentAvailable: number | null = null
  if (taskSource) {
    const account = accounts.find(item => item.config_id === taskSource.id)
    currentAvailable = account?.balance?.available_balance ?? null
    try {
      const result = await fetchChengmengTasks(
        { baseUrl: taskSource.baseUrl, apiKey: taskSource.apiKey },
        { page: 1, pageSize },
      )
      tasksTotal = result.total
      const mapped = result.list.map(item => {
        const netCost = resolveChengmengNetCost(item.status, item.actualCost, item.estimatedCost)
        return {
          task_id: item.taskNo,
          model: item.modelId,
          status: item.status,
          estimated_cost: item.estimatedCost,
          actual_cost: item.actualCost,
          cost: item.actualCost ?? item.estimatedCost,
          net_cost: netCost,
          cost_unit: '元',
          prompt_head: item.prompt.slice(0, 120),
          error_message: item.errorMessage,
          created_at: item.createdAt,
          finished_at: item.finishedAt,
          config_id: taskSource.id,
          config_name: taskSource.name,
        }
      })
      tasks = attachRunningBalances(mapped, currentAvailable, 'yuan')
    } catch (err: any) {
      tasksError = String(err?.message || '拉取上游任务失败')
    }
  }

  return success(c, {
    accounts,
    tasks,
    tasks_config_id: taskSource?.id ?? null,
    tasks_error: tasksError,
    total: tasksTotal,
    page_size: pageSize,
    current_balance: currentAvailable,
    balance_timeline_note: '变动后余额由当前可用余额按明细从新到旧回推；期间若有充值/其他消费，更早条目可能偏离。',
  })
})

// GET /ai-configs/aistarslab-balance — 通道3 上游余额 + 近期任务扣费（按本站 task_id 回查上游详情）
app.get('/aistarslab-balance', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const limit = Math.min(30, Math.max(1, Number(c.req.query('limit') || 20) || 20))
  const light = c.req.query('light') === '1' || c.req.query('quick') === '1'
  const rows = listAistarslabVideoConfigRows()
  if (!rows.length) {
    return success(c, { accounts: [], tasks: [], total: 0 })
  }

  const accounts = await Promise.all(rows.map(async (row) => {
    const apiKey = String(row.apiKey || '').trim()
    if (!apiKey || isPlaceholderApiKey(apiKey)) {
      return {
        config_id: row.id,
        name: row.name,
        is_active: !!row.isActive,
        base_url: row.baseUrl || null,
        balance: null,
        error: '未配置 API Key',
      }
    }

    try {
      const balance = await fetchAistarslabAccountCredits({ baseUrl: row.baseUrl, apiKey })
      return {
        config_id: row.id,
        name: row.name,
        is_active: !!row.isActive,
        base_url: row.baseUrl || null,
        balance: { credits: balance.credits },
        error: null,
      }
    } catch (err: any) {
      return {
        config_id: row.id,
        name: row.name,
        is_active: !!row.isActive,
        base_url: row.baseUrl || null,
        balance: null,
        error: String(err?.message || '查询余额失败'),
      }
    }
  }))

  const active = rows.find(r => r.isActive && r.apiKey && !isPlaceholderApiKey(r.apiKey))
    || rows.find(r => r.apiKey && !isPlaceholderApiKey(r.apiKey))
    || null

  let tasks: any[] = []
  let tasksError: string | null = null
  if (active) {
    const localRows = db.select({
      id: schema.videoGenerations.id,
      taskId: schema.videoGenerations.taskId,
      model: schema.videoGenerations.model,
      style: schema.videoGenerations.style,
      duration: schema.videoGenerations.duration,
      status: schema.videoGenerations.status,
      createdAt: schema.videoGenerations.createdAt,
    })
      .from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.provider, 'aistarslab'))
      .orderBy(desc(schema.videoGenerations.id))
      .limit(Math.max(limit * 3, 40))
      .all()
      .filter(row => String(row.taskId || '').trim())
      .slice(0, limit)

    try {
      if (light) {
        tasks = localRows.map((local) => {
          const taskId = String(local.taskId || '').trim()
          const fallbackStatus = String(local.status || 'unknown')
          const billing = resolveAistarslabTaskBilling({
            statusLabel: fallbackStatus,
            costCredits: null,
            errorMessage: null,
          })
          return {
            local_id: local.id,
            task_id: taskId,
            model: local.model,
            channel: local.style,
            status: fallbackStatus,
            cost: billing.cost,
            net_cost: billing.net_cost,
            refunded: billing.refunded,
            refund_status: billing.refund_status,
            cost_note: '轻量模式：仅本站记录，未回查上游详情',
            cost_unit: '积分',
            seconds: local.duration,
            prompt_head: '',
            error_message: null,
            created_at: local.createdAt,
            finished_at: null,
            config_id: active.id,
            config_name: active.name,
            source: 'local_only',
          }
        })
        const currentCreditsLight = accounts.find(item => item.config_id === active.id)?.balance?.credits ?? null
        tasks = attachRunningBalances(tasks, currentCreditsLight, 'credit')
      } else {
      const details = await Promise.all(localRows.map(async (local) => {
        const taskId = String(local.taskId || '').trim()
        try {
          const detail = await fetchAistarslabTaskDetail(
            { baseUrl: active.baseUrl, apiKey: active.apiKey },
            taskId,
          )
          if (!detail) {
            const fallbackStatus = String(local.status || 'unknown')
            const billing = resolveAistarslabTaskBilling({
              statusLabel: fallbackStatus,
              costCredits: null,
              errorMessage: '上游未返回任务详情',
            })
            return {
              local_id: local.id,
              task_id: taskId,
              model: local.model,
              channel: local.style,
              status: fallbackStatus,
              cost: billing.cost,
              net_cost: billing.net_cost,
              refunded: billing.refunded,
              refund_status: billing.refund_status,
              cost_note: billing.cost_note,
              cost_unit: '积分',
              seconds: local.duration,
              prompt_head: '',
              error_message: '上游未返回任务详情',
              created_at: local.createdAt,
              finished_at: null,
              config_id: active.id,
              config_name: active.name,
              source: 'local_fallback',
            }
          }
          const statusLabel = mapAistarslabUpstreamStatus(detail.status)
          const billing = resolveAistarslabTaskBilling({
            statusLabel,
            costCredits: detail.costCredits,
            errorMessage: detail.errorMessage,
          })
          return {
            local_id: local.id,
            task_id: detail.taskId,
            model: detail.model || local.model,
            channel: detail.channel || local.style,
            status: statusLabel,
            upstream_status: detail.status,
            cost: billing.cost,
            net_cost: billing.net_cost,
            refunded: billing.refunded,
            refund_status: billing.refund_status,
            cost_note: billing.cost_note,
            cost_unit: '积分',
            seconds: detail.seconds ?? local.duration,
            prompt_head: detail.prompt.slice(0, 120),
            error_message: detail.errorMessage,
            created_at: detail.createdAt || local.createdAt,
            finished_at: detail.completedAt,
            config_id: active.id,
            config_name: active.name,
            source: 'upstream',
          }
        } catch (err: any) {
          const fallbackStatus = String(local.status || 'unknown')
          const billing = resolveAistarslabTaskBilling({
            statusLabel: fallbackStatus,
            costCredits: null,
            errorMessage: String(err?.message || '查询上游任务失败'),
          })
          return {
            local_id: local.id,
            task_id: taskId,
            model: local.model,
            channel: local.style,
            status: fallbackStatus,
            cost: billing.cost,
            net_cost: billing.net_cost,
            refunded: billing.refunded,
            refund_status: billing.refund_status,
            cost_note: billing.cost_note,
            cost_unit: '积分',
            seconds: local.duration,
            prompt_head: '',
            error_message: String(err?.message || '查询上游任务失败'),
            created_at: local.createdAt,
            finished_at: null,
            config_id: active.id,
            config_name: active.name,
            source: 'local_fallback',
          }
        }
      }))
      const currentCredits = accounts.find(item => item.config_id === active.id)?.balance?.credits ?? null
      tasks = attachRunningBalances(details, currentCredits, 'credit')
      }
    } catch (err: any) {
      tasksError = String(err?.message || '拉取上游任务失败')
    }
  }

  const currentCredits = active
    ? (accounts.find(item => item.config_id === active.id)?.balance?.credits ?? null)
    : null

  return success(c, {
    accounts,
    tasks,
    tasks_config_id: active?.id ?? null,
    tasks_error: tasksError,
    total: tasks.length,
    current_balance: currentCredits,
    note: '通道3上游未开放任务列表接口；明细按本站近期 task_id 回查上游任务详情。失败任务的 costCredits 多为预扣标价，退款以错误文案/账户余额为准。',
    balance_timeline_note: '变动后余额由当前积分余额按明细从新到旧回推；期间若有充值/其他消费，更早条目可能偏离。若相邻两条实扣与余额差不一致，可能是上游扣费异常。',
  })
})

function resolveAigcccTaskBilling(opts: {
  statusLabel: string
  usedCredits: number | null
  errorMessage?: string | null
}) {
  const listedCost = opts.usedCredits
  const status = String(opts.statusLabel || '').toLowerCase()
  const err = String(opts.errorMessage || '')
  const explicitRefund = /退款|退还|已返还|已退回|refund/i.test(err)
  const failed = status === 'failed' || status === 'fail' || status === 'error'
  const pending = status === 'pending' || status === 'processing' || status === 'running' || status === 'queued'

  if (failed && explicitRefund) {
    return {
      cost: listedCost,
      net_cost: 0,
      refunded: true,
      refund_status: 'refunded' as const,
      cost_note: listedCost != null ? `已退还（原扣 ${listedCost}）` : '已退还',
    }
  }
  if (failed) {
    return {
      cost: listedCost,
      net_cost: 0,
      refunded: true,
      refund_status: 'likely_refunded' as const,
      cost_note: listedCost != null ? `失败不计实扣（标价 ${listedCost}）` : '失败不计实扣',
    }
  }
  if (pending && listedCost == null) {
    return {
      cost: null,
      net_cost: 0,
      refunded: false,
      refund_status: 'pending' as const,
      cost_note: '生成中，暂无 used_credits',
    }
  }
  return {
    cost: listedCost,
    net_cost: listedCost,
    refunded: false,
    refund_status: 'charged' as const,
    cost_note: null as string | null,
  }
}

function mapAigcccUpstreamStatus(status: string | null | undefined) {
  const raw = String(status || '').trim().toLowerCase()
  if (!raw) return 'unknown'
  if (raw === 'succeeded' || raw === 'success' || raw === 'completed') return 'completed'
  if (raw === 'failed' || raw === 'failure' || raw === 'error') return 'failed'
  if (raw === 'running' || raw === 'processing' || raw === 'in_progress') return 'processing'
  if (raw === 'queued' || raw === 'pending' || raw === 'submitted') return 'pending'
  return raw
}

// GET /ai-configs/aigccc-balance — 通道6 上游余额 + 近期任务扣费
// 上游无独立余额接口；余额取自任务 status.remaining_credits，明细取 used_credits
app.get('/aigccc-balance', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const limit = Math.min(30, Math.max(1, Number(c.req.query('limit') || 20) || 20))
  const rows = listAigcccVideoConfigRows()
  if (!rows.length) {
    return success(c, { accounts: [], tasks: [], total: 0 })
  }

  const recentByConfig = new Map<number, string[]>()
  for (const row of rows) {
    const taskIds = db.select({
      taskId: schema.videoGenerations.taskId,
    })
      .from(schema.videoGenerations)
      .where(and(
        eq(schema.videoGenerations.provider, 'aigccc'),
        eq(schema.videoGenerations.configId, row.id),
      ))
      .orderBy(desc(schema.videoGenerations.id))
      .limit(12)
      .all()
      .map(item => String(item.taskId || '').trim())
      .filter(Boolean)
    // Fallback: any aigccc task if this config has none yet
    if (!taskIds.length) {
      const anyIds = db.select({
        taskId: schema.videoGenerations.taskId,
      })
        .from(schema.videoGenerations)
        .where(eq(schema.videoGenerations.provider, 'aigccc'))
        .orderBy(desc(schema.videoGenerations.id))
        .limit(12)
        .all()
        .map(item => String(item.taskId || '').trim())
        .filter(Boolean)
      recentByConfig.set(row.id, anyIds)
    } else {
      recentByConfig.set(row.id, taskIds)
    }
  }

  const accounts = await Promise.all(rows.map(async (row) => {
    const apiKey = String(row.apiKey || '').trim()
    if (!apiKey || isPlaceholderApiKey(apiKey)) {
      return {
        config_id: row.id,
        name: row.name,
        is_active: !!row.isActive,
        base_url: row.baseUrl || null,
        balance: null,
        via_task_id: null,
        error: '未配置 API Key',
      }
    }

    try {
      const balance = await fetchAigcccAccountCreditsViaTask(
        { baseUrl: row.baseUrl, apiKey },
        recentByConfig.get(row.id) || [],
      )
      return {
        config_id: row.id,
        name: row.name,
        is_active: !!row.isActive,
        base_url: row.baseUrl || null,
        balance: { credits: balance.credits },
        via_task_id: balance.via_task_id,
        error: null,
      }
    } catch (err: any) {
      return {
        config_id: row.id,
        name: row.name,
        is_active: !!row.isActive,
        base_url: row.baseUrl || null,
        balance: null,
        via_task_id: null,
        error: String(err?.message || '查询余额失败'),
      }
    }
  }))

  const active = rows.find(r => r.isActive && r.apiKey && !isPlaceholderApiKey(r.apiKey))
    || rows.find(r => r.apiKey && !isPlaceholderApiKey(r.apiKey))
    || null

  let tasks: any[] = []
  let tasksError: string | null = null
  if (active) {
    const localRows = db.select({
      id: schema.videoGenerations.id,
      taskId: schema.videoGenerations.taskId,
      model: schema.videoGenerations.model,
      duration: schema.videoGenerations.duration,
      status: schema.videoGenerations.status,
      prompt: schema.videoGenerations.prompt,
      createdAt: schema.videoGenerations.createdAt,
    })
      .from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.provider, 'aigccc'))
      .orderBy(desc(schema.videoGenerations.id))
      .limit(Math.max(limit * 3, 40))
      .all()
      .filter(row => String(row.taskId || '').trim())
      .slice(0, limit)

    try {
      const details = await Promise.all(localRows.map(async (local) => {
        const taskId = String(local.taskId || '').trim()
        try {
          const detail = await fetchAigcccTaskStatus(
            { baseUrl: active.baseUrl, apiKey: active.apiKey },
            taskId,
          )
          if (!detail) {
            const fallbackStatus = String(local.status || 'unknown')
            const billing = resolveAigcccTaskBilling({
              statusLabel: fallbackStatus,
              usedCredits: null,
              errorMessage: '上游未返回任务详情',
            })
            return {
              local_id: local.id,
              task_id: taskId,
              model: local.model,
              status: fallbackStatus,
              cost: billing.cost,
              net_cost: billing.net_cost,
              refunded: billing.refunded,
              refund_status: billing.refund_status,
              cost_note: billing.cost_note,
              cost_unit: '积分',
              seconds: local.duration,
              remaining_credits: null,
              prompt_head: String(local.prompt || '').slice(0, 120),
              error_message: '上游未返回任务详情',
              created_at: local.createdAt,
              finished_at: null,
              config_id: active.id,
              config_name: active.name,
              source: 'local_fallback',
            }
          }
          const statusLabel = mapAigcccUpstreamStatus(detail.status)
          const billing = resolveAigcccTaskBilling({
            statusLabel,
            usedCredits: detail.usedCredits,
            errorMessage: detail.error,
          })
          return {
            local_id: local.id,
            task_id: detail.taskId,
            model: local.model,
            status: statusLabel,
            upstream_status: detail.status,
            cost: billing.cost,
            net_cost: billing.net_cost,
            refunded: billing.refunded,
            refund_status: billing.refund_status,
            cost_note: billing.cost_note,
            cost_unit: '积分',
            seconds: detail.duration ?? local.duration,
            remaining_credits: detail.remainingCredits,
            prompt_head: String(local.prompt || '').slice(0, 120),
            error_message: detail.error,
            created_at: local.createdAt,
            finished_at: statusLabel === 'completed' || statusLabel === 'failed' ? local.createdAt : null,
            config_id: active.id,
            config_name: active.name,
            source: 'upstream',
          }
        } catch (err: any) {
          const fallbackStatus = String(local.status || 'unknown')
          const billing = resolveAigcccTaskBilling({
            statusLabel: fallbackStatus,
            usedCredits: null,
            errorMessage: String(err?.message || '查询上游任务失败'),
          })
          return {
            local_id: local.id,
            task_id: taskId,
            model: local.model,
            status: fallbackStatus,
            cost: billing.cost,
            net_cost: billing.net_cost,
            refunded: billing.refunded,
            refund_status: billing.refund_status,
            cost_note: billing.cost_note,
            cost_unit: '积分',
            seconds: local.duration,
            remaining_credits: null,
            prompt_head: String(local.prompt || '').slice(0, 120),
            error_message: String(err?.message || '查询上游任务失败'),
            created_at: local.createdAt,
            finished_at: null,
            config_id: active.id,
            config_name: active.name,
            source: 'local_fallback',
          }
        }
      }))
      const currentCredits = accounts.find(item => item.config_id === active.id)?.balance?.credits ?? null
      tasks = attachRunningBalances(details, currentCredits, 'credit')
    } catch (err: any) {
      tasksError = String(err?.message || '拉取上游任务失败')
    }
  }

  const currentCredits = active
    ? (accounts.find(item => item.config_id === active.id)?.balance?.credits ?? null)
    : null

  return success(c, {
    accounts,
    tasks,
    tasks_config_id: active?.id ?? null,
    tasks_error: tasksError,
    total: tasks.length,
    current_balance: currentCredits,
    note: '通道6上游未开放独立余额/任务列表接口；余额取自任务 status.remaining_credits，明细取 used_credits（按本站近期 task_id 回查）。',
    balance_timeline_note: '变动后余额由当前积分按明细从新到旧回推；期间若有充值/其他消费，更早条目可能偏离。生成中任务可能尚无 used_credits。',
  })
})

// GET /ai-configs/official-balance — 通道2 火山方舟：拉上游任务列表（含探测直连），入库并尽量落盘视频
app.get('/official-balance', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') || c.req.query('page_size') || 20) || 20))
  const pageNum = Math.max(1, Number(c.req.query('page') || c.req.query('page_num') || 1) || 1)
  const light = c.req.query('light') === '1' || c.req.query('quick') === '1'
  const rows = listOfficialVolcengineConfigRows()
  if (!rows.length) {
    return success(c, {
      accounts: [],
      tasks: [],
      total: 0,
      page: 1,
      page_num: 1,
      page_size: limit,
      limit,
      has_more: false,
      pricing: SEEDANCE_YUAN_PER_MILLION_TOKENS,
      note: '未配置火山方舟 Seedance（provider=volcengine，Base URL 含 ark.cn-beijing.volces.com）。',
    })
  }

  const active = rows.find(r => r.isActive && r.apiKey && !isPlaceholderApiKey(r.apiKey))
    || rows.find(r => r.apiKey && !isPlaceholderApiKey(r.apiKey))
    || null

  let tasks: any[] = []
  let tasksError: string | null = null
  let billFetchError: string | null = null
  let upstreamTotal = 0
  const spendByConfig = new Map<number, number>()

  if (active) {
    try {
      const listed = await listVolcengineArkTasks(
        { baseUrl: active.baseUrl, apiKey: active.apiKey },
        { pageSize: limit, pageNum },
      )
      upstreamTotal = listed.total

      // 轻量模式：仅用列表数据，跳过逐条详情 / 账单 / 落盘（设置页刷新用）
      const details = light
        ? listed.items
        : await Promise.all(listed.items.map(async (item) => {
          try {
            const detail = await fetchVolcengineArkTaskDetail(
              { baseUrl: active.baseUrl, apiKey: active.apiKey },
              item.taskId,
            )
            return detail || item
          } catch {
            return item
          }
        }))

      const adminUser = getAuthUser(c)
      const ts = now()
      const billingCreds = resolveOfficialVolcengineBillingCredentials(active)
      let billRows: Awaited<ReturnType<typeof fetchVolcengineBillDetailsForAnchors>> = []
      const usedBillIds = new Set<string>()
      if (!light && billingCreds) {
        try {
          const anchorTimesMs = details.map((detail) => {
            const anchor = detail.updatedAt || detail.createdAt || null
            if (!anchor) return NaN
            const ms = Date.parse(String(anchor))
            return Number.isFinite(ms) ? ms : NaN
          }).filter(ms => Number.isFinite(ms) && ms > 0)
          if (anchorTimesMs.length) {
            billRows = await fetchVolcengineBillDetailsForAnchors(
              billingCreds.access_key,
              billingCreds.secret_key,
              anchorTimesMs,
            )
          }
        } catch (err: any) {
          billFetchError = String(err?.message || '拉取账单明细失败')
        }
      }

      tasks = await Promise.all(details.map(async (detail) => {
        const statusLabel = mapVolcengineUpstreamStatus(detail.status)
        const tokens = detail.completionTokens ?? detail.totalTokens
        const model = detail.model
        const cost = statusLabel === 'completed'
          ? estimateSeedanceYuanFromTokens(model, tokens, false)
          : null
        if (cost != null && Number.isFinite(cost)) {
          spendByConfig.set(active.id, (spendByConfig.get(active.id) || 0) + cost)
        }
        const rate = isSeedance2FastModel(model)
          ? SEEDANCE_YUAN_PER_MILLION_TOKENS.V2_0_FAST_NO_VIDEO
          : SEEDANCE_YUAN_PER_MILLION_TOKENS.V2_0_NO_VIDEO

        // 同步到本站 video_generations（探测脚本直连的任务也会入库）
        let local = db.select({
          id: schema.videoGenerations.id,
          localPath: schema.videoGenerations.localPath,
          videoUrl: schema.videoGenerations.videoUrl,
          prompt: schema.videoGenerations.prompt,
          createdAt: schema.videoGenerations.createdAt,
          completedAt: schema.videoGenerations.completedAt,
          duration: schema.videoGenerations.duration,
          userId: schema.videoGenerations.userId,
          creditTransactionId: schema.videoGenerations.creditTransactionId,
          upstreamEstimatedCostYuan: schema.videoGenerations.upstreamEstimatedCostYuan,
          upstreamActualCostYuan: schema.videoGenerations.upstreamActualCostYuan,
          upstreamBillId: schema.videoGenerations.upstreamBillId,
        })
          .from(schema.videoGenerations)
          .where(and(
            eq(schema.videoGenerations.provider, 'volcengine'),
            eq(schema.videoGenerations.taskId, detail.taskId),
          ))
          .all()[0] || null

        if (!local) {
          if (light) {
            local = {
              id: 0,
              localPath: null,
              videoUrl: detail.videoUrl || null,
              prompt: detail.taskId,
              createdAt: detail.createdAt || ts,
              completedAt: detail.updatedAt || null,
              duration: detail.duration ?? 4,
              userId: null,
              creditTransactionId: null,
              upstreamEstimatedCostYuan: null,
              upstreamActualCostYuan: null,
              upstreamBillId: null,
            }
          } else {
          const insertRes = db.insert(schema.videoGenerations).values({
            provider: 'volcengine',
            prompt: `[上游同步] ${detail.taskId}`,
            model: model || null,
            duration: detail.duration ?? 4,
            resolution: detail.resolution || null,
            aspectRatio: detail.ratio || null,
            videoUrl: detail.videoUrl || null,
            status: statusLabel === 'completed' ? 'completed' : (statusLabel === 'failed' ? 'failed' : 'processing'),
            taskId: detail.taskId,
            errorMsg: detail.error || null,
            configId: active.id,
            userId: adminUser?.id ?? null,
            createdAt: detail.createdAt || ts,
            updatedAt: ts,
            completedAt: statusLabel === 'completed' ? (detail.updatedAt || ts) : null,
          }).run()
          local = {
            id: Number(insertRes.lastInsertRowid),
            localPath: null,
            videoUrl: detail.videoUrl || null,
            prompt: `[上游同步] ${detail.taskId}`,
            createdAt: detail.createdAt || ts,
            completedAt: statusLabel === 'completed' ? (detail.updatedAt || ts) : null,
            duration: detail.duration ?? 4,
            userId: adminUser?.id ?? null,
            creditTransactionId: null,
            upstreamEstimatedCostYuan: null,
            upstreamActualCostYuan: null,
            upstreamBillId: null,
          }
          }
        } else if (!light) {
          const patch: Record<string, unknown> = { updatedAt: ts }
          if (statusLabel === 'completed') {
            patch.status = 'completed'
            patch.completedAt = detail.updatedAt || local.completedAt || ts
          } else if (statusLabel === 'failed') {
            patch.status = 'failed'
            patch.errorMsg = detail.error || null
          }
          if (detail.videoUrl && !local.videoUrl) patch.videoUrl = detail.videoUrl
          if (model) patch.model = model
          if (detail.duration != null) patch.duration = detail.duration
          if (detail.resolution) patch.resolution = detail.resolution
          db.update(schema.videoGenerations)
            .set(patch)
            .where(eq(schema.videoGenerations.id, local.id))
            .run()
          if (patch.completedAt) local = { ...local, completedAt: String(patch.completedAt) }
          if (detail.duration != null) local = { ...local, duration: detail.duration }
        }

        let operatorUsername: string | null = null
        if (local.userId != null) {
          const [op] = db.select({
            username: schema.users.username,
          })
            .from(schema.users)
            .where(eq(schema.users.id, local.userId))
            .all()
          operatorUsername = op?.username || null
        }

        // 成功任务尽量落盘，避免方舟 TOS 链接过期
        let localPath = local.localPath || null
        const remoteVideo = detail.videoUrl || local.videoUrl || null
        if (!light && statusLabel === 'completed' && remoteVideo && !localPath) {
          try {
            localPath = await downloadFile(remoteVideo, 'videos', { syncOss: true })
            db.update(schema.videoGenerations)
              .set({ localPath, videoUrl: remoteVideo, updatedAt: now() })
              .where(eq(schema.videoGenerations.id, local.id))
              .run()
          } catch (err: any) {
            logTaskError('OfficialBalance', 'download-video', {
              taskId: detail.taskId,
              error: String(err?.message || err),
            })
          }
        }

        const playUrl = localPath
          ? (localPath.startsWith('/') ? localPath : `/${localPath}`)
          : remoteVideo

        const videoSeconds = detail.duration ?? local.duration ?? null
        const completedAt = statusLabel === 'completed'
          ? (local.completedAt || detail.updatedAt || null)
          : (local.completedAt || null)
        const createdAt = local.createdAt || detail.createdAt || null
        let elapsedSeconds: number | null = null
        if (createdAt && completedAt) {
          const startMs = Date.parse(String(createdAt))
          const endMs = Date.parse(String(completedAt))
          if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
            elapsedSeconds = Math.round((endMs - startMs) / 1000)
          }
        }

        const costPatch: Record<string, unknown> = { updatedAt: ts }
        if (cost != null && Number.isFinite(cost)) {
          costPatch.upstreamEstimatedCostYuan = Math.round(cost * 1_000_000) / 1_000_000
        }

        let actualCost = local.upstreamActualCostYuan ?? null
        let actualBillId = local.upstreamBillId ?? null
        let actualCostNote: string | null = null
        const billAnchorMs = Date.parse(String(completedAt || detail.updatedAt || createdAt || ''))
        if (!light && statusLabel === 'completed' && billingCreds && Number.isFinite(billAnchorMs)) {
          const matched = matchVolcengineBillToTask(billAnchorMs, billRows, usedBillIds)
          if (matched) {
            actualCost = matched.actual_cost
            actualBillId = matched.bill_id
            actualCostNote = matched.note
            costPatch.upstreamActualCostYuan = actualCost
            costPatch.upstreamBillId = actualBillId
            costPatch.upstreamBillSyncedAt = ts
          } else if (actualCost == null) {
            actualCostNote = billFetchError || '未匹配到账单明细（账单可能尚未出账）'
          }
        } else if (actualCost != null) {
          actualCostNote = actualBillId ? `已入库 · 账单 ${actualBillId}` : '已入库'
        } else if (!billingCreds && statusLabel === 'completed') {
          actualCostNote = '需配置 AK/SK 才能拉取控制台实付'
        }

        if (!light && Object.keys(costPatch).length > 1) {
          db.update(schema.videoGenerations)
            .set(costPatch)
            .where(eq(schema.videoGenerations.id, local.id))
            .run()
        }

        const siteBilling = resolveSiteCreditCharge(local.creditTransactionId)

        return {
          local_id: local.id,
          task_id: detail.taskId,
          model,
          status: statusLabel,
          upstream_status: detail.status,
          tokens,
          completion_tokens: detail.completionTokens,
          total_tokens: detail.totalTokens,
          cost,
          estimated_cost: cost,
          cost_unit: '元',
          cost_note: tokens != null
            ? `按官方价 ${rate} 元/百万 tokens 估算（不含视频输入档）`
            : (statusLabel === 'completed' ? '任务成功但未返回 usage.tokens' : null),
          actual_cost: actualCost,
          actual_cost_unit: '元',
          actual_cost_note: actualCostNote,
          upstream_bill_id: actualBillId,
          site_credits: siteBilling.site_credits_net ?? siteBilling.site_credits,
          site_credits_gross: siteBilling.site_credits,
          site_credits_refunded: siteBilling.site_credits_refunded,
          site_credits_note: siteBilling.site_credits_note,
          credit_transaction_id: local.creditTransactionId ?? null,
          has_video_input: false,
          yuan_per_million_tokens: rate,
          seconds: videoSeconds,
          duration_seconds: videoSeconds,
          elapsed_seconds: elapsedSeconds,
          resolution: detail.resolution || null,
          prompt_head: String(local.prompt || '').slice(0, 120),
          error_message: detail.error,
          created_at: createdAt,
          completed_at: completedAt,
          user_id: local.userId ?? null,
          username: operatorUsername,
          operator: operatorUsername,
          config_id: active.id,
          config_name: active.name,
          source: 'upstream_list',
          video_url: remoteVideo,
          local_path: localPath,
          play_url: playUrl,
        }
      }))
    } catch (err: any) {
      tasksError = String(err?.message || '拉取上游任务失败')
    }
  }

  const accounts = await Promise.all(rows.map(async (row) => {
    const base = formatOfficialKeyAccount(row)
    const apiKey = String(row.apiKey || '').trim()
    if (!apiKey || isPlaceholderApiKey(apiKey)) {
      return {
        ...base,
        balance: null,
        estimated_spend_yuan: null,
        probe_ok: false,
        error: '未配置 API Key',
        note: null,
      }
    }

    const estimated = spendByConfig.get(row.id)
      ?? (row.id === active?.id
        ? [...spendByConfig.values()].reduce((a, b) => a + b, 0)
        : null)

    const [probe, billing] = await Promise.all([
      probeOfficialVolcengineKey(row),
      resolveOfficialKeyBalance(row),
    ])

    let note = '现金余额需配置同账号 Access Key / Secret Key（管控面）；仅有方舟 API Key 时可探测可用性与近期估算消耗。'
    if (billing.has_billing_credentials && billing.balance) {
      note = '余额来自火山费用中心 QueryBalanceAcct'
    } else if (billing.has_billing_credentials && billing.error) {
      note = `余额查询失败：${billing.error}`
    }

    return {
      ...base,
      balance: billing.balance
        ? {
            available_balance: billing.balance.available_balance,
            cash_balance: billing.balance.cash_balance,
            freeze_amount: billing.balance.freeze_amount,
            arrears_balance: billing.balance.arrears_balance,
            currency: billing.balance.currency || 'CNY',
          }
        : null,
      estimated_spend_yuan: estimated != null
        ? Math.round(estimated * 10000) / 10000
        : null,
      probe_ok: probe.ok,
      error: probe.ok ? (billing.error || null) : probe.error,
      note,
    }
  }))

  return success(c, {
    accounts,
    tasks,
    tasks_config_id: active?.id ?? null,
    tasks_error: tasksError,
    total: upstreamTotal || tasks.length,
    page: pageNum,
    page_num: pageNum,
    page_size: limit,
    limit,
    has_more: upstreamTotal > 0
      ? pageNum * limit < upstreamTotal
      : tasks.length >= limit,
    pricing: SEEDANCE_YUAN_PER_MILLION_TOKENS,
    console_url: 'https://console.volcengine.com/finance/account-overview/',
    bill_fetch_error: tasksError ? null : billFetchError,
    note: light
      ? '轻量刷新：仅拉方舟任务列表 + 本站已入库实付；完整同步（账单匹配/落盘）请去掉 light=1 或等待后台定时同步。'
      : '通道2支持多 API Key 切换。现金余额与实付来自同账号 AK/SK（ListBillDetail）；估算费用为 tokens×刊例价；本站扣费来自 video_generations.credit_transaction_id。',
  })
})

// GET /ai-configs/official-pnl — 通道2 盈亏统计（本站实收 vs 控制台实付）
app.get('/official-pnl', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied

  const daysRaw = c.req.query('days')
  const days = daysRaw != null && String(daysRaw).trim() !== ''
    ? Number(daysRaw)
    : null
  const limit = Number(c.req.query('limit') || 50)
  const offset = Number(c.req.query('offset') || 0)
  const sort = String(c.req.query('sort') || 'profit_asc') as 'profit_asc' | 'profit_desc' | 'date_desc'
  const backfillBills = c.req.query('backfill') === '1' || c.req.query('backfill_bills') === '1'
  const onlyCompleted = c.req.query('all_status') !== '1'

  try {
    const report = await computeOfficialChannel2Pnl({
      days: Number.isFinite(days) && days! > 0 ? days : null,
      limit,
      offset,
      sort,
      backfillBills,
      onlyCompleted,
    })
    return success(c, report)
  } catch (err: any) {
    return badRequest(c, String(err?.message || '通道2盈亏统计失败'))
  }
})

// GET /ai-configs/official-bill-sync — 通道2 实付定时同步状态
app.get('/official-bill-sync', (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  return success(c, getOfficialChannel2BillSyncStatus())
})

// POST /ai-configs/official-bill-sync/run — 手动触发一批（不影响定时游标）
app.post('/official-bill-sync/run', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  const batchSize = Math.min(20, Math.max(1, Number(body.batch_size) || 5))
  try {
    const result = await runOfficialChannel2BillSyncBatch({
      batchSize,
      persistCursor: false,
      cursorBeforeId: body.reset_cursor ? null : undefined,
    })
    return success(c, {
      ...result,
      status: getOfficialChannel2BillSyncStatus(),
    })
  } catch (err: any) {
    return badRequest(c, String(err?.message || '手动同步失败'))
  }
})

// POST /ai-configs/official-keys — 新增通道2 API Key
app.post('/official-keys', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  try {
    const row = createOfficialVolcengineKey({
      name: body.name,
      api_key: body.api_key,
      billing_label: body.billing_label,
      access_key: body.access_key,
      secret_key: body.secret_key,
      activate: body.activate === true,
    })
    logActivity(getAuthUser(c), {
      action: 'settings.official_key.create',
      summary: `新增通道2 API Key：${row?.name || ''}`,
      resourceType: 'ai_config',
      resourceId: row?.id,
    })
    return created(c, formatOfficialKeyAccount(row!))
  } catch (err: any) {
    return badRequest(c, String(err?.message || err || '创建失败'))
  }
})

// POST /ai-configs/official-keys/sync-env — 从环境变量同步 huoshankey_*
app.post('/official-keys/sync-env', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const result = syncOfficialVolcengineKeysFromEnv()
  logActivity(getAuthUser(c), {
    action: 'settings.official_key.sync_env',
    summary: `同步通道2环境变量 Key：新建 ${result.created}，更新 ${result.updated}，账单 ${result.billing_updated}`,
  })
  return success(c, {
    ...result,
    accounts: listOfficialVolcengineConfigRows().map(formatOfficialKeyAccount),
  })
})

// PUT /ai-configs/official-keys/:id/active — 切换当前启用
app.put('/official-keys/:id/active', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '无效 id')
  try {
    const row = activateOfficialVolcengineKey(id)
    logActivity(getAuthUser(c), {
      action: 'settings.official_key.activate',
      summary: `切换通道2 API Key：${row.name}`,
      resourceType: 'ai_config',
      resourceId: row.id,
    })
    return success(c, formatOfficialKeyAccount(row))
  } catch (err: any) {
    return badRequest(c, String(err?.message || err || '切换失败'))
  }
})

// PUT /ai-configs/official-keys/:id — 更新备注 / Key / 余额凭证
app.put('/official-keys/:id', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '无效 id')
  const body = await c.req.json().catch(() => ({}))
  try {
    const row = updateOfficialVolcengineKey(id, {
      name: body.name,
      api_key: body.api_key,
      billing_label: body.billing_label,
      access_key: body.access_key,
      secret_key: body.secret_key,
      clear_secret: body.clear_secret === true,
    })
    logActivity(getAuthUser(c), {
      action: 'settings.official_key.update',
      summary: `更新通道2 API Key #${id}`,
      resourceType: 'ai_config',
      resourceId: id,
    })
    return success(c, row ? formatOfficialKeyAccount(row) : null)
  } catch (err: any) {
    return badRequest(c, String(err?.message || err || '更新失败'))
  }
})

// DELETE /ai-configs/official-keys/:id
app.delete('/official-keys/:id', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, '无效 id')
  try {
    deleteOfficialVolcengineKey(id)
    logActivity(getAuthUser(c), {
      action: 'settings.official_key.delete',
      summary: `删除通道2 API Key #${id}`,
      resourceType: 'ai_config',
      resourceId: id,
    })
    return success(c, { ok: true })
  } catch (err: any) {
    return badRequest(c, String(err?.message || err || '删除失败'))
  }
})

// GET /ai-configs?service_type=text — 工作台可读；完整列表仅管理员
app.get('/', async (c) => {
  const serviceType = c.req.query('service_type')
  if (!serviceType) {
    const denied = denyUnlessAdmin(c)
    if (denied) return denied
  }
  let rows = db.select().from(schema.aiServiceConfigs).all()
  if (serviceType) rows = rows.filter(r => r.serviceType === serviceType)

  const maskKey = getAuthUser(c).role !== 'admin'
  const parsed = rows.map(r => formatAiConfig(r, maskKey))
  return success(c, parsed)
})

// POST /ai-configs
app.post('/', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json()
  const ts = now()

  // 验证必填字段
  if (!body.service_type || !body.provider) {
    return badRequest(c, 'service_type and provider are required')
  }

  const res = db.insert(schema.aiServiceConfigs).values({
    serviceType: body.service_type,
    provider: body.provider,
    name: body.name || `${body.provider}-${body.service_type}`,
    baseUrl: body.base_url || '',
    apiKey: body.api_key || '',
    model: JSON.stringify(body.model || []),
    priority: body.priority || 0,
    isActive: true,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const [row] = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, Number(res.lastInsertRowid))).all()

  logActivity(getAuthUser(c), {
    action: 'settings.ai_config.create',
    summary: `新增 AI 配置：${row.name}`,
    resourceType: 'ai_config',
    resourceId: row.id,
  })

  return created(c, formatAiConfig(row, false))
})

// POST /ai-configs/huobao-preset
app.post('/huobao-preset', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json()
  const apiKey = String(body.api_key || '').trim()
  if (!apiKey) return badRequest(c, 'api_key is required')

  const ts = now()

  for (const preset of HUOBAO_PRESET_SERVICES) {
    const sameType = db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.serviceType, preset.serviceType)).all()
    const existing = sameType.find(row => {
      if (row.name === preset.name) return true
      try {
        const models = row.model ? JSON.parse(row.model) : []
        return Array.isArray(models) && models.includes(preset.model)
      } catch {
        return false
      }
    })

    const values = {
      serviceType: preset.serviceType,
      provider: preset.provider,
      name: preset.name,
      baseUrl: preset.baseUrl,
      apiKey,
      model: JSON.stringify([preset.model]),
      priority: preset.priority,
      isActive: true,
      updatedAt: ts,
    }

    if (existing) {
      db.update(schema.aiServiceConfigs).set(values).where(eq(schema.aiServiceConfigs.id, existing.id)).run()
    } else {
      db.insert(schema.aiServiceConfigs).values({
        ...values,
        createdAt: ts,
      }).run()
    }
  }

  for (const agent of HUOBAO_AGENT_DEFAULTS) {
    const [existing] = db.select().from(schema.agentConfigs).where(eq(schema.agentConfigs.agentType, agent.agentType)).all()
    const values = {
      name: agent.name,
      model: HUOBAO_AGENT_MODEL,
      isActive: true,
      updatedAt: ts,
    }

    if (existing) {
      db.update(schema.agentConfigs).set(values).where(eq(schema.agentConfigs.id, existing.id)).run()
    } else {
      db.insert(schema.agentConfigs).values({
        agentType: agent.agentType,
        description: '',
        model: HUOBAO_AGENT_MODEL,
        name: agent.name,
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: agent.maxTokens,
        maxIterations: 10,
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
      }).run()
    }
  }

  const configs = db.select().from(schema.aiServiceConfigs).all().map(row => ({
    ...toSnakeCase(row),
    model: row.model ? JSON.parse(row.model) : [],
  }))
  const agents = db.select().from(schema.agentConfigs).all().map(row => toSnakeCase(row))

  logTaskSuccess('AIConfig', 'huobao-preset-applied', {
    serviceCount: HUOBAO_PRESET_SERVICES.length,
    agentCount: HUOBAO_AGENT_DEFAULTS.length,
  })

  logActivity(getAuthUser(c), {
    action: 'settings.huobao_preset',
    summary: '应用影光工场一键配置',
  })

  return success(c, {
    configs,
    agents,
    agent_model: HUOBAO_AGENT_MODEL,
  })
})

// POST /ai-configs/test
app.post('/test', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json()
  if (!body.service_type || !body.provider || !body.base_url) {
    return badRequest(c, 'service_type, provider and base_url are required')
  }

  const model = Array.isArray(body.model) ? body.model[0] : body.model
  const probeBases = isApimartProvider(body.provider)
    ? listApimartApiBases({
      baseUrl: body.base_url,
      settings: typeof body.settings === 'object' && body.settings ? body.settings : undefined,
    })
    : [body.base_url]

  let lastProbe = buildProbe(body.service_type, body.provider, probeBases[0], model, body.api_key)
  let probeUrl = redactUrl(lastProbe.url)
  let lastError = ''

  logTaskProgress('AIConfig', 'probe-start', {
    serviceType: body.service_type,
    provider: body.provider,
    method: lastProbe.method,
    url: probeUrl,
    mirrorCount: probeBases.length,
  })

  try {
    for (let i = 0; i < probeBases.length; i += 1) {
      const baseUrl = probeBases[i]
      const probe = buildProbe(body.service_type, body.provider, baseUrl, model, body.api_key)
      lastProbe = probe
      probeUrl = redactUrl(probe.url)
      try {
        const resp = await fetch(probe.url, {
          method: probe.method,
          headers: probe.headers,
          body: probe.body ? JSON.stringify(probe.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        })
        const text = await resp.text()
        const tunnelDown = /tunnel.*unavailable|cpolar/i.test(text)
        const reachable = [200, 204, 400, 401, 403].includes(resp.status)
        let message = reachable
          ? (resp.ok ? '端点可访问，认证与路径基本正常' : '端点已响应，请根据状态码判断认证或路径是否正确')
          : '端点未按预期响应，请检查 Base URL 和代理前缀'
        if (isApimartProvider(body.provider) && i > 0 && reachable) {
          message = `${message}（已自动切换到备用域名 ${baseUrl}）`
        }
        if (tunnelDown || (resp.status === 502 && body.provider === 'chengmeng')) {
          message = '橙盟 API 隧道不可用。请将 Base URL 改为 https://api.chengmeng.site（勿使用 cpolar 临时地址）'
        }
        const payload = {
          ok: resp.ok,
          reachable,
          status: resp.status,
          status_text: resp.statusText,
          method: probe.method,
          url: probeUrl,
          message,
          response_preview: text.slice(0, 240),
          active_base_url: baseUrl,
        }
        if (reachable) {
          logTaskSuccess('AIConfig', 'probe-done', {
            provider: body.provider,
            status: resp.status,
            url: probeUrl,
            activeBaseUrl: baseUrl,
          })
        } else if (
          isApimartProvider(body.provider)
          && i < probeBases.length - 1
          && isRetryableApimartHttpStatus(resp.status)
        ) {
          lastError = message
          continue
        } else {
          logTaskError('AIConfig', 'probe-unexpected', {
            provider: body.provider,
            status: resp.status,
            url: probeUrl,
          })
        }
        return success(c, payload)
      } catch (error: any) {
        lastError = error.message || '请求失败'
        if (isApimartProvider(body.provider) && i < probeBases.length - 1 && isRetryableApimartFetchError(error)) {
          continue
        }
        throw error
      }
    }

    return success(c, {
      ok: false,
      reachable: false,
      method: lastProbe.method,
      url: probeUrl,
      message: lastError || 'APIMart 主域名与备用域名均不可达',
      response_preview: '',
    })
  } catch (error: any) {
    logTaskError('AIConfig', 'probe-failed', {
      provider: body.provider,
      url: probeUrl,
      error: error.message,
    })
    return success(c, {
      ok: false,
      reachable: false,
      method: lastProbe.method,
      url: probeUrl,
      message: error.message || '请求失败',
      response_preview: '',
    })
  }
})

// GET /ai-configs/:id
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id)).all()
  if (!row) return notFound(c)
  return success(c, formatAiConfig(row, getAuthUser(c).role !== 'admin'))
})

// PUT /ai-configs/:id
app.put('/:id', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const updates: Record<string, any> = { updatedAt: now() }

  if ('provider' in body) updates.provider = body.provider
  if ('name' in body) updates.name = body.name
  if ('base_url' in body) updates.baseUrl = body.base_url
  if ('api_key' in body) updates.apiKey = body.api_key
  if ('model' in body) updates.model = JSON.stringify(body.model)
  if ('priority' in body) updates.priority = body.priority
  if ('is_active' in body) updates.isActive = body.is_active

  db.update(schema.aiServiceConfigs).set(updates).where(eq(schema.aiServiceConfigs.id, id)).run()
  logActivity(getAuthUser(c), {
    action: 'settings.ai_config.update',
    summary: `更新 AI 配置 #${id}`,
    resourceType: 'ai_config',
    resourceId: id,
  })
  return success(c)
})

// DELETE /ai-configs/:id
app.delete('/:id', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const id = Number(c.req.param('id'))
  db.delete(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, id)).run()
  logActivity(getAuthUser(c), {
    action: 'settings.ai_config.delete',
    summary: `删除 AI 配置 #${id}`,
    resourceType: 'ai_config',
    resourceId: id,
  })
  return success(c)
})

// GET /ai-providers
export const aiProviders = new Hono()
aiProviders.get('/', async (c) => {
  const rows = db.select().from(schema.aiServiceProviders).all()
  const parsed = rows.map(r => ({
    ...toSnakeCase(r),
    preset_models: r.presetModels ? JSON.parse(r.presetModels) : [],
  }))
  return success(c, parsed)
})

export default app
