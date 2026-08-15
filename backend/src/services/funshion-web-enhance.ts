/**
 * 通道8 后处理超分：橙星 storyboard video-enhance，固定 2K
 */
import { and, eq, isNull } from 'drizzle-orm'
import {
  FUNSHION_ENHANCE_CLARITY,
  FUNSHION_ENHANCE_INSTANCE_TYPE,
  FUNSHION_TAB_APP_CODE,
} from '../constants/funshion-web.js'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { downloadFile } from '../utils/storage.js'
import { tryRefundCharge } from '../utils/credit-charge.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import {
  extractFunshionVideoResId,
  getFunshionEnhanceInput,
  listFunshionProjectResources,
  pollFunshionEnhanceTask,
  submitFunshionEnhanceTask,
} from './funshion-web-client.js'
import { getFunshionWebSession } from './funshion-web-session.js'
import { resolveFunshionSessionForStyle } from '../utils/funshion-web-video-options.js'

const POLL_MS = 8000
const TIMEOUT_MS = 45 * 60_000
const activeJobs = new Set<number>()

export function isFunshionEnhanceInstance(instanceType?: string | null): boolean {
  const raw = String(instanceType || '').trim().toLowerCase()
  return raw === FUNSHION_ENHANCE_INSTANCE_TYPE || raw.startsWith('funshion_')
}

function parseStylePart(style: string | null | undefined, key: string): string | null {
  const raw = String(style || '')
  const m = raw.match(new RegExp(`\\|${key}:([^|]+)`))
  return m?.[1]?.trim() || null
}

