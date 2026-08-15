import { Hono } from 'hono'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now, forbidden } from '../utils/response.js'
import { getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { toSnakeCase } from '../utils/transform.js'
import {
  splitNovelIntoSegments,
  rebuildNarrationSegments,
  listNarrationSegments,
} from '../services/narration-segments.js'
import { extractNarrationEntities, bindNarrationSegmentMeta } from '../services/narration-extract.js'
import { generateNarrationTTS } from '../services/narration-tts.js'
import { exportJianyingDraft } from '../services/jianying-draft.js'
import { parseNarrationAnalysis, type NarrationAnalysis } from '../services/narration-types.js'
import { resolveSegmentVoice, ensureAnalysisVoices, defaultNarratorVoice, normalizeIndexTts2Voice, assignCharacterVoices, isValidIndexTts2Voice, isRunningHubVoiceRef } from '../services/narration-voice.js'
import { autoAssignNarrationVoices, ensureAnalysisVoiceProfiles } from '../services/narration-voice-auto.js'
import {
  buildNarrationSegmentContentRefs,
  generateAllNarrationAssets,
  generateNarrationCharacterImage,
  generateNarrationPropImage,
  generateNarrationSceneImage,
  listNarrationAssetReadiness,
  loadSyncedNarrationAnalysis,
  packNarrationSegmentContentRefs,
} from '../services/narration-assets.js'
import { generateVideo } from '../services/video-generation.js'
import { getConfigById } from '../services/ai.js'
import {
  assertNarrationGrokApiKey,
  getNarrationGrokChannelDef,
  listNarrationGrokChannelOptions,
  resolveNarrationGrokConfigId,
} from '../utils/narration-grok-channels.js'
import { grokVideoDurationBounds } from '../constants/geeknow-grok.js'
import { tryChargeUser, tryRefundCharge } from '../utils/credit-charge.js'
import { resolveGrokVideoCreditAction } from '../constants/credit-actions.js'
import { NARRATION_VOICE_PRESETS } from '../constants/narration-voices.js'

import {
  ensureNarrationLinkedDrama,
  ensureMissingNarrationLinkedDramas,
  syncNarrationDramaTitle,
} from '../services/narration-drama-link.js'
import { syncNarrationAssetsToDrama } from '../services/narration-drama-sync.js'
import { softDeleteNarrationProject } from '../services/narration-delete.js'

const app = new Hono<{ Variables: AuthVariables }>()

function getJobOr404(id: number) {
  const [row] = db.select().from(schema.narrationJobs)
    .where(eq(schema.narrationJobs.id, id)).all()
  if (!row || row.deletedAt) return null
  return row
}

function assertJobAccess(c: Parameters<typeof getAuthUser>[0], row: typeof schema.narrationJobs.$inferSelect) {
  const user = getAuthUser(c)
  if (user.role === 'admin') return user
  if (row.userId !== user.id) return null
  return user
}

function syncSegmentVideos(jobId: number) {
  const segments = listNarrationSegments(jobId)
  const ts = now()
  for (const seg of segments) {
    if (!seg.videoGenerationId) continue
    const [gen] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, seg.videoGenerationId)).all()
    if (!gen) continue
    // Prefer local file; keep existing segment path if generation row has not landed yet
    const videoPath = gen.localPath || gen.videoUrl || seg.videoPath || null
    const status = gen.status === 'completed' ? 'completed'
      : gen.status === 'failed' ? 'failed'
        : seg.status
    db.update(schema.narrationSegments).set({
      videoPath,
      videoDurationSec: gen.duration || seg.videoDurationSec,
      status,
      errorMsg: gen.status === 'failed' ? (gen.errorMsg || seg.errorMsg) : (status === 'completed' ? null : seg.errorMsg),
      updatedAt: ts,
    }).where(eq(schema.narrationSegments.id, seg.id)).run()
  }
}

function normalizeNarrationMediaUrl(raw: string | null | undefined) {
  const value = String(raw || '').trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  const path = value.replace(/^\/+/, '')
  if (path.startsWith('static/')) return `/${path}`
  return value.startsWith('/') ? value : `/${value}`
}

