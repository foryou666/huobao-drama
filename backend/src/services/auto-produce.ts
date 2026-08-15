/**
 * 一键出片：剧本 → 分镜 → 批量视频 → 合成拼接
 */
import { randomUUID } from 'crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { Context } from 'hono'
import { createAgent } from '../agents/index.js'
import { db, schema } from '../db/index.js'
import { getAuthUser, type AuthUser } from '../middleware/auth.js'
import { buildAgentChatMessages, runAgentGenerate } from './agent-chat.js'
import {
  commitScriptImport,
  getScriptImportStatus,
  startScriptImportExtract,
} from './script-import.js'
import { generateVideo } from './video-generation.js'
import { composeStoryboard } from './ffmpeg-compose.js'
import { mergeEpisodeVideos } from './ffmpeg-merge.js'
import { buildOrderedStoryboardContentRefs } from '../utils/video-content-refs.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

export type AutoProduceStepKey =
  | 'import'
  | 'extract'
  | 'storyboard'
  | 'videos'
  | 'compose'
  | 'merge'

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface AutoProduceStepState {
  key: AutoProduceStepKey
  label: string
  status: StepStatus
  detail?: string | null
}

export interface AutoProduceOptions {
  clipCount: number
  durationSec: number
  aspectRatio: '16:9' | '9:16'
  dialogueLock: boolean
  generateImages: boolean
  directorStyle?: string
}

export interface AutoProduceJob {
  id: string
  userId: number
  title: string
  scriptText: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  steps: AutoProduceStepState[]
  options: AutoProduceOptions
  dramaId: number | null
  episodeId: number | null
  episodeNumber: number | null
  error: string | null
  result: {
    mergedUrl?: string | null
    storyboardCount?: number
    videoCount?: number
    dramaId?: number
    episodeId?: number
  } | null
  createdAt: string
  updatedAt: string
}

const jobs = new Map<string, AutoProduceJob>()
const running = new Set<string>()

const STEP_DEFS: Array<{ key: AutoProduceStepKey; label: string }> = [
  { key: 'import', label: '导入剧本' },
  { key: 'extract', label: '提取资产' },
  { key: 'storyboard', label: '拆解分镜' },
  { key: 'videos', label: '生成视频' },
  { key: 'compose', label: '合成镜头' },
  { key: 'merge', label: '拼接成片' },
]

function stamp(job: AutoProduceJob) {
  job.updatedAt = new Date().toISOString()
  jobs.set(job.id, job)
  return job
}

function setStep(job: AutoProduceJob, key: AutoProduceStepKey, status: StepStatus, detail?: string | null) {
  const step = job.steps.find((s) => s.key === key)
  if (step) {
    step.status = status
    step.detail = detail ?? step.detail ?? null
  }
  stamp(job)
}

function ensureEpisodeMarker(scriptText: string) {
  const text = String(scriptText || '').trim()
  if (!text) return text
  if (/第\s*\d+\s*集/.test(text)) return text
  return `第1集\n${text}`
}

function publicJob(job: AutoProduceJob) {
  return {
    id: job.id,
    user_id: job.userId,
    title: job.title,
    status: job.status,
    steps: job.steps,
    options: {
      clip_count: job.options.clipCount,
      duration_sec: job.options.durationSec,
      aspect_ratio: job.options.aspectRatio,
      dialogue_lock: job.options.dialogueLock,
      generate_images: job.options.generateImages,
      director_style: job.options.directorStyle || null,
    },
    drama_id: job.dramaId,
    episode_id: job.episodeId,
    episode_number: job.episodeNumber,
    error: job.error,
    result: job.result
      ? {
          drama_id: job.result.dramaId ?? null,
          episode_id: job.result.episodeId ?? null,
          storyboard_count: job.result.storyboardCount ?? null,
          video_count: job.result.videoCount ?? null,
          merged_url: job.result.mergedUrl ?? null,
        }
      : null,
    script_chars: job.scriptText.length,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  }
}

