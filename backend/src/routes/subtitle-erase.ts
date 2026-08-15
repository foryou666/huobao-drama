import { Hono } from 'hono'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import ffmpeg from 'fluent-ffmpeg'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now, forbidden } from '../utils/response.js'
import { saveUploadedFile } from '../utils/storage.js'
import { ensureFfmpegConfigured } from '../utils/ffmpeg-path.js'
import { resolveMediaFilePath } from '../utils/media-path.js'
import { getAuthUser, type AuthVariables } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { resolveActiveTeamId } from '../services/team-access.js'
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
  resolveSubtitleEraseCreditCost,
  SUBTITLE_ERASE_CREDITS_PER_SECOND,
} from '../constants/credit-actions.js'
import {
  RUNNINGHUB_SUBTITLE_ERASE_DOCS_URL,
  RUNNINGHUB_SUBTITLE_ERASE_INSTANCE_TYPE,
  SUBTITLE_ERASE_MAX_DURATION_SEC,
  SUBTITLE_ERASE_MAX_FILE_BYTES,
  SUBTITLE_ERASE_MAX_FILES_PER_BATCH,
} from '../constants/runninghub-subtitle-erase.js'
import { resolveRunningHubIndexTts2Config } from '../services/runninghub-indextts2-config.js'
import {
  AVG_SUBTITLE_ERASE_JOB_SEC,
  formatSubtitleEraseJob,
  formatSubtitleEraseJobs,
  processSubtitleEraseJob,
} from '../services/subtitle-erase-runninghub.js'

const app = new Hono<{ Variables: AuthVariables }>()

async function probeVideoMeta(relativePath: string): Promise<{ duration: number; maxSide: number }> {
  const filePath = resolveMediaFilePath(relativePath)
  if (!filePath) return { duration: 0, maxSide: 832 }
  ensureFfmpegConfigured()
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        resolve({ duration: 0, maxSide: 832 })
        return
      }
      const duration = Number(metadata.format?.duration || 0)
      const videoStream = (metadata.streams || []).find((s: any) => s.codec_type === 'video')
      const w = Number(videoStream?.width || 0)
      const h = Number(videoStream?.height || 0)
      const maxSide = Math.max(w, h) || 832
      resolve({
        duration: duration > 0 ? Math.round(duration * 10) / 10 : 0,
        maxSide,
      })
    })
  })
}

function assertAccess(c: Parameters<typeof getAuthUser>[0], row: typeof schema.subtitleEraseJobs.$inferSelect) {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  if (user.role === 'admin') return user
  if (row.userId === user.id) return user
  if (teamId != null && row.teamId === teamId) return user
  return null
}

function resolveCreditsPerSecond() {
  return getActionCost(CREDIT_ACTIONS.SUBTITLE_ERASE, 1) || SUBTITLE_ERASE_CREDITS_PER_SECOND
}

function normalizeMode(raw: unknown): 'subtitle' | 'watermark' | 'both' {
  const normalized = String(raw || 'subtitle').trim().toLowerCase()
  if (normalized === 'watermark' || normalized === 'wm') return 'watermark'
  if (normalized === 'both' || normalized === 'all') return 'both'
  return 'subtitle'
}

// GET /subtitle-erase/meta
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
  return success(c, {
    ready,
    detail,
    max_files: SUBTITLE_ERASE_MAX_FILES_PER_BATCH,
    max_duration_sec: SUBTITLE_ERASE_MAX_DURATION_SEC,
    max_file_bytes: SUBTITLE_ERASE_MAX_FILE_BYTES,
    credits_per_second: resolveCreditsPerSecond(),
    accept: 'video/mp4,.mp4',
    avg_job_sec: AVG_SUBTITLE_ERASE_JOB_SEC,
    modes: [
      { value: 'subtitle', label: '去字幕' },
    ],
    docs_url: RUNNINGHUB_SUBTITLE_ERASE_DOCS_URL,
  })
})