function formatSegment(row: typeof schema.narrationSegments.$inferSelect, grokModel?: string | null) {
  const bounds = grokVideoDurationBounds(grokModel || 'grok-video-3-pro')
  const ttsSec = Number(row.ttsDurationSec) || 0
  const videoMaxSec = bounds.max
  const shotsNeeded = ttsSec > 0 ? Math.ceil(ttsSec / videoMaxSec) : 1
  const durationMismatch = ttsSec > videoMaxSec + 0.5
  return toSnakeCase({
    ...row,
    tts_audio_url: normalizeNarrationMediaUrl(row.ttsAudioPath),
    video_url: normalizeNarrationMediaUrl(row.videoPath),
    character_ids: row.characterIds ? JSON.parse(row.characterIds) : [],
    prop_ids: row.propIds ? JSON.parse(row.propIds) : [],
    content_refs: row.contentRefs ? JSON.parse(row.contentRefs) : [],
    video_max_sec: videoMaxSec,
    shots_needed: shotsNeeded,
    duration_mismatch: durationMismatch,
    estimated_speech_sec: Math.max(1, Math.round(String(row.text || '').replace(/\s/g, '').length / 4.5)),
  })
}

function formatJob(row: typeof schema.narrationJobs.$inferSelect) {
  syncSegmentVideos(row.id)
  const [fresh] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, row.id)).all()
  const job = fresh || row
  const analysis = loadSyncedNarrationAnalysis(job.id, job.analysisJson)
  const channel = getNarrationGrokChannelDef(job.grokChannel)
  return toSnakeCase({
    ...job,
    grok_channel: job.grokChannel || channel.id,
    grok_model: job.grokModel || channel.defaultModel,
    analysis,
    asset_readiness: listNarrationAssetReadiness(analysis),
    jianying_draft_url: job.jianyingDraftPath ? `/${job.jianyingDraftPath}` : null,
    jianying_zip_url: job.jianyingDraftPath ? `/${String(job.jianyingDraftPath).replace(/\/$/, '')}.zip` : null,
    segments: listNarrationSegments(job.id).map(s => formatSegment(s, job.grokModel || channel.defaultModel)),
    grok_channels: listNarrationGrokChannelOptions(),
  })
}

function applyAnalysisToSegments(jobId: number, analysis: NarrationAnalysis) {
  const ts = now()
  for (const meta of analysis.segment_meta) {
    db.update(schema.narrationSegments).set({
      videoPrompt: meta.video_prompt,
      sceneId: meta.scene_id || null,
      characterIds: JSON.stringify(meta.character_ids || []),
      propIds: JSON.stringify(meta.prop_ids || []),
      updatedAt: ts,
    }).where(and(
      eq(schema.narrationSegments.jobId, jobId),
      eq(schema.narrationSegments.segmentIndex, meta.segment_index),
    )).run()
  }
}

// GET /narration/voices — 内置解说音色
app.get('/voices', (c) => success(c, { voices: NARRATION_VOICE_PRESETS }))

// GET /narration/grok-channels — GeekNow / 花镜（不含启灵泽）
app.get('/grok-channels', (c) => success(c, { channels: listNarrationGrokChannelOptions() }))

