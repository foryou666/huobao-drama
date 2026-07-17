import { Hono } from 'hono'
import { desc, eq, isNull } from 'drizzle-orm'
import ffmpeg from 'fluent-ffmpeg'
import { db, schema } from '../db/index.js'
import { success, badRequest, notFound, created, now } from '../utils/response.js'
import { saveUploadedFile } from '../utils/storage.js'
import { ensureFfmpegConfigured } from '../utils/ffmpeg-path.js'
import { resolveMediaFilePath } from '../utils/media-path.js'
import { getAuthUser, denyUnlessAdmin, type AuthVariables } from '../middleware/auth.js'
import { logActivity } from '../services/activity.js'
import { resolveActiveTeamId } from '../services/team-access.js'
import { toSnakeCase } from '../utils/transform.js'
import {
  mimeForStaticPath,
  openMediaReadStream,
  sanitizeDownloadFilename,
} from '../utils/media-download.js'
import { Readable } from 'stream'
import fs from 'fs'
import {
  submitSubtitleRemovalJob,
  pollSubtitleRemovalRemoteJob,
  downloadSubtitleRemovalOutput,
} from '../services/subtitle-remover-client.js'
import {
  getSubtitleRemoverAdminConfig,
  saveSubtitleRemoverAdminConfig,
  probeSubtitleRemoverApi,
} from '../services/subtitle-remover-config.js'

const app = new Hono<{ Variables: AuthVariables }>()

const MAX_SOURCE_DURATION_SEC = 600
const POLL_MS = 5000

/** sttn-auto 仅重绘手动框选区域，不做 OCR；无框选时必须改用 sttn-det */
function resolveInpaintMode(inpaintMode: string, subtitleAreas: number[][] | null | undefined) {
  const mode = String(inpaintMode || 'sttn-det').trim() || 'sttn-det'
  const hasAreas = Array.isArray(subtitleAreas) && subtitleAreas.length > 0
  if (!hasAreas && mode === 'sttn-auto') return 'sttn-det'
  return mode
}

