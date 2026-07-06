import { Hono } from 'hono'
import { desc, eq, isNull } from 'drizzle-orm'
import ffmpeg from 'fluent-ffmpeg'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now } from '../utils/response.js'
import { saveUploadedFile } from '../utils/storage.js'
import { ensureFfmpegConfigured } from '../utils/ffmpeg-path.js'
import { resolveMediaFilePath } from '../utils/media-path.js'
import { getAuthUser } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { ensureUserInDefaultTeam } from '../services/teams.js'
import { normalizeDirectorStyle } from '../prompts/director-styles.js'
import { toSnakeCase } from '../utils/transform.js'
import { runRepaintAnalysis } from '../services/repaint-analysis.js'
import { parseRepaintAnalysis, type RepaintAnalysis } from '../services/repaint-types.js'
import { syncRepaintEntitiesToDrama } from '../services/repaint-entities.js'
import { logTaskError, logTaskStart } from '../utils/task-logger.js'
import { trySyncStaticToOss } from '../utils/oss-entity-sync.js'
import {
  rebuildRepaintSegments,
  getRepaintDefaultVideoModel,
} from '../services/repaint-segments.js'
import { generateVideo } from '../services/video-generation.js'
import { tryChargeUser, tryRefundCharge } from '../utils/credit-charge.js'
import { getDramaImageAspectRatio } from '../utils/image-size.js'
import { chengmengModelCreditAction } from '../constants/chengmeng.js'
import type { VideoContentRef } from '../utils/seedance-content.js'

const app = new Hono()

const MAX_SOURCE_DURATION_SEC = 300

const STAGE_ORDER = ['upload', 'analysis', 'assets', 'prompts', 'generate', 'merge', 'completed'] as const

function stageIndex(stage: string) {
  const idx = STAGE_ORDER.indexOf(stage as typeof STAGE_ORDER[number])
  return idx >= 0 ? idx : 0
}

function formatJob(row: typeof schema.videoRepaintJobs.$inferSelect) {
  const analysis = parseRepaintAnalysis(row.analysisJson)
  return toSnakeCase({
    ...row,
    analysis,
    source_video_url: row.sourceVideoPath ? `/${row.sourceVideoPath}` : null,
    merged_video_url: row.mergedVideoPath ? `/${row.mergedVideoPath}` : null,
  })
}

function getJobOr404(id: number) {
  const [row] = db.select().from(schema.videoRepaintJobs)
    .where(eq(schema.videoRepaintJobs.id, id))
    .all()
  if (!row || row.deletedAt) return null
  return row
}

function assertJobAccess(c: Parameters<typeof getAuthUser>[0], row: typeof schema.videoRepaintJobs.$inferSelect) {
  const user = getAuthUser(c)
  if (user.role === 'admin') return user
  if (row.userId !== user.id) return null
  return user
}

async function probeVideoDuration(relativePath: string): Promise<number> {
  const filePath = resolveMediaFilePath(relativePath)
  if (!filePath) return 0
  ensureFfmpegConfigured()
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        resolve(0)
        return
      }
      const duration = Number(metadata.format?.duration || 0)
      resolve(duration > 0 ? Math.round(duration * 10) / 10 : 0)
    })
  })
}

