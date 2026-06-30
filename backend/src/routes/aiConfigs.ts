import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
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
  loadAistarslabVideoConfigFromProvider,
  normalizeAistarslabVideoConfig,
} from '../utils/aistarslab-video-options.js'
import {
  getChengmengVideoModelOptions,
  listChengmengModelOptionsForApi,
  syncChengmengModelCreditPricing,
} from '../utils/chengmeng-video-options.js'

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
  { serviceType: 'text', name: '红果默认文本服务', label: '文本', provider: 'chatfire', baseUrl: 'https://api.chatfire.site', model: 'gemini-3-pro-preview', priority: 100 },
  { serviceType: 'image', name: '红果默认图片服务', label: '图片', provider: 'gemini', baseUrl: 'https://api.chatfire.site', model: 'gemini-3-pro-image-preview', priority: 99 },
  ...SEEDANCE_VIDEO_PRESETS,
  { serviceType: 'audio', name: '红果默认音频服务', label: '音频', provider: 'minimax', baseUrl: 'https://api.chatfire.site/minimax', model: 'speech-2.8-hd', priority: 97 },
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

  if (p === 'openai' || p === 'openrouter' || p === 'chatfire' || p === 'geeknow') {
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
    const raw = await loadAistarslabVideoConfigFromProvider({ baseUrl, apiKey })
    const config = normalizeAistarslabVideoConfig(raw)
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
    summary: '应用红果一键配置',
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
  const probe = buildProbe(body.service_type, body.provider, body.base_url, model, body.api_key)
  const probeUrl = redactUrl(probe.url)

  logTaskProgress('AIConfig', 'probe-start', {
    serviceType: body.service_type,
    provider: body.provider,
    method: probe.method,
    url: probeUrl,
  })

  try {
    const resp = await fetch(probe.url, {
      method: probe.method,
      headers: probe.headers,
      body: probe.body ? JSON.stringify(probe.body) : undefined,
    })
    const text = await resp.text()
    const tunnelDown = /tunnel.*unavailable|cpolar/i.test(text)
    const reachable = [200, 204, 400, 401, 403].includes(resp.status)
    let message = reachable
      ? (resp.ok ? '端点可访问，认证与路径基本正常' : '端点已响应，请根据状态码判断认证或路径是否正确')
      : '端点未按预期响应，请检查 Base URL 和代理前缀'
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
    }
    if (reachable) {
      logTaskSuccess('AIConfig', 'probe-done', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    } else {
      logTaskError('AIConfig', 'probe-unexpected', {
        provider: body.provider,
        status: resp.status,
        url: probeUrl,
      })
    }
    return success(c, payload)
  } catch (error: any) {
    logTaskError('AIConfig', 'probe-failed', {
      provider: body.provider,
      url: probeUrl,
      error: error.message,
    })
    return success(c, {
      ok: false,
      reachable: false,
      method: probe.method,
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