function parseSubtitleAreasJson(raw: string | null | undefined) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function formatJob(row: typeof schema.subtitleRemovalJobs.$inferSelect) {
  return toSnakeCase({
    ...row,
    source_video_url: row.sourceVideoPath ? `/${row.sourceVideoPath}` : null,
    output_video_url: row.outputVideoPath ? `/${row.outputVideoPath}` : null,
    subtitle_areas: parseSubtitleAreasJson(row.subtitleAreasJson),
  })
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

function assertAccess(c: Parameters<typeof getAuthUser>[0], row: typeof schema.subtitleRemovalJobs.$inferSelect) {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  if (user.role === 'admin') return user
  if (row.userId === user.id) return user
  if (teamId != null && row.teamId === teamId) return user
  return null
}

async function processJobInBackground(jobId: number) {
  const [row] = db.select().from(schema.subtitleRemovalJobs)
    .where(eq(schema.subtitleRemovalJobs.id, jobId))
    .all()
  if (!row || !row.sourceVideoPath) return

  try {
    const remoteJobId = await submitSubtitleRemovalJob({
      sourceRelativePath: row.sourceVideoPath,
      inpaintMode: resolveInpaintMode(row.inpaintMode || 'sttn-det', row.subtitleAreasJson ? JSON.parse(row.subtitleAreasJson) : undefined),
      subtitleAreas: row.subtitleAreasJson ? JSON.parse(row.subtitleAreasJson) : undefined,
    })
    db.update(schema.subtitleRemovalJobs).set({
      remoteJobId,
      status: 'remote_processing',
      progress: 10,
      updatedAt: now(),
    }).where(eq(schema.subtitleRemovalJobs.id, jobId)).run()

    for (;;) {
      await new Promise(r => setTimeout(r, POLL_MS))
      const remote = await pollSubtitleRemovalRemoteJob(remoteJobId)
      const progress = Number(remote.progress || 0)
      if (remote.status === 'completed' && remote.has_output) {
        try {
          const outputPath = await downloadSubtitleRemovalOutput(remoteJobId)
          const absOutput = resolveMediaFilePath(outputPath)
          const size = absOutput && fs.existsSync(absOutput) ? fs.statSync(absOutput).size : 0
          if (size < 64 * 1024) {
            throw new Error(`VSR 成品无效（${size} 字节），请检查本机 ffmpeg 后重试`)
          }
          db.update(schema.subtitleRemovalJobs).set({
            status: 'completed',
            progress: 100,
            outputVideoPath: outputPath,
            errorMsg: null,
            updatedAt: now(),
          }).where(eq(schema.subtitleRemovalJobs.id, jobId)).run()
          return
        } catch (err: any) {
          db.update(schema.subtitleRemovalJobs).set({
            status: 'failed',
            errorMsg: err.message || 'VSR 成品下载失败',
            updatedAt: now(),
          }).where(eq(schema.subtitleRemovalJobs.id, jobId)).run()
          return
        }
      }
      if (remote.status === 'completed' && !remote.has_output) {
        db.update(schema.subtitleRemovalJobs).set({
          status: 'failed',
          errorMsg: remote.error || 'VSR 已完成但未生成有效成品',
          updatedAt: now(),
        }).where(eq(schema.subtitleRemovalJobs.id, jobId)).run()
        return
      }
      if (remote.status === 'failed') {
        db.update(schema.subtitleRemovalJobs).set({
          status: 'failed',
          errorMsg: remote.error || 'VSR 处理失败',
          updatedAt: now(),
        }).where(eq(schema.subtitleRemovalJobs.id, jobId)).run()
        return
      }
      db.update(schema.subtitleRemovalJobs).set({
        status: 'remote_processing',
        progress: Math.max(10, Math.min(95, progress || 20)),
        updatedAt: now(),
      }).where(eq(schema.subtitleRemovalJobs.id, jobId)).run()
    }
  } catch (err: any) {
    db.update(schema.subtitleRemovalJobs).set({
      status: 'failed',
      errorMsg: err.message || '处理失败',
      updatedAt: now(),
    }).where(eq(schema.subtitleRemovalJobs.id, jobId)).run()
  }
}

// GET /subtitle-remover/config
app.get('/config', (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  return success(c, getSubtitleRemoverAdminConfig())
})

// PUT /subtitle-remover/config
app.put('/config', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  try {
    const saved = saveSubtitleRemoverAdminConfig({
      base_url: String(body.base_url || ''),
      api_key: body.api_key != null ? String(body.api_key) : undefined,
      is_active: body.is_active !== false && body.is_active !== 0 && body.is_active !== '0',
    }, getAuthUser(c))
    return success(c, saved)
  } catch (err: any) {
    return badRequest(c, err.message || '保存失败')
  }
})

// POST /subtitle-remover/config/test
app.post('/config/test', async (c) => {
  const denied = denyUnlessAdmin(c)
  if (denied) return denied
  const body = await c.req.json().catch(() => ({}))
  const baseUrl = String(body.base_url || '').trim()
  if (!baseUrl) return badRequest(c, '请填写 API 地址')
  try {
    const result = await probeSubtitleRemoverApi(baseUrl, body.api_key ? String(body.api_key) : undefined)
    return success(c, result)
  } catch (err: any) {
    return success(c, { ok: false, reachable: false, message: err.message || '请求失败' })
  }
})

// GET /subtitle-remover
app.get('/', (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const rows = db.select().from(schema.subtitleRemovalJobs)
    .where(isNull(schema.subtitleRemovalJobs.deletedAt))
    .orderBy(desc(schema.subtitleRemovalJobs.updatedAt))
    .all()
    .filter(row => user.role === 'admin' || row.userId === user.id || (teamId != null && row.teamId === teamId))
  return success(c, { items: rows.map(formatJob) })
})

