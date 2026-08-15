import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { logActivity } from './activity.js'
import type { AuthUser } from '../middleware/auth.js'
import { RunningHubClient, extractNodeInfoList, tryParseNodeInfoFromText } from './runninghub-client.js'
import {
  DEFAULT_RUNNINGHUB_NODE_BINDINGS,
  RUNNINGHUB_API_BASE,
  RUNNINGHUB_EMOTION_KEYS,
  RUNNINGHUB_INDEXTTS2_DOCS_URL,
  RUNNINGHUB_INDEXTTS2_REF_DOCS_URL,
  RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID,
  RUNNINGHUB_INDEXTTS2_WEBAPP_ID,
  RUNNINGHUB_INDEXTTS2_WORKFLOW_ID,
  RUNNINGHUB_TTS_PROVIDER,
  RUNNINGHUB_TTS_REF_PROVIDER,
  type RunningHubEmotionKey,
  type RunningHubNodeBinding,
  type RunningHubNodeBindings,
  type RunningHubTtsProfile,
} from '../constants/runninghub-indextts2.js'

export const RUNNINGHUB_INDEXTTS2_CONFIG_NAME = 'RunningHub IndexTTS2'
export const RUNNINGHUB_INDEXTTS2_REF_CONFIG_NAME = 'RunningHub IndexTTS2 参考音色'

export type RunningHubApiMode = 'openapi_v2' | 'ai_app'

export interface RunningHubIndexTts2Config {
  id: number | null
  provider: string
  apiKey: string
  apiBase: string
  workflowId: string
  webappId: string
  apiMode: RunningHubApiMode
  isActive: boolean
  nodeBindings: RunningHubNodeBindings
  /** 从 RH 同步或手动粘贴的完整 nodeInfoList 模板 */
  nodeInfoTemplate: Array<{ nodeId: string; fieldName: string; fieldValue?: unknown }>
  instanceType: string
  usePersonalQueue: boolean
}

function parseSettings(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function parseBinding(raw: unknown): RunningHubNodeBinding | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const nodeId = String(o.nodeId || o.node_id || '').trim()
  const fieldName = String(o.fieldName || o.field_name || '').trim()
  if (!nodeId || !fieldName) return null
  return { nodeId, fieldName }
}

function parseBindings(raw: unknown): RunningHubNodeBindings {
  const base: RunningHubNodeBindings = { ...DEFAULT_RUNNINGHUB_NODE_BINDINGS }
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  base.text = parseBinding(o.text)
  base.audio = parseBinding(o.audio)
  base.emotionAudio = parseBinding(o.emotionAudio || o.emotion_audio)
  base.emotionVector = parseBinding(o.emotionVector || o.emotion_vector)
  base.emotionWeight = parseBinding(o.emotionWeight || o.emotion_weight)
  const emotionsRaw = (o.emotions || {}) as Record<string, unknown>
  const emotions: Partial<Record<RunningHubEmotionKey, RunningHubNodeBinding>> = {}
  for (const key of RUNNINGHUB_EMOTION_KEYS) {
    const b = parseBinding(emotionsRaw[key])
    if (b) emotions[key] = b
  }
  base.emotions = Object.keys(emotions).length ? emotions : null
  return base
}

function parseTemplate(raw: unknown): RunningHubIndexTts2Config['nodeInfoTemplate'] {
  if (typeof raw === 'string') {
    const fromText = tryParseNodeInfoFromText(raw)
    if (fromText?.length) return fromText
    try {
      return parseTemplate(JSON.parse(raw))
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x: any) => x && x.nodeId != null && x.fieldName != null)
    .map((x: any) => ({
      nodeId: String(x.nodeId),
      fieldName: String(x.fieldName),
      fieldValue: x.fieldValue,
      description: String(x.description || x.descriptionCn || x.descriptionEn || '').trim() || undefined,
    }))
}