export function listAutoProduceJobs(userId: number, limit = 20) {
  return [...jobs.values()]
    .filter((j) => j.userId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
    .map(publicJob)
}

export function getAutoProduceJob(id: string, userId?: number) {
  const job = jobs.get(id)
  if (!job) return null
  if (userId != null && job.userId !== userId) return null
  return publicJob(job)
}

export function createAutoProduceJob(
  c: Context,
  input: {
    title: string
    script_text: string
    options?: Partial<AutoProduceOptions>
  },
) {
  const user = getAuthUser(c)
  if (!user) throw new Error('未登录')

  const title = String(input.title || '').trim()
  const scriptText = ensureEpisodeMarker(input.script_text)
  if (!title) throw new Error('请填写项目名称')
  if (!scriptText || scriptText.length < 20) throw new Error('剧本内容过短')

  const options: AutoProduceOptions = {
    clipCount: Math.min(12, Math.max(3, Number(input.options?.clipCount || 5))),
    durationSec: Math.min(15, Math.max(8, Number(input.options?.durationSec || 15))),
    aspectRatio: input.options?.aspectRatio === '9:16' ? '9:16' : '16:9',
    dialogueLock: input.options?.dialogueLock !== false,
    generateImages: input.options?.generateImages === true,
    directorStyle: input.options?.directorStyle || 'hongguo',
  }

  const job: AutoProduceJob = {
    id: randomUUID(),
    userId: user.id,
    title,
    scriptText,
    status: 'queued',
    steps: STEP_DEFS.map((s) => ({ key: s.key, label: s.label, status: 'pending', detail: null })),
    options,
    dramaId: null,
    episodeId: null,
    episodeNumber: null,
    error: null,
    result: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  jobs.set(job.id, job)
  void runAutoProduceJob(c, job.id, user).catch(() => {})
  return publicJob(job)
}

async function waitExtractDone(dramaId: number, timeoutMs = 12 * 60 * 1000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const st = getScriptImportStatus(dramaId)
    const stage = st?.script_import?.stage
    if (stage === 'extracted' || stage === 'done') return st
    if (stage === 'error') throw new Error(st?.script_import?.error || '资产提取失败')
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('资产提取超时')
}

async function waitVideosDone(dramaId: number, episodeId: number, timeoutMs = 30 * 60 * 1000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const sbs = db.select().from(schema.storyboards)
      .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt)))
      .all()
    if (!sbs.length) throw new Error('没有分镜可生成视频')
    const withVideo = sbs.filter((s) => s.videoUrl)
    const sbIds = new Set(sbs.map((s) => s.id))
    const pendingGens = db.select().from(schema.videoGenerations)
      .where(eq(schema.videoGenerations.dramaId, dramaId))
      .all()
      .filter((g) => g.storyboardId != null && sbIds.has(g.storyboardId) && (g.status === 'pending' || g.status === 'processing'))

    if (withVideo.length >= sbs.length && pendingGens.length === 0) {
      return { total: sbs.length, done: withVideo.length }
    }
    // 若已有失败且无 pending，也结束（部分成功）
    if (pendingGens.length === 0 && withVideo.length > 0) {
      return { total: sbs.length, done: withVideo.length }
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('视频生成超时')
}

function buildStoryboardMessage(options: AutoProduceOptions) {
  const lock = options.dialogueLock
    ? '台词纪律：分镜 dialogue 与 video_prompt 中的对白/VO/OS 必须使用剧本原句，禁止改写、删减、同义替换。'
    : ''
  return [
    `请把当前集拆成约 ${options.clipCount} 个镜头（每镜 ${options.durationSec} 秒，画幅 ${options.aspectRatio}）。`,
    '每个镜头写完整 video_prompt（按 3 秒分段时间轴），并绑定角色/场景。',
    '镜头之间用硬切衔接，结尾帧要能接下一条。',
    lock,
    '完成后调用 save_storyboards 保存。不要生成视频。',
  ].filter(Boolean).join('\n')
}

async function runStoryboardAgent(dramaId: number, episodeId: number, options: AutoProduceOptions) {
  const agent = createAgent('storyboard_breaker', episodeId, dramaId)
  if (!agent) throw new Error('分镜 Agent 不可用，请检查 Agent 配置')
  const messages = buildAgentChatMessages([], buildStoryboardMessage(options))
  await runAgentGenerate(agent, messages, { maxSteps: 24 })
}

async function batchStartVideos(dramaId: number, episodeId: number, options: AutoProduceOptions, userId: number) {
  const [ep] = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).all()
  if (!ep) throw new Error('剧集不存在')

  const sbs = db.select().from(schema.storyboards)
    .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt)))
    .all()
  if (!sbs.length) throw new Error('分镜拆解未产出镜头，请重试或检查剧本')

  const started: number[] = []
  const failed: Array<{ id: number; error: string }> = []
  for (const sb of sbs) {
    if (sb.videoUrl) continue
    try {
      const prompt = String(sb.videoPrompt || sb.description || sb.action || sb.title || '').trim()
      if (!prompt) {
        failed.push({ id: sb.id, error: '缺少 video_prompt' })
        continue
      }
      const contentRefs = buildOrderedStoryboardContentRefs(sb, dramaId, prompt)
      const genId = await generateVideo({
        storyboardId: sb.id,
        dramaId,
        prompt,
        referenceMode: 'reference',
        duration: options.durationSec,
        aspectRatio: options.aspectRatio,
        contentRefs: contentRefs.length ? contentRefs : undefined,
        configId: ep.videoConfigId ?? undefined,
        userId,
      })
      started.push(genId)
    } catch (err: any) {
      failed.push({ id: sb.id, error: err?.message || '提交失败' })
    }
  }
  return { started: started.length, failed, total: sbs.length }
}

