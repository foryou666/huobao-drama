import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import {
  JIMENG_DEFAULT_VIDEO_MODEL,
  JIMENG_DRAFT_VERSION_OMNI,
  JIMENG_OMNI_MAX_TOTAL_REFS,
  JIMENG_REF_LIMITS,
  JIMENG_VIDEO_REFERER,
  JIMENG_WEB_VERSION,
  getJimengOmniBenefitType,
  jimengVideoModelLabel,
  normalizeJimengAspectRatio,
  resolveJimengBillingSeconds,
  resolveJimengInternalModel,
} from '../constants/jimeng-web.js'
import { resolveJimengSessionForStyle } from '../utils/jimeng-web-video-options.js'
import {
  jimengBrowserGenerateRequest,
  jimengRequest,
  parseJimengHistoryStatus,
  uploadJimengImage,
  uploadJimengMedia,
} from './jimeng-web-client.js'
import { getAbsolutePath, parseDataUrl } from '../utils/storage.js'
import { parseVideoContentRefs, type VideoContentRef } from '../utils/seedance-content.js'
import type { VideoGenerationRecord } from './adapters/types.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import { db, schema } from '../db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../utils/response.js'
import { failVideoGeneration } from '../utils/generation-failure.js'

type JimengMaterialType = 'image' | 'video' | 'audio'

interface UploadedJimengMaterial {
  type: JimengMaterialType
  uri?: string
  vid?: string
  width?: number
  height?: number
  durationMs?: number
  fps?: number
  name?: string
}

const MATERIAL_TYPE_CODE: Record<JimengMaterialType, number> = {
  image: 1,
  video: 2,
  audio: 3,
}

const EXT_MEDIA_TYPE: Record<string, JimengMaterialType> = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image', '.gif': 'image', '.bmp': 'image',
  '.mp4': 'video', '.mov': 'video', '.m4v': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio',
}

function detectMediaTypeFromPath(filePath: string): JimengMaterialType {
  const ext = path.extname(String(filePath || '')).toLowerCase()
  return EXT_MEDIA_TYPE[ext] || 'image'
}

function readMediaBuffer(ref: string): { buffer: Buffer; filename: string; mediaType: JimengMaterialType } | null {
  const raw = String(ref || '').trim()
  if (!raw) return null

  const parsed = parseDataUrl(raw)
  if (parsed) {
    const mime = parsed.mimeType.toLowerCase()
    let mediaType: JimengMaterialType = 'image'
    if (mime.startsWith('video/')) mediaType = 'video'
    else if (mime.startsWith('audio/')) mediaType = 'audio'
    const ext = mediaType === 'video' ? '.mp4' : mediaType === 'audio' ? '.mp3' : '.png'
    return {
      buffer: Buffer.from(parsed.data, 'base64'),
      filename: `reference${ext}`,
      mediaType,
    }
  }

  const staticPath = raw.replace(/^\/+/, '')
  if (staticPath.startsWith('static/')) {
    const absPath = getAbsolutePath(staticPath)
    if (!fs.existsSync(absPath)) return null
    const ext = path.extname(absPath).toLowerCase() || '.bin'
    return {
      buffer: fs.readFileSync(absPath),
      filename: `reference${ext}`,
      mediaType: detectMediaTypeFromPath(absPath),
    }
  }

  return null
}

function pushUniqueRef(bucket: VideoContentRef[], seen: Set<string>, ref: VideoContentRef) {
  const url = String(ref.url || '').trim()
  if (!url || seen.has(`${ref.type}:${url}`)) return
  seen.add(`${ref.type}:${url}`)
  bucket.push({ ...ref, url })
}

function collectOmniContentRefs(record: VideoGenerationRecord): {
  images: VideoContentRef[]
  videos: VideoContentRef[]
  audios: VideoContentRef[]
} {
  const images: VideoContentRef[] = []
  const videos: VideoContentRef[] = []
  const audios: VideoContentRef[] = []
  const seen = new Set<string>()

  const pushUrl = (type: JimengMaterialType, url?: string | null, label?: string) => {
    const next = String(url || '').trim()
    if (!next) return
    pushUniqueRef(
      type === 'image' ? images : type === 'video' ? videos : audios,
      seen,
      { type, url: next, label },
    )
  }

  if (record.referenceMode === 'single' && record.imageUrl) pushUrl('image', record.imageUrl)
  if (record.referenceMode === 'first_last') {
    pushUrl('image', record.firstFrameUrl, '首帧')
    pushUrl('image', record.lastFrameUrl, '尾帧')
  }
  if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
    try {
      const refs = JSON.parse(record.referenceImageUrls)
      if (Array.isArray(refs)) refs.forEach((item, idx) => pushUrl('image', String(item || ''), `参考图${idx + 1}`))
    } catch { /* ignore */ }
  }

  for (const ref of parseVideoContentRefs(record.referencePayload)) {
    if (ref.type === 'image') pushUniqueRef(images, seen, ref)
    else if (ref.type === 'video') pushUniqueRef(videos, seen, ref)
    else if (ref.type === 'audio') pushUniqueRef(audios, seen, ref)
  }

  return {
    images: images.slice(0, JIMENG_REF_LIMITS.images),
    videos: videos.slice(0, JIMENG_REF_LIMITS.videos),
    audios: audios.slice(0, JIMENG_REF_LIMITS.audios),
  }
}