function createRepaintDrama(userId: number, teamId: number | null, title: string) {
  const ts = now()
  const res = db.insert(schema.dramas).values({
    title,
    description: '视频转绘自动创建的项目空间，用于角色/场景/道具与分段生成',
    style: 'realistic',
    metadata: JSON.stringify({ source: 'video_repaint' }),
    directorStyle: normalizeDirectorStyle('north_america_director'),
    teamId,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const dramaId = Number(res.lastInsertRowid)
  const epRes = db.insert(schema.episodes).values({
    dramaId,
    episodeNumber: 1,
    title: '转绘',
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }).run()
  return { dramaId, episodeId: Number(epRes.lastInsertRowid), ts }
}

// GET /repaint — 转绘任务列表
app.get('/', (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const rows = db.select().from(schema.videoRepaintJobs)
    .where(isNull(schema.videoRepaintJobs.deletedAt))
    .orderBy(desc(schema.videoRepaintJobs.updatedAt))
    .all()
    .filter((row) => {
      if (user.role === 'admin') return true
      if (teamId != null && row.teamId === teamId) return true
      return row.userId === user.id
    })

  return success(c, { items: rows.map(formatJob) })
})

// POST /repaint — 上传原片并创建任务
app.post('/', async (c) => {
  const user = getAuthUser(c)
  let teamId = resolveActiveTeamId(c, user)
  if (teamId == null) teamId = ensureUserInDefaultTeam(user.id)

  const body = await c.req.parseBody()
  const file = body['file']
  if (!file || !(file instanceof File)) return badRequest(c, '请上传视频文件')

  const mime = String(file.type || '').toLowerCase()
  const lowerName = String(file.name || '').toLowerCase()
  const isVideo = mime.startsWith('video/')
    || lowerName.endsWith('.mp4')
    || lowerName.endsWith('.mov')
    || lowerName.endsWith('.webm')
    || lowerName.endsWith('.m4v')
  if (!isVideo) return badRequest(c, '仅支持 MP4 / MOV / WebM / M4V')

  const titleRaw = String(body['title'] || '').trim()
  const baseName = file.name.replace(/\.[^.]+$/, '') || '未命名转绘'
  const title = titleRaw || baseName

  const buffer = await file.arrayBuffer()
  const path = await saveUploadedFile(buffer, 'uploads/repaint', file.name)
  const duration = await probeVideoDuration(path)
  if (duration <= 0) return badRequest(c, '无法读取视频时长，请确认文件有效')
  if (duration > MAX_SOURCE_DURATION_SEC) {
    return badRequest(c, `原片时长不能超过 ${MAX_SOURCE_DURATION_SEC / 60} 分钟（当前 ${Math.ceil(duration)} 秒）`)
  }

  const { dramaId, episodeId, ts } = createRepaintDrama(user.id, teamId, `转绘 · ${title}`)

  const res = db.insert(schema.videoRepaintJobs).values({
    title,
    dramaId,
    episodeId,
    userId: user.id,
    teamId,
    status: 'uploaded',
    stage: 'upload',
    sourceVideoPath: path,
    sourceDuration: duration,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const jobId = Number(res.lastInsertRowid)
  logActivity(user, {
    action: 'repaint.create',
    summary: `创建视频转绘：${title}`,
    resourceType: 'repaint_job',
    resourceId: jobId,
    dramaId,
  })

  const [createdJob] = db.select().from(schema.videoRepaintJobs)
    .where(eq(schema.videoRepaintJobs.id, jobId)).all()

  return created(c, formatJob(createdJob))
})

// GET /repaint/:id
app.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '转绘任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '转绘任务不存在')

  return success(c, formatJob(row))
})

// PATCH /repaint/:id — 更新标题等
app.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '转绘任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '转绘任务不存在')

  const body = await c.req.json().catch(() => ({}))
  const updates: Partial<typeof schema.videoRepaintJobs.$inferInsert> = { updatedAt: now() }
  if (body.title?.trim()) updates.title = String(body.title).trim()

  db.update(schema.videoRepaintJobs).set(updates).where(eq(schema.videoRepaintJobs.id, id)).run()
  const [next] = db.select().from(schema.videoRepaintJobs).where(eq(schema.videoRepaintJobs.id, id)).all()
  return success(c, formatJob(next!))
})

function advanceStage(row: typeof schema.videoRepaintJobs.$inferSelect, targetStage: string) {
  const currentIdx = stageIndex(row.stage)
  const targetIdx = stageIndex(targetStage)
  if (targetIdx < currentIdx) {
    throw new Error('不能回退到尚未解锁的步骤，请在页面内编辑当前步骤内容')
  }
  const ts = now()
  const status = targetStage === 'completed' ? 'completed' : row.status === 'failed' ? 'uploaded' : row.status
  db.update(schema.videoRepaintJobs).set({
    stage: targetStage,
    status: targetStage === 'completed' ? 'completed' : status,
    updatedAt: ts,
    errorMsg: null,
  }).where(eq(schema.videoRepaintJobs.id, row.id)).run()
}

// PATCH /repaint/:id/analysis — 编辑分析结果（镜头/台词/实体草稿）
app.patch('/:id/analysis', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '转绘任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '转绘任务不存在')

  const body = await c.req.json().catch(() => ({}))
  const current = parseRepaintAnalysis(row.analysisJson) || {
    version: 1 as const,
    shots: [],
    utterances: [],
    characters: [],
    scenes: [],
    props: [],
    shot_assignments: [],
  }

  const next: RepaintAnalysis = {
    ...current,
    version: 1,
    shots: Array.isArray(body.shots) ? body.shots : current.shots,
    utterances: Array.isArray(body.utterances) ? body.utterances : current.utterances,
    characters: Array.isArray(body.characters) ? body.characters : current.characters,
    scenes: Array.isArray(body.scenes) ? body.scenes : current.scenes,
    props: Array.isArray(body.props) ? body.props : current.props,
    shot_assignments: Array.isArray(body.shot_assignments)
      ? body.shot_assignments
      : current.shot_assignments,
    shot_visuals: Array.isArray(body.shot_visuals) ? body.shot_visuals : current.shot_visuals,
  }

  db.update(schema.videoRepaintJobs).set({
    analysisJson: JSON.stringify(next),
    status: 'analyzed',
    stage: 'analysis',
    updatedAt: now(),
  }).where(eq(schema.videoRepaintJobs.id, id)).run()

  const [updated] = db.select().from(schema.videoRepaintJobs).where(eq(schema.videoRepaintJobs.id, id)).all()
  return success(c, formatJob(updated!))
})