// GET /narration
app.get('/', (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  ensureMissingNarrationLinkedDramas({
    userId: user.role === 'admin' ? null : user.id,
    teamId,
  })
  const rows = db.select().from(schema.narrationJobs)
    .where(isNull(schema.narrationJobs.deletedAt))
    .orderBy(desc(schema.narrationJobs.updatedAt))
    .all()
    .filter(row => user.role === 'admin' || row.userId === user.id || (teamId != null && row.teamId === teamId))
    .map(row => ensureNarrationLinkedDrama(row))

  const dramaIds = [...new Set(rows.map(r => r.dramaId).filter((id): id is number => Number.isFinite(Number(id)) && Number(id) > 0))]
  const dramaById = new Map<number, typeof schema.dramas.$inferSelect>()
  if (dramaIds.length) {
    for (const d of db.select().from(schema.dramas).all()) {
      if (dramaIds.includes(d.id) && !d.deletedAt) dramaById.set(d.id, d)
    }
  }

  const items = rows.map((row) => {
    const drama = row.dramaId ? dramaById.get(row.dramaId) : null
    let covers: { '3:4': string | null; '4:3': string | null } = { '3:4': null, '4:3': null }
    let dramaStyle: string | null = null
    if (drama) {
      dramaStyle = drama.style || null
      let meta: Record<string, any> = {}
      try {
        meta = drama.metadata ? JSON.parse(drama.metadata) : {}
      } catch { /* ignore */ }
      const raw = meta.covers && typeof meta.covers === 'object' ? meta.covers : {}
      covers = {
        '3:4': String(raw['3:4'] || drama.thumbnail || '').trim() || null,
        '4:3': String(raw['4:3'] || '').trim() || null,
      }
    }
    let characterCount = 0
    let sceneCount = 0
    try {
      const analysis = row.analysisJson ? JSON.parse(row.analysisJson) : null
      characterCount = Array.isArray(analysis?.characters) ? analysis.characters.length : 0
      sceneCount = Array.isArray(analysis?.scenes) ? analysis.scenes.length : 0
    } catch { /* ignore */ }
    const segmentCount = listNarrationSegments(row.id).length
    return toSnakeCase({
      ...row,
      drama_title: drama?.title || row.title,
      drama_style: dramaStyle,
      covers,
      cover_3_4: covers['3:4'],
      cover_4_3: covers['4:3'],
      cover_url: covers['3:4'] || covers['4:3'],
      thumbnail: covers['3:4'] || drama?.thumbnail || null,
      character_count: characterCount,
      scene_count: sceneCount,
      segment_count: segmentCount,
    })
  })

  return success(c, { items })
})

// POST /narration — 新建（JSON 或 multipart 小说文件）
app.post('/', async (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const ts = now()
  let title = '解说漫项目'
  let novelText = ''

  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.parseBody()
    title = String(form.title || title).trim() || title
    const file = form.file
    if (file && typeof file === 'object' && 'arrayBuffer' in file) {
      const buf = Buffer.from(await (file as File).arrayBuffer())
      novelText = buf.toString('utf8')
    } else {
      novelText = String(form.novel_text || form.text || '').trim()
    }
  } else {
    const body = await c.req.json().catch(() => ({}))
    title = String(body.title || title).trim() || title
    novelText = String(body.novel_text || body.text || '').trim()
  }

  if (!novelText) return badRequest(c, '请提供小说正文或上传 txt 文件')

  const res = db.insert(schema.narrationJobs).values({
    title,
    novelText,
    userId: user.id,
    teamId,
    status: 'draft',
    stage: 'upload',
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const jobId = Number(res.lastInsertRowid)
  // 创建后不自动分段：先提取资产，再手动/下一步分段
  const [row] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, jobId)).all()
  const linked = ensureNarrationLinkedDrama(row!)
  return created(c, formatJob(linked))
})

// GET /narration/:id
app.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  return success(c, formatJob(ensureNarrationLinkedDrama(row)))
})

// PATCH /narration/:id
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const body = await c.req.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updatedAt: now() }
  if (body.title != null) patch.title = String(body.title).trim() || row.title
  if (body.narrator_voice != null) {
    const nextVoice = String(body.narrator_voice).trim() || null
    const hasTts = listNarrationSegments(id).some(s => s.ttsAudioPath)
    if (hasTts && row.narratorVoice && nextVoice !== row.narratorVoice) {
      return badRequest(c, '已开始 TTS 朗读，旁白音色不可修改')
    }
    patch.narratorVoice = nextVoice
  }
  if (body.tts_config_id != null) patch.ttsConfigId = Number(body.tts_config_id) || null
  if (body.grok_channel != null) {
    const requested = String(body.grok_channel).trim().toLowerCase()
    if (requested === 'qilingze') {
      return badRequest(c, '解说漫已停用启灵泽通道，请改用 GeekNow 或花镜')
    }
    const channel = getNarrationGrokChannelDef(requested)
    patch.grokChannel = channel.id
    const currentModel = String(body.grok_model ?? row.grokModel ?? '').trim()
    if (!channel.models.some(m => m.id === currentModel)) {
      patch.grokModel = channel.defaultModel
    }
  }
  if (body.grok_model != null) patch.grokModel = String(body.grok_model).trim() || row.grokModel
  if (body.aspect_ratio != null) patch.aspectRatio = String(body.aspect_ratio).trim() || row.aspectRatio
  if (body.novel_text != null || body.text != null) {
    const nextNovel = String(body.novel_text ?? body.text ?? '').trim()
    if (!nextNovel) return badRequest(c, '原文不能为空')
    const hasTts = listNarrationSegments(id).some(s => s.ttsAudioPath)
    if (hasTts) {
      return badRequest(c, '已完成 TTS，不可替换原文；请新建任务')
    }
    patch.novelText = nextNovel
  }
  db.update(schema.narrationJobs).set(patch).where(eq(schema.narrationJobs.id, id)).run()
  const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
  if (next) {
    ensureNarrationLinkedDrama(next)
    if (body.title != null) syncNarrationDramaTitle(next)
  }
  const [fresh] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
  return success(c, formatJob(fresh || next!))
})