async function runComposeAll(episodeId: number) {
  const sbs = db.select().from(schema.storyboards)
    .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt)))
    .all()
    .filter((s) => s.videoUrl)
  let ok = 0
  for (const sb of sbs) {
    try {
      await composeStoryboard(sb.id)
      ok += 1
    } catch {
      // 无配音时 compose 可能失败：仍允许直接 merge 原视频
    }
  }
  return { ok, total: sbs.length }
}

async function runAutoProduceJob(c: Context, jobId: string, user: AuthUser) {
  if (running.has(jobId)) return
  running.add(jobId)
  const job = jobs.get(jobId)
  if (!job) {
    running.delete(jobId)
    return
  }

  job.status = 'running'
  stamp(job)
  logTaskStart('AutoProduce', jobId, { title: job.title, userId: user.id })

  try {
    // 1) import
    setStep(job, 'import', 'running')
    const committed = commitScriptImport(c, {
      title: job.title,
      script_text: job.scriptText,
      director_style: job.options.directorStyle || 'hongguo',
      style: job.options.aspectRatio === '9:16' ? '竖屏短剧' : '横屏短剧',
    })
    job.dramaId = committed.drama_id
    const eps = db.select().from(schema.episodes)
      .where(eq(schema.episodes.dramaId, committed.drama_id))
      .orderBy(schema.episodes.episodeNumber)
      .all()
    const ep = eps[0]
    if (!ep) throw new Error('导入后未找到剧集')
    job.episodeId = ep.id
    job.episodeNumber = ep.episodeNumber
    setStep(job, 'import', 'done', `项目 #${committed.drama_id} · 第${ep.episodeNumber}集`)

    // 2) extract
    setStep(job, 'extract', 'running')
    startScriptImportExtract(committed.drama_id, user)
    await waitExtractDone(committed.drama_id)
    setStep(job, 'extract', 'done', '角色/场景/道具文字已提取')

    // 3) storyboard
    setStep(job, 'storyboard', 'running', `目标约 ${job.options.clipCount} 镜`)
    await runStoryboardAgent(committed.drama_id, ep.id, job.options)
    const sbCount = db.select().from(schema.storyboards)
      .where(and(eq(schema.storyboards.episodeId, ep.id), isNull(schema.storyboards.deletedAt)))
      .all().length
    if (!sbCount) throw new Error('分镜拆解未产出镜头')
    setStep(job, 'storyboard', 'done', `${sbCount} 个镜头`)

    // 4) videos
    setStep(job, 'videos', 'running')
    const videoKick = await batchStartVideos(committed.drama_id, ep.id, job.options, user.id)
    setStep(job, 'videos', 'running', `已提交 ${videoKick.started}/${videoKick.total}` + (videoKick.failed.length ? ` · 失败 ${videoKick.failed.length}` : ''))
    if (videoKick.started === 0 && videoKick.failed.length) {
      throw new Error(videoKick.failed.map((f) => `#${f.id}:${f.error}`).join('；'))
    }
    const videoWait = await waitVideosDone(committed.drama_id, ep.id)
    setStep(job, 'videos', 'done', `${videoWait.done}/${videoWait.total} 镜完成`)

    // 5) compose
    setStep(job, 'compose', 'running')
    const composed = await runComposeAll(ep.id)
    setStep(job, 'compose', composed.ok ? 'done' : 'skipped', `合成 ${composed.ok}/${composed.total}（无配音可跳过）`)

    // 6) merge
    setStep(job, 'merge', 'running')
    const mergeId = await mergeEpisodeVideos(ep.id, committed.drama_id)
    // poll merge briefly
    let mergedUrl: string | null = null
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const [row] = db.select().from(schema.videoMerges).where(eq(schema.videoMerges.id, mergeId)).all()
      if (!row) break
      if (row.status === 'completed') {
        mergedUrl = row.mergedUrl || null
        break
      }
      if (row.status === 'failed') throw new Error(row.errorMsg || '拼接失败')
    }
    setStep(job, 'merge', 'done', mergedUrl ? '成片已就绪' : `任务 #${mergeId} 处理中`)

    job.status = 'completed'
    job.result = {
      dramaId: committed.drama_id,
      episodeId: ep.id,
      storyboardCount: sbCount,
      videoCount: videoWait.done,
      mergedUrl,
    }
    stamp(job)
    logTaskSuccess('AutoProduce', jobId, { dramaId: committed.drama_id, episodeId: ep.id })
  } catch (err: any) {
    const msg = err?.message || String(err)
    job.status = 'failed'
    job.error = msg
    const runningStep = job.steps.find((s) => s.status === 'running')
    if (runningStep) setStep(job, runningStep.key, 'error', msg)
    stamp(job)
    logTaskError('AutoProduce', jobId, { error: msg })
  } finally {
    running.delete(jobId)
  }
}
