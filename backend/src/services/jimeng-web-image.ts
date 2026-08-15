import { v4 as uuidv4 } from 'uuid'
import { eq } from 'drizzle-orm'
import {
  JIMENG_ASSISTANT_ID,
  JIMENG_WEB_VERSION,
} from '../constants/jimeng-web.js'
import {
  JIMENG_IMAGE_DRAFT_MIN_VERSION,
  JIMENG_IMAGE_DRAFT_VERSION,
  JIMENG_IMAGE_REFERER,
  JIMENG_IMAGE_UPSTREAM_SEEDREAM_50_PRO,
  JIMENG_STUDIO_IMAGE_MODEL_DREAM50_PRO,
  aspectRatioFromJimengSize,
  parseJimengImageResolution,
  qualityHasJimengIntelligent,
  resolveJimengImageBenefitType,
  resolveJimengImageSize,
} from '../constants/jimeng-web-image.js'
import {
  formatJimengSessionStyle,
  parseJimengSessionIdFromStyle,
} from '../utils/jimeng-web-video-options.js'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'
import { failImageGeneration } from '../utils/generation-failure.js'
import { getAbsolutePath, parseDataUrl, downloadFile } from '../utils/storage.js'
import { ensureThumbnail } from '../utils/thumbnail.js'
import { openMediaReadStream } from '../utils/media-download.js'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import {
  jimengBrowserGenerateRequest,
  jimengRequest,
  uploadJimengImage,
} from './jimeng-web-client.js'
import { getJimengWebSession } from './jimeng-web-session.js'
import { resolveJimengSessionForImageGeneration } from './jimeng-image-session-picker.js'
import fs from 'fs'

function uuid() {
  return uuidv4()
}

async function readLocalImageBuffer(ref: string): Promise<{ buffer: Buffer; filename: string } | null> {
  const raw = String(ref || '').trim()
  if (!raw) return null
  const parsed = parseDataUrl(raw)
  if (parsed) {
    return { buffer: Buffer.from(parsed.data, 'base64'), filename: 'reference.png' }
  }
  const staticPath = raw.replace(/^\/+/, '')
  if (!staticPath.startsWith('static/')) return null
  const abs = getAbsolutePath(staticPath)
  if (fs.existsSync(abs)) {
    return { buffer: fs.readFileSync(abs), filename: `reference${(abs.match(/\.[a-z0-9]+$/i) || ['.png'])[0]}` }
  }
  try {
    const { stream } = await openMediaReadStream(staticPath)
    const chunks: Buffer[] = []
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      stream.on('end', () => resolve())
      stream.on('error', reject)
    })
    return { buffer: Buffer.concat(chunks), filename: 'reference.png' }
  } catch {
    return null
  }
}

function parseReferencePaths(raw?: string | null): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => {
      if (typeof item === 'string') return item.trim()
      return String(item?.url || item?.path || '').trim()
    }).filter(Boolean)
  } catch {
    return []
  }
}

