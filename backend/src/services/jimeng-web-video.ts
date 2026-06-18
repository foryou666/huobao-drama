import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import {
  JIMENG_DRAFT_VERSION,
  JIMENG_VIDEO_REFERER,
  JIMENG_WEB_VERSION,
  getJimengVideoBenefitType,
  normalizeJimengAspectRatio,
  resolveJimengBillingSeconds,
  resolveJimengInternalModel,
} from '../constants/jimeng-web.js'
import { getJimengWebSession } from './jimeng-web-session.js'
import {
  jimengRequest,
  parseJimengHistoryStatus,
  uploadJimengImage,
} from './jimeng-web-client.js'
import { getAbsolutePath, parseDataUrl } from '../utils/storage.js'
import { parseVideoContentRefs } from '../utils/seedance-content.js'
import type { VideoGenerationRecord } from './adapters/types.js'
import { logTaskError, logTaskProgress, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { failVideoGeneration } from '../utils/generation-failure.js'

function readImageBuffer(ref: string): { buffer: Buffer; filename: string } | null {
  const raw = String(ref || '').trim()
  if (!raw) return null

  const parsed = parseDataUrl(raw)
  if (parsed) {
    const ext = parsed.mimeType.includes('jpeg') || parsed.mimeType.includes('jpg') ? 'jpg' : 'png'
    return {
      buffer: Buffer.from(parsed.data, 'base64'),
      filename: `reference.${ext}`,
    }
  }

  const staticPath = raw.replace(/^\/+/, '')
  if (staticPath.startsWith('static/')) {
    const absPath = getAbsolutePath(staticPath)
    if (!fs.existsSync(absPath)) return null
    const ext = path.extname(absPath).toLowerCase() || '.png'
    return {
      buffer: fs.readFileSync(absPath),
      filename: `reference${ext}`,
    }
  }

  return null
}

function collectReferencePaths(record: VideoGenerationRecord): string[] {
  const paths: string[] = []
  const push = (value?: string | null) => {
    const next = String(value || '').trim()
    if (!next || paths.includes(next)) return
    paths.push(next)
  }

  if (record.referenceMode === 'single' && record.imageUrl) push(record.imageUrl)
  if (record.referenceMode === 'first_last') {
    push(record.firstFrameUrl)
    push(record.lastFrameUrl)
  }
  if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
    try {
      const refs = JSON.parse(record.referenceImageUrls)
      if (Array.isArray(refs)) refs.forEach(item => push(String(item || '')))
    } catch { /* ignore */ }
  }

  for (const ref of parseVideoContentRefs(record.referencePayload)) {
    if (ref.type === 'image') push(ref.url)
  }

  return paths.slice(0, 2)
}

async function uploadReferenceImages(record: VideoGenerationRecord): Promise<string[]> {
  const session = getJimengWebSession()
  if (!session) throw new Error('即梦 Session 未配置，请管理员在「即梦视频」页粘贴 Cookie')

  const uris: string[] = []
  for (const ref of collectReferencePaths(record)) {
    const file = readImageBuffer(ref)
    if (!file) continue
    const uri = await uploadJimengImage(session, file.buffer, file.filename)
    uris.push(uri)
  }
  return uris
}

function buildFrameImage(uri: string) {
  return {
    format: '',
    height: 0,
    id: uuidv4(),
    image_uri: uri,
    name: '',
    platform_type: 1,
    source_from: 'upload',
    type: 'image',
    uri,
    width: 0,
  }
}

function buildGeneratePayload(record: VideoGenerationRecord, uploadIDs: string[]) {
  const internalModel = resolveJimengInternalModel(record.model)
  const actualDuration = resolveJimengBillingSeconds(record.model, record.duration)
  const durationMs = actualDuration * 1000
  const ratio = normalizeJimengAspectRatio(record.aspectRatio)
  const componentId = uuidv4()
  const originSubmitId = uuidv4()
  const functionMode = 'first_last_frames'

  const sceneOption = {
    type: 'video',
    scene: 'BasicVideoGenerateButton',
    modelReqKey: internalModel,
    videoDuration: actualDuration,
    materialTypes: [] as number[],
    reportParams: {
      enterSource: 'generate',
      vipSource: 'generate',
      extraVipFunctionKey: internalModel,
      useVipFunctionDetailsReporterHoc: true,
    },
  }

  const metricsExtra = JSON.stringify({
    promptSource: 'custom',
    isDefaultSeed: 1,
    originSubmitId,
    isRegenerate: false,
    enterFrom: 'use_bgimage_prompt',
    position: 'page_bottom_box',
    functionMode,
    sceneOptions: JSON.stringify([sceneOption]),
  })

  const first_frame_image = uploadIDs[0] ? buildFrameImage(uploadIDs[0]) : undefined
  const end_frame_image = uploadIDs[1] ? buildFrameImage(uploadIDs[1]) : undefined
  const benefitType = getJimengVideoBenefitType(internalModel)

  return {
    params: {
      aigc_features: 'app_lip_sync',
      web_version: JIMENG_WEB_VERSION,
      da_version: JIMENG_DRAFT_VERSION,
    },
    data: {
      extend: {
        root_model: internalModel,
        m_video_commerce_info: {
          benefit_type: benefitType,
          resource_id: 'generate_video',
          resource_id_type: 'str',
          resource_sub_type: 'aigc',
        },
        m_video_commerce_info_list: [{
          benefit_type: benefitType,
          resource_id: 'generate_video',
          resource_id_type: 'str',
          resource_sub_type: 'aigc',
        }],
      },
      submit_id: uuidv4(),
      metrics_extra: metricsExtra,
      draft_content: JSON.stringify({
        type: 'draft',
        id: uuidv4(),
        min_version: '3.0.5',
        min_features: [],
        is_from_tsn: true,
        version: JIMENG_DRAFT_VERSION,
        main_component_id: componentId,
        component_list: [{
          type: 'video_base_component',
          id: componentId,
          min_version: '1.0.0',
          aigc_mode: 'workbench',
          metadata: {
            type: '',
            id: uuidv4(),
            created_platform: 3,
            created_platform_version: '',
            created_time_in_ms: Date.now().toString(),
            created_did: '',
          },
          generate_type: 'gen_video',
          abilities: {
            type: '',
            id: uuidv4(),
            gen_video: {
              id: uuidv4(),
              type: '',
              text_to_video_params: {
                type: '',
                id: uuidv4(),
                video_gen_inputs: [{
                  type: '',
                  id: uuidv4(),
                  min_version: '3.0.5',
                  prompt: record.prompt,
                  video_mode: 2,
                  fps: 24,
                  duration_ms: durationMs,
                  first_frame_image,
                  end_frame_image,
                  idip_meta_list: [],
                }],
                video_aspect_ratio: ratio,
                seed: Math.floor(Math.random() * 4294967296),
                model_req_key: internalModel,
                priority: 0,
              },
              video_task_extra: metricsExtra,
            },
          },
          process_type: 1,
        }],
      }),
      http_common_info: {
        aid: 513695,
      },
    },
    headers: { Referer: JIMENG_VIDEO_REFERER },
  }
}