function resolveSessionForRecord(record: VideoGenerationRecord) {
  const session = resolveJimengSessionForStyle(record.style)
  if (!session) {
    throw new Error('即梦 Session 未配置，请管理员在「设置 → AI 服务 → 即梦 Session」中配置')
  }
  return session
}

async function uploadOmniMaterials(
  session: ReturnType<typeof resolveJimengSessionForStyle>,
  refs: { images: VideoContentRef[]; videos: VideoContentRef[]; audios: VideoContentRef[] },
): Promise<UploadedJimengMaterial[]> {
  const orderedRefs = [...refs.images, ...refs.videos, ...refs.audios]
  const materials: UploadedJimengMaterial[] = []
  let totalVideoDurationSec = 0

  for (const ref of orderedRefs) {
    const file = readMediaBuffer(ref.url)
    if (!file) {
      throw new Error(`无法读取参考${ref.type === 'image' ? '图' : ref.type === 'video' ? '视频' : '音频'}：${ref.url}`)
    }

    if (file.mediaType === 'image' || ref.type === 'image') {
      const uri = await uploadJimengImage(session!, file.buffer, file.filename)
      materials.push({
        type: 'image',
        uri,
        name: ref.label || '',
      })
      continue
    }

    const mediaType = ref.type === 'audio' ? 'audio' : 'video'
    const vod = await uploadJimengMedia(session!, file.buffer, mediaType)
    if (mediaType === 'video') {
      totalVideoDurationSec += vod.durationMs / 1000
    }
    materials.push({
      type: mediaType,
      vid: vod.vid,
      width: vod.width,
      height: vod.height,
      durationMs: vod.durationMs,
      fps: vod.fps,
      name: ref.label || '',
    })
  }

  if (totalVideoDurationSec > 15) {
    throw new Error(`参考视频总时长 ${totalVideoDurationSec.toFixed(1)}s 超过 15 秒上限`)
  }

  return materials
}

function buildMaterialList(materials: UploadedJimengMaterial[]) {
  return materials.map((mat) => {
    const base = { type: '', id: uuidv4() }
    if (mat.type === 'image') {
      return {
        ...base,
        material_type: 'image',
        image_info: {
          type: 'image',
          id: uuidv4(),
          source_from: 'upload',
          platform_type: 1,
          name: mat.name || '',
          image_uri: mat.uri,
          aigc_image: { type: '', id: uuidv4() },
          width: 0,
          height: 0,
          format: '',
          uri: mat.uri,
        },
      }
    }
    if (mat.type === 'video') {
      return {
        ...base,
        material_type: 'video',
        video_info: {
          type: 'video',
          id: uuidv4(),
          source_from: 'upload',
          name: mat.name || '',
          vid: mat.vid,
          fps: mat.fps || 0,
          width: mat.width || 0,
          height: mat.height || 0,
          duration: mat.durationMs || 0,
        },
      }
    }
    return {
      ...base,
      material_type: 'audio',
      audio_info: {
        type: 'audio',
        id: uuidv4(),
        source_from: 'upload',
        vid: mat.vid,
        duration: mat.durationMs || 0,
        name: mat.name || '',
      },
    }
  })
}

function resolveMaterialIndex(
  materials: UploadedJimengMaterial[],
  type: JimengMaterialType,
  index: number,
): number {
  let count = 0
  for (let i = 0; i < materials.length; i++) {
    if (materials[i]!.type === type) {
      count += 1
      if (count === index) return i
    }
  }
  return -1
}

/** 解析 prompt 中的 @图片N / @视频N / @音频N 为 meta_list */
function buildOmniMetaList(prompt: string, materials: UploadedJimengMaterial[]) {
  const metaList: Array<{ meta_type: string; text?: string; material_ref?: { material_idx: number } }> = []
  const text = String(prompt || '')
  const pattern = /@?(?:图片|图|image)\s*(\d+)|@?(?:视频|video)\s*(\d+)|@?(?:音频|audio)\s*(\d+)/gi

  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index)
      if (segment) metaList.push({ meta_type: 'text', text: segment })
    }

    let materialIdx = -1
    let metaType: JimengMaterialType = 'image'
    if (match[1]) {
      materialIdx = resolveMaterialIndex(materials, 'image', Number(match[1]))
      metaType = 'image'
    } else if (match[2]) {
      materialIdx = resolveMaterialIndex(materials, 'video', Number(match[2]))
      metaType = 'video'
    } else if (match[3]) {
      materialIdx = resolveMaterialIndex(materials, 'audio', Number(match[3]))
      metaType = 'audio'
    }

    if (materialIdx >= 0) {
      metaList.push({
        meta_type: metaType,
        text: '',
        material_ref: { material_idx: materialIdx },
      })
    }

    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) {
    metaList.push({ meta_type: 'text', text: text.slice(lastIndex) })
  }

  if (!metaList.length) {
    if (text.trim()) {
      metaList.push({ meta_type: 'text', text })
    } else if (materials.length) {
      metaList.push({ meta_type: 'text', text: '使用参考素材生成视频' })
    }
  }

  return metaList
}