function findRow() {
  return db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(row => String(row.provider || '').toLowerCase() === RUNNINGHUB_TTS_PROVIDER)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || null
}

function findRefRow() {
  return db.select().from(schema.aiServiceConfigs)
    .all()
    .filter(row => String(row.provider || '').toLowerCase() === RUNNINGHUB_TTS_REF_PROVIDER)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || null
}

function rowToConfig(row: typeof schema.aiServiceConfigs.$inferSelect): RunningHubIndexTts2Config {
  const settings = parseSettings(row.settings)
  const apiMode = String(settings.api_mode || 'openapi_v2') === 'ai_app' ? 'ai_app' : 'openapi_v2'
  return {
    id: row.id,
    provider: RUNNINGHUB_TTS_PROVIDER,
    apiKey: row.apiKey || '',
    apiBase: String(row.baseUrl || RUNNINGHUB_API_BASE).trim() || RUNNINGHUB_API_BASE,
    workflowId: String(settings.workflow_id || RUNNINGHUB_INDEXTTS2_WORKFLOW_ID),
    webappId: String(settings.webapp_id || RUNNINGHUB_INDEXTTS2_WEBAPP_ID),
    apiMode,
    isActive: !!row.isActive,
    nodeBindings: parseBindings(settings.node_bindings),
    nodeInfoTemplate: parseTemplate(settings.node_info_template),
    instanceType: String(settings.instance_type || 'default'),
    usePersonalQueue: settings.use_personal_queue === true,
  }
}

function envFallback(): RunningHubIndexTts2Config | null {
  const apiKey = (process.env.RUNNINGHUB_API_KEY || '').trim()
  if (!apiKey) return null
  return {
    id: 0,
    provider: RUNNINGHUB_TTS_PROVIDER,
    apiKey,
    apiBase: (process.env.RUNNINGHUB_API_BASE || RUNNINGHUB_API_BASE).trim() || RUNNINGHUB_API_BASE,
    workflowId: process.env.RUNNINGHUB_INDEXTTS2_WORKFLOW_ID || RUNNINGHUB_INDEXTTS2_WORKFLOW_ID,
    webappId: process.env.RUNNINGHUB_INDEXTTS2_WEBAPP_ID || RUNNINGHUB_INDEXTTS2_WEBAPP_ID,
    apiMode: process.env.RUNNINGHUB_API_MODE === 'ai_app' ? 'ai_app' : 'openapi_v2',
    isActive: true,
    nodeBindings: DEFAULT_RUNNINGHUB_NODE_BINDINGS,
    nodeInfoTemplate: [],
    instanceType: 'default',
    usePersonalQueue: false,
  }
}

export function resolveRunningHubIndexTts2Config(): RunningHubIndexTts2Config {
  const row = findRow()
  // 优先启用中的配置；若仅有停用记录但已有 Key，仍可用（避免「保存了却提示无 Key」）
  if (row?.apiKey && row.isActive) return rowToConfig(row)
  const env = envFallback()
  if (env) return env
  if (row?.apiKey) return rowToConfig(row)
  throw new Error(
    'RunningHub IndexTTS2 未配置：请在「设置 → AI 服务 → RunningHub IndexTTS2」填写 API Key，'
    + '或设置环境变量 RUNNINGHUB_API_KEY',
  )
}

/**
 * 旁白配音(参考音色)：共用主配置 API Key，强制走 AI App apiType=4。
 * 节点模板必须来自参考音色 webapp（双音频），不可回退主工作流模板。
 */
