import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, created, badRequest, notFound, now } from '../utils/response.js'
import { getAuthUser, denyUnlessAdmin, type AuthVariables } from '../middleware/auth.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { logActivity } from '../services/activity.js'
import { toSnakeCase } from '../utils/transform.js'
import { NARRATION_VOICE_PRESETS } from '../constants/narration-voices.js'
import { generateStudioTts } from '../services/tts-studio.js'
import {
  getIndexTts2AdminConfig,
  saveIndexTts2AdminConfig,
  probeIndexTts2Api,
  getIndexTts2ServerStatus,
} from '../services/indextts2-config.js'
import type { IndexTts2EmotionOptions } from '../services/adapters/indextts2-gradio.js'

const app = new Hono<{ Variables: AuthVariables }>()

function formatTtsRow(row: typeof schema.ttsGenerations.$inferSelect) {
  return toSnakeCase({
    ...row,
    audio_url: row.audioPath ? `/${row.audioPath}` : null,
    emotion_vector: row.emotionVector ? JSON.parse(row.emotionVector) : null,
  })
}

function parseEmotion(body: Record<string, unknown>): IndexTts2EmotionOptions | undefined {
  const emotion = body.emotion as Record<string, unknown> | undefined
  if (!emotion && body.emotion_mode == null && body.emotion_text == null) return undefined
  const mode = String(emotion?.mode || body.emotion_mode || 'same').trim() as IndexTts2EmotionOptions['mode']
  if (mode === 'text') {
    return {
      mode: 'text',
      description: String(emotion?.description || body.emotion_text || '').trim(),
      weight: Number(emotion?.weight ?? body.emotion_weight ?? 0.8),
    }
  }
  if (mode === 'vector') {
    const vector = (emotion?.vector || body.emotion_vector || {}) as Record<string, number>
    return {
      mode: 'vector',
      weight: Number(emotion?.weight ?? body.emotion_weight ?? 0.8),
      vector: {
        happy: Number(vector.happy ?? 0),
        angry: Number(vector.angry ?? 0),
        sad: Number(vector.sad ?? 0),
        afraid: Number(vector.afraid ?? 0),
        disgusted: Number(vector.disgusted ?? 0),
        melancholic: Number(vector.melancholic ?? 0),
        surprised: Number(vector.surprised ?? 0),
        calm: Number(vector.calm ?? 0),
      },
    }
  }
  return { mode: 'same' }
}

// GET /tts/voices — 内置音色 + 情绪模式说明
app.get('/voices', (c) => {
  return success(c, {
    presets: NARRATION_VOICE_PRESETS,
    emotion_modes: [
      { id: 'same', label: '跟随参考音色' },
      { id: 'text', label: '文字描述情绪' },
      { id: 'vector', label: '情绪滑条' },
    ],
    emotion_presets: [
      { id: 'calm', label: '平静', mode: 'text', text: '平静、自然、舒缓' },
      { id: 'happy', label: '开心', mode: 'text', text: '开心、愉悦、轻快' },
      { id: 'sad', label: '悲伤', mode: 'text', text: '悲伤、低沉、压抑' },
      { id: 'angry', label: '愤怒', mode: 'text', text: '愤怒、激烈、强硬' },
      { id: 'suspense', label: '悬疑', mode: 'text', text: '悬疑、紧张、压迫感' },
      { id: 'warm', label: '温柔', mode: 'vector', vector: { calm: 0.6, happy: 0.3 } },
      { id: 'excited', label: '激动', mode: 'vector', vector: { happy: 0.7, surprised: 0.4 } },
    ],
  })
})

// GET /tts/config — IndexTTS2 API 配置（管理员）
app.get('/config', (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  return success(c, getIndexTts2AdminConfig())
})

// PUT /tts/config — 保存 IndexTTS2 API 配置（管理员）
app.put('/config', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  try {
    const saved = saveIndexTts2AdminConfig({
      base_url: String(body.base_url || ''),
      api_key: body.api_key != null ? String(body.api_key) : undefined,
      default_voice: body.default_voice != null ? String(body.default_voice) : undefined,
      response_format: body.response_format != null ? String(body.response_format) : undefined,
      is_active: body.is_active !== false && body.is_active !== 0 && body.is_active !== '0',
    }, getAuthUser(c))
    return success(c, saved)
  } catch (err: any) {
    return badRequest(c, err.message || '保存失败')
  }
})