// GET /subtitle-erase/balance
app.get('/balance', (c) => {
  const user = getAuthUser(c)
  return success(c, {
    balance: getUserBalance(user.id),
    credits_per_second: resolveCreditsPerSecond(),
  })
})

// GET /subtitle-erase
app.get('/', (c) => {
  const user = getAuthUser(c)
  const status = String(c.req.query('status') || '').trim()
  const range = String(c.req.query('range') || 'week').trim()
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') || 20) || 20))
  const offset = Math.max(0, Number(c.req.query('offset') || 0) || 0)

  const conditions = [isNull(schema.subtitleEraseJobs.deletedAt)]
  if (user.role !== 'admin') {
    conditions.push(eq(schema.subtitleEraseJobs.userId, user.id))
  }
  if (status && status !== 'all') {
    if (status === 'processing') {
      conditions.push(sql`${schema.subtitleEraseJobs.status} IN ('queued','uploading','processing')`)
    } else {
      conditions.push(eq(schema.subtitleEraseJobs.status, status))
    }
  }
  if (range === 'week') {
    conditions.push(sql`${schema.subtitleEraseJobs.createdAt} >= datetime('now', '-7 days')`)
  } else if (range === 'month') {
    conditions.push(sql`${schema.subtitleEraseJobs.createdAt} >= datetime('now', '-30 days')`)
  }

  const where = and(...conditions)
  const rows = db.select().from(schema.subtitleEraseJobs)
    .where(where)
    .orderBy(desc(schema.subtitleEraseJobs.id))
    .limit(limit)
    .offset(offset)
    .all()

  const statsBase = [isNull(schema.subtitleEraseJobs.deletedAt)]
  if (user.role !== 'admin') statsBase.push(eq(schema.subtitleEraseJobs.userId, user.id))
  const all = db.select({ status: schema.subtitleEraseJobs.status })
    .from(schema.subtitleEraseJobs)
    .where(and(...statsBase))
    .all()

  let processing = 0
  let completed = 0
  let failed = 0
  for (const item of all) {
    if (item.status === 'completed') completed += 1
    else if (item.status === 'failed') failed += 1
    else processing += 1
  }

  return success(c, {
    items: formatSubtitleEraseJobs(rows),
    total: all.length,
    stats: { processing, completed, failed, total: all.length },
    pagination: { limit, offset, has_more: offset + rows.length < all.length },
  })
})