// DELETE /narration/:id — 软删解说任务及关联项目壳（仅平台管理员）
app.delete('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  const user = getAuthUser(c)
  if (user.role !== 'admin') return forbidden(c, '仅平台管理员可删除解说漫')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const result = softDeleteNarrationProject(row)
  return success(c, result)
})

// POST /narration/:id/replace-novel — 替换原文并重新切分（须未完成 TTS；保留已提取资产）
app.post('/:id/replace-novel', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const body = await c.req.json().catch(() => ({}))
  const nextNovel = String(body.novel_text ?? body.text ?? '').trim()
  if (!nextNovel) return badRequest(c, '请提供英文/原文正文')
  const hasTts = listNarrationSegments(id).some(s => s.ttsAudioPath)
  if (hasTts) return badRequest(c, '已完成 TTS，无法替换原文；请新建任务')

  db.update(schema.narrationJobs).set({
    novelText: nextNovel,
    updatedAt: now(),
  }).where(eq(schema.narrationJobs.id, id)).run()

  const [updated] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
  try {
    // 已有资产则直接重切分；尚未抽取则只保存原文
    const analysis = parseNarrationAnalysis(updated!.analysisJson)
    if (analysis.characters.length || analysis.scenes.length || analysis.props.length) {
      await segmentAndBind(id, updated!)
    }
    const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
    return success(c, formatJob(next!))
  } catch (err: any) {
    db.update(schema.narrationJobs).set({ errorMsg: err.message, updatedAt: now() })
      .where(eq(schema.narrationJobs.id, id)).run()
    return badRequest(c, err.message)
  }
})

async function segmentAndBind(id: number, row: typeof schema.narrationJobs.$inferSelect) {
  const existing = parseNarrationAnalysis(row.analysisJson)
  if (!existing.characters.length && !existing.scenes.length && !existing.props.length) {
    throw new Error('请先提取角色/场景/道具，再进行旁白分段')
  }
  if (!row.novelText?.trim()) throw new Error('小说内容为空')
  const texts = splitNovelIntoSegments(row.novelText)
  if (!texts.length) throw new Error('无法切分有效段落')
  rebuildNarrationSegments(id, texts)
  const analysis = await bindNarrationSegmentMeta(id, row.novelText, existing, row.narratorVoice)
  const ts = now()
  db.update(schema.narrationJobs).set({
    analysisJson: JSON.stringify(analysis),
    stage: 'segment',
    status: 'segmented',
    errorMsg: null,
    updatedAt: ts,
  }).where(eq(schema.narrationJobs.id, id)).run()
  applyAnalysisToSegments(id, analysis)
  packNarrationSegmentContentRefs(id, analysis)
}

// POST /narration/:id/segment — 切分旁白段（须已提取资产）
app.post('/:id/segment', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  try {
    await segmentAndBind(id, row)
    const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
    return success(c, formatJob(next!))
  } catch (err: any) {
    db.update(schema.narrationJobs).set({ errorMsg: err.message, updatedAt: now() })
      .where(eq(schema.narrationJobs.id, id)).run()
    return badRequest(c, err.message)
  }
})

// POST /narration/:id/resplit-segments — 按整句/台词时长规则重新切分（须未完成 TTS；保留已提取资产）
app.post('/:id/resplit-segments', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const hasTts = listNarrationSegments(id).some(s => s.ttsAudioPath)
  if (hasTts) return badRequest(c, '已完成 TTS，无法重新切分；请新建任务或手动在剪映中对齐')
  try {
    await segmentAndBind(id, row)
    const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
    return success(c, formatJob(next!))
  } catch (err: any) {
    db.update(schema.narrationJobs).set({ errorMsg: err.message, updatedAt: now() })
      .where(eq(schema.narrationJobs.id, id)).run()
    return badRequest(c, err.message)
  }
})