async function failJob(jobId: number, message: string, creditTxId?: number | null) {
  db.update(schema.videoUpscaleJobs).set({
    status: 'failed',
    errorMsg: message,
    progress: 0,
    updatedAt: now(),
  }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()

  if (creditTxId) {
    try {
      tryRefundCharge(creditTxId, {
        summary: '通道8超分失败退款',
        metadata: { reason: message },
      })
    } catch (err: any) {
      logTaskError('FunshionEnhance', 'refund-failed', { jobId, error: String(err?.message || err) })
    }
  }
}

async function resolveVideoResId(opts: {
  session: NonNullable<ReturnType<typeof getFunshionWebSession>>
  projectId: string
  tab: string
  video: typeof schema.videoGenerations.$inferSelect
}): Promise<string> {
  const fromUrl = extractFunshionVideoResId(opts.video.videoUrl, opts.video.localPath)
  if (fromUrl) {
    try {
      await getFunshionEnhanceInput(opts.session, fromUrl)
      return fromUrl
    } catch {
      /* fall through to list match */
    }
  }

  const taskId = String(opts.video.taskId || '').trim()
  if (taskId) {
    const list = await listFunshionProjectResources(opts.session, opts.projectId, opts.tab)
    const hit = list.find((item) => {
      const okTask = String(item?.taskId || '') === taskId
      const st = String(item?.taskStatus || '').toUpperCase()
      return okTask && (st === 'SUCCESS' || st === 'COMPLETED' || st === '1')
    })
    if (hit?.id) {
      const id = String(hit.id)
      await getFunshionEnhanceInput(opts.session, id)
      return id
    }
  }

  throw new Error('找不到橙星视频资源，请使用通道8生成的原片做超分')
}

export async function processFunshionEnhanceJob(jobId: number) {
  if (activeJobs.has(jobId)) return
  activeJobs.add(jobId)
  try {
    const [row] = db.select().from(schema.videoUpscaleJobs)
      .where(and(eq(schema.videoUpscaleJobs.id, jobId), isNull(schema.videoUpscaleJobs.deletedAt)))
      .all()
    if (!row) return
    if (row.status === 'completed') return
    if (row.status === 'failed' && !row.remoteTaskId) return

    const videoGenerationId = Number(row.videoGenerationId || 0)
    if (!videoGenerationId) {
      await failJob(jobId, '缺少关联视频', row.creditTransactionId)
      return
    }
    const [video] = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.id, videoGenerationId))
      .all()
    if (!video) {
      await failJob(jobId, '关联视频不存在', row.creditTransactionId)
      return
    }

    const session = resolveFunshionSessionForStyle(video.style) || getFunshionWebSession()
    if (!session?.token) {
      await failJob(jobId, 'S通道8 未配置 Token', row.creditTransactionId)
      return
    }
    const projectId = parseStylePart(video.style, 'project') || String(session.projectId || '').trim()
    if (!projectId) {
      await failJob(jobId, '缺少橙星项目 ID', row.creditTransactionId)
      return
    }
    const tab = parseStylePart(video.style, 'tab') || FUNSHION_TAB_APP_CODE

    let taskId = String(row.remoteTaskId || '').trim()
    let enhanceResourceId = ''

    // remoteTaskId 格式：taskId 或 taskId|resourceId
    if (taskId.includes('|')) {
      const [t, r] = taskId.split('|')
      taskId = String(t || '').trim()
      enhanceResourceId = String(r || '').trim()
    }

    if (!taskId) {
      logTaskStart('FunshionEnhance', 'submit', { jobId, videoGenerationId, clarity: FUNSHION_ENHANCE_CLARITY })
      db.update(schema.videoUpscaleJobs).set({
        status: 'uploading',
        progress: 5,
        errorMsg: null,
        updatedAt: now(),
      }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()

      const videoResId = await resolveVideoResId({ session, projectId, tab, video })
      const submitted = await submitFunshionEnhanceTask(session, {
        videoResId,
        clarity: FUNSHION_ENHANCE_CLARITY,
      })
      taskId = submitted.taskId
      enhanceResourceId = submitted.resourceId
      const remoteKey = enhanceResourceId ? `${taskId}|${enhanceResourceId}` : taskId
      db.update(schema.videoUpscaleJobs).set({
        status: 'processing',
        progress: 15,
        remoteTaskId: remoteKey,
        instanceType: FUNSHION_ENHANCE_INSTANCE_TYPE,
        updatedAt: now(),
      }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()
      logTaskSuccess('FunshionEnhance', 'submitted', { jobId, taskId, enhanceResourceId })
    } else {
      db.update(schema.videoUpscaleJobs).set({
        status: 'processing',
        progress: Math.max(15, Number(row.progress) || 15),
        errorMsg: null,
        updatedAt: now(),
      }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()
    }

    const started = Date.now()
    while (Date.now() - started < TIMEOUT_MS) {
      const poll = await pollFunshionEnhanceTask(session, projectId, taskId, tab, enhanceResourceId || null)
      const elapsedRatio = Math.min(0.75, (Date.now() - started) / TIMEOUT_MS)
      const progress = Math.max(20, Math.min(90, Math.round(20 + elapsedRatio * 70)))
      db.update(schema.videoUpscaleJobs).set({
        progress,
        updatedAt: now(),
      }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()

      if (poll.status === 'completed' && poll.videoUrl) {
        const localPath = await downloadFile(poll.videoUrl, 'videos/upscale', { syncOss: true })
        db.update(schema.videoUpscaleJobs).set({
          status: 'completed',
          progress: 100,
          outputVideoPath: localPath,
          errorMsg: null,
          updatedAt: now(),
        }).where(eq(schema.videoUpscaleJobs.id, jobId)).run()
        logTaskSuccess('FunshionEnhance', 'done', { jobId, taskId, localPath })
        return
      }
      if (poll.status === 'failed') {
        throw new Error(poll.error || '橙星超分失败')
      }
      logTaskProgress('FunshionEnhance', 'poll', { jobId, taskId, progress })
      await new Promise(r => setTimeout(r, POLL_MS))
    }
    throw new Error('超分任务超时，请稍后重试')
  } catch (err: any) {
    const [row] = db.select().from(schema.videoUpscaleJobs)
      .where(eq(schema.videoUpscaleJobs.id, jobId))
      .all()
    const msg = String(err?.message || err || '超分失败')
    logTaskError('FunshionEnhance', 'failed', { jobId, error: msg })
    await failJob(jobId, msg, row?.creditTransactionId)
  } finally {
    activeJobs.delete(jobId)
  }
}