// POST /tts/config/test — 测试 IndexTTS2 API 连通性（管理员）
app.post('/config/test', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  const baseUrl = String(body.base_url || '').trim()
  if (!baseUrl) return badRequest(c, '请填写 API 地址')
  try {
    const result = await probeIndexTts2Api(baseUrl)
    return success(c, result)
  } catch (err: any) {
    return success(c, {
      ok: false,
      reachable: false,
      message: err.message || '请求失败',
      response_preview: '',
    })
  }
})

// GET /tts/status — TTS 服务器开机/关机状态（所有登录用户）
app.get('/status', async (c) => {
  const force = c.req.query('force') === '1' || c.req.query('force') === 'true'
  const status = await getIndexTts2ServerStatus({ force })
  return success(c, status)
})

// GET /tts — 历史记录
app.get('/', (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 40)))
  const rows = db.select().from(schema.ttsGenerations)
    .orderBy(desc(schema.ttsGenerations.id))
    .limit(limit)
    .all()
    .filter(row => user.role === 'admin' || row.userId === user.id || (teamId != null && row.teamId === teamId))
  return success(c, { items: rows.map(formatTtsRow) })
})

// POST /tts — 生成配音
app.post('/', async (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const body = await c.req.json().catch(() => ({}))
  const text = String(body.text || '').trim()
  if (!text) return badRequest(c, '请输入配音文本')

  const voiceInput = {
    voice_asset_id: body.voice_asset_id != null ? Number(body.voice_asset_id) : null,
    voice_path: body.voice_path ? String(body.voice_path) : null,
    voice_id: body.voice_id ? String(body.voice_id) : null,
  }
  if (!voiceInput.voice_asset_id && !voiceInput.voice_path && !voiceInput.voice_id) {
    return badRequest(c, '请选择或上传参考音色')
  }

  const emotion = parseEmotion(body)
  const ts = now()

  try {
    const result = await generateStudioTts({
      text,
      voice: voiceInput,
      emotion,
      config_id: body.config_id != null ? Number(body.config_id) : null,
    })

    const insert = db.insert(schema.ttsGenerations).values({
      userId: user.id,
      teamId,
      dramaId: body.drama_id != null ? Number(body.drama_id) || null : null,
      text,
      voiceAssetId: result.voiceAssetId,
      voicePath: result.voicePath,
      voicePresetId: result.voicePresetId,
      voiceName: result.voiceName,
      emotionMode: emotion?.mode || 'same',
      emotionText: emotion?.mode === 'text' ? emotion.description || null : null,
      emotionVector: emotion?.mode === 'vector' ? JSON.stringify(emotion.vector || {}) : null,
      emotionWeight: emotion?.weight ?? null,
      audioPath: result.path,
      durationSec: result.durationSec,
      status: 'completed',
      errorMsg: null,
      createdAt: ts,
      updatedAt: ts,
    }).run()

    const id = Number(insert.lastInsertRowid)
    const [row] = db.select().from(schema.ttsGenerations).where(eq(schema.ttsGenerations.id, id)).all()

    logActivity(user, {
      action: 'tts.generate',
      summary: '配音生成',
      resourceType: 'tts_studio',
      resourceId: id,
      dramaId: body.drama_id != null ? Number(body.drama_id) || undefined : undefined,
      metadata: {
        voice_name: result.voiceName,
        duration_sec: result.durationSec,
        emotion_mode: emotion?.mode || 'same',
      },
    })

    return created(c, formatTtsRow(row!))
  } catch (err: any) {
    return badRequest(c, err.message || '配音生成失败')
  }
})

// GET /tts/:id
app.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const [row] = db.select().from(schema.ttsGenerations).where(eq(schema.ttsGenerations.id, id)).all()
  if (!row) return notFound(c, '记录不存在')
  if (user.role !== 'admin' && row.userId !== user.id && !(teamId != null && row.teamId === teamId)) {
    return notFound(c, '记录不存在')
  }
  return success(c, formatTtsRow(row))
})

export default app
