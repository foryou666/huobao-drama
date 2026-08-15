import { Hono } from 'hono'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import ffmpeg from 'fluent-ffmpeg'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now, forbidden } from '../utils/response.js'
import { downloadFile, saveUploadedFile } from '../utils/storage.js'
import { ensureFfmpegConfigured } from '../utils/ffmpeg-path.js'
import { resolveMediaFilePath } from '../utils/media-path.js'
import { getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { getTeamMemberUserIds } from '../services/team-audit.js'
import {
  mimeForStaticPath,
  openMediaReadStream,
  sanitizeDownloadFilename,
} from '../utils/media-download.js'
import { Readable } from 'stream'
import fs from 'fs'
import { tryChargeUser } from '../utils/credit-charge.js'
import { getActionCost, getUserBalance } from '../services/credits.js'
import {
  CREDIT_ACTIONS,
  resolveVideoUpscaleSeedvr2CreditCost,
  resolveVideoUpscaleFunshion2kCreditCost,
  VIDEO_UPSCALE_SEEDVR2_CREDITS_PER_SECOND,
} from '../constants/credit-actions.js'
import {
  RUNNINGHUB_SEEDVR2_INSTANCE_TYPE,
  SEEDVR2_MAX_DURATION_SEC,
  SEEDVR2_MAX_FILE_BYTES,
  SEEDVR2_MAX_FILES_PER_BATCH,
} from '../constants/runninghub-seedvr2.js'
import {
  FUNSHION_ENHANCE_CLARITY,
  FUNSHION_ENHANCE_INSTANCE_TYPE,
} from '../constants/funshion-web.js'
import { resolveRunningHubIndexTts2Config } from '../services/runninghub-indextts2-config.js'
import {
  AVG_UPSCALE_JOB_SEC,
  formatVideoUpscaleJob,
  formatVideoUpscaleJobs,
  processVideoUpscaleJob,
} from '../services/video-upscale-seedvr2.js'
import {
  getRunningHubConcurrencySnapshot,
  RUNNINGHUB_CONCURRENCY,
} from '../services/runninghub-concurrency.js'

const app = new Hono<{ Variables: AuthVariables }>()

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

function assertAccess(c: Parameters<typeof getAuthUser>[0], row: typeof schema.videoUpscaleJobs.$inferSelect) {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  if (user.role === 'admin') return user
  if (row.userId === user.id) return user
  if (teamId != null && row.teamId === teamId) return user
  return null
}

function resolveCreditsPerSecond() {
  return getActionCost(CREDIT_ACTIONS.VIDEO_UPSCALE_SEEDVR2, 1) || VIDEO_UPSCALE_SEEDVR2_CREDITS_PER_SECOND
}

// GET /video-upscale/meta
app.get('/meta', (c) => {
  let ready = false
  let detail = '服务暂未就绪，请联系管理员'
  try {
    resolveRunningHubIndexTts2Config()
    ready = true
    detail = '已就绪'
  } catch {
    detail = '服务暂未就绪，请联系管理员'
  }
  const creditsPerSecond = resolveCreditsPerSecond()
  const concurrency = getRunningHubConcurrencySnapshot()
  return success(c, {
    ready,
    detail,
    max_files: SEEDVR2_MAX_FILES_PER_BATCH,
    max_duration_sec: SEEDVR2_MAX_DURATION_SEC,
    max_file_bytes: SEEDVR2_MAX_FILE_BYTES,
    credits_per_second: creditsPerSecond,
    accept: 'video/mp4,.mp4',
    avg_job_sec: AVG_UPSCALE_JOB_SEC,
    concurrency: {
      upscale_limit: RUNNINGHUB_CONCURRENCY.upscale,
      tts_limit: RUNNINGHUB_CONCURRENCY.tts,
      account_total: RUNNINGHUB_CONCURRENCY.total,
      active_upscale: concurrency.active.upscale,
      active_tts: concurrency.active.tts,
      waiting: concurrency.waiting,
    },
  })
})

// GET /video-upscale/balance — 当前积分（页面「账户剩余」）
app.get('/balance', (c) => {
  const user = getAuthUser(c)
  return success(c, {
    balance: getUserBalance(user.id),
    credits_per_second: resolveCreditsPerSecond(),
  })
})

// GET /video-upscale — 任务列表
app.get('/', (c) => {
  const user = getAuthUser(c)
  const status = String(c.req.query('status') || '').trim()
  const range = String(c.req.query('range') || 'week').trim() // week | month | all
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') || 20) || 20))
  const offset = Math.max(0, Number(c.req.query('offset') || 0) || 0)

  const conditions = [isNull(schema.videoUpscaleJobs.deletedAt)]
  if (user.role !== 'admin') {
    conditions.push(eq(schema.videoUpscaleJobs.userId, user.id))
  }
  if (status && status !== 'all') {
    if (status === 'processing') {
      conditions.push(sql`${schema.videoUpscaleJobs.status} IN ('queued','uploading','processing')`)
    } else {
      conditions.push(eq(schema.videoUpscaleJobs.status, status))
    }
  }
  if (range === 'week') {
    conditions.push(sql`${schema.videoUpscaleJobs.createdAt} >= datetime('now', '-7 days')`)
  } else if (range === 'month') {
    conditions.push(sql`${schema.videoUpscaleJobs.createdAt} >= datetime('now', '-30 days')`)
  }

  const where = and(...conditions)
  const rows = db.select().from(schema.videoUpscaleJobs)
    .where(where)
    .orderBy(desc(schema.videoUpscaleJobs.id))
    .limit(limit)
    .offset(offset)
    .all()

  const statsBase = [isNull(schema.videoUpscaleJobs.deletedAt)]
  if (user.role !== 'admin') statsBase.push(eq(schema.videoUpscaleJobs.userId, user.id))
  const all = db.select({
    status: schema.videoUpscaleJobs.status,
  }).from(schema.videoUpscaleJobs).where(and(...statsBase)).all()

  let processing = 0
  let completed = 0
  let failed = 0
  for (const item of all) {
    if (item.status === 'completed') completed += 1
    else if (item.status === 'failed') failed += 1
    else processing += 1
  }

  return success(c, {
    items: formatVideoUpscaleJobs(rows),
    total: all.length,
    stats: { processing, completed, failed, total: all.length },
    pagination: { limit, offset, has_more: offset + rows.length < all.length },
  })
})

// POST /video-upscale — 上传并提交（支持多文件，字段名 files）
app.post('/', async (c) => {
  const user = getAuthUser(c)
  try {
    resolveRunningHubIndexTts2Config()
  } catch (err: any) {
    return badRequest(c, '服务暂未就绪，请联系管理员')
  }

  const body = await c.req.parseBody({ all: true })
  const rawFiles = body.files ?? body.file
  const fileList = Array.isArray(rawFiles) ? rawFiles : (rawFiles ? [rawFiles] : [])
  const files = fileList.filter((f): f is File => f instanceof File)
  if (!files.length) return badRequest(c, '请上传 MP4 视频')
  if (files.length > SEEDVR2_MAX_FILES_PER_BATCH) {
    return badRequest(c, `单次最多 ${SEEDVR2_MAX_FILES_PER_BATCH} 个文件`)
  }

  const teamId = resolveActiveTeamId(c, user)
  const createdJobs = []

  for (const file of files) {
    const name = String(file.name || 'video.mp4')
    if (!/\.mp4$/i.test(name) && file.type && !file.type.includes('mp4')) {
      return badRequest(c, `仅支持 MP4：${name}`)
    }
    if (file.size > SEEDVR2_MAX_FILE_BYTES) {
      return badRequest(c, `文件过大（上限 500MB）：${name}`)
    }

    const buffer = await file.arrayBuffer()
    const path = await saveUploadedFile(buffer, 'uploads/video-upscale', name)
    const duration = await probeVideoDuration(path)
    if (duration > SEEDVR2_MAX_DURATION_SEC) {
      return badRequest(c, `单个文件时长不能超过 3 分钟：${name}`)
    }

    const billedSeconds = Math.max(1, Math.ceil(duration || 1))
    const cost = getActionCost(CREDIT_ACTIONS.VIDEO_UPSCALE_SEEDVR2, billedSeconds)
      || resolveVideoUpscaleSeedvr2CreditCost(duration)
    const charged = tryChargeUser(c, CREDIT_ACTIONS.VIDEO_UPSCALE_SEEDVR2, {
      summary: `视频超分 ${name}`,
      quantity: billedSeconds,
      flatCost: cost,
      metadata: {
        filename: name,
        duration_sec: duration,
        billing_unit: 'second',
        provider: 'runninghub_seedvr25',
      },
    })
    if (charged.error) return charged.error

    const ts = now()
    const insert = db.insert(schema.videoUpscaleJobs).values({
      title: name,
      userId: user.id,
      teamId: teamId ?? null,
      status: 'queued',
      sourceVideoPath: path,
      durationSec: duration || null,
      fileSize: file.size,
      instanceType: RUNNINGHUB_SEEDVR2_INSTANCE_TYPE,
      creditTransactionId: charged.charge.transactionId ?? null,
      progress: 0,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    const id = Number(insert.lastInsertRowid)
    createdJobs.push(id)

    logActivity(user, {
      action: 'video.upscale.seedvr25.submit',
      summary: `提交视频超分 #${id}`,
      resourceType: 'video_upscale',
      resourceId: id,
      creditCost: cost,
    })

    void processVideoUpscaleJob(id)
  }

  const rows = createdJobs.length
    ? db.select().from(schema.videoUpscaleJobs)
      .where(inArray(schema.videoUpscaleJobs.id, createdJobs))
      .all()
    : []

  return created(c, {
    items: formatVideoUpscaleJobs(rows),
    count: rows.length,
    balance: getUserBalance(user.id),
  })
})

const ACTIVE_UPSCALE_STATUSES = ['queued', 'uploading', 'processing'] as const

function canAccessVideoGeneration(
  c: Parameters<typeof getAuthUser>[0],
  row: typeof schema.videoGenerations.$inferSelect,
) {
  const user = getAuthUser(c)
  if (user.role === 'admin') return user
  if (row.userId === user.id) return user
  const teamId = resolveActiveTeamId(c, user)
  if (teamId != null && row.dramaId) {
    const [drama] = db.select().from(schema.dramas)
      .where(eq(schema.dramas.id, row.dramaId))
      .all()
    if (drama?.teamId === teamId) {
      const members = getTeamMemberUserIds(teamId)
      const ownerId = Number(row.userId)
      if ((Number.isFinite(ownerId) && members.includes(ownerId)) || members.includes(user.id)) {
        return user
      }
    }
  }
  return null
}

async function resolveUpscaleSourceFromGeneration(
  row: typeof schema.videoGenerations.$inferSelect,
): Promise<{ sourcePath: string; fileSize: number }> {
  const local = String(row.localPath || '').trim()
  if (local) {
    const abs = resolveMediaFilePath(local)
    if (abs && fs.existsSync(abs)) {
      const normalized = local.replace(/^\/+/, '')
      return {
        sourcePath: normalized.startsWith('static/') ? normalized : `static/${normalized}`,
        fileSize: fs.statSync(abs).size,
      }
    }
  }
  const remote = String(row.videoUrl || '').trim()
  if (remote.startsWith('http://') || remote.startsWith('https://')) {
    const path = await downloadFile(remote, 'uploads/video-upscale', { syncOss: true })
    const abs = resolveMediaFilePath(path)
    const fileSize = abs && fs.existsSync(abs) ? fs.statSync(abs).size : 0
    return { sourcePath: path, fileSize }
  }
  if (remote) {
    const abs = resolveMediaFilePath(remote)
    if (abs && fs.existsSync(abs)) {
      const normalized = remote.replace(/^\/+/, '')
      return {
        sourcePath: normalized.startsWith('static/') ? normalized : `static/${normalized}`,
        fileSize: fs.statSync(abs).size,
      }
    }
  }
  throw new Error('视频文件不可用，请稍后重试')
}

function latestUpscaleJobForGeneration(videoGenerationId: number) {
  return db.select().from(schema.videoUpscaleJobs)
    .where(and(
      eq(schema.videoUpscaleJobs.videoGenerationId, videoGenerationId),
      isNull(schema.videoUpscaleJobs.deletedAt),
    ))
    .orderBy(desc(schema.videoUpscaleJobs.id))
    .limit(1)
    .all()[0] || null
}

// GET /video-upscale/for-generations?ids=1,2,3 — 批量查视频生成关联的最新超分任务
app.get('/for-generations', (c) => {
  const user = getAuthUser(c)
  const raw = String(c.req.query('ids') || '').trim()
  const ids = [...new Set(
    raw.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0),
  )].slice(0, 100)
  if (!ids.length) return success(c, { items: {} })

  const rows = db.select().from(schema.videoUpscaleJobs)
    .where(and(
      inArray(schema.videoUpscaleJobs.videoGenerationId, ids),
      isNull(schema.videoUpscaleJobs.deletedAt),
    ))
    .orderBy(desc(schema.videoUpscaleJobs.id))
    .all()

  const teamId = resolveActiveTeamId(c, user)
  const picked: typeof rows = []
  const seen = new Set<string>()
  for (const row of rows) {
    const key = String(row.videoGenerationId || '')
    if (!key || seen.has(key)) continue
    if (user.role !== 'admin' && row.userId !== user.id) {
      if (teamId == null || row.teamId !== teamId) continue
    }
    seen.add(key)
    picked.push(row)
  }
  const formatted = formatVideoUpscaleJobs(picked)
  const map: Record<string, (typeof formatted)[number]> = {}
  for (const item of formatted) {
    if (item.video_generation_id != null) map[String(item.video_generation_id)] = item
  }
  return success(c, { items: map })
})

// POST /video-upscale/from-generation — 从通道视频生成记录提交超分（留在原页）
app.post('/from-generation', async (c) => {
  const user = getAuthUser(c)

  const body = await c.req.json().catch(() => ({})) as { video_generation_id?: number }
  const videoGenerationId = Number(body.video_generation_id)
  if (!Number.isFinite(videoGenerationId) || videoGenerationId <= 0) {
    return badRequest(c, '缺少 video_generation_id')
  }

  const [video] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, videoGenerationId))
    .all()
  if (!video) return notFound(c, '视频不存在')
  if (!canAccessVideoGeneration(c, video)) return forbidden(c, '无权操作该视频')
  if (video.status !== 'completed') return badRequest(c, '仅已完成的视频可超分')

  const isFunshion = String(video.provider || '').trim() === 'funshion_web'
  if (!isFunshion) {
    try {
      resolveRunningHubIndexTts2Config()
    } catch {
      return badRequest(c, '超分服务暂未就绪，请联系管理员')
    }
  }

  const existing = latestUpscaleJobForGeneration(videoGenerationId)
  if (existing && (ACTIVE_UPSCALE_STATUSES as readonly string[]).includes(existing.status)) {
    return success(c, {
      item: formatVideoUpscaleJob(existing),
      reused: true,
      balance: getUserBalance(user.id),
    })
  }

  let sourcePath = ''
  let fileSize = 0
  try {
    const resolved = await resolveUpscaleSourceFromGeneration(video)
    sourcePath = resolved.sourcePath
    fileSize = resolved.fileSize
  } catch (err: any) {
    if (!isFunshion) {
      return badRequest(c, String(err?.message || '视频文件不可用'))
    }
    // 通道8 超分走橙星资源 ID，本地文件仅用于对比；缺失时仍可提交
    sourcePath = String(video.localPath || video.videoUrl || '').replace(/^\/+/, '')
    if (sourcePath && !sourcePath.startsWith('static/') && !/^https?:\/\//i.test(sourcePath)) {
      sourcePath = `static/${sourcePath}`
    }
  }

  if (!isFunshion && fileSize > SEEDVR2_MAX_FILE_BYTES) {
    return badRequest(c, '视频文件过大（上限 500MB）')
  }

  const duration = sourcePath && !/^https?:\/\//i.test(sourcePath)
    ? await probeVideoDuration(sourcePath)
    : 0
  const fallbackDuration = Number(video.duration) || 0
  const effectiveDuration = duration > 0 ? duration : fallbackDuration
  if (!isFunshion && effectiveDuration > SEEDVR2_MAX_DURATION_SEC) {
    return badRequest(c, '单个文件时长不能超过 3 分钟')
  }

  const title = isFunshion
    ? `通道8超分2K #${videoGenerationId}.mp4`
    : `通道视频 #${videoGenerationId}.mp4`

  let cost = 0
  let charged: ReturnType<typeof tryChargeUser>

  if (isFunshion) {
    cost = getActionCost(CREDIT_ACTIONS.VIDEO_UPSCALE_FUNSHION_2K, 1)
      || resolveVideoUpscaleFunshion2kCreditCost()
    charged = tryChargeUser(c, CREDIT_ACTIONS.VIDEO_UPSCALE_FUNSHION_2K, {
      summary: `通道8超分2K ${title}`,
      quantity: 1,
      flatCost: cost,
      resourceType: 'video_generation',
      resourceId: videoGenerationId,
      metadata: {
        video_generation_id: videoGenerationId,
        duration_sec: effectiveDuration,
        billing_unit: 'flat',
        provider: 'funshion_enhance',
        clarity: FUNSHION_ENHANCE_CLARITY,
        source: 'channel8_card',
      },
    })
  } else {
    const billedSeconds = Math.max(1, Math.ceil(effectiveDuration || 1))
    cost = getActionCost(CREDIT_ACTIONS.VIDEO_UPSCALE_SEEDVR2, billedSeconds)
      || resolveVideoUpscaleSeedvr2CreditCost(effectiveDuration)
    charged = tryChargeUser(c, CREDIT_ACTIONS.VIDEO_UPSCALE_SEEDVR2, {
      summary: `视频超分 ${title}`,
      quantity: billedSeconds,
      flatCost: cost,
      resourceType: 'video_generation',
      resourceId: videoGenerationId,
      metadata: {
        video_generation_id: videoGenerationId,
        duration_sec: effectiveDuration,
        billing_unit: 'second',
        provider: 'runninghub_seedvr25',
        source: 'channel2_card',
      },
    })
  }
  if (charged.error) return charged.error

  const teamId = resolveActiveTeamId(c, user)
  const ts = now()
  const insert = db.insert(schema.videoUpscaleJobs).values({
    title,
    userId: user.id,
    teamId: teamId ?? null,
    videoGenerationId,
    status: 'queued',
    sourceVideoPath: sourcePath || null,
    durationSec: effectiveDuration || null,
    fileSize: fileSize || null,
    instanceType: isFunshion ? FUNSHION_ENHANCE_INSTANCE_TYPE : RUNNINGHUB_SEEDVR2_INSTANCE_TYPE,
    creditTransactionId: charged.charge.transactionId ?? null,
    progress: 0,
    createdAt: ts,
    updatedAt: ts,
  }).run()
  const id = Number(insert.lastInsertRowid)

  logActivity(user, {
    action: isFunshion ? 'video.upscale.funshion.2k.submit' : 'video.upscale.seedvr25.submit',
    summary: isFunshion
      ? `提交通道8超分2K #${id}（源视频 #${videoGenerationId}）`
      : `提交视频超分 #${id}（源视频 #${videoGenerationId}）`,
    resourceType: 'video_upscale',
    resourceId: id,
    creditCost: cost,
  })

  void processVideoUpscaleJob(id)

  const [job] = db.select().from(schema.videoUpscaleJobs)
    .where(eq(schema.videoUpscaleJobs.id, id))
    .all()

  return created(c, {
    item: formatVideoUpscaleJob(job),
    reused: false,
    balance: getUserBalance(user.id),
  })
})