// POST /repaint/:id/analyze — 切镜 + ASR + 实体抽取
app.post('/:id/analyze', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '转绘任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '转绘任务不存在')
  if (!row.sourceVideoPath) return badRequest(c, '缺少原片')

  const body = await c.req.json().catch(() => ({}))
  const skipAsr = !!body.skip_asr

  db.update(schema.videoRepaintJobs).set({
    status: 'analyzing',
    errorMsg: null,
    updatedAt: now(),
  }).where(eq(schema.videoRepaintJobs.id, id)).run()

  logTaskStart('RepaintAPI', 'analyze', { jobId: id, skipAsr })

  try {
    await trySyncStaticToOss(row.sourceVideoPath, row.dramaId ?? undefined)
    const analysis = await runRepaintAnalysis({
      sourceVideoPath: row.sourceVideoPath,
      sourceDuration: row.sourceDuration || 0,
      dramaId: row.dramaId,
      skipAsr,
    })

    db.update(schema.videoRepaintJobs).set({
      status: 'analyzed',
      stage: 'analysis',
      analysisJson: JSON.stringify(analysis),
      errorMsg: null,
      updatedAt: now(),
    }).where(eq(schema.videoRepaintJobs.id, id)).run()
  } catch (err: any) {
    logTaskError('RepaintAPI', 'analyze', { jobId: id, error: err.message })
    db.update(schema.videoRepaintJobs).set({
      status: 'failed',
      errorMsg: err.message || '分析失败',
      updatedAt: now(),
    }).where(eq(schema.videoRepaintJobs.id, id)).run()
    return badRequest(c, err.message || '分析失败')
  }

  const [next] = db.select().from(schema.videoRepaintJobs).where(eq(schema.videoRepaintJobs.id, id)).all()
  return success(c, formatJob(next!))
})

// POST /repaint/:id/confirm — 检查点确认，进入下一阶段
app.post('/:id/confirm', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '转绘任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '转绘任务不存在')

  const body = await c.req.json().catch(() => ({}))
  const stage = String(body.stage || '').trim()
  const nextMap: Record<string, string> = {
    analysis: 'assets',
    assets: 'prompts',
    prompts: 'generate',
    generate: 'merge',
    merge: 'completed',
  }
  const nextStage = nextMap[stage]
  if (!nextStage) return badRequest(c, '无效的 stage')

  if (stageIndex(row.stage) < stageIndex(stage)) {
    return badRequest(c, '请先完成当前步骤')
  }

  let analysisJson = row.analysisJson
  if (stage === 'analysis' && row.dramaId && row.episodeId && row.analysisJson) {
    const parsed = parseRepaintAnalysis(row.analysisJson)
    if (parsed) {
      const synced = syncRepaintEntitiesToDrama(row.dramaId, row.episodeId, parsed)
      analysisJson = JSON.stringify(synced)
      db.update(schema.videoRepaintJobs).set({
        analysisJson,
        updatedAt: now(),
      }).where(eq(schema.videoRepaintJobs.id, id)).run()
    }
  }

  if (stage === 'assets' && row.dramaId && analysisJson) {
    const parsed = parseRepaintAnalysis(analysisJson)
    if (parsed?.shots?.length) {
      await rebuildRepaintSegments(id, parsed, row.dramaId)
    }
  }

  try {
    advanceStage(row, nextStage)
  } catch (err: any) {
    return badRequest(c, err.message)
  }

  const user = getAuthUser(c)
  logActivity(user, {
    action: 'repaint.confirm',
    summary: `转绘确认步骤：${stage} → ${nextStage}`,
    resourceType: 'repaint_job',
    resourceId: id,
    dramaId: row.dramaId ?? undefined,
    metadata: { from: stage, to: nextStage },
  })

  const [next] = db.select().from(schema.videoRepaintJobs).where(eq(schema.videoRepaintJobs.id, id)).all()
  return success(c, formatJob(next!))
})

