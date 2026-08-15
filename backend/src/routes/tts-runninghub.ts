import { Hono } from 'hono'
import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { getAuthUser, denyUnlessAdmin, type AuthVariables } from '../middleware/auth.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { logActivity } from '../services/activity.js'
import { toSnakeCase } from '../utils/transform.js'
import { RUNNINGHUB_EMOTION_LABELS, RUNNINGHUB_TTS_PROVIDER } from '../constants/runninghub-indextts2.js'
import {
  getRunningHubIndexTts2AdminConfig,
  saveRunningHubIndexTts2AdminConfig,
  syncRunningHubIndexTts2NodeMap,
  probeRunningHubApi,
  resolveRunningHubIndexTts2Config,
  hasUsableBindings,
} from '../services/runninghub-indextts2-config.js'
import {
  processRunningHubTtsGeneration,
  formatEmotionVectorString,
  type RunningHubEmotionVector,
} from '../services/runninghub-indextts2.js'
import { resolveStudioTtsVoice } from '../services/tts-studio.js'

const app = new Hono<{ Variables: AuthVariables }>()

type TtsRow = typeof schema.ttsGenerations.$inferSelect
type UserRow = typeof schema.users.$inferSelect

function loadUserMap(userIds: Array<number | null | undefined>) {
  const ids = [...new Set(userIds.filter((id): id is number => Number.isFinite(Number(id)) && Number(id) > 0))]
  if (!ids.length) return new Map<number, UserRow>()
  return new Map(
    db.select().from(schema.users).where(inArray(schema.users.id, ids)).all().map(u => [u.id, u]),
  )
}

function operatorFields(userId: number | null | undefined, userMap: Map<number, UserRow>) {
  const owner = userId ? userMap.get(userId) : null
  return {
    operator_id: userId ?? null,
    operator_name: owner?.displayName || owner?.username || null,
    username: owner?.username || null,
    display_name: owner?.displayName || owner?.username || null,
  }
}

function formatRow(row: TtsRow, userMap?: Map<number, UserRow>) {
  const map = userMap || loadUserMap([row.userId])
  return toSnakeCase({
    ...row,
    audio_url: row.audioPath ? `/${row.audioPath}` : null,
    emotion_vector: row.emotionVector ? safeJson(row.emotionVector) : null,
    ...operatorFields(row.userId, map),
  })
}

function formatRows(rows: TtsRow[]) {
  const userMap = loadUserMap(rows.map(r => r.userId))
  return rows.map(row => formatRow(row, userMap))
}

function safeJson(raw: string) {
  try { return JSON.parse(raw) } catch { return raw }
}

function parseEmotionVector(body: Record<string, unknown>): RunningHubEmotionVector {
  const src = (body.emotion_vector || body.emotionVector || {}) as Record<string, number>
  return {
    happy: Number(src.happy ?? 0),
    angry: Number(src.angry ?? 0),
    sad: Number(src.sad ?? 0),
    afraid: Number(src.afraid ?? 0),
    disgusted: Number(src.disgusted ?? 0),
    melancholic: Number(src.melancholic ?? 0),
    surprised: Number(src.surprised ?? 0),
    calm: Number(src.calm ?? 0),
  }
}

// GET /tts/runninghub/meta
app.get('/meta', (c) => {
  return success(c, {
    provider: RUNNINGHUB_TTS_PROVIDER,
    emotion_labels: RUNNINGHUB_EMOTION_LABELS,
    emotion_hint: '[喜, 怒, 哀, 惧, 厌恶, 低落, 惊喜, 平静]，每项强度最高为 1',
  })
})

// GET /tts/runninghub/status
app.get('/status', (c) => {
  try {
    const cfg = resolveRunningHubIndexTts2Config()
    const ready = hasUsableBindings(cfg)
    return success(c, {
      state: ready ? 'ready' : 'needs_bindings',
      configured: true,
      ready,
      label: ready ? 'RunningHub IndexTTS2 已就绪' : '已配置 API Key，需同步节点参数',
      detail: ready
        ? `工作流 ${cfg.workflowId}`
        : '请管理员在设置中同步或粘贴 nodeInfoList',
    })
  } catch {
    return success(c, {
      state: 'unconfigured',
      configured: false,
      ready: false,
      label: 'RunningHub IndexTTS2 未配置',
      detail: '请联系管理员配置 RunningHub API Key',
    })
  }
})

// GET /tts/runninghub/config
app.get('/config', (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  return success(c, getRunningHubIndexTts2AdminConfig())
})

// PUT /tts/runninghub/config
app.put('/config', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  try {
    const saved = saveRunningHubIndexTts2AdminConfig({
      api_key: body.api_key != null ? String(body.api_key) : undefined,
      api_base: body.api_base != null ? String(body.api_base) : undefined,
      workflow_id: body.workflow_id != null ? String(body.workflow_id) : undefined,
      webapp_id: body.webapp_id != null ? String(body.webapp_id) : undefined,
      api_mode: body.api_mode != null ? String(body.api_mode) : undefined,
      node_bindings: body.node_bindings,
      node_info_template: body.node_info_template,
      instance_type: body.instance_type != null ? String(body.instance_type) : undefined,
      use_personal_queue: body.use_personal_queue,
      is_active: body.is_active !== false && body.is_active !== 0 && body.is_active !== '0',
    }, getAuthUser(c))
    return success(c, saved)
  } catch (err: any) {
    return badRequest(c, err.message || '保存失败')
  }
})

