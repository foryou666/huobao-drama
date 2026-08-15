/**
 * 旁白配音(参考音色)
 * RunningHub AI App apiType=4 — webapp 1986388299516411905
 * https://www.runninghub.cn/call-api/api-detail/1986388299516411905?apiType=4
 */
import { Hono } from 'hono'
import { desc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { getAuthUser, denyUnlessAdmin, type AuthVariables } from '../middleware/auth.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { logActivity } from '../services/activity.js'
import { toSnakeCase } from '../utils/transform.js'
import {
  RUNNINGHUB_EMOTION_LABELS,
  RUNNINGHUB_INDEXTTS2_REF_DOCS_URL,
  RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID,
  RUNNINGHUB_TTS_REF_PROVIDER,
} from '../constants/runninghub-indextts2.js'
import {
  hasUsableBindings,
  resolveRunningHubIndexTts2Config,
  resolveRunningHubIndexTts2RefConfig,
  syncRunningHubIndexTts2RefNodeMap,
} from '../services/runninghub-indextts2-config.js'
import {
  processRunningHubTtsGeneration,
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
    emotion_audio_url: row.emotionAudioPath ? `/${row.emotionAudioPath}` : null,
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

// GET /tts/runninghub-ref/meta
app.get('/meta', (c) => {
  return success(c, {
    provider: RUNNINGHUB_TTS_REF_PROVIDER,
    webapp_id: RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID,
    docs_url: RUNNINGHUB_INDEXTTS2_REF_DOCS_URL,
    api_type: 4,
    emotion_labels: RUNNINGHUB_EMOTION_LABELS,
    emotion_hint: '[喜, 怒, 哀, 惧, 厌恶, 低落, 惊喜, 平静]，每项强度最高为 1',
  })
})

// GET /tts/runninghub-ref/status
app.get('/status', async (c) => {
  try {
    resolveRunningHubIndexTts2Config()
  } catch {
    return success(c, {
      state: 'unconfigured',
      configured: false,
      ready: false,
      label: 'RunningHub 未配置',
      detail: '请联系管理员在设置中配置 RunningHub API Key',
      docs_url: RUNNINGHUB_INDEXTTS2_REF_DOCS_URL,
    })
  }

  try {
    let cfg = resolveRunningHubIndexTts2RefConfig()
    if (!hasUsableBindings(cfg)) {
      // 首次访问：自动拉取参考音色 AI App 的 nodeInfoList
      try {
        await syncRunningHubIndexTts2RefNodeMap(getAuthUser(c))
        cfg = resolveRunningHubIndexTts2RefConfig()
      } catch {
        /* keep needs_bindings */
      }
    }
    const ready = hasUsableBindings(cfg)
    return success(c, {
      state: ready ? 'ready' : 'needs_bindings',
      configured: true,
      ready,
      label: ready ? '参考音色配音已就绪' : '已有 API Key，需同步参考音色节点参数',
      detail: ready
        ? `AI App ${RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID}`
        : '请管理员点击同步，或从 RunningHub 页面粘贴 nodeInfoList',
      webapp_id: RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID,
      docs_url: RUNNINGHUB_INDEXTTS2_REF_DOCS_URL,
    })
  } catch (err: any) {
    return success(c, {
      state: 'unconfigured',
      configured: false,
      ready: false,
      label: '参考音色配音未就绪',
      detail: err?.message || '请联系管理员',
      docs_url: RUNNINGHUB_INDEXTTS2_REF_DOCS_URL,
    })
  }
})

// POST /tts/runninghub-ref/config/sync
app.post('/config/sync', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await syncRunningHubIndexTts2RefNodeMap(getAuthUser(c), {
      api_key: body.api_key != null ? String(body.api_key) : undefined,
      node_info_template: body.node_info_template,
    })
    return success(c, result)
  } catch (err: any) {
    return badRequest(c, err.message || '同步失败')
  }
})