function buildGeneratePayload(record: VideoGenerationRecord, materials: UploadedJimengMaterial[]) {
  const internalModel = resolveJimengInternalModel(record.model)
  const actualDuration = resolveJimengBillingSeconds(record.model, record.duration)
  const durationMs = actualDuration * 1000
  const ratio = normalizeJimengAspectRatio(record.aspectRatio)
  const componentId = uuidv4()
  const originSubmitId = uuidv4()
  const functionMode = 'omni_reference'
  const materialTypes = [...new Set(materials.map(item => MATERIAL_TYPE_CODE[item.type]))]
  const hasVideoMaterial = materials.some(item => item.type === 'video')
  const benefitType = getJimengOmniBenefitType(internalModel)

  const material_list = buildMaterialList(materials)
  const meta_list = buildOmniMetaList(record.prompt || '', materials)

  const sceneOption = {
    type: 'video',
    scene: 'BasicVideoGenerateButton',
    modelReqKey: internalModel,
    videoDuration: actualDuration,
    materialTypes,
    reportParams: {
      enterSource: 'generate',
      vipSource: 'generate',
      extraVipFunctionKey: internalModel,
      useVipFunctionDetailsReporterHoc: true,
    },
  }

  const metricsExtra = JSON.stringify({
    position: 'page_bottom_box',
    isDefaultSeed: 1,
    originSubmitId,
    isRegenerate: false,
    enterFrom: 'click',
    functionMode,
    sceneOptions: JSON.stringify([sceneOption]),
    hasVideoMaterial,
  })

  return {
    params: {
      aigc_features: 'app_lip_sync',
      web_version: JIMENG_WEB_VERSION,
      da_version: JIMENG_DRAFT_VERSION_OMNI,
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
        min_version: JIMENG_DRAFT_VERSION_OMNI,
        min_features: ['AIGC_Video_UnifiedEdit'],
        is_from_tsn: true,
        version: JIMENG_DRAFT_VERSION_OMNI,
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
                  min_version: JIMENG_DRAFT_VERSION_OMNI,
                  prompt: '',
                  video_mode: 2,
                  fps: 24,
                  duration_ms: durationMs,
                  unified_edit_input: {
                    type: '',
                    id: uuidv4(),
                    material_list,
                    meta_list,
                  },
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
  const session = resolveSessionForRecord(record)
  const refs = collectOmniContentRefs(record)
  const totalCount = refs.images.length + refs.videos.length + refs.audios.length
  if (totalCount > JIMENG_OMNI_MAX_TOTAL_REFS) {
    throw new Error(`即梦全能参考素材总数不能超过 ${JIMENG_OMNI_MAX_TOTAL_REFS} 个`)
  }

  const materials = totalCount > 0 ? await uploadOmniMaterials(session, refs) : []
  const payload = buildGeneratePayload(record, materials)
  const internalModel = resolveJimengInternalModel(record.model)
  logTaskPayload('JimengVideo', 'submit omni_reference', {
    recordId: record.id,
    frontendModel: record.model,
    frontendLabel: jimengVideoModelLabel(record.model),
    upstreamModel: internalModel,
    benefitType: getJimengOmniBenefitType(internalModel),
    refCounts: { images: refs.images.length, videos: refs.videos.length, audios: refs.audios.length },
  })
  const result = await jimengBrowserGenerateRequest<{ aigc_data?: { history_record_id?: string } }>(
    session,
    '/mweb/v1/aigc_draft/generate',
    payload,
  )

  const historyId = result?.aigc_data?.history_record_id
  if (!historyId) throw new Error('即梦未返回 history_record_id')
  return String(historyId)
}

export async function pollJimengVideoOnce(historyId: string, style?: string | null) {
  const session = resolveJimengSessionForStyle(style)
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
  style?: string | null,
) {
  await new Promise(r => setTimeout(r, 5000))

  for (let i = 0; i < 180; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 0 : 10000))
    try {
      logTaskProgress('VideoTask', 'jimeng-poll', { id, historyId, attempt: i + 1 })
      const poll = await pollJimengVideoOnce(historyId, style)
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
    pollJimengVideoTask(id, historyId, record.storyboardId, record.duration, record.style).catch(err => {
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
    model: model || JIMENG_DEFAULT_VIDEO_MODEL,
    settings: {},
  }
}