export function resolveRunningHubIndexTts2RefConfig(): RunningHubIndexTts2Config {
  const base = resolveRunningHubIndexTts2Config()
  const refRow = findRefRow()
  if (refRow) {
    const settings = parseSettings(refRow.settings)
    const template = parseTemplate(settings.node_info_template)
    const bindings = parseBindings(settings.node_bindings)
    return {
      id: refRow.id,
      provider: RUNNINGHUB_TTS_REF_PROVIDER,
      apiKey: base.apiKey,
      apiBase: base.apiBase,
      workflowId: base.workflowId,
      webappId: RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID,
      apiMode: 'ai_app',
      isActive: true,
      nodeBindings: bindings,
      nodeInfoTemplate: template,
      instanceType: String(settings.instance_type || base.instanceType || 'default'),
      usePersonalQueue: settings.use_personal_queue === true || base.usePersonalQueue,
    }
  }
  return {
    ...base,
    id: null,
    provider: RUNNINGHUB_TTS_REF_PROVIDER,
    webappId: RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID,
    apiMode: 'ai_app',
    nodeBindings: { ...DEFAULT_RUNNINGHUB_NODE_BINDINGS },
    nodeInfoTemplate: [],
  }
}

export function resolveRunningHubTtsConfigByProfile(profile: RunningHubTtsProfile = 'default') {
  return profile === 'ref'
    ? resolveRunningHubIndexTts2RefConfig()
    : resolveRunningHubIndexTts2Config()
}

