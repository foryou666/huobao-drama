/**
 * RunningHub SeedVR2.5 视频高清放大
 * API: https://www.runninghub.cn/call-api/api-detail/2061462363160797186?apiType=5
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import fs from 'fs'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { downloadFile } from '../utils/storage.js'
import { resolveMediaFilePath } from '../utils/media-path.js'
import { tryRefundCharge } from '../utils/credit-charge.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { RunningHubClient, pickAudioResult, type RunningHubTaskResultItem, type RunningHubTaskStatus } from './runninghub-client.js'
import { resolveRunningHubIndexTts2Config } from './runninghub-indextts2-config.js'
import {
  RUNNINGHUB_SEEDVR25_INSTANCE_TYPE,
  RUNNINGHUB_SEEDVR25_VIDEO_NODE,
  RUNNINGHUB_SEEDVR25_WORKFLOW_ID,
} from '../constants/runninghub-seedvr2.js'
import { RUNNINGHUB_CONCURRENCY, withRunningHubSlot } from './runninghub-concurrency.js'

const POLL_MS = 4000
const TIMEOUT_MS = 60 * 60_000
/** 单任务经验耗时（上传+上游处理），用于排队 ETA */
export const AVG_UPSCALE_JOB_SEC = 15 * 60
const activeJobs = new Set<number>()

export type UpscaleQueueFields = {
  queue_position: number | null
  queue_ahead: number
  eta_sec: number | null
  upscale_limit: number
  active_upscale: number
  queued_total: number
}

function countActiveUpscaleJobs() {
  const row = db.select({ n: sql<number>`count(*)` })
    .from(schema.videoUpscaleJobs)
    .where(and(
      isNull(schema.videoUpscaleJobs.deletedAt),
      inArray(schema.videoUpscaleJobs.status, ['uploading', 'processing']),
    ))
    .all()[0]
  return Number(row?.n || 0)
}

function listQueuedUpscaleIds() {
  return db.select({ id: schema.videoUpscaleJobs.id })
    .from(schema.videoUpscaleJobs)
    .where(and(
      isNull(schema.videoUpscaleJobs.deletedAt),
      eq(schema.videoUpscaleJobs.status, 'queued'),
    ))
    .orderBy(asc(schema.videoUpscaleJobs.id))
    .all()
    .map(r => r.id)
}

/** 并发=2 的 FIFO：前方人数 + 预计完成时间 */
export function buildUpscaleQueueFields(
  jobId: number,
  status: string,
  progress = 0,
): UpscaleQueueFields {
  const limit = RUNNINGHUB_CONCURRENCY.upscale
  const active = countActiveUpscaleJobs()
  const queuedIds = listQueuedUpscaleIds()
  const queuedTotal = queuedIds.length

  if (status === 'queued') {
    const idx = queuedIds.indexOf(jobId)
    const position = idx >= 0 ? idx + 1 : queuedTotal + 1
    const ahead = Math.max(0, position - 1)
    // 含自身：按槽位摊平的完成 ETA
    const etaSec = Math.ceil((ahead + active + 1) / limit) * AVG_UPSCALE_JOB_SEC
    return {
      queue_position: position,
      queue_ahead: ahead,
      eta_sec: etaSec,
      upscale_limit: limit,
      active_upscale: active,
      queued_total: queuedTotal,
    }
  }

  if (status === 'uploading' || status === 'processing') {
    const prog = Math.max(5, Math.min(95, Number(progress) || 20))
    const etaSec = Math.max(60, Math.round(AVG_UPSCALE_JOB_SEC * (1 - prog / 100)))
    return {
      queue_position: null,
      queue_ahead: 0,
      eta_sec: etaSec,
      upscale_limit: limit,
      active_upscale: active,
      queued_total: queuedTotal,
    }
  }

  return {
    queue_position: null,
    queue_ahead: 0,
    eta_sec: null,
    upscale_limit: limit,
    active_upscale: active,
    queued_total: queuedTotal,
  }
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
  const exceptionType = String(reason?.exception_type || '').trim()
  if (/OutOfMemory|显存不足|CUDA out of memory/i.test(`${exceptionType}\n${exceptionMessage}`)) {
    return '上游显存不足，建议缩短视频、降低分辨率，或稍后再试'
  }
  if (/queue limit|并发数已达/i.test(String(status.errorMessage || ''))) {
    return String(status.errorMessage || '上游并发已满，请稍后重试')
  }
  if (exceptionMessage) {
    const firstLine = exceptionMessage.split(/\r?\n/).map(s => s.trim()).find(Boolean) || exceptionMessage
    return firstLine.slice(0, 120)
  }
  return String(status.errorMessage || '').trim() || '超分任务失败'
}