// POST /narration/:id/preview-voice — 音色试听（RunningHub）
app.post('/:id/preview-voice', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const body = await c.req.json().catch(() => ({}))
  const voiceId = String(body.voice_id || body.voice || '').trim()
  if (!voiceId) return badRequest(c, '请选择音色')
  if (!isRunningHubVoiceRef(voiceId)) {
    return badRequest(c, '请选择音色库参考音色后再试听')
  }
  const sampleText = String(body.text || '欢迎收听解说漫，这是一段音色试听。')
  try {
    const { path: audioPath } = await generateNarrationTTS({
      text: sampleText,
      voice: voiceId,
    })
    return success(c, { audio_url: `/${audioPath}`, voice_id: voiceId })
  } catch (err: any) {
    return badRequest(c, err.message || '试听失败')
  }
})

// POST /narration/:id/extract — 抽取角色/场景/道具 + 画面 Prompt
app.post('/:id/extract', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  try {
    const analysis = await extractNarrationEntities(id, row.novelText || '', row.narratorVoice)
    const ts = now()
    db.update(schema.narrationJobs).set({
      analysisJson: JSON.stringify(analysis),
      stage: 'extract',
      status: 'extracted',
      errorMsg: null,
      updatedAt: ts,
    }).where(eq(schema.narrationJobs.id, id)).run()
    applyAnalysisToSegments(id, analysis)
    packNarrationSegmentContentRefs(id, analysis)
    const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
    const linked = ensureNarrationLinkedDrama(next!)
    syncNarrationAssetsToDrama(linked)
    return success(c, formatJob(linked))
  } catch (err: any) {
    db.update(schema.narrationJobs).set({ errorMsg: err.message, updatedAt: now() })
      .where(eq(schema.narrationJobs.id, id)).run()
    return badRequest(c, err.message)
  }
})

// PATCH /narration/:id/analysis
app.patch('/:id/analysis', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const body = await c.req.json().catch(() => ({}))
  const analysis = body.analysis || body
  const ts = now()
  const narratorVoice = normalizeIndexTts2Voice(row.narratorVoice || defaultNarratorVoice(), 'narrator')
  ensureAnalysisVoices(analysis as NarrationAnalysis, narratorVoice)
  db.update(schema.narrationJobs).set({
    analysisJson: JSON.stringify(analysis),
    updatedAt: ts,
  }).where(eq(schema.narrationJobs.id, id)).run()
  applyAnalysisToSegments(id, analysis as NarrationAnalysis)
  packNarrationSegmentContentRefs(id, analysis as NarrationAnalysis)
  const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
  const linked = ensureNarrationLinkedDrama(next!)
  syncNarrationAssetsToDrama(linked)
  return success(c, formatJob(linked))
})

