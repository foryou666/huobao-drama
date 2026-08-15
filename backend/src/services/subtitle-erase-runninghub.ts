/**
 * RunningHub 视频自动去字幕/去水印
 * API: https://www.runninghub.cn/call-api/api-detail/2039727020543840258?apiType=4
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import fs from 'fs'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { downloadFile } from '../utils/storage.js'
import { resolveMediaFilePath } from '../utils/media-path.js'
import { tryRefundCharge } from '../utils/credit-charge.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import {
  RunningHubClient,
  pickAudioResult,
  type RunningHubTaskResultItem,
} from './runninghub-client.js'
import { resolveRunningHubIndexTts2Config } from './runninghub-indextts2-config.js'
import {
  RUNNINGHUB_SUBTITLE_ERASE_INSTANCE_TYPE,
  RUNNINGHUB_SUBTITLE_ERASE_VIDEO_NODE,
  RUNNINGHUB_SUBTITLE_ERASE_WEBAPP_ID,
} from '../constants/runninghub-subtitle-erase.js'
import { RUNNINGHUB_CONCURRENCY, withRunningHubSlot } from './runninghub-concurrency.js'

const POLL_MS = 4000
const TIMEOUT_MS = 60 * 60_000
export const AVG_SUBTITLE_ERASE_JOB_SEC = 10 * 60
const activeJobs = new Set<number>()

function countActiveJobs() {
  const row = db.select({ n: sql<number>`count(*)` })
    .from(schema.subtitleEraseJobs)
    .where(and(
      isNull(schema.subtitleEraseJobs.deletedAt),
      inArray(schema.subtitleEraseJobs.status, ['uploading', 'processing']),
    ))
    .all()[0]
  return Number(row?.n || 0)
}

function listQueuedIds() {
  return db.select({ id: schema.subtitleEraseJobs.id })
    .from(schema.subtitleEraseJobs)
    .where(and(
      isNull(schema.subtitleEraseJobs.deletedAt),
      eq(schema.subtitleEraseJobs.status, 'queued'),
    ))
    .orderBy(asc(schema.subtitleEraseJobs.id))
    .all()
    .map(r => r.id)
}

export function buildSubtitleEraseQueueFields(jobId: number, status: string, progress = 0) {
  const limit = RUNNINGHUB_CONCURRENCY.upscale
  const active = countActiveJobs()
  const queuedIds = listQueuedIds()
  const queuedTotal = queuedIds.length

  if (status === 'queued') {
    const idx = queuedIds.indexOf(jobId)
    const position = idx >= 0 ? idx + 1 : queuedTotal + 1
    const ahead = Math.max(0, position - 1)
    return {
      queue_position: position,
      queue_ahead: ahead,
      eta_sec: Math.ceil((ahead + active + 1) / limit) * AVG_SUBTITLE_ERASE_JOB_SEC,
    }
  }
  if (status === 'uploading' || status === 'processing') {
    const prog = Math.max(5, Math.min(95, Number(progress) || 20))
    return {
      queue_position: null,
      queue_ahead: 0,
      eta_sec: Math.max(60, Math.round(AVG_SUBTITLE_ERASE_JOB_SEC * (1 - prog / 100))),
    }
  }
  return { queue_position: null, queue_ahead: 0, eta_sec: null }
}

function pickVideoResult(results: RunningHubTaskResultItem[] | null | undefined): string | null {
  if (!results?.length) return null
  for (const item of results) {
    const url = String(item?.url || '').trim()
    if (!url) continue
    const typ = String(item?.outputType || '').toLowerCase()
    if (typ.includes('mp4') || typ.includes('video') || /\.mp4(\?|$)/i.test(url)) return url
  }
  for (const item of results) {
    const url = String(item?.url || '').trim()
    if (url) return url
  }
  return pickAudioResult(results)
}

function extractRemoteFailureMessage(status: {
  errorMessage?: string
  failedReason?: unknown
}): string {
  const reason = status.failedReason as Record<string, unknown> | null | undefined
  const exceptionMessage = String(reason?.exception_message || '').trim()
  if (exceptionMessage) {
    return (exceptionMessage.split(/\r?\n/).map(s => s.trim()).find(Boolean) || exceptionMessage).slice(0, 120)
  }
  return String(status.errorMessage || '').trim() || '去字幕任务失败'
}

function publicError(message: string) {
  const raw = String(message || '').trim() || '处理失败'
  if (/OOM|显存不足|out of memory|OOM_KILLED/i.test(raw)) {
    return '上游显存不足，请缩短视频、降低分辨率后重试（积分已自动退回）'
  }
  if (/显存不足|并发已满|queue limit/i.test(raw)) return raw
  if (/SAM3Propagate|unexpected keyword|video_model|工作流运行失败/i.test(raw)) {
    return '上游工作流异常（节点版本不兼容），积分将自动退回。请稍后重试或联系管理员更换应用'
  }
  if (/runninghub|webapp|openapi|comfy/i.test(raw)) {
    if (/超时/.test(raw)) return '任务超时，请稍后重试'
    if (/上传/.test(raw)) return '视频上传失败，请稍后重试'
    return '处理失败，请稍后重试'
  }
  return raw
}

function formatBase(row: typeof schema.subtitleEraseJobs.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    user_id: row.userId,
    team_id: row.teamId,
    status: row.status,
    mode: row.eraseMode || 'subtitle',
    source_video_path: row.sourceVideoPath,
    source_video_url: row.sourceVideoPath ? `/${row.sourceVideoPath}` : null,
    output_video_path: row.outputVideoPath,
    output_video_url: row.outputVideoPath ? `/${row.outputVideoPath}` : null,
    remote_task_id: row.remoteTaskId,
    duration_sec: row.durationSec,
    max_side: row.maxSide,
    file_size: row.fileSize,
    credit_transaction_id: row.creditTransactionId,
    progress: row.progress ?? 0,
    error_msg: row.errorMsg ? publicError(row.errorMsg) : null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export function formatSubtitleEraseJob(row: typeof schema.subtitleEraseJobs.$inferSelect) {
  return {
    ...formatBase(row),
    ...buildSubtitleEraseQueueFields(row.id, row.status, row.progress ?? 0),
  }
}

export function formatSubtitleEraseJobs(rows: Array<typeof schema.subtitleEraseJobs.$inferSelect>) {
  const queuedIds = listQueuedIds()
  const queuedTotal = queuedIds.length
  const active = countActiveJobs()
  const limit = RUNNINGHUB_CONCURRENCY.upscale
  const posById = new Map(queuedIds.map((id, i) => [id, i + 1]))

  return rows.map((row) => {
    const base = formatBase(row)
    if (row.status === 'queued') {
      const position = posById.get(row.id) || queuedTotal + 1
      const ahead = Math.max(0, position - 1)
      return {
        ...base,
        queue_position: position,
        queue_ahead: ahead,
        eta_sec: Math.ceil((ahead + active + 1) / limit) * AVG_SUBTITLE_ERASE_JOB_SEC,
      }
    }
    if (row.status === 'uploading' || row.status === 'processing') {
      const prog = Math.max(5, Math.min(95, Number(row.progress) || 20))
      return {
        ...base,
        queue_position: null,
        queue_ahead: 0,
        eta_sec: Math.max(60, Math.round(AVG_SUBTITLE_ERASE_JOB_SEC * (1 - prog / 100))),
      }
    }
    return { ...base, queue_position: null, queue_ahead: 0, eta_sec: null }
  })
}

async function failJob(jobId: number, message: string, creditTxId?: number | null, opts?: { refund?: boolean }) {
  db.update(schema.subtitleEraseJobs).set({
    status: 'failed',
    errorMsg: message,
    progress: 0,
    updatedAt: now(),
  }).where(eq(schema.subtitleEraseJobs.id, jobId)).run()

  if (opts?.refund !== false && creditTxId) {
    try {
      tryRefundCharge(creditTxId, {
        summary: '去字幕失败退款',
        metadata: { reason: message },
      })
    } catch (err: any) {
      logTaskError('SubtitleErase', 'refund-failed', { jobId, error: String(err?.message || err) })
    }
  }
}

async function finalizeSuccess(jobId: number, taskId: string, results: RunningHubTaskResultItem[] | null | undefined) {
  const remoteUrl = pickVideoResult(results)
  if (!remoteUrl) throw new Error('任务成功但未返回视频地址')
  const localPath = await downloadFile(remoteUrl, 'videos/subtitle-erased', { syncOss: true })
  db.update(schema.subtitleEraseJobs).set({
    status: 'completed',
    progress: 100,
    outputVideoPath: localPath,
    errorMsg: null,
    updatedAt: now(),
  }).where(eq(schema.subtitleEraseJobs.id, jobId)).run()
  logTaskSuccess('SubtitleErase', 'done', { jobId, taskId, localPath })
}

async function pollExistingRemoteTask(jobId: number, taskId: string) {
  const cfg = resolveRunningHubIndexTts2Config()
  const client = new RunningHubClient(cfg.apiKey, cfg.apiBase)

  db.update(schema.subtitleEraseJobs).set({
    status: 'processing',
    progress: Math.max(20, 0),
    errorMsg: null,
    updatedAt: now(),
  }).where(eq(schema.subtitleEraseJobs.id, jobId)).run()

  const started = Date.now()
  while (Date.now() - started < TIMEOUT_MS) {
    const lastStatus = await client.queryTask(taskId)
    const st = String(lastStatus.status || '').toUpperCase()
    const elapsedRatio = Math.min(0.7, (Date.now() - started) / TIMEOUT_MS)
    const progress = Math.max(20, Math.min(90, Math.round(20 + elapsedRatio * 70)))
    db.update(schema.subtitleEraseJobs).set({
      progress,
      updatedAt: now(),
    }).where(eq(schema.subtitleEraseJobs.id, jobId)).run()

    if (st === 'SUCCESS') {
      await finalizeSuccess(jobId, taskId, lastStatus.results)
      return
    }
    if (st === 'FAILED' || st === 'ERROR' || st === 'CANCELLED') {
      const err = new Error(extractRemoteFailureMessage(lastStatus)) as Error & { upstreamFailed?: boolean }
      err.upstreamFailed = true
      throw err
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
  throw new Error('任务超时，请稍后重试')
}

export async function processSubtitleEraseJob(jobId: number) {
  if (activeJobs.has(jobId)) return
  activeJobs.add(jobId)
  try {
    const [row] = db.select().from(schema.subtitleEraseJobs)
      .where(and(eq(schema.subtitleEraseJobs.id, jobId), isNull(schema.subtitleEraseJobs.deletedAt)))
      .all()
    if (!row || !row.sourceVideoPath) return
    if (row.status === 'completed') return

    const abs = resolveMediaFilePath(row.sourceVideoPath)
    if (!abs || !fs.existsSync(abs)) {
      await failJob(jobId, '源视频文件不存在', row.creditTransactionId)
      return
    }

    const existingTaskId = String(row.remoteTaskId || '').trim()
    if (existingTaskId) {
      await pollExistingRemoteTask(jobId, existingTaskId)
      return
    }
    if (row.status === 'failed') return

    await withRunningHubSlot('upscale', async () => {
      const [fresh] = db.select().from(schema.subtitleEraseJobs)
        .where(eq(schema.subtitleEraseJobs.id, jobId))
        .all()
      const freshTaskId = String(fresh?.remoteTaskId || '').trim()
      if (freshTaskId) {
        await pollExistingRemoteTask(jobId, freshTaskId)
        return
      }

      const cfg = resolveRunningHubIndexTts2Config()
      const client = new RunningHubClient(cfg.apiKey, cfg.apiBase)
      logTaskStart('SubtitleErase', 'upload', { jobId, path: row.sourceVideoPath })

      db.update(schema.subtitleEraseJobs).set({
        status: 'uploading',
        progress: 5,
        errorMsg: null,
        updatedAt: now(),
      }).where(eq(schema.subtitleEraseJobs.id, jobId)).run()

      const uploaded = await client.uploadForComfyInput(abs)
      const fileRef = String(uploaded.fileName || uploaded.download_url || '').trim()
      if (!fileRef) throw new Error('视频上传失败，请稍后重试')

      db.update(schema.subtitleEraseJobs).set({
        status: 'processing',
        progress: 15,
        updatedAt: now(),
      }).where(eq(schema.subtitleEraseJobs.id, jobId)).run()

      const submitted = await client.runAiApp({
        webappId: RUNNINGHUB_SUBTITLE_ERASE_WEBAPP_ID,
        instanceType: row.instanceType || RUNNINGHUB_SUBTITLE_ERASE_INSTANCE_TYPE,
        nodeInfoList: [
          {
            nodeId: RUNNINGHUB_SUBTITLE_ERASE_VIDEO_NODE.nodeId,
            fieldName: RUNNINGHUB_SUBTITLE_ERASE_VIDEO_NODE.fieldName,
            fieldValue: fileRef,
          },
        ],
      })

      const taskId = submitted.taskId
      if (!taskId) throw new Error('提交任务失败，请稍后重试')

      db.update(schema.subtitleEraseJobs).set({
        remoteTaskId: taskId,
        progress: 20,
        updatedAt: now(),
      }).where(eq(schema.subtitleEraseJobs.id, jobId)).run()

      logTaskProgress('SubtitleErase', 'submitted', {
        jobId,
        taskId,
        webappId: RUNNINGHUB_SUBTITLE_ERASE_WEBAPP_ID,
        mode: row.eraseMode,
      })

      await pollExistingRemoteTask(jobId, taskId)
    }, { jobId })
  } catch (err: any) {
    const [row] = db.select().from(schema.subtitleEraseJobs)
      .where(eq(schema.subtitleEraseJobs.id, jobId))
      .all()
    const msg = String(err?.message || err || '处理失败')
    logTaskError('SubtitleErase', 'failed', { jobId, error: msg })
    const hasRemote = !!String(row?.remoteTaskId || '').trim()
    // 上游明确失败应退款；仅本地异常且已拿到 remoteTaskId 时暂不退（避免孤儿任务误退）
    const shouldRefund = !hasRemote || err?.upstreamFailed === true
    await failJob(jobId, publicError(msg), row?.creditTransactionId, { refund: shouldRefund })
  } finally {
    activeJobs.delete(jobId)
  }
}

export function resumePendingSubtitleEraseJobs() {
  const rows = db.select({ id: schema.subtitleEraseJobs.id })
    .from(schema.subtitleEraseJobs)
    .where(and(
      isNull(schema.subtitleEraseJobs.deletedAt),
      inArray(schema.subtitleEraseJobs.status, ['queued', 'uploading', 'processing']),
    ))
    .orderBy(asc(schema.subtitleEraseJobs.id))
    .limit(50)
    .all()
  for (const row of rows) {
    void processSubtitleEraseJob(row.id)
  }
  if (rows.length) {
    logTaskProgress('SubtitleErase', 'resume', { count: rows.length })
  }
}