function publicUpscaleError(message: string) {
  const raw = String(message || '').trim() || '超分失败'
  if (/显存不足|并发已满|queue limit/i.test(raw)) return raw
  if (/runninghub|seedvr|index.?tts|webapp|openapi/i.test(raw)) {
    if (/超时/.test(raw)) return '超分任务超时，请稍后重试'
    if (/上传/.test(raw)) return '视频上传失败，请稍后重试'
    if (/失败|FAILED|ERROR|CANCELLED/i.test(raw)) return '超分任务失败，请稍后重试'
    return '超分失败，请稍后重试'
  }
  return raw
}

function formatVideoUpscaleJobBase(row: typeof schema.videoUpscaleJobs.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    user_id: row.userId,
    team_id: row.teamId,
    video_generation_id: row.videoGenerationId ?? null,
    status: row.status,
    source_video_path: row.sourceVideoPath,
    source_video_url: row.sourceVideoPath ? `/${row.sourceVideoPath}` : null,
    output_video_path: row.outputVideoPath,
    output_video_url: row.outputVideoPath ? `/${row.outputVideoPath}` : null,
    remote_task_id: row.remoteTaskId,
    duration_sec: row.durationSec,
    file_size: row.fileSize,
    credit_transaction_id: row.creditTransactionId,
    progress: row.progress ?? 0,
    error_msg: row.errorMsg ? publicUpscaleError(row.errorMsg) : null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }
}

export function formatVideoUpscaleJob(row: typeof schema.videoUpscaleJobs.$inferSelect) {
  return {
    ...formatVideoUpscaleJobBase(row),
    ...buildUpscaleQueueFields(row.id, row.status, row.progress ?? 0),
  }
}

/** 批量格式化时复用同一次排队快照，避免 N 次全表扫描 */
export function formatVideoUpscaleJobs(rows: Array<typeof schema.videoUpscaleJobs.$inferSelect>) {
  const limit = RUNNINGHUB_CONCURRENCY.upscale
  const active = countActiveUpscaleJobs()
  const queuedIds = listQueuedUpscaleIds()
  const queuedTotal = queuedIds.length
  const posById = new Map(queuedIds.map((id, i) => [id, i + 1]))

  return rows.map((row) => {
    const base = formatVideoUpscaleJobBase(row)
    if (row.status === 'queued') {
      const position = posById.get(row.id) || queuedTotal + 1
      const ahead = Math.max(0, position - 1)
      return {
        ...base,
        queue_position: position,
        queue_ahead: ahead,
        eta_sec: Math.ceil((ahead + active + 1) / limit) * AVG_UPSCALE_JOB_SEC,
        upscale_limit: limit,
        active_upscale: active,
        queued_total: queuedTotal,
      }
    }
    if (row.status === 'uploading' || row.status === 'processing') {
      const prog = Math.max(5, Math.min(95, Number(row.progress) || 20))
      return {
        ...base,
        queue_position: null,
        queue_ahead: 0,
        eta_sec: Math.max(60, Math.round(AVG_UPSCALE_JOB_SEC * (1 - prog / 100))),
        upscale_limit: limit,
        active_upscale: active,
        queued_total: queuedTotal,
      }
    }
    return {
      ...base,
      queue_position: null,
      queue_ahead: 0,
      eta_sec: null,
      upscale_limit: limit,
      active_upscale: active,
      queued_total: queuedTotal,
    }
  })
}