// POST /narration/:id/tts — 批量 RunningHub IndexTTS2
app.post('/:id/tts', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const segments = listNarrationSegments(id)
  if (!segments.length) return badRequest(c, '请先切分旁白段')

  const analysis = parseNarrationAnalysis(row.analysisJson)
  ensureAnalysisVoiceProfiles(analysis)
  let narratorVoice = String(row.narratorVoice || '').trim()
  let autoAssignments: ReturnType<typeof autoAssignNarrationVoices>['assignments'] = []

  if (!isRunningHubVoiceRef(narratorVoice)) {
    const auto = autoAssignNarrationVoices({
      analysis,
      narratorVoice,
      dramaId: row.dramaId,
      force: false,
    })
    narratorVoice = auto.narrator_voice
    autoAssignments = auto.assignments
    if (!isRunningHubVoiceRef(narratorVoice)) {
      return badRequest(c, '音色库中没有可用参考音频。请先上传旁白/角色参考音色，或点击「自动匹配音色」后重试。')
    }
  } else {
    // 已有旁白音色时，仍为缺少资产引用的角色自动匹配
    const auto = autoAssignNarrationVoices({
      analysis,
      narratorVoice,
      dramaId: row.dramaId,
      force: false,
    })
    autoAssignments = auto.assignments
  }

  assignCharacterVoices(analysis.characters, narratorVoice)
  db.update(schema.narrationJobs).set({
    narratorVoice,
    analysisJson: JSON.stringify(analysis),
    updatedAt: now(),
  }).where(eq(schema.narrationJobs.id, id)).run()

  let done = 0
  const errors: string[] = []

  for (const seg of segments) {
    try {
      const voice = seg.ttsVoice && isRunningHubVoiceRef(seg.ttsVoice)
        ? seg.ttsVoice
        : resolveSegmentVoice(narratorVoice, seg.segmentIndex, analysis)
      db.update(schema.narrationSegments).set({ status: 'tts_generating', updatedAt: now() })
        .where(eq(schema.narrationSegments.id, seg.id)).run()
      const { path: audioPath, durationSec } = await generateNarrationTTS({
        text: seg.text,
        voice,
      })
      db.update(schema.narrationSegments).set({
        ttsAudioPath: audioPath,
        ttsDurationSec: durationSec,
        ttsVoice: voice,
        status: 'tts_done',
        errorMsg: null,
        updatedAt: now(),
      }).where(eq(schema.narrationSegments.id, seg.id)).run()
      done += 1
    } catch (err: any) {
      errors.push(`段${seg.segmentIndex + 1}: ${err.message}`)
      db.update(schema.narrationSegments).set({
        status: 'failed',
        errorMsg: err.message,
        updatedAt: now(),
      }).where(eq(schema.narrationSegments.id, seg.id)).run()
    }
  }

  db.update(schema.narrationJobs).set({
    stage: 'tts',
    status: errors.length ? 'tts_partial' : 'tts_done',
    errorMsg: errors.length ? errors.join('; ') : null,
    updatedAt: now(),
  }).where(eq(schema.narrationJobs.id, id)).run()

  const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
  return success(c, {
    job: formatJob(next!),
    tts_done: done,
    errors,
    auto_voice_assignments: autoAssignments,
  })
})

// POST /narration/:id/auto-voices — 按性格/音色画像自动匹配音色库
app.post('/:id/auto-voices', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const body = await c.req.json().catch(() => ({}))
  const force = body.force === true || body.force === 1 || body.force === '1'
  const analysis = parseNarrationAnalysis(row.analysisJson)
  const result = autoAssignNarrationVoices({
    analysis,
    narratorVoice: row.narratorVoice,
    dramaId: row.dramaId,
    force,
  })
  if (!isRunningHubVoiceRef(result.narrator_voice)) {
    return badRequest(c, '音色库暂无可用参考音频，请先在资产库上传旁白/角色音色')
  }
  db.update(schema.narrationJobs).set({
    narratorVoice: result.narrator_voice,
    analysisJson: JSON.stringify(analysis),
    updatedAt: now(),
  }).where(eq(schema.narrationJobs.id, id)).run()
  const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
  return success(c, {
    job: formatJob(next!),
    narrator_voice: result.narrator_voice,
    assignments: result.assignments,
  })
})

// GET /narration/:id/asset-readiness
app.get('/:id/asset-readiness', (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const analysis = loadSyncedNarrationAnalysis(id, row.analysisJson)
  return success(c, listNarrationAssetReadiness(analysis))
})