// GET /video-upscale/:id
app.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const [row] = db.select().from(schema.videoUpscaleJobs)
    .where(and(eq(schema.videoUpscaleJobs.id, id), isNull(schema.videoUpscaleJobs.deletedAt)))
    .all()
  if (!row) return notFound(c, '任务不存在')
  if (!assertAccess(c, row)) return forbidden(c, '无权查看')
  return success(c, formatVideoUpscaleJob(row))
})

// GET /video-upscale/:id/download
app.get('/:id/download', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = db.select().from(schema.videoUpscaleJobs)
    .where(and(eq(schema.videoUpscaleJobs.id, id), isNull(schema.videoUpscaleJobs.deletedAt)))
    .all()
  if (!row) return notFound(c, '任务不存在')
  if (!assertAccess(c, row)) return forbidden(c, '无权下载')
  if (!row.outputVideoPath) return badRequest(c, '成品尚未就绪')

  const abs = resolveMediaFilePath(row.outputVideoPath)
  if (!abs || !fs.existsSync(abs)) return notFound(c, '成品文件不存在')

  const filename = sanitizeDownloadFilename(
    `${String(row.title || 'video').replace(/\.mp4$/i, '')}-upscale.mp4`,
    `upscale-${id}.mp4`,
  )
  const { stream } = await openMediaReadStream(row.outputVideoPath)
  const webStream = Readable.toWeb(stream) as ReadableStream
  return new Response(webStream, {
    headers: {
      'Content-Type': mimeForStaticPath(row.outputVideoPath) || 'video/mp4',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

export default app