function saveRefNodeTemplate(
  template: RunningHubIndexTts2Config['nodeInfoTemplate'],
  bindings: RunningHubNodeBindings,
  user: AuthUser,
) {
  const base = resolveRunningHubIndexTts2Config()
  const existing = findRefRow()
  const settings = {
    webapp_id: RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID,
    api_mode: 'ai_app',
    node_bindings: bindings,
    node_info_template: template,
    instance_type: base.instanceType || 'default',
    use_personal_queue: !!base.usePersonalQueue,
    docs_url: RUNNINGHUB_INDEXTTS2_REF_DOCS_URL,
  }
  const ts = now()
  if (existing) {
    db.update(schema.aiServiceConfigs)
      .set({
        baseUrl: base.apiBase,
        apiKey: base.apiKey,
        settings: JSON.stringify(settings),
        isActive: true,
        updatedAt: ts,
      })
      .where(eq(schema.aiServiceConfigs.id, existing.id))
      .run()
    logActivity(user, {
      action: 'settings.runninghub_tts_ref_config.update',
      summary: '更新 RunningHub 参考音色配音节点映射',
      resourceType: 'ai_config',
      resourceId: existing.id,
    })
    return existing.id
  }
  const res = db.insert(schema.aiServiceConfigs).values({
    serviceType: 'audio',
    provider: RUNNINGHUB_TTS_REF_PROVIDER,
    name: RUNNINGHUB_INDEXTTS2_REF_CONFIG_NAME,
    baseUrl: base.apiBase,
    apiKey: base.apiKey,
    model: JSON.stringify([RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID]),
    priority: 119,
    isActive: true,
    settings: JSON.stringify(settings),
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const id = Number(res.lastInsertRowid)
  logActivity(user, {
    action: 'settings.runninghub_tts_ref_config.create',
    summary: '创建 RunningHub 参考音色配音节点映射',
    resourceType: 'ai_config',
    resourceId: id,
  })
  return id
}

/** 同步参考音色 AI App 的 nodeInfoList（可自动拉取） */
export async function syncRunningHubIndexTts2RefNodeMap(user: AuthUser, opts?: {
  api_key?: string
  node_info_template?: unknown
}) {
  let template = parseTemplate(opts?.node_info_template)
  let source = 'manual'
  const base = (() => {
    try {
      return resolveRunningHubIndexTts2Config()
    } catch {
      return null
    }
  })()
  if (!template.length) {
    const apiKeyInput = String(opts?.api_key || '').trim()
    const apiKey = (apiKeyInput && apiKeyInput !== '********')
      ? apiKeyInput
      : (base?.apiKey || '')
    if (!apiKey) throw new Error('请先在「设置 → RunningHub IndexTTS2」配置 API Key')
    const client = new RunningHubClient(apiKey, base?.apiBase || RUNNINGHUB_API_BASE)
    const demo = await client.fetchNodeInfoDemo({
      webappId: RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID,
    })
    template = demo.nodeInfoList
    source = demo.source
  }
  if (!template.length) {
    throw new Error('未能获取参考音色应用的 nodeInfoList，请从 RunningHub 页面粘贴模板')
  }
  const bindings = inferBindingsFromTemplate(template)
  const id = saveRefNodeTemplate(template, bindings, user)
  const cfg = resolveRunningHubIndexTts2RefConfig()
  return {
    id,
    sync_source: source,
    webapp_id: RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID,
    docs_url: RUNNINGHUB_INDEXTTS2_REF_DOCS_URL,
    has_bindings: hasUsableBindings(cfg),
    node_bindings: cfg.nodeBindings,
    node_info_template: cfg.nodeInfoTemplate,
    inferred_bindings: bindings,
  }
}


export function getRunningHubIndexTts2AdminConfig() {
  const row = findRow()
  const env = envFallback()
  const dbCfg = row?.apiKey ? rowToConfig(row) : null
  const active = (row?.isActive && dbCfg) ? dbCfg : (env || dbCfg)
  const hasKey = !!(dbCfg?.apiKey || env?.apiKey)

  return {
    configured: hasKey,
    has_api_key: hasKey,
    source: row?.isActive && row.apiKey ? 'database' : (row?.apiKey ? 'database_inactive' : (env ? 'env' : 'none')),
    id: row?.id || null,
    // 有 key 即视为启用意向；仅当库里显式关闭时为 false
    is_active: row ? !!row.isActive : !!env,
    api_base: row?.baseUrl || env?.apiBase || RUNNINGHUB_API_BASE,
    // 不把掩码写回输入框（否则像「key 被截短」）；前端用 has_api_key 提示已配置
    api_key: '',
    api_key_masked: hasKey ? maskApiKey(dbCfg?.apiKey || env?.apiKey || '') : '',
    workflow_id: active?.workflowId || RUNNINGHUB_INDEXTTS2_WORKFLOW_ID,
    webapp_id: active?.webappId || RUNNINGHUB_INDEXTTS2_WEBAPP_ID,
    api_mode: active?.apiMode || 'openapi_v2',
    node_bindings: active?.nodeBindings || DEFAULT_RUNNINGHUB_NODE_BINDINGS,
    node_info_template: active?.nodeInfoTemplate || [],
    instance_type: active?.instanceType || 'default',
    use_personal_queue: active?.usePersonalQueue || false,
    docs_url: RUNNINGHUB_INDEXTTS2_DOCS_URL,
    has_bindings: hasUsableBindings(active),
  }
}

function maskApiKey(raw: string) {
  const key = String(raw || '').trim()
  if (!key) return ''
  if (key.length <= 8) return '********'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

export function hasUsableBindings(cfg?: RunningHubIndexTts2Config | null) {
  if (!cfg) return false
  const b = cfg.nodeBindings
  // 参考音色 AI App：人物音频 + 文本即可（情感音频可选）
  if (cfg.provider === RUNNINGHUB_TTS_REF_PROVIDER || cfg.webappId === RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID) {
    if (cfg.nodeInfoTemplate.length > 0 && b.text?.nodeId && b.audio?.nodeId) return true
    return !!(b.text?.nodeId && b.audio?.nodeId)
  }
  if (cfg.nodeInfoTemplate.length > 0) return true
  return !!(b.text?.nodeId && b.audio?.nodeId && (b.emotionVector?.nodeId || b.emotions))
}

export function saveRunningHubIndexTts2AdminConfig(input: {
  api_key?: string
  api_base?: string
  workflow_id?: string
  webapp_id?: string
  api_mode?: string
  node_bindings?: unknown
  node_info_template?: unknown
  instance_type?: string
  use_personal_queue?: boolean
  is_active?: boolean
}, user: AuthUser) {
  const existing = findRow()
  const current = existing ? rowToConfig(existing) : null
  const apiKeyInput = String(input.api_key || '').trim()
  const apiKey = (apiKeyInput && apiKeyInput !== '********' && !/^•+$/.test(apiKeyInput) && !apiKeyInput.includes('••••'))
    ? apiKeyInput
    : (current?.apiKey || '')
  if (!apiKey) throw new Error('请填写 RunningHub API Key')

  const apiBase = String(input.api_base || current?.apiBase || RUNNINGHUB_API_BASE).trim().replace(/\/+$/, '') || RUNNINGHUB_API_BASE
  const workflowId = String(input.workflow_id || current?.workflowId || RUNNINGHUB_INDEXTTS2_WORKFLOW_ID).trim()
  const webappId = String(input.webapp_id || current?.webappId || RUNNINGHUB_INDEXTTS2_WEBAPP_ID).trim()
  const apiMode: RunningHubApiMode = String(input.api_mode || current?.apiMode || 'openapi_v2') === 'ai_app'
    ? 'ai_app'
    : 'openapi_v2'
  const nodeInfoTemplate = input.node_info_template != null
    ? parseTemplate(input.node_info_template)
    : (current?.nodeInfoTemplate || [])
  let nodeBindings = input.node_bindings != null
    ? parseBindings(input.node_bindings)
    : (current?.nodeBindings || DEFAULT_RUNNINGHUB_NODE_BINDINGS)
  if (input.node_info_template != null && nodeInfoTemplate.length && input.node_bindings == null) {
    nodeBindings = inferBindingsFromTemplate(nodeInfoTemplate)
  }
  const instanceType = String(input.instance_type || current?.instanceType || 'default').trim() || 'default'
  const usePersonalQueue = input.use_personal_queue != null
    ? !!input.use_personal_queue
    : !!current?.usePersonalQueue
  // 默认启用；仅当请求明确传 is_active=false 时停用
  const isActive = input.is_active !== false

  const settings = {
    workflow_id: workflowId,
    webapp_id: webappId,
    api_mode: apiMode,
    node_bindings: nodeBindings,
    node_info_template: nodeInfoTemplate,
    instance_type: instanceType,
    use_personal_queue: usePersonalQueue,
  }

  const ts = now()
  if (existing) {
    db.update(schema.aiServiceConfigs)
      .set({
        baseUrl: apiBase,
        apiKey,
        settings: JSON.stringify(settings),
        isActive,
        updatedAt: ts,
      })
      .where(eq(schema.aiServiceConfigs.id, existing.id))
      .run()
    logActivity(user, {
      action: 'settings.runninghub_tts_config.update',
      summary: '更新 RunningHub IndexTTS2 配置',
      resourceType: 'ai_config',
      resourceId: existing.id,
    })
  } else {
    const res = db.insert(schema.aiServiceConfigs).values({
      serviceType: 'audio',
      provider: RUNNINGHUB_TTS_PROVIDER,
      name: RUNNINGHUB_INDEXTTS2_CONFIG_NAME,
      baseUrl: apiBase,
      apiKey,
      model: JSON.stringify([workflowId]),
      priority: 120,
      isActive,
      settings: JSON.stringify(settings),
      createdAt: ts,
      updatedAt: ts,
    }).run()
    logActivity(user, {
      action: 'settings.runninghub_tts_config.create',
      summary: '创建 RunningHub IndexTTS2 配置',
      resourceType: 'ai_config',
      resourceId: Number(res.lastInsertRowid),
    })
  }
  return getRunningHubIndexTts2AdminConfig()
}

function nodeDescription(item: { description?: string; fieldValue?: unknown }): string {
  return String((item as any).description || '').trim()
}

function isAudioLikeField(fieldName: string): boolean {
  const lower = String(fieldName || '').toLowerCase()
  return lower === 'audio' || /audio|voice|speaker|filename|ref/.test(lower)
}

function classifyAudioRole(description: string): 'character' | 'emotion' | 'unknown' {
  const d = String(description || '')
  if (/情感|情绪|emotion|次要|secondary|emo/i.test(d) && !/人物|角色|character|重要|important/i.test(d)) {
    return 'emotion'
  }
  if (/人物|角色|character|重要|important|音色|参考音/i.test(d)) {
    return 'character'
  }
  if (/情感|情绪|emotion|次要|secondary/i.test(d)) return 'emotion'
  return 'unknown'
}

/** 根据 fieldName / description / 模板默认值启发式推断角色绑定 */
export function inferBindingsFromTemplate(
  template: Array<{ nodeId: string; fieldName: string; fieldValue?: unknown; description?: string }>,
): RunningHubNodeBindings {
  const bindings: RunningHubNodeBindings = { ...DEFAULT_RUNNINGHUB_NODE_BINDINGS, emotions: {} }
  const emotions = bindings.emotions as Partial<Record<RunningHubEmotionKey, RunningHubNodeBinding>>
  const hasDedicatedText = template.some(x => /^(text|value|string)$/i.test(String(x.fieldName || '')))

  const looksLikeEmotionVector = (value: unknown) => {
    const s = String(value ?? '').trim()
    return s.startsWith('[') && /^\[[\d\s.,+\-eE]+\]$/.test(s)
  }

  const audioItems = template.filter(item => isAudioLikeField(String(item.fieldName || '')))
  const characterByDesc = audioItems.find(item => classifyAudioRole(nodeDescription(item)) === 'character')
  const emotionByDesc = audioItems.find(item => classifyAudioRole(nodeDescription(item)) === 'emotion')
  if (characterByDesc) {
    bindings.audio = { nodeId: String(characterByDesc.nodeId), fieldName: String(characterByDesc.fieldName) }
  }
  if (emotionByDesc) {
    bindings.emotionAudio = { nodeId: String(emotionByDesc.nodeId), fieldName: String(emotionByDesc.fieldName) }
  }
  // 两个同名 audio 节点且无描述区分时：按顺序 人物 → 情感
  if (audioItems.length >= 2 && (!bindings.audio || !bindings.emotionAudio)) {
    const ordered = audioItems.map(item => ({
      nodeId: String(item.nodeId),
      fieldName: String(item.fieldName),
    }))
    if (!bindings.audio) bindings.audio = ordered[0]
    if (!bindings.emotionAudio) {
      const second = ordered.find(x => x.nodeId !== bindings.audio?.nodeId)
      if (second) bindings.emotionAudio = second
    }
  } else if (audioItems.length === 1 && !bindings.audio) {
    bindings.audio = {
      nodeId: String(audioItems[0].nodeId),
      fieldName: String(audioItems[0].fieldName),
    }
  }

  for (const item of template) {
    const name = String(item.fieldName || '')
    const lower = name.toLowerCase()
    const binding = { nodeId: String(item.nodeId), fieldName: name }

    // 音频节点已在上面按 description/顺序处理
    if (isAudioLikeField(name)) continue

    if (
      !bindings.emotionVector
      && (
        /emo_vector|emotion_vector|emotionvector/.test(lower)
        || looksLikeEmotionVector(item.fieldValue)
        || (lower === 'prompt' && hasDedicatedText)
      )
    ) {
      bindings.emotionVector = binding
      continue
    }
    if (!bindings.emotionWeight && /emo_alpha|emotion_weight|emo_weight/.test(lower)) {
      bindings.emotionWeight = binding
      continue
    }
    if (!bindings.text && (/^(text|value|string)$/i.test(name) || (/multiline|text/.test(lower) && lower !== 'prompt'))) {
      if (!/emo_text|negative/.test(lower)) {
        bindings.text = binding
        continue
      }
    }
    if (!bindings.text && lower === 'prompt' && !hasDedicatedText && !looksLikeEmotionVector(item.fieldValue)) {
      bindings.text = binding
      continue
    }

    const emotionMap: Array<[RegExp, RunningHubEmotionKey]> = [
      [/^(happy|喜|开心)$/i, 'happy'],
      [/^(angry|怒|愤怒)$/i, 'angry'],
      [/^(sad|哀|悲伤)$/i, 'sad'],
      [/^(afraid|fear|惧|恐惧)$/i, 'afraid'],
      [/^(disgusted|hate|厌恶)$/i, 'disgusted'],
      [/^(melancholic|low|低落|忧郁)$/i, 'melancholic'],
      [/^(surprised|surprise|惊喜|惊讶)$/i, 'surprised'],
      [/^(calm|neutral|平静)$/i, 'calm'],
    ]
    for (const [re, key] of emotionMap) {
      if (re.test(name) && !emotions[key]) {
        emotions[key] = binding
        break
      }
    }
  }

  if (!Object.keys(emotions).length) bindings.emotions = null
  return bindings
}

export async function syncRunningHubIndexTts2NodeMap(user: AuthUser, opts?: {
  api_key?: string
  node_info_template?: unknown
}) {
  let template = parseTemplate(opts?.node_info_template)
  let source = 'manual'

  if (!template.length) {
    const cfg = (() => {
      try {
        return resolveRunningHubIndexTts2Config()
      } catch {
        return null
      }
    })()
    const apiKeyInput = String(opts?.api_key || '').trim()
    const apiKey = (apiKeyInput && apiKeyInput !== '********')
      ? apiKeyInput
      : (cfg?.apiKey || '')
    if (!apiKey) throw new Error('请先填写 API Key，或直接粘贴 nodeInfoList 模板')

    const client = new RunningHubClient(apiKey, cfg?.apiBase || RUNNINGHUB_API_BASE)
    const demo = await client.fetchNodeInfoDemo({
      workflowId: cfg?.workflowId,
      webappId: cfg?.webappId,
    })
    template = demo.nodeInfoList
    source = demo.source
  }

  const bindings = inferBindingsFromTemplate(template)
  const saved = saveRunningHubIndexTts2AdminConfig({
    api_key: opts?.api_key,
    node_info_template: template,
    node_bindings: bindings,
    is_active: true,
  }, user)

  return {
    ...saved,
    sync_source: source,
    inferred_bindings: bindings,
  }
}

export async function probeRunningHubApi(apiKey: string, apiBase?: string) {
  const key = String(apiKey || '').trim()
  if (!key || key === '********') throw new Error('请填写 API Key')
  const base = (apiBase || RUNNINGHUB_API_BASE).replace(/\/+$/, '')
  const url = `${base}/openapi/v2/query`
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskId: '0' }),
      signal: AbortSignal.timeout(20_000),
    })
    const text = await resp.text()
    let payload: any = {}
    try { payload = text ? JSON.parse(text) : {} } catch { payload = { _raw: text } }
    // 401/412 = key 无效；其他（含 task not found）说明鉴权通路可达
    const authFailed = resp.status === 401 || resp.status === 403
      || /TOKEN_INVALID|UNAUTHORIZED|invalid.*key/i.test(String(payload?.msg || payload?.message || payload?.errorMessage || ''))
    if (authFailed) {
      return {
        ok: false,
        reachable: true,
        status: resp.status,
        message: `API Key 无效或无权限：${payload?.msg || payload?.errorMessage || resp.status}`,
      }
    }
    return {
      ok: true,
      reachable: true,
      status: resp.status,
      message: 'API Key 可访问 RunningHub OpenAPI',
      response_preview: text.slice(0, 200),
    }
  } catch (err: any) {
    return {
      ok: false,
      reachable: false,
      status: null,
      message: err?.message || '无法连接 RunningHub',
    }
  }
}

export { extractNodeInfoList }