// POST /narration/:id/assets/generate-all
app.post('/:id/assets/generate-all', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const analysis = parseNarrationAnalysis(row.analysisJson)
  if (!analysis.characters.length && !analysis.scenes.length && !analysis.props.length) {
    return badRequest(c, '请先完成实体抽取')
  }
  try {
    const result = await generateAllNarrationAssets(c, id, analysis, row.dramaId)
    db.update(schema.narrationJobs).set({ stage: 'assets', updatedAt: now() })
      .where(eq(schema.narrationJobs.id, id)).run()
    const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
    const linked = ensureNarrationLinkedDrama(next!)
    syncNarrationAssetsToDrama(linked)
    return success(c, { job: formatJob(linked), ...result })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// POST /narration/:id/assets/:type/:entityId/generate
app.post('/:id/assets/:type/:entityId/generate', async (c) => {
  const id = Number(c.req.param('id'))
  const type = String(c.req.param('type'))
  const entityId = String(c.req.param('entityId'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const analysis = parseNarrationAnalysis(row.analysisJson)
  try {
    let result: any
    if (type === 'characters') {
      result = await generateNarrationCharacterImage(c, id, entityId, analysis, row.dramaId)
    } else if (type === 'scenes') {
      result = await generateNarrationSceneImage(c, id, entityId, analysis, row.dramaId)
    } else if (type === 'props') {
      result = await generateNarrationPropImage(c, id, entityId, analysis, row.dramaId)
    } else {
      return badRequest(c, 'type 须为 characters / scenes / props')
    }
    if (result.error) return result.error
    db.update(schema.narrationJobs).set({ stage: 'assets', updatedAt: now() })
      .where(eq(schema.narrationJobs.id, id)).run()
    const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
    const linked = ensureNarrationLinkedDrama(next!)
    syncNarrationAssetsToDrama(linked)
    return success(c, { job: formatJob(linked), ...result })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// PATCH /narration/:id/segments/:segmentId
app.patch('/:id/segments/:segmentId', async (c) => {
  const jobId = Number(c.req.param('id'))
  const segmentId = Number(c.req.param('segmentId'))
  const row = getJobOr404(jobId)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  const [seg] = db.select().from(schema.narrationSegments).where(eq(schema.narrationSegments.id, segmentId)).all()
  if (!seg || seg.jobId !== jobId) return notFound(c, '分段不存在')
  const body = await c.req.json().catch(() => ({}))
  if (body.text != null && String(body.text) !== seg.text) {
    return badRequest(c, '朗读须使用小说原文，不可修改分段正文；请重新切分')
  }
  const patch: Record<string, unknown> = { updatedAt: now() }
  if (body.video_prompt != null) patch.videoPrompt = String(body.video_prompt)
  db.update(schema.narrationSegments).set(patch).where(eq(schema.narrationSegments.id, segmentId)).run()
  const [next] = db.select().from(schema.narrationSegments).where(eq(schema.narrationSegments.id, segmentId)).all()
  return success(c, { segment: formatSegment(next!, row.grokModel) })
})

async function generateNarrationSegmentVideo(
  c: Parameters<typeof getAuthUser>[0],
  jobId: number,
  segmentId: number,
) {
  const row = getJobOr404(jobId)
  if (!row) return { error: notFound(c, '任务不存在') }
  if (!assertJobAccess(c, row)) return { error: notFound(c, '任务不存在') }

  let channelId = row.grokChannel || 'geeknow'
  if (channelId === 'qilingze') {
    // 旧任务若仍绑启灵泽，生成时自动改用 GeekNow
    channelId = 'geeknow'
    db.update(schema.narrationJobs).set({
      grokChannel: 'geeknow',
      grokModel: getNarrationGrokChannelDef('geeknow').defaultModel,
      updatedAt: now(),
    }).where(eq(schema.narrationJobs.id, jobId)).run()
  }
  const channelDef = getNarrationGrokChannelDef(channelId)
  const model = (row.grokChannel === 'qilingze'
    ? channelDef.defaultModel
    : (row.grokModel || channelDef.defaultModel))
  const resolved = resolveNarrationGrokConfigId({
    channel: channelId,
    model,
  })
  if (!resolved) {
    return { error: badRequest(c, `未配置 ${channelDef.label} Grok 视频服务，请在设置中添加对应上游`) }
  }
  const grokConfig = getConfigById(resolved.configId, { includeInactive: true })
  try {
    assertNarrationGrokApiKey(grokConfig, channelDef.label)
  } catch (err: any) {
    return { error: badRequest(c, err.message || `${channelDef.label} API Key 无效`) }
  }

  const [seg] = db.select().from(schema.narrationSegments).where(eq(schema.narrationSegments.id, segmentId)).all()
  if (!seg || seg.jobId !== jobId) return { error: notFound(c, '分段不存在') }
  if (!seg.videoPrompt?.trim()) return { error: badRequest(c, '分段画面 Prompt 为空') }

  const analysis = loadSyncedNarrationAnalysis(jobId, row.analysisJson)
  const { contentRefs, promptPrefix } = buildNarrationSegmentContentRefs(analysis, seg.segmentIndex)
  const videoPrompt = [promptPrefix, seg.videoPrompt.trim()].filter(Boolean).join('')

  db.update(schema.narrationSegments).set({
    contentRefs: JSON.stringify(contentRefs),
    updatedAt: now(),
  }).where(eq(schema.narrationSegments.id, segmentId)).run()

  const creditAction = resolveGrokVideoCreditAction(resolved.model)
  const billed = tryChargeUser(c, creditAction, {
    summary: `解说漫 Grok(${channelDef.label}) #${seg.segmentIndex + 1}`,
    dramaId: row.dramaId ?? undefined,
    resourceType: 'narration_segment',
    resourceId: segmentId,
  })
  if (billed.error) return { error: billed.error }

  const bounds = grokVideoDurationBounds(resolved.model)
  const duration = Math.min(bounds.max, Math.max(bounds.min, Math.round(Number(seg.ttsDurationSec) || bounds.defaultSec)))

  try {
    db.update(schema.narrationSegments).set({ status: 'generating', errorMsg: null, updatedAt: now() })
      .where(eq(schema.narrationSegments.id, segmentId)).run()

    const genId = await generateVideo({
      dramaId: row.dramaId ?? undefined,
      prompt: videoPrompt,
      model: resolved.model,
      provider: resolved.provider,
      configId: resolved.configId,
      duration,
      aspectRatio: row.aspectRatio || '9:16',
      contentRefs,
      creditTransactionId: billed.charge.transactionId,
      userId: getAuthUser(c).id,
    })

    db.update(schema.narrationSegments).set({
      videoGenerationId: genId,
      status: 'generating',
      updatedAt: now(),
    }).where(eq(schema.narrationSegments.id, segmentId)).run()

    db.update(schema.narrationJobs).set({ stage: 'generate', status: 'generating', updatedAt: now() })
      .where(eq(schema.narrationJobs.id, jobId)).run()

    const [next] = db.select().from(schema.narrationSegments).where(eq(schema.narrationSegments.id, segmentId)).all()
    return {
      segment: formatSegment(next!, row.grokModel),
      video_generation_id: genId,
      credits_balance: billed.charge.balance,
    }
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '解说漫 Grok 失败退款',
      resourceType: 'narration_segment',
      resourceId: segmentId,
      metadata: { reason: err.message },
    })
    db.update(schema.narrationSegments).set({ status: 'failed', errorMsg: err.message, updatedAt: now() })
      .where(eq(schema.narrationSegments.id, segmentId)).run()
    return { error: badRequest(c, err.message) }
  }
}

// POST /narration/:id/segments/:segmentId/generate — Grok 单段
app.post('/:id/segments/:segmentId/generate', async (c) => {
  const jobId = Number(c.req.param('id'))
  const segmentId = Number(c.req.param('segmentId'))
  const result = await generateNarrationSegmentVideo(c, jobId, segmentId)
  if (result.error) return result.error
  return success(c, result)
})

// POST /narration/:id/generate-all
app.post('/:id/generate-all', async (c) => {
  const jobId = Number(c.req.param('id'))
  const row = getJobOr404(jobId)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')

  const segments = listNarrationSegments(jobId)
    .filter(s => s.videoPrompt?.trim() && s.status !== 'completed' && s.status !== 'generating')

  let queued = 0
  const errors: string[] = []
  for (const seg of segments) {
    const result = await generateNarrationSegmentVideo(c, jobId, seg.id)
    if (result.error) errors.push(`段${seg.segmentIndex + 1}`)
    else queued += 1
  }

  const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, jobId)).all()
  return success(c, { job: formatJob(next!), queued, errors })
})

// POST /narration/:id/export-jianying
app.post('/:id/export-jianying', (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '任务不存在')
  try {
    syncSegmentVideos(id)
    const { draftPath, zipPath } = exportJianyingDraft(id, row.title)
    db.update(schema.narrationJobs).set({
      jianyingDraftPath: draftPath,
      stage: 'export',
      status: 'exported',
      errorMsg: null,
      updatedAt: now(),
    }).where(eq(schema.narrationJobs.id, id)).run()
    const [next] = db.select().from(schema.narrationJobs).where(eq(schema.narrationJobs.id, id)).all()
    return success(c, {
      ...formatJob(next!),
      jianying_zip_url: `/${zipPath}`,
      download_filename: `${String(row.title || `解说漫_${id}`).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40)}_剪映草稿.zip`,
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

export default app
