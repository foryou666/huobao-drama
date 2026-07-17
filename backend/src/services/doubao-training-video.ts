import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { failVideoGeneration } from '../utils/generation-failure.js'
import { logTaskError, logTaskProgress, logTaskSuccess } from '../utils/task-logger.js'
import type { VideoGenerationRecord } from './adapters/types.js'
import { generateDoubaoTrainingVideo } from './doubao-training-client.js'
import {
  formatDoubaoTrainingSessionStyle,
  pickDoubaoTrainingSessionWithQuota,
  resolveDoubaoTrainingSessionForStyle,
} from '../utils/doubao-training-video-options.js'
import { incrementDoubaoSessionDailyUsage } from '../utils/doubao-training-quota.js'
import {
  DOUBAO_TRAINING_DEFAULT_MODEL,
  normalizeDoubaoTrainingAspectRatio,
  normalizeDoubaoTrainingDuration,
  normalizeDoubaoTrainingModel,
} from '../constants/doubao-training.js'

export function buildDoubaoTrainingVirtualConfig(model?: string | null) {
  return {
    id: 0,
    provider: 'doubao_training',
    baseUrl: 'https://www.doubao.com',
    apiKey: '',
    model: normalizeDoubaoTrainingModel(model || DOUBAO_TRAINING_DEFAULT_MODEL),
    settings: {},
  }
}

export async function processDoubaoTrainingVideoGeneration(id: number) {
  const [record] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id)).all()
  if (!record) return

  try {
    const preferredId = parseDoubaoTrainingSessionIdFromStyle(record.style)
    const session = pickDoubaoTrainingSessionWithQuota(preferredId)
    if (!session) {
      throw new Error('所有豆包培训账号今日额度已用完，请明天再试或联系管理员添加账号')
    }

    logTaskProgress('VideoTask', 'doubao-training-submit', {
      id,
      sessionId: session.id,
      model: record.model,
    })

    const model = normalizeDoubaoTrainingModel(record.model)
    const videoUrl = await generateDoubaoTrainingVideo({
      session,
      prompt: String(record.prompt || ''),
      ratio: normalizeDoubaoTrainingAspectRatio(record.aspectRatio),
      duration: normalizeDoubaoTrainingDuration(record.duration),
      model,
    })

    incrementDoubaoSessionDailyUsage(session.id)

    db.update(schema.videoGenerations)
      .set({
        taskId: `doubao-training-${id}`,
        style: formatDoubaoTrainingSessionStyle(session.id),
        status: 'processing',
        updatedAt: now(),
      })
      .where(eq(schema.videoGenerations.id, id))
      .run()

    logTaskSuccess('VideoTask', 'doubao-training-complete', { id, videoUrl })
    const { handleVideoComplete } = await import('./video-generation.js')
    await handleVideoComplete(id, videoUrl, record.duration, record.storyboardId)
  } catch (err: any) {
    logTaskError('VideoTask', 'doubao-training-submit', { id, error: err.message })
    failVideoGeneration(id, err.message)
  }
}

function parseDoubaoTrainingSessionIdFromStyle(style?: string | null): string | null {
  const raw = String(style || '').trim()
  const prefix = 'doubao_training_session:'
  if (!raw.startsWith(prefix)) return null
  return raw.slice(prefix.length).trim() || null
}

export async function pollDoubaoTrainingVideoOnce(_taskId: string, style?: string | null) {
  const session = resolveDoubaoTrainingSessionForStyle(style)
  if (!session) throw new Error('豆包培训 Session 未配置')
  return { status: 'processing' as const }
}

export type { VideoGenerationRecord }