// POST /tts/runninghub/config/test
app.post('/config/test', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  try {
    let apiKey = String(body.api_key || '').trim()
    if (!apiKey || apiKey === '********') {
      try {
        apiKey = resolveRunningHubIndexTts2Config().apiKey
      } catch {
        return badRequest(c, '请填写 API Key')
      }
    }
    const result = await probeRunningHubApi(apiKey, body.api_base ? String(body.api_base) : undefined)
    return success(c, result)
  } catch (err: any) {
    return success(c, { ok: false, reachable: false, message: err.message || '测试失败' })
  }
})

// POST /tts/runninghub/config/sync — 拉取或粘贴 nodeInfoList
app.post('/config/sync', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await syncRunningHubIndexTts2NodeMap(getAuthUser(c), {
      api_key: body.api_key != null ? String(body.api_key) : undefined,
      node_info_template: body.node_info_template,
    })
    return success(c, result)
  } catch (err: any) {
    return badRequest(c, err.message || '同步失败')
  }
})

// GET /tts/runninghub — 历史（仅 RunningHub）
app.get('/', (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 40)))
  const rows = db.select().from(schema.ttsGenerations)
    .orderBy(desc(schema.ttsGenerations.id))
    .limit(Math.min(200, limit * 3))
    .all()
    .filter(row => {
      if (row.provider !== RUNNINGHUB_TTS_PROVIDER) return false
      return user.role === 'admin' || row.userId === user.id || (teamId != null && row.teamId === teamId)
    })
    .slice(0, limit)
  return success(c, { items: formatRows(rows) })
})

// POST /tts/runninghub — 提交生成（异步，立即返回）
app.post('/', async (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const body = await c.req.json().catch(() => ({}))
  const text = String(body.text || '').trim()
  if (!text) return badRequest(c, '请输入配音文本')

  const voiceInput = {
    voice_asset_id: body.voice_asset_id != null ? Number(body.voice_asset_id) : null,
    voice_path: body.voice_path ? String(body.voice_path) : null,
  }
  if (!voiceInput.voice_asset_id && !voiceInput.voice_path) {
    return badRequest(c, '请选择音色库或上传参考音频')
  }

  let resolved
  try {
    resolved = resolveStudioTtsVoice(voiceInput)
    if (!resolved.voicePath) {
      return badRequest(c, 'RunningHub 配音需要音色库或上传参考音频')
    }
  } catch (err: any) {
    return badRequest(c, err?.message || '音色无效')
  }

  try {
    resolveRunningHubIndexTts2Config()
  } catch (err: any) {
    return badRequest(c, err?.message || 'RunningHub 未配置')
  }

  const emotionVector = parseEmotionVector(body)
  const emotionWeight = body.emotion_weight != null ? Number(body.emotion_weight) : 0.8
  const ts = now()

  const insert = db.insert(schema.ttsGenerations).values({
    userId: user.id,
    teamId,
    dramaId: body.drama_id != null ? Number(body.drama_id) || null : null,
    text,
    voiceAssetId: resolved.voiceAssetId,
    voicePath: resolved.voicePath,
    voicePresetId: null,
    voiceName: resolved.voiceName,
    emotionMode: 'vector',
    emotionText: formatEmotionVectorString(emotionVector),
    emotionVector: JSON.stringify(emotionVector),
    emotionWeight,
    audioPath: null,
    durationSec: null,
    status: 'pending',
    errorMsg: null,
    provider: RUNNINGHUB_TTS_PROVIDER,
    remoteTaskId: null,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const id = Number(insert.lastInsertRowid)

  logActivity(user, {
    action: 'tts.runninghub.generate',
    summary: 'RunningHub IndexTTS2 配音',
    resourceType: 'tts_studio',
    resourceId: id,
    dramaId: body.drama_id != null ? Number(body.drama_id) || undefined : undefined,
    metadata: {
      voice_name: resolved.voiceName,
      provider: RUNNINGHUB_TTS_PROVIDER,
      async: true,
    },
  })

  void processRunningHubTtsGeneration(id)

  const [row] = db.select().from(schema.ttsGenerations).where(eq(schema.ttsGenerations.id, id)).all()
  return created(c, formatRow(row!))
})

// GET /tts/runninghub/:id
app.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const [row] = db.select().from(schema.ttsGenerations).where(eq(schema.ttsGenerations.id, id)).all()
  if (!row) return notFound(c, '记录不存在')
  if (row.provider && row.provider !== RUNNINGHUB_TTS_PROVIDER) return notFound(c, '记录不存在')
  if (user.role !== 'admin' && row.userId !== user.id && !(teamId != null && row.teamId === teamId)) {
    return notFound(c, '记录不存在')
  }
  return success(c, formatRow(row))
})

export default app