export function extractJimengImageUrl(item: any): string | null {
  if (!item || typeof item !== 'object') return null
  const large = item?.image?.large_images?.[0]
    || item?.common_attr?.large_images?.[0]
    || item?.large_images?.[0]
  const candidates = [
    large?.image_url,
    large?.url,
    item?.image?.image_url,
    item?.common_attr?.cover_url,
    item?.common_attr?.cover?.url,
    item?.cover_url,
    item?.image_url,
    item?.url,
  ]
  for (const c of candidates) {
    const url = String(c || '').trim()
    if (/^https?:\/\//i.test(url)) return url
  }
  return null
}

export function parseJimengImageHistoryStatus(historyData: any): {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  imageUrl?: string
  error?: string
} {
  if (!historyData) return { status: 'processing' }
  const code = Number(historyData.status)
  const itemList = Array.isArray(historyData.item_list) ? historyData.item_list : []

  if (code === 30) {
    const raw = String(historyData.fail_starling_message || historyData.fail_msg || '即梦图片生成失败').trim()
    return { status: 'failed', error: raw || '即梦图片生成失败' }
  }

  if (itemList.length) {
    const imageUrl = extractJimengImageUrl(itemList[0])
    if (imageUrl) return { status: 'completed', imageUrl }
  }

  if (code === 10 || code === 50) {
    const imageUrl = itemList.length ? extractJimengImageUrl(itemList[0]) : null
    if (imageUrl) return { status: 'completed', imageUrl }
  }

  if (code === 20 || code === 42 || code === 45) return { status: 'processing' }
  return { status: 'processing' }
}

function buildText2ImgPayload(opts: {
  prompt: string
  aspectRatio?: string | null
  resolution?: string | null
  intelligentRatio?: boolean
}) {
  const size = resolveJimengImageSize(opts.aspectRatio, opts.resolution)
  const intelligentRatio = opts.intelligentRatio ?? size.intelligent
  const model = JIMENG_IMAGE_UPSTREAM_SEEDREAM_50_PRO
  const benefitType = resolveJimengImageBenefitType(size.resolution)
  const componentId = uuid()
  const submitId = uuid()
  const seed = Math.floor(Math.random() * 4294967296)

  const coreParam: Record<string, unknown> = {
    type: '',
    id: uuid(),
    model,
    prompt: String(opts.prompt || '').trim(),
    negative_prompt: '',
    seed,
    sample_strength: 0.5,
    large_image_info: {
      type: '',
      id: uuid(),
      min_version: JIMENG_IMAGE_DRAFT_MIN_VERSION,
      height: size.height,
      width: size.width,
      resolution_type: size.resolution,
    },
    intelligent_ratio: !!intelligentRatio,
  }
  if (!intelligentRatio) {
    coreParam.image_ratio = size.imageRatio
  }

  const metricsExtra = JSON.stringify({
    promptSource: 'custom',
    generateCount: 1,
    enterFrom: 'click',
    sceneOptions: JSON.stringify([{
      type: 'image',
      scene: 'ImageBasicGenerate',
      modelReqKey: model,
      resolutionType: size.resolution,
      abilityList: [],
      benefitCount: 4,
      reportParams: {
        enterSource: 'generate',
        vipSource: 'generate',
        extraVipFunctionKey: `${model}-${size.resolution}`,
        useVipFunctionDetailsReporterHoc: true,
      },
    }]),
    generateId: submitId,
    isRegenerate: false,
  })

  const draftContent = JSON.stringify({
    type: 'draft',
    id: uuid(),
    min_version: JIMENG_IMAGE_DRAFT_MIN_VERSION,
    min_features: [],
    is_from_tsn: true,
    version: JIMENG_IMAGE_DRAFT_VERSION,
    main_component_id: componentId,
    component_list: [{
      type: 'image_base_component',
      id: componentId,
      min_version: JIMENG_IMAGE_DRAFT_MIN_VERSION,
      aigc_mode: 'workbench',
      metadata: {
        type: '',
        id: uuid(),
        created_platform: 3,
        created_platform_version: '',
        created_time_in_ms: Date.now().toString(),
        created_did: '',
      },
      generate_type: 'generate',
      abilities: {
        type: '',
        id: uuid(),
        generate: {
          type: '',
          id: uuid(),
          core_param: coreParam,
          gen_option: {
            type: '',
            id: uuid(),
            generate_all: false,
          },
        },
      },
    }],
  })

  return {
    params: {
      aigc_features: 'app_lip_sync',
      web_version: JIMENG_WEB_VERSION,
      da_version: JIMENG_IMAGE_DRAFT_VERSION,
    },
    data: {
      extend: {
        root_model: model,
        m_image_commerce_info: {
          benefit_type: benefitType,
          resource_id: 'generate_img',
          resource_id_type: 'str',
          resource_sub_type: 'aigc',
        },
      },
      submit_id: submitId,
      metrics_extra: metricsExtra,
      draft_content: draftContent,
      http_common_info: { aid: JIMENG_ASSISTANT_ID },
    },
    headers: { Referer: JIMENG_IMAGE_REFERER },
  }
}

function buildBlendPayload(opts: {
  prompt: string
  aspectRatio?: string | null
  resolution?: string | null
  intelligentRatio?: boolean
  imageUris: string[]
}) {
  const size = resolveJimengImageSize(opts.aspectRatio, opts.resolution)
  const intelligentRatio = opts.intelligentRatio ?? size.intelligent
  const model = JIMENG_IMAGE_UPSTREAM_SEEDREAM_50_PRO
  const benefitType = resolveJimengImageBenefitType(size.resolution)
  const componentId = uuid()
  const submitId = uuid()
  const seed = Math.floor(Math.random() * 4294967296)
  const imageCount = opts.imageUris.length
  const promptPrefix = '#'.repeat(imageCount * 2)
  const sampleStrength = 0.5

  const coreParam: Record<string, unknown> = {
    type: '',
    id: uuid(),
    model,
    prompt: `${promptPrefix}${String(opts.prompt || '').trim()}`,
    negative_prompt: '',
    seed,
    sample_strength: sampleStrength,
    // 图生图保留 image_ratio（与即梦/jimeng-api 一致）
    image_ratio: size.imageRatio,
    large_image_info: {
      type: '',
      id: uuid(),
      min_version: JIMENG_IMAGE_DRAFT_MIN_VERSION,
      height: size.height,
      width: size.width,
      resolution_type: size.resolution,
    },
    intelligent_ratio: !!intelligentRatio,
  }

  const abilityList = opts.imageUris.map((imageId) => ({
    type: '',
    id: uuid(),
    name: 'byte_edit',
    image_uri_list: [imageId],
    image_list: [{
      type: 'image',
      id: uuid(),
      source_from: 'upload',
      platform_type: 1,
      name: '',
      image_uri: imageId,
      width: 0,
      height: 0,
      format: '',
      uri: imageId,
    }],
    strength: sampleStrength,
  }))

  const promptPlaceholderInfoList = opts.imageUris.map((_, index) => ({
    type: '',
    id: uuid(),
    ability_index: index,
  }))

  const metricsAbilityList = opts.imageUris.map(() => ({
    abilityName: 'byte_edit',
    strength: sampleStrength,
    source: { imageUrl: `blob:https://jimeng.jianying.com/${uuid()}` },
  }))

  const metricsExtra = JSON.stringify({
    promptSource: 'custom',
    generateCount: 1,
    enterFrom: 'click',
    sceneOptions: JSON.stringify([{
      type: 'image',
      scene: 'ImageBasicGenerate',
      modelReqKey: model,
      resolutionType: size.resolution,
      abilityList: metricsAbilityList,
      benefitCount: 4,
      reportParams: {
        enterSource: 'generate',
        vipSource: 'generate',
        extraVipFunctionKey: `${model}-${size.resolution}`,
        useVipFunctionDetailsReporterHoc: true,
      },
    }]),
    generateId: submitId,
    isRegenerate: false,
  })

  const draftContent = JSON.stringify({
    type: 'draft',
    id: uuid(),
    min_version: '3.2.9',
    min_features: [],
    is_from_tsn: true,
    version: JIMENG_IMAGE_DRAFT_VERSION,
    main_component_id: componentId,
    component_list: [{
      type: 'image_base_component',
      id: componentId,
      min_version: JIMENG_IMAGE_DRAFT_MIN_VERSION,
      aigc_mode: 'workbench',
      metadata: {
        type: '',
        id: uuid(),
        created_platform: 3,
        created_platform_version: '',
        created_time_in_ms: Date.now().toString(),
        created_did: '',
      },
      generate_type: 'blend',
      abilities: {
        type: '',
        id: uuid(),
        blend: {
          type: '',
          id: uuid(),
          ...(imageCount >= 2 ? { min_version: '3.2.9' } : {}),
          min_features: [],
          core_param: coreParam,
          ability_list: abilityList,
          prompt_placeholder_info_list: promptPlaceholderInfoList,
          postedit_param: {
            type: '',
            id: uuid(),
            generate_type: 0,
          },
        },
        gen_option: {
          type: '',
          id: uuid(),
          generate_all: false,
        },
      },
    }],
  })

  return {
    params: {
      aigc_features: 'app_lip_sync',
      web_version: JIMENG_WEB_VERSION,
      da_version: JIMENG_IMAGE_DRAFT_VERSION,
    },
    data: {
      extend: {
        root_model: model,
        m_image_commerce_info: {
          benefit_type: benefitType,
          resource_id: 'generate_img',
          resource_id_type: 'str',
          resource_sub_type: 'aigc',
        },
      },
      submit_id: submitId,
      metrics_extra: metricsExtra,
      draft_content: draftContent,
      http_common_info: { aid: JIMENG_ASSISTANT_ID },
    },
    headers: { Referer: JIMENG_IMAGE_REFERER },
  }
}

async function uploadReferenceUris(session: NonNullable<ReturnType<typeof getJimengWebSession>>, refs: string[]) {
  const uris: string[] = []
  for (const ref of refs.slice(0, 10)) {
    const media = await readLocalImageBuffer(ref)
    if (!media) {
      logTaskWarn('JimengImage', 'ref-read-failed', { ref })
      continue
    }
    const uri = await uploadJimengImage(session, media.buffer, media.filename)
    uris.push(uri)
  }
  return uris
}

export async function submitJimengImage(record: {
  id: number
  prompt: string
  model?: string | null
  size?: string | null
  quality?: string | null
  referenceImages?: string | null
  style?: string | null
  dramaId?: number | null
}): Promise<{ historyId: string; sessionInternalId: string }> {
  const preferred = parseJimengSessionIdFromStyle(record.style)
  const picked = await resolveJimengSessionForImageGeneration({ preferredSessionId: preferred })
  const session = picked.session

  // 选号后立即落库，提交失败时管理端「生图记录」仍能看到即梦账号
  db.update(schema.imageGenerations)
    .set({
      style: formatJimengSessionStyle(session.id),
      updatedAt: now(),
    })
    .where(eq(schema.imageGenerations.id, record.id))
    .run()

  const intelligentRatio = qualityHasJimengIntelligent(record.quality)
  const aspectRatio = aspectRatioFromJimengSize(record.size)
  const resolution = parseJimengImageResolution(record.quality)
  const refs = parseReferencePaths(record.referenceImages)
  let payload
  if (refs.length) {
    const uris = await uploadReferenceUris(session, refs)
    if (!uris.length) throw new Error('参考图上传失败')
    payload = buildBlendPayload({
      prompt: record.prompt,
      aspectRatio,
      resolution,
      intelligentRatio,
      imageUris: uris,
    })
  } else {
    payload = buildText2ImgPayload({
      prompt: record.prompt,
      aspectRatio: intelligentRatio ? '智能' : aspectRatio,
      resolution,
      intelligentRatio,
    })
  }

  logTaskPayload('JimengImage', 'submit', {
    recordId: record.id,
    model: record.model || JIMENG_STUDIO_IMAGE_MODEL_DREAM50_PRO,
    upstreamModel: JIMENG_IMAGE_UPSTREAM_SEEDREAM_50_PRO,
    sessionId: session.id,
    label: session.label,
    pickSource: picked.source,
    balance: picked.balance,
    resolution,
    aspectRatio: intelligentRatio ? '智能' : aspectRatio,
    intelligentRatio,
    refCount: refs.length,
  })

  const result = await jimengBrowserGenerateRequest<{ aigc_data?: { history_record_id?: string } }>(
    session,
    '/mweb/v1/aigc_draft/generate',
    payload,
  )
  const historyId = result?.aigc_data?.history_record_id
  if (!historyId) throw new Error('即梦未返回 history_record_id')
  return { historyId: String(historyId), sessionInternalId: session.id }
}

export async function pollJimengImageOnce(historyId: string, sessionInternalId?: string | null) {
  const session = getJimengWebSession(sessionInternalId || undefined) || getJimengWebSession()
  if (!session) throw new Error('即梦 Session 未配置')
  const result = await jimengRequest<Record<string, unknown>>(session, 'POST', '/mweb/v1/get_history_by_ids', {
    data: { history_ids: [historyId] },
    headers: { Referer: JIMENG_IMAGE_REFERER },
  })
  const historyData = (result as any)?.[historyId]
    || Object.values(result || {}).find((item: any) => item && typeof item === 'object' && 'item_list' in item)
  return parseJimengImageHistoryStatus(historyData)
}

export async function processJimengWebImageGeneration(id: number) {
  const [record] = db.select().from(schema.imageGenerations).where(eq(schema.imageGenerations.id, id)).all()
  if (!record) return

  try {
    const { historyId, sessionInternalId } = await submitJimengImage({
      id: record.id,
      prompt: record.prompt || '',
      model: record.model,
      size: record.size,
      quality: record.quality,
      referenceImages: record.referenceImages,
      style: record.style,
      dramaId: record.dramaId,
    })

    db.update(schema.imageGenerations)
      .set({
        taskId: historyId,
        style: formatJimengSessionStyle(sessionInternalId),
        status: 'processing',
        updatedAt: now(),
      })
      .where(eq(schema.imageGenerations.id, id))
      .run()

    await new Promise(r => setTimeout(r, 3000))
    for (let i = 0; i < 120; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 5000))
      logTaskProgress('ImageTask', 'jimeng-poll', { id, historyId, attempt: i + 1 })
      const poll = await pollJimengImageOnce(historyId, sessionInternalId)
      if (poll.status === 'failed') {
        failImageGeneration(id, poll.error || '即梦图片生成失败')
        return
      }
      if (poll.status === 'completed' && poll.imageUrl) {
        const localPath = await downloadFile(poll.imageUrl, 'images', { dramaId: record.dramaId })
        void ensureThumbnail(localPath).catch(() => {})
        db.update(schema.imageGenerations)
          .set({
            status: 'completed',
            imageUrl: poll.imageUrl,
            localPath,
            completedAt: now(),
            updatedAt: now(),
            errorMsg: '',
          })
          .where(eq(schema.imageGenerations.id, id))
          .run()
        logTaskSuccess('ImageTask', 'jimeng-complete', { id, historyId, localPath })
        return
      }
    }
    failImageGeneration(id, '即梦图片生成超时')
  } catch (err: any) {
    logTaskError('ImageTask', 'jimeng-process', { id, error: err.message })
    failImageGeneration(id, err.message || '即梦图片生成失败')
  }
}