// POST /subtitle-erase
app.post('/', async (c) => {
  const user = getAuthUser(c)
  try {
    resolveRunningHubIndexTts2Config()
  } catch {
    return badRequest(c, '服务暂未就绪，请联系管理员')
  }

  const body = await c.req.parseBody({ all: true })
  const mode = normalizeMode(body.mode)
  const rawFiles = body.files ?? body.file
  const fileList = Array.isArray(rawFiles) ? rawFiles : (rawFiles ? [rawFiles] : [])
  const files = fileList.filter((f): f is File => f instanceof File)
  if (!files.length) return badRequest(c, '请上传 MP4 视频')
  if (files.length > SUBTITLE_ERASE_MAX_FILES_PER_BATCH) {
    return badRequest(c, `单次最多 ${SUBTITLE_ERASE_MAX_FILES_PER_BATCH} 个文件`)
  }

  const teamId = resolveActiveTeamId(c, user)
  const createdJobs: number[] = []

  for (const file of files) {
    const name = String(file.name || 'video.mp4')
    if (!/\.mp4$/i.test(name) && file.type && !file.type.includes('mp4')) {
      return badRequest(c, `仅支持 MP4：${name}`)
    }
    if (file.size > SUBTITLE_ERASE_MAX_FILE_BYTES) {
      return badRequest(c, `文件过大（上限 500MB）：${name}`)
    }

    const buffer = await file.arrayBuffer()
    const path = await saveUploadedFile(buffer, 'uploads/subtitle-erase', name)
    const meta = await probeVideoMeta(path)
    if (meta.duration > SUBTITLE_ERASE_MAX_DURATION_SEC) {
      return badRequest(c, `单个文件时长不能超过 ${SUBTITLE_ERASE_MAX_DURATION_SEC} 秒：${name}`)
    }

    const billedSeconds = Math.max(1, Math.ceil(meta.duration || 1))
    const cost = getActionCost(CREDIT_ACTIONS.SUBTITLE_ERASE, billedSeconds)
      || resolveSubtitleEraseCreditCost(meta.duration)
    const charged = tryChargeUser(c, CREDIT_ACTIONS.SUBTITLE_ERASE, {
      summary: `${mode === 'watermark' ? '去水印' : mode === 'both' ? '去字幕水印' : '去字幕'} ${name}`,
      quantity: billedSeconds,
      flatCost: cost,
      metadata: {
        filename: name,
        duration_sec: meta.duration,
        max_side: meta.maxSide,
        mode,
        billing_unit: 'second',
        provider: 'runninghub_subtitle_erase',
        webapp_id: '2082744190789840898',
      },
    })
    if (charged.error) return charged.error

    const ts = now()
    const insert = db.insert(schema.subtitleEraseJobs).values({
      title: name,
      userId: user.id,
      teamId: teamId ?? null,
      status: 'queued',
      eraseMode: mode,
      sourceVideoPath: path,
      durationSec: meta.duration || null,
      maxSide: meta.maxSide || null,
      fileSize: file.size,
      instanceType: RUNNINGHUB_SUBTITLE_ERASE_INSTANCE_TYPE,
      creditTransactionId: charged.charge.transactionId ?? null,
      progress: 0,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    const id = Number(insert.lastInsertRowid)
    createdJobs.push(id)

    logActivity(user, {
      action: 'subtitle.erase.submit',
      summary: `提交${mode === 'watermark' ? '去水印' : mode === 'both' ? '去字幕水印' : '去字幕'} #${id}`,
      resourceType: 'subtitle_erase',
      resourceId: id,
      creditCost: cost,
    })

    void processSubtitleEraseJob(id)
  }

  const rows = createdJobs.length
    ? db.select().from(schema.subtitleEraseJobs)
      .where(inArray(schema.subtitleEraseJobs.id, createdJobs))
      .all()
    : []

  return created(c, {
    items: formatSubtitleEraseJobs(rows),
    balance: getUserBalance(user.id),
  })
})

// GET /subtitle-erase/:id
app.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const [row] = db.select().from(schema.subtitleEraseJobs)
    .where(and(eq(schema.subtitleEraseJobs.id, id), isNull(schema.subtitleEraseJobs.deletedAt)))
    .all()
  if (!row) return notFound(c, '任务不存在')
  if (!assertAccess(c, row)) return forbidden(c, '无权查看')
  return success(c, formatSubtitleEraseJob(row))
})

// GET /subtitle-erase/:id/download
app.get('/:id/download', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = db.select().from(schema.subtitleEraseJobs)
    .where(and(eq(schema.subtitleEraseJobs.id, id), isNull(schema.subtitleEraseJobs.deletedAt)))
    .all()
  if (!row) return notFound(c, '任务不存在')
  if (!assertAccess(c, row)) return forbidden(c, '无权下载')
  if (!row.outputVideoPath) return badRequest(c, '成品尚未就绪')

  const abs = resolveMediaFilePath(row.outputVideoPath)
  if (!abs || !fs.existsSync(abs)) return notFound(c, '成品文件不存在')

  const suffix = row.eraseMode === 'watermark' ? 'no-wm' : 'no-sub'
  const filename = sanitizeDownloadFilename(
    `${String(row.title || 'video').replace(/\.mp4$/i, '')}-${suffix}.mp4`,
    `subtitle-erase-${id}.mp4`,
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
