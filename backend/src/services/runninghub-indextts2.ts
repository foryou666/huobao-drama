import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { downloadFile } from '../utils/storage.js'
import { getAudioDurationSeconds } from '../utils/audio-duration.js'
import { resolveStudioTtsVoice, type StudioTtsVoiceInput } from './tts-studio.js'
import {
  RunningHubClient,
  pickAudioResult,
  type RunningHubNodeInfo,
} from './runninghub-client.js'
import {
  hasUsableBindings,
  resolveRunningHubTtsConfigByProfile,
  type RunningHubIndexTts2Config,
} from './runninghub-indextts2-config.js'
import {
  RUNNINGHUB_EMOTION_KEYS,
  RUNNINGHUB_TTS_PROVIDER,
  RUNNINGHUB_TTS_REF_PROVIDER,
  type RunningHubEmotionKey,
  type RunningHubTtsProfile,
} from '../constants/runninghub-indextts2.js'
import { withRunningHubSlot } from './runninghub-concurrency.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORAGE_ROOT = process.env.STORAGE_PATH || path.resolve(__dirname, '../../../data/static')

export interface RunningHubEmotionVector {
  happy?: number
  angry?: number
  sad?: number
  afraid?: number
  disgusted?: number
  melancholic?: number
  surprised?: number
  calm?: number
}