// GET /tts/runninghub-ref — 历史
app.get('/', (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 40)))
  const rows = db.select().from(schema.ttsGenerations)
    .orderBy(desc(schema.ttsGenerations.id))
    .limit(Math.min(200, limit * 3))
    .all()
    .filter(row => {
      if (row.provider !== RUNNINGHUB_TTS_REF_PROVIDER) return false
      return user.role === 'admin' || row.userId === user.id || (teamId != null && row.teamId === teamId)
    })
    .slice(0, limit)
  return success(c, { items: formatRows(rows) })
})

// POST /tts/runninghub-ref — 提交生成
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
      return badRequest(c, '参考音色配音需要音色库或上传参考音频')
    }
  } catch (err: any) {
    return badRequest(c, err?.message || '音色无效')
  }

  try {
    resolveRunningHubIndexTts2Config()
  } catch (err: any) {
    return badRequest(c, err?.message || 'RunningHub 未配置')
  }

  let cfg = resolveRunningHubIndexTts2RefConfig()
  if (!hasUsableBindings(cfg)) {
    try {
      await syncRunningHubIndexTts2RefNodeMap(user)
      cfg = resolveRunningHubIndexTts2RefConfig()
    } catch (err: any) {
      return badRequest(c, err?.message || '请先同步参考音色节点参数')
    }
  }
  if (!hasUsableBindings(cfg)) {
    return badRequest(c, '参考音色节点参数未就绪，请管理员同步 nodeInfoList')
  }

  const emotionAudioPathRaw = String(body.emotion_audio_path || body.emotionAudioPath || '').trim()
  let emotionAudioPath: string | null = null
  if (emotionAudioPathRaw) {
    try {
      // 复用音色解析：仅校验本地路径存在
      const emoResolved = resolveStudioTtsVoice({ voice_path: emotionAudioPathRaw })
      emotionAudioPath = emoResolved.voicePath || emotionAudioPathRaw.replace(/^\/+/, '')
    } catch (err: any) {
      return badRequest(c, err?.message || '情感参考音频无效')
    }
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
    emotionMode: emotionAudioPath ? 'audio' : 'same',
    emotionText: emotionAudioPath ? '加载情感' : null,
    emotionVector: JSON.stringify(emotionVector),
    emotionWeight,
    emotionAudioPath,
    audioPath: null,
    durationSec: null,
    status: 'pending',
    errorMsg: null,
    provider: RUNNINGHUB_TTS_REF_PROVIDER,
    remoteTaskId: null,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const id = Number(insert.lastInsertRowid)

  logActivity(user, {
    action: 'tts.runninghub_ref.generate',
    summary: 'RunningHub 参考音色配音',
    resourceType: 'tts_studio',
    resourceId: id,
    dramaId: body.drama_id != null ? Number(body.drama_id) || undefined : undefined,
    metadata: {
      voice_name: resolved.voiceName,
      provider: RUNNINGHUB_TTS_REF_PROVIDER,
      webapp_id: RUNNINGHUB_INDEXTTS2_REF_WEBAPP_ID,
      async: true,
    },
  })

  void processRunningHubTtsGeneration(id)

  const [row] = db.select().from(schema.ttsGenerations).where(eq(schema.ttsGenerations.id, id)).all()
  return created(c, formatRow(row!))
})

// GET /tts/runninghub-ref/:id
app.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const [row] = db.select().from(schema.ttsGenerations).where(eq(schema.ttsGenerations.id, id)).all()
  if (!row) return notFound(c, '记录不存在')
  if (row.provider && row.provider !== RUNNINGHUB_TTS_REF_PROVIDER) return notFound(c, '记录不存在')
  if (user.role !== 'admin' && row.userId !== user.id && !(teamId != null && row.teamId === teamId)) {
    return notFound(c, '记录不存在')
  }
  return success(c, formatRow(row))
})

export default app