// GET /repaint/:id/asset-readiness — 资产就绪检查（复用 drama 实体）
app.get('/:id/asset-readiness', (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '转绘任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '转绘任务不存在')
  if (!row.dramaId) return success(c, { ready: false, missing: [], message: '未绑定项目' })

  const analysis = parseRepaintAnalysis(row.analysisJson)
  const expectedChars = analysis?.characters?.length || 0
  const expectedScenes = analysis?.scenes?.length || 0
  const expectedProps = analysis?.props?.length || 0

  const chars = db.select().from(schema.characters)
    .where(eq(schema.characters.dramaId, row.dramaId)).all()
    .filter(item => !item.deletedAt)
  const scenes = db.select().from(schema.scenes)
    .where(eq(schema.scenes.dramaId, row.dramaId)).all()
    .filter(item => !item.deletedAt)
  const props = db.select().from(schema.props)
    .where(eq(schema.props.dramaId, row.dramaId)).all()
    .filter(item => !item.deletedAt)

  const missing: Array<{ type: string; id: number; name: string; reason: string; draft_id?: string }> = []
  for (const char of chars) {
    if (!char.imageUrl && !char.localPath) {
      missing.push({ type: 'character', id: char.id, name: char.name, reason: '缺少四视图定妆照' })
    }
  }
  for (const scene of scenes) {
    if (!scene.imageUrl && !scene.localPath) {
      missing.push({ type: 'scene', id: scene.id, name: scene.location, reason: '缺少场景主图' })
    }
  }
  for (const prop of props) {
    if (!prop.imageUrl && !prop.localPath) {
      missing.push({ type: 'prop', id: prop.id, name: prop.name, reason: '缺少道具图' })
    }
  }

  if (analysis) {
    for (const draft of analysis.characters) {
      if (draft.character_id && !missing.some(m => m.type === 'character' && m.id === draft.character_id)) continue
      if (!draft.character_id) {
        missing.push({
          type: 'character',
          id: draft.character_id || 0,
          draft_id: draft.id,
          name: draft.name,
          reason: '尚未同步到项目，请确认分析步骤',
        })
      }
    }
  }

  const needEntities = expectedChars + expectedScenes + expectedProps
  const ready = needEntities === 0 ? missing.length === 0 : missing.length === 0 && chars.length + scenes.length + props.length > 0

  return success(c, {
    ready,
    missing,
    counts: {
      characters: chars.length,
      scenes: scenes.length,
      props: props.length,
      expected_characters: expectedChars,
      expected_scenes: expectedScenes,
      expected_props: expectedProps,
    },
  })
})

function formatSegment(row: typeof schema.videoRepaintSegments.$inferSelect) {
  let shotIds: string[] = []
  let contentRefs: VideoContentRef[] = []
  try {
    if (row.shotIds) shotIds = JSON.parse(row.shotIds)
  } catch { /* ignore */ }
  try {
    if (row.contentRefs) contentRefs = JSON.parse(row.contentRefs)
  } catch { /* ignore */ }

  let videoGen: typeof schema.videoGenerations.$inferSelect | null = null
  if (row.videoGenerationId) {
    [videoGen] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, row.videoGenerationId)).all()
  }

  return toSnakeCase({
    ...row,
    shot_ids: shotIds,
    content_refs: contentRefs,
    video_url: videoGen?.localPath ? `/${videoGen.localPath}` : videoGen?.videoUrl,
    video_status: videoGen?.status,
    video_error: videoGen?.errorMsg,
  })
}

function listJobSegments(jobId: number) {
  return db.select().from(schema.videoRepaintSegments)
    .where(eq(schema.videoRepaintSegments.jobId, jobId))
    .all()
    .sort((a, b) => a.segmentIndex - b.segmentIndex)
}

// GET /repaint/:id/segments
app.get('/:id/segments', (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '转绘任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '转绘任务不存在')
  return success(c, { items: listJobSegments(id).map(formatSegment) })
})