async function failJob(jobId: number, message: string, creditTxId?: number | null, opts?: { refund?: boolean }) {
  db.update(schema.videoUpscaleJobs).set({
    status: 'failed',
    errorMsg: message,
    progress: 0,
    updatedAt: now(),
  }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()

  const shouldRefund = opts?.refund !== false
  if (shouldRefund && creditTxId) {
    try {
      tryRefundCharge(creditTxId, {
        summary: '视频超分失败退款',
        metadata: { reason: message },
      })
    } catch (err: any) {
      logTaskError('SeedVR2.5', 'refund-failed', { jobId, error: String(err?.message || err) })
    }
  }
}

async function finalizeSuccess(jobId: number, taskId: string, results: RunningHubTaskResultItem[] | null | undefined) {
  const remoteUrl = pickVideoResult(results)
  if (!remoteUrl) throw new Error('任务成功但未返回视频地址')
  const localPath = await downloadFile(remoteUrl, 'videos/upscale', { syncOss: true })
  db.update(schema.videoUpscaleJobs).set({
    status: 'completed',
    progress: 100,
    outputVideoPath: localPath,
    errorMsg: null,
    updatedAt: now(),
  }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()
  logTaskSuccess('SeedVR2.5', 'done', { jobId, taskId, localPath })
}

/** 仅轮询已存在的上游任务（不重新上传/提交，也不抢新并发槽） */
async function pollExistingRemoteTask(jobId: number, taskId: string) {
  const cfg = resolveRunningHubIndexTts2Config()
  const client = new RunningHubClient(cfg.apiKey, cfg.apiBase)
  logTaskProgress('SeedVR2.5', 'poll-existing', { jobId, taskId })

  db.update(schema.videoUpscaleJobs).set({
    status: 'processing',
    progress: Math.max(20, 0),
    errorMsg: null,
    updatedAt: now(),
  }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()

  const started = Date.now()
  while (Date.now() - started < TIMEOUT_MS) {
    const lastStatus = await client.queryTask(taskId)
    const st = String(lastStatus.status || '').toUpperCase()
    const elapsedRatio = Math.min(0.7, (Date.now() - started) / TIMEOUT_MS)
    const progress = Math.max(20, Math.min(90, Math.round(20 + elapsedRatio * 70)))
    db.update(schema.videoUpscaleJobs).set({
      progress,
      updatedAt: now(),
    }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()

    if (st === 'SUCCESS') {
      await finalizeSuccess(jobId, taskId, lastStatus.results)
      return
    }
    if (st === 'FAILED' || st === 'ERROR' || st === 'CANCELLED') {
      throw new Error(extractRemoteFailureMessage(lastStatus))
    }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
  throw new Error('超分任务超时，请稍后重试')
}

export async function processVideoUpscaleJob(jobId: number) {
  if (activeJobs.has(jobId)) return

  const [early] = db.select().from(schema.videoUpscaleJobs)
    .where(and(eq(schema.videoUpscaleJobs.id, jobId), isNull(schema.videoUpscaleJobs.deletedAt)))
    .all()
  if (!early) return
  if (early.status === 'completed') return

  // 通道8 橙星原生超分（2K）：不走 RunningHub
  const { isFunshionEnhanceInstance, processFunshionEnhanceJob } = await import('./funshion-web-enhance.js')
  if (isFunshionEnhanceInstance(early.instanceType)) {
    await processFunshionEnhanceJob(jobId)
    return
  }

  activeJobs.add(jobId)
  try {
    const [row] = db.select().from(schema.videoUpscaleJobs)
      .where(and(eq(schema.videoUpscaleJobs.id, jobId), isNull(schema.videoUpscaleJobs.deletedAt)))
      .all()
    if (!row || !row.sourceVideoPath) return
    if (row.status === 'completed') return

    const abs = resolveMediaFilePath(row.sourceVideoPath)
    if (!abs || !fs.existsSync(abs)) {
      await failJob(jobId, '源视频文件不存在', row.creditTransactionId)
      return
    }

    // 已有上游 taskId：只跟跑，禁止再次提交（避免孤儿任务占满并发）
    const existingTaskId = String(row.remoteTaskId || '').trim()
    if (existingTaskId) {
      await pollExistingRemoteTask(jobId, existingTaskId)
      return
    }

    if (row.status === 'failed') return

    // 排队等待超分槽位（最多 2），拿到后再上传/提交，避免挤占 TTS
    if (row.status === 'queued') {
      db.update(schema.videoUpscaleJobs).set({
        progress: 1,
        updatedAt: now(),
      }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()
    }

    await withRunningHubSlot('upscale', async () => {
      // 进槽后再读一次，避免排队期间已被其它路径写入 remoteTaskId
      const [fresh] = db.select().from(schema.videoUpscaleJobs)
        .where(eq(schema.videoUpscaleJobs.id, jobId))
        .all()
      const freshTaskId = String(fresh?.remoteTaskId || '').trim()
      if (freshTaskId) {
        await pollExistingRemoteTask(jobId, freshTaskId)
        return
      }

      const cfg = resolveRunningHubIndexTts2Config()
      const client = new RunningHubClient(cfg.apiKey, cfg.apiBase)
      logTaskStart('SeedVR2.5', 'upload', { jobId, path: row.sourceVideoPath })

      db.update(schema.videoUpscaleJobs).set({
        status: 'uploading',
        progress: 5,
        errorMsg: null,
        updatedAt: now(),
      }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()

      const uploaded = await client.uploadForComfyInput(abs)
      const fileRef = String(uploaded.fileName || uploaded.download_url || '').trim()
      if (!fileRef) throw new Error('视频上传失败，请稍后重试')
      logTaskProgress('SeedVR2.5', 'uploaded', { jobId, fileRef: fileRef.slice(0, 120), size: uploaded.size })

      db.update(schema.videoUpscaleJobs).set({
        status: 'processing',
        progress: 15,
        updatedAt: now(),
      }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()

      const submitted = await client.runWorkflow({
        workflowId: RUNNINGHUB_SEEDVR25_WORKFLOW_ID,
        instanceType: row.instanceType || RUNNINGHUB_SEEDVR25_INSTANCE_TYPE,
        nodeInfoList: [
          {
            nodeId: RUNNINGHUB_SEEDVR25_VIDEO_NODE.nodeId,
            fieldName: RUNNINGHUB_SEEDVR25_VIDEO_NODE.fieldName,
            fieldValue: fileRef,
          },
        ],
      })
      const taskId = submitted.taskId
      if (!taskId) throw new Error('提交超分任务失败，请稍后重试')

      db.update(schema.videoUpscaleJobs).set({
        remoteTaskId: taskId,
        progress: 20,
        updatedAt: now(),
      }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()

      logTaskProgress('SeedVR2.5', 'submitted', {
        jobId,
        taskId,
        workflowId: RUNNINGHUB_SEEDVR25_WORKFLOW_ID,
      })

      await pollExistingRemoteTask(jobId, taskId)
    }, { jobId })
  } catch (err: any) {
    const [row] = db.select().from(schema.videoUpscaleJobs)
      .where(eq(schema.videoUpscaleJobs.id, jobId))
      .all()
    const msg = String(err?.message || err || '超分失败')
    logTaskError('SeedVR2.5', 'failed', { jobId, error: msg })
    // 若本地已有 remoteTaskId，说明上游可能仍在跑：失败时不退款，避免重复扣费/误退
    const hasRemote = !!String(row?.remoteTaskId || '').trim()
    await failJob(
      jobId,
      publicUpscaleError(msg),
      row?.creditTransactionId,
      { refund: !hasRemote },
    )
  } finally {
    activeJobs.delete(jobId)
  }
}

/**
 * 把上游已存在的 taskId 挂回本地任务列表并开始跟跑。
 * 用于部署重启导致重复提交后的孤儿任务回收。
 */
export async function attachRemoteUpscaleTasks(opts: {
  remoteTaskIds: string[]
  templateJobId?: number
  /** 默认 true；脚本挂载时可 false，交给主进程 resume 跟跑 */
  startPolling?: boolean
}) {
  const taskIds = [...new Set(opts.remoteTaskIds.map(id => String(id || '').trim()).filter(Boolean))]
  if (!taskIds.length) return []
  const startPolling = opts.startPolling !== false

  let template = opts.templateJobId
    ? db.select().from(schema.videoUpscaleJobs)
      .where(eq(schema.videoUpscaleJobs.id, opts.templateJobId))
      .all()[0]
    : null
  if (!template) {
    template = db.select().from(schema.videoUpscaleJobs)
      .where(isNull(schema.videoUpscaleJobs.deletedAt))
      .orderBy(desc(schema.videoUpscaleJobs.id))
      .limit(1)
      .all()[0] || null
  }
  if (!template?.sourceVideoPath) {
    throw new Error('找不到可用于挂载的本地源视频任务')
  }

  const cfg = resolveRunningHubIndexTts2Config()
  const client = new RunningHubClient(cfg.apiKey, cfg.apiBase)
  const attachedIds: number[] = []

  for (const taskId of taskIds) {
    const existing = db.select().from(schema.videoUpscaleJobs)
      .where(and(
        eq(schema.videoUpscaleJobs.remoteTaskId, taskId),
        isNull(schema.videoUpscaleJobs.deletedAt),
      ))
      .all()[0]

    let remote: RunningHubTaskStatus
    try {
      remote = await client.queryTask(taskId)
    } catch (err: any) {
      logTaskError('SeedVR2.5', 'attach-query-failed', { taskId, error: String(err?.message || err) })
      continue
    }
    const st = String(remote.status || '').toUpperCase()
    if (!st) continue

    let jobId = existing?.id
    if (!jobId) {
      const ts = now()
      const insert = db.insert(schema.videoUpscaleJobs).values({
        title: template.title || `upstream-${taskId.slice(-6)}.mp4`,
        userId: template.userId,
        teamId: template.teamId ?? null,
        status: st === 'FAILED' || st === 'ERROR' || st === 'CANCELLED' ? 'failed' : 'processing',
        sourceVideoPath: template.sourceVideoPath,
        durationSec: template.durationSec ?? null,
        fileSize: template.fileSize ?? null,
        instanceType: template.instanceType || RUNNINGHUB_SEEDVR25_INSTANCE_TYPE,
        remoteTaskId: taskId,
        creditTransactionId: null, // 不重复扣费
        progress: st === 'SUCCESS' ? 90 : 20,
        errorMsg: null,
        createdAt: ts,
        updatedAt: ts,
      }).run()
      jobId = Number(insert.lastInsertRowid)
      logTaskProgress('SeedVR2.5', 'attached-orphan', { jobId, taskId, status: st })
    } else if (existing && existing.status === 'failed') {
      if (st !== 'SUCCESS' && st !== 'FAILED' && st !== 'ERROR' && st !== 'CANCELLED') {
        db.update(schema.videoUpscaleJobs).set({
          status: 'processing',
          progress: 20,
          errorMsg: null,
          updatedAt: now(),
        }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()
      }
    }

    if (!jobId) continue
    attachedIds.push(jobId)

    if (st === 'SUCCESS') {
      try {
        await finalizeSuccess(jobId, taskId, remote.results)
      } catch (err: any) {
        await failJob(jobId, publicUpscaleError(String(err?.message || err)), null, { refund: false })
      }
      continue
    }
    if (st === 'FAILED' || st === 'ERROR' || st === 'CANCELLED') {
      await failJob(jobId, publicUpscaleError(extractRemoteFailureMessage(remote)), null, { refund: false })
      continue
    }

    if (startPolling) void processVideoUpscaleJob(jobId)
  }

  return attachedIds
}

/** 启动时恢复未完成任务（按 id ASC，保证本地 FIFO 排队顺序） */
export function resumePendingVideoUpscaleJobs() {
  const rows = db.select({ id: schema.videoUpscaleJobs.id })
    .from(schema.videoUpscaleJobs)
    .where(and(
      isNull(schema.videoUpscaleJobs.deletedAt),
      inArray(schema.videoUpscaleJobs.status, ['queued', 'uploading', 'processing']),
    ))
    .orderBy(asc(schema.videoUpscaleJobs.id))
    .limit(50)
    .all()
  for (const row of rows) {
    void processVideoUpscaleJob(row.id)
  }
  if (rows.length) {
    logTaskProgress('SeedVR2.5', 'resume', { count: rows.length })
  }
}