// POST /subtitle-remover
app.post('/', async (c) => {
  const user = getAuthUser(c)
  const teamId = resolveActiveTeamId(c, user)
  const body = await c.req.parseBody()
  const file = body.file
  if (!(file instanceof File)) return badRequest(c, '请上传视频文件')

  const buffer = await file.arrayBuffer()
  if (buffer.byteLength < 1024) return badRequest(c, '文件过小')

  const path = await saveUploadedFile(buffer, 'uploads/subtitle-remover', file.name)
  const duration = await probeVideoDuration(path)
  if (duration > MAX_SOURCE_DURATION_SEC) {
    return badRequest(c, `视频时长不能超过 ${MAX_SOURCE_DURATION_SEC / 60} 分钟`)
  }

  let subtitleAreas: number[][] | null = null
  const areasRaw = body.subtitle_areas
  if (areasRaw != null && String(areasRaw).trim()) {
    try {
      subtitleAreas = JSON.parse(String(areasRaw))
    } catch {
      return badRequest(c, 'subtitle_areas 必须是 JSON 数组')
    }
  }

  const inpaintMode = resolveInpaintMode(String(body.inpaint_mode || 'sttn-det'), subtitleAreas)

  const title = String(body.title || file.name || '去字幕任务').trim() || '去字幕任务'
  const ts = now()
  const insert = db.insert(schema.subtitleRemovalJobs).values({
    title,
    userId: user.id,
    teamId,
    status: 'queued',
    sourceVideoPath: path,
    inpaintMode,
    subtitleAreasJson: subtitleAreas ? JSON.stringify(subtitleAreas) : null,
    progress: 0,
    createdAt: ts,
    updatedAt: ts,
  }).run()

  const id = Number(insert.lastInsertRowid)
  logActivity(user, {
    action: 'subtitle_remover.create',
    summary: '创建去字幕任务',
    resourceType: 'subtitle_removal_job',
    resourceId: id,
  })

  setTimeout(() => { void processJobInBackground(id) }, 0)

  const [row] = db.select().from(schema.subtitleRemovalJobs)
    .where(eq(schema.subtitleRemovalJobs.id, id)).all()
  return created(c, formatJob(row!))
})

// GET /subtitle-remover/:id/download
app.get('/:id/download', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return badRequest(c, 'invalid id')
  const [row] = db.select().from(schema.subtitleRemovalJobs)
    .where(eq(schema.subtitleRemovalJobs.id, id)).all()
  if (!row || row.deletedAt) return notFound(c)
  if (!assertAccess(c, row)) return notFound(c)
  if (row.status !== 'completed') return badRequest(c, '任务尚未完成')

  let outputPath = row.outputVideoPath
  const absOutput = outputPath ? resolveMediaFilePath(outputPath) : null
  const absSize = absOutput && fs.existsSync(absOutput) ? fs.statSync(absOutput).size : 0
  if (!outputPath || !absOutput || absSize < 64 * 1024) {
    if (!row.remoteJobId) return notFound(c, '成品文件不存在')
    try {
      outputPath = await downloadSubtitleRemovalOutput(row.remoteJobId)
      db.update(schema.subtitleRemovalJobs).set({
        outputVideoPath: outputPath,
        updatedAt: now(),
      }).where(eq(schema.subtitleRemovalJobs.id, id)).run()
    } catch (err: any) {
      return notFound(c, err.message || '成品文件不存在')
    }
  }

  try {
    const filename = sanitizeDownloadFilename(
      `${row.title || '去字幕'}_${id}.mp4`,
      `subtitle_removed_${id}.mp4`,
    )
    const { stream } = await openMediaReadStream(outputPath!)
    const webStream = Readable.toWeb(stream) as ReadableStream
    return new Response(webStream, {
      headers: {
        'Content-Type': mimeForStaticPath(outputPath!),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (err: any) {
    return notFound(c, err.message || 'file not found')
  }
})

// GET /subtitle-remover/:id
app.get('/:id', (c) => {
  const id = Number(c.req.param('id'))
  const [row] = db.select().from(schema.subtitleRemovalJobs)
    .where(eq(schema.subtitleRemovalJobs.id, id)).all()
  if (!row || row.deletedAt) return notFound(c)
  if (!assertAccess(c, row)) return notFound(c)
  return success(c, formatJob(row))
})

export default app