// POST /repaint/:id/segments/build — 重新打包分段与 Prompt
app.post('/:id/segments/build', async (c) => {
  const id = Number(c.req.param('id'))
  const row = getJobOr404(id)
  if (!row) return notFound(c, '转绘任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '转绘任务不存在')
  if (!row.dramaId) return badRequest(c, '未绑定项目')
  const analysis = parseRepaintAnalysis(row.analysisJson)
  if (!analysis?.shots?.length) return badRequest(c, '请先完成分析')

  const items = await rebuildRepaintSegments(id, analysis, row.dramaId)
  return success(c, { items: items.map(formatSegment) })
})

// PATCH /repaint/:id/segments/:segmentId
app.patch('/:id/segments/:segmentId', async (c) => {
  const jobId = Number(c.req.param('id'))
  const segmentId = Number(c.req.param('segmentId'))
  const row = getJobOr404(jobId)
  if (!row) return notFound(c, '转绘任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '转绘任务不存在')

  const [seg] = db.select().from(schema.videoRepaintSegments)
    .where(eq(schema.videoRepaintSegments.id, segmentId)).all()
  if (!seg || seg.jobId !== jobId) return notFound(c, '分段不存在')

  const body = await c.req.json().catch(() => ({}))
  const updates: Partial<typeof schema.videoRepaintSegments.$inferInsert> = { updatedAt: now() }
  if (body.video_prompt != null) updates.videoPrompt = String(body.video_prompt)
  if (body.status) updates.status = String(body.status)

  db.update(schema.videoRepaintSegments).set(updates)
    .where(eq(schema.videoRepaintSegments.id, segmentId)).run()

  const [next] = db.select().from(schema.videoRepaintSegments)
    .where(eq(schema.videoRepaintSegments.id, segmentId)).all()
  return success(c, formatSegment(next!))
})

// POST /repaint/:id/segments/:segmentId/generate — 通道1 生成该段
app.post('/:id/segments/:segmentId/generate', async (c) => {
  const jobId = Number(c.req.param('id'))
  const segmentId = Number(c.req.param('segmentId'))
  const row = getJobOr404(jobId)
  if (!row) return notFound(c, '转绘任务不存在')
  if (!assertJobAccess(c, row)) return notFound(c, '转绘任务不存在')
  if (!row.dramaId) return badRequest(c, '未绑定项目')

  const [seg] = db.select().from(schema.videoRepaintSegments)
    .where(eq(schema.videoRepaintSegments.id, segmentId)).all()
  if (!seg || seg.jobId !== jobId) return notFound(c, '分段不存在')
  if (!seg.videoPrompt?.trim()) return badRequest(c, '分段 Prompt 为空')

  let contentRefs: VideoContentRef[] = []
  try {
    contentRefs = seg.contentRefs ? JSON.parse(seg.contentRefs) : []
  } catch { /* ignore */ }
  if (!contentRefs.length) return badRequest(c, '分段缺少参考图，请确认角色/场景/道具已生成图片后重新打包分段')

  const model = getRepaintDefaultVideoModel()
  const creditAction = chengmengModelCreditAction(model)
  const billed = tryChargeUser(c, creditAction, {
    summary: `转绘分段生成 #${seg.segmentIndex + 1}`,
    dramaId: row.dramaId,
    resourceType: 'repaint_segment',
    resourceId: segmentId,
  })
  if (billed.error) return billed.error

  const aspectRatio = getDramaImageAspectRatio(row.dramaId)

  try {
    db.update(schema.videoRepaintSegments).set({
      status: 'generating',
      errorMsg: null,
      updatedAt: now(),
    }).where(eq(schema.videoRepaintSegments.id, segmentId)).run()

    const genId = await generateVideo({
      dramaId: row.dramaId,
      prompt: seg.videoPrompt,
      model,
      provider: 'chengmeng',
      contentRefs,
      duration: Math.round(Number(seg.durationSec) || 5),
      aspectRatio,
      creditTransactionId: billed.charge.transactionId,
      userId: getAuthUser(c).id,
    })

    db.update(schema.videoRepaintSegments).set({
      videoGenerationId: genId,
      status: 'generating',
      updatedAt: now(),
    }).where(eq(schema.videoRepaintSegments.id, segmentId)).run()

    const [next] = db.select().from(schema.videoRepaintSegments)
      .where(eq(schema.videoRepaintSegments.id, segmentId)).all()
    return success(c, {
      segment: formatSegment(next!),
      video_generation_id: genId,
      credits_balance: billed.charge.balance,
    })
  } catch (err: any) {
    tryRefundCharge(billed.charge.transactionId, {
      summary: '转绘分段生成失败退款',
      dramaId: row.dramaId,
      resourceType: 'repaint_segment',
      resourceId: segmentId,
      metadata: { reason: err.message },
    })
    db.update(schema.videoRepaintSegments).set({
      status: 'failed',
      errorMsg: err.message,
      updatedAt: now(),
    }).where(eq(schema.videoRepaintSegments.id, segmentId)).run()
    return badRequest(c, err.message)
  }
})

export default app