export async function submitJimengVideo(record: VideoGenerationRecord): Promise<string> {
  const session = getJimengWebSession()
  if (!session) throw new Error('即梦 Session 未配置，请管理员在「即梦视频」页粘贴 Cookie')

  const uploadIDs = await uploadReferenceImages(record)
  const payload = buildGeneratePayload(record, uploadIDs)
  const result = await jimengRequest<{ aigc_data?: { history_record_id?: string } }>(
    session,
    'POST',
    '/mweb/v1/aigc_draft/generate',
    payload,
  )

  const historyId = result?.aigc_data?.history_record_id
  if (!historyId) throw new Error('即梦未返回 history_record_id')
  return String(historyId)
}

export async function pollJimengVideoOnce(historyId: string) {
  const session = getJimengWebSession()
  if (!session) throw new Error('即梦 Session 未配置')

  const result = await jimengRequest<Record<string, unknown>>(session, 'POST', '/mweb/v1/get_history_by_ids', {
    data: { history_ids: [historyId] },
  })

  const historyData = (result as Record<string, unknown>)?.[historyId]
  return parseJimengHistoryStatus(historyData)
}

export async function pollJimengVideoTask(
  id: number,
  historyId: string,
  storyboardId?: number | null,
  duration?: number | null,
) {
  await new Promise(r => setTimeout(r, 5000))

  for (let i = 0; i < 180; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 0 : 10000))
    try {
      logTaskProgress('VideoTask', 'jimeng-poll', { id, historyId, attempt: i + 1 })
      const poll = await pollJimengVideoOnce(historyId)
      if (poll.status === 'completed' && poll.videoUrl) {
        logTaskSuccess('VideoTask', 'jimeng-complete', { id, historyId, videoUrl: poll.videoUrl })
        const { handleVideoComplete } = await import('./video-generation.js')
        await handleVideoComplete(id, poll.videoUrl, duration, storyboardId)
        return
      }
      if (poll.status === 'failed') {
        failVideoGeneration(id, poll.error || '即梦视频生成失败')
        return
      }
    } catch (err: any) {
      logTaskWarn('VideoTask', 'jimeng-poll-retry', { id, historyId, attempt: i + 1, error: err.message })
      if (i >= 179) {
        failVideoGeneration(id, `即梦轮询超时: ${err.message}`)
        return
      }
    }
  }
  failVideoGeneration(id, '即梦视频生成超时')
}

export async function processJimengWebVideoGeneration(id: number) {
  const [record] = db.select().from(schema.videoGenerations)
    .where(eq(schema.videoGenerations.id, id)).all()
  if (!record) return

  try {
    logTaskProgress('VideoTask', 'jimeng-submit', { id, model: record.model })
    const historyId = await submitJimengVideo(record as VideoGenerationRecord)
    db.update(schema.videoGenerations)
      .set({ taskId: historyId, status: 'processing', updatedAt: now() })
      .where(eq(schema.videoGenerations.id, id))
      .run()
    pollJimengVideoTask(id, historyId, record.storyboardId, record.duration).catch(err => {
      logTaskError('VideoTask', 'jimeng-poll', { id, error: err.message })
    })
  } catch (err: any) {
    logTaskError('VideoTask', 'jimeng-submit', { id, error: err.message })
    failVideoGeneration(id, err.message)
  }
}

export function buildJimengVirtualConfig(model?: string | null) {
  return {
    id: 0,
    provider: 'jimeng_web',
    baseUrl: 'https://jimeng.jianying.com',
    apiKey: '',
    model: model || 'jimeng-video-3.5-pro',
    settings: {},
  }
}