export interface RunningHubTtsRequest {
  text: string
  voice?: StudioTtsVoiceInput
  /** 情感参考音频本地路径（可选，参考音色 AI App 第二路） */
  emotionAudioPath?: string | null
  emotionVector?: RunningHubEmotionVector
  emotionWeight?: number
  /** default=现有 workflow 页；ref=AI App 参考音色页 */
  profile?: RunningHubTtsProfile
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

export function formatEmotionVectorString(vector?: RunningHubEmotionVector | null): string {
  const vals = RUNNINGHUB_EMOTION_KEYS.map(k => clamp01(Number(vector?.[k] ?? 0)))
  return `[${vals.map(v => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))).join(', ')}]`
}

function resolveLocalVoicePath(voicePath: string): string {
  const raw = voicePath.trim().replace(/^\/+/, '')
  if (path.isAbsolute(raw) && fs.existsSync(raw)) return raw
  if (raw.startsWith('static/')) {
    const abs = path.join(STORAGE_ROOT, raw.replace(/^static\//, ''))
    if (fs.existsSync(abs)) return abs
  }
  const abs2 = path.join(STORAGE_ROOT, raw)
  if (fs.existsSync(abs2)) return abs2
  throw new Error(`参考音频文件不存在: ${voicePath}`)
}

function applyRole(
  list: RunningHubNodeInfo[],
  binding: { nodeId: string; fieldName: string } | null | undefined,
  value: unknown,
) {
  if (!binding?.nodeId || !binding.fieldName) return false
  const idx = list.findIndex(
    x => String(x.nodeId) === String(binding.nodeId) && String(x.fieldName) === String(binding.fieldName),
  )
  if (idx >= 0) {
    list[idx] = { ...list[idx], fieldValue: value }
    return true
  }
  list.push({ nodeId: String(binding.nodeId), fieldName: String(binding.fieldName), fieldValue: value })
  return true
}

function looksLikeEmotionVector(value: unknown): boolean {
  const s = String(value ?? '').trim()
  if (!s.startsWith('[')) return false
  // [0, 0, 0, 0, 0, 1, 0, 0] 或带小数
  return /^\[[\d\s.,+\-eE]+\]$/.test(s)
}

function fillByFieldNameHeuristics(
  list: RunningHubNodeInfo[],
  values: {
    text: string
    audioRef: string
    emotionAudioRef?: string | null
    emotionAudioNodeIds?: Set<string>
    emotionVectorStr: string
    emotionWeight: number
    emotions: Record<RunningHubEmotionKey, number>
  },
) {
  const hasDedicatedText = list.some(x => /^(text|value|string)$/i.test(String(x.fieldName || '')))
  const emotionAudioNodeIds = values.emotionAudioNodeIds || new Set<string>()
  const emotionAudioRef = values.emotionAudioRef || values.audioRef

  for (const item of list) {
    const name = String(item.fieldName || '')
    const lower = name.toLowerCase()
    const desc = String(item.description || '')
    // 模板里已是情感向量形态的字段（本工作流把向量放在 prompt 上）
    if (looksLikeEmotionVector(item.fieldValue) || /emo_vector|emotion_vector/.test(lower)) {
      item.fieldValue = values.emotionVectorStr
      continue
    }
    if (/emo_alpha|emotion_weight|emo_weight/.test(lower)) {
      item.fieldValue = values.emotionWeight
      continue
    }
    if (/audio|voice|speaker|filename/.test(lower) || lower === 'audio') {
      const isEmotionAudio = emotionAudioNodeIds.has(String(item.nodeId))
        || /emo_audio|emotion_audio/.test(lower)
        || (/情感|情绪|emotion|次要|secondary/i.test(desc) && !/人物|角色|character|重要|important/i.test(desc))
      item.fieldValue = isEmotionAudio ? emotionAudioRef : values.audioRef
      continue
    }
    // 已有独立 text 节点时，不要把 prompt 当正文（IndexTTS2 的 prompt = 情感向量）
    if (lower === 'prompt' && hasDedicatedText) {
      item.fieldValue = values.emotionVectorStr
      continue
    }
    if ((/^(text|value|string)$/i.test(name) || (/multiline|text/.test(lower) && lower !== 'prompt')) && !/emo_text|negative/.test(lower)) {
      item.fieldValue = values.text
      continue
    }
    if (/^(prompt)$/i.test(name) && !hasDedicatedText) {
      item.fieldValue = values.text
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
      if (re.test(name)) {
        item.fieldValue = values.emotions[key]
        break
      }
    }
  }
}

export function buildRunningHubNodeInfoList(
  cfg: RunningHubIndexTts2Config,
  values: {
    text: string
    audioRef: string
    emotionAudioRef?: string | null
    emotionVector?: RunningHubEmotionVector | null
    emotionWeight?: number
  },
): RunningHubNodeInfo[] {
  const emotionVectorStr = formatEmotionVectorString(values.emotionVector)
  const emotionWeight = Number.isFinite(Number(values.emotionWeight))
    ? Number(values.emotionWeight)
    : 0.8
  const emotions = Object.fromEntries(
    RUNNINGHUB_EMOTION_KEYS.map(k => [k, clamp01(Number(values.emotionVector?.[k] ?? 0))]),
  ) as Record<RunningHubEmotionKey, number>
  // 未单独上传情感音频时，与上游 demo 一致：复用人物音频
  const emotionAudioRef = values.emotionAudioRef || values.audioRef

  if (!hasUsableBindings(cfg)) {
    throw new Error(
      '尚未配置工作流节点映射。请在设置中点击「同步节点参数」，'
      + '或从 RunningHub API 文档粘贴 nodeInfoList 模板。',
    )
  }

  const list: RunningHubNodeInfo[] = cfg.nodeInfoTemplate.length
    ? cfg.nodeInfoTemplate.map(x => ({
      nodeId: String(x.nodeId),
      fieldName: String(x.fieldName),
      fieldValue: x.fieldValue,
      description: (x as any).description ? String((x as any).description) : undefined,
    }))
    : []

  const b = cfg.nodeBindings
  const emotionAudioNodeIds = new Set<string>()
  if (b.emotionAudio?.nodeId) emotionAudioNodeIds.add(String(b.emotionAudio.nodeId))

  let applied = 0
  if (applyRole(list, b.text, values.text)) applied++
  if (applyRole(list, b.audio, values.audioRef)) applied++
  if (applyRole(list, b.emotionAudio, emotionAudioRef)) {
    applied++
    if (b.emotionAudio?.nodeId) emotionAudioNodeIds.add(String(b.emotionAudio.nodeId))
  }
  if (applyRole(list, b.emotionVector, emotionVectorStr)) applied++
  if (b.emotionWeight && applyRole(list, b.emotionWeight, emotionWeight)) applied++
  if (b.emotions) {
    for (const key of RUNNINGHUB_EMOTION_KEYS) {
      if (b.emotions[key] && applyRole(list, b.emotions[key], emotions[key])) applied++
    }
  }

  // 模板存在时再用启发式兜底填充未绑定字段
  if (cfg.nodeInfoTemplate.length) {
    fillByFieldNameHeuristics(list, {
      text: values.text,
      audioRef: values.audioRef,
      emotionAudioRef,
      emotionAudioNodeIds,
      emotionVectorStr,
      emotionWeight,
      emotions,
    })
  }

  if (!list.length || applied === 0 && !cfg.nodeInfoTemplate.length) {
    throw new Error('nodeInfoList 为空，请检查节点映射配置')
  }
  return list
}

export async function generateRunningHubIndexTts(req: RunningHubTtsRequest) {
  const text = String(req.text || '').trim()
  if (!text) throw new Error('请输入配音文本')

  const profile: RunningHubTtsProfile = req.profile === 'ref' ? 'ref' : 'default'
  const cfg = resolveRunningHubTtsConfigByProfile(profile)
  const resolved = resolveStudioTtsVoice(req.voice)
  if (!resolved.voicePath) {
    throw new Error('RunningHub 配音需要音色库或上传参考音频（不支持仅用内置音色 ID）')
  }

  const localVoice = resolveLocalVoicePath(resolved.voicePath)
  const emotionAudioPath = String(req.emotionAudioPath || '').trim()
  const localEmotionAudio = emotionAudioPath
    ? resolveLocalVoicePath(emotionAudioPath)
    : null

  return withRunningHubSlot('tts', async () => {
    const client = new RunningHubClient(cfg.apiKey, cfg.apiBase)
    const uploaded = await client.uploadBinary(localVoice)
    // 工作流节点优先用 fileName；部分环境可用 download_url
    const audioRef = uploaded.fileName || uploaded.download_url
    if (!audioRef) throw new Error('RunningHub 上传未返回可用音频引用')

    let emotionAudioRef: string | null = null
    if (localEmotionAudio) {
      if (path.resolve(localEmotionAudio) === path.resolve(localVoice)) {
        emotionAudioRef = audioRef
      } else {
        const emoUploaded = await client.uploadBinary(localEmotionAudio)
        emotionAudioRef = emoUploaded.fileName || emoUploaded.download_url || null
        if (!emotionAudioRef) throw new Error('RunningHub 情感音频上传未返回可用引用')
      }
    }

    const nodeInfoList = buildRunningHubNodeInfoList(cfg, {
      text,
      audioRef,
      emotionAudioRef,
      emotionVector: req.emotionVector,
      emotionWeight: req.emotionWeight,
    })

    const submitted = (profile === 'ref' || cfg.apiMode === 'ai_app')
      ? await client.runAiApp({ webappId: cfg.webappId, nodeInfoList })
      : await client.runWorkflow({
        workflowId: cfg.workflowId,
        nodeInfoList,
        instanceType: cfg.instanceType || undefined,
        usePersonalQueue: cfg.usePersonalQueue || undefined,
      })

    if (!submitted.taskId) throw new Error('RunningHub 未返回 taskId')

    const done = await client.pollUntilDone(submitted.taskId)
    const st = String(done.status || '').toUpperCase()
    if (st !== 'SUCCESS') {
      throw new Error(
        done.errorMessage
        || (typeof done.failedReason === 'string' ? done.failedReason : '')
        || `RunningHub 任务失败（${done.status || 'UNKNOWN'}）`,
      )
    }

    const resultUrl = pickAudioResult(done.results)
    if (!resultUrl) throw new Error('RunningHub 任务成功但未返回音频 URL（结果链接约 24 小时有效）')

    const audioPath = await downloadFile(resultUrl, 'audio')
    const durationSec = await getAudioDurationSeconds(audioPath).catch(() => 0)

    return {
      path: audioPath,
      durationSec,
      taskId: submitted.taskId,
      remoteUrl: resultUrl,
      ...resolved,
    }
  }, { textLen: text.length })
}

function nowIso() {
  return new Date().toISOString()
}

/** 后台完成一条 RunningHub 配音（提交即返回后的异步收尾） */
export async function processRunningHubTtsGeneration(id: number) {
  const [row] = db.select().from(schema.ttsGenerations)
    .where(eq(schema.ttsGenerations.id, id))
    .all()
  if (!row) return
  if (row.status === 'completed' || row.status === 'failed') return

  db.update(schema.ttsGenerations)
    .set({ status: 'processing', updatedAt: nowIso() })
    .where(eq(schema.ttsGenerations.id, id))
    .run()

  try {
    let emotionVector: RunningHubEmotionVector | undefined
    if (row.emotionVector) {
      try {
        emotionVector = JSON.parse(row.emotionVector) as RunningHubEmotionVector
      } catch {
        emotionVector = undefined
      }
    }

    const profile: RunningHubTtsProfile = row.provider === RUNNINGHUB_TTS_REF_PROVIDER
      ? 'ref'
      : 'default'
    const result = await generateRunningHubIndexTts({
      text: row.text,
      voice: {
        voice_asset_id: row.voiceAssetId,
        voice_path: row.voicePath,
      },
      emotionAudioPath: row.emotionAudioPath,
      emotionVector,
      emotionWeight: row.emotionWeight ?? 0.8,
      profile,
    })

    db.update(schema.ttsGenerations)
      .set({
        status: 'completed',
        audioPath: result.path,
        durationSec: result.durationSec,
        remoteTaskId: result.taskId,
        voiceAssetId: result.voiceAssetId ?? row.voiceAssetId,
        voicePath: result.voicePath || row.voicePath,
        voiceName: result.voiceName || row.voiceName,
        errorMsg: null,
        updatedAt: nowIso(),
      })
      .where(eq(schema.ttsGenerations.id, id))
      .run()
  } catch (err: any) {
    const message = String(err?.message || err || '配音生成失败')
    db.update(schema.ttsGenerations)
      .set({
        status: 'failed',
        errorMsg: message,
        updatedAt: nowIso(),
      })
      .where(eq(schema.ttsGenerations.id, id))
      .run()
  }
}

/** 服务重启后恢复未完成的 RunningHub 配音 */
export function resumePendingRunningHubTts() {
  const rows = db.select().from(schema.ttsGenerations)
    .all()
    .filter(r =>
      (r.provider === RUNNINGHUB_TTS_PROVIDER || r.provider === RUNNINGHUB_TTS_REF_PROVIDER)
      && (r.status === 'pending' || r.status === 'processing'),
    )
    .slice(0, 10)

  for (const row of rows) {
    void processRunningHubTtsGeneration(row.id)
  }
}
