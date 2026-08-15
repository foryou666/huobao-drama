/**
 * GeekNow Grok 视频生成 Adapter
 * 文档: https://docs.geeknow.top/api-reference/videos/grok/generation
 * POST /v1/videos (multipart/form-data)
 * GET  /v1/videos/{task_id}
 */
import fs from 'fs'
import path from 'path'
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
} from './types'
import { joinProviderUrl } from './url'
import { getAbsolutePath, parseDataUrl } from '../../utils/storage.js'
import { parseVideoContentRefs } from '../../utils/seedance-content.js'
import {
  mapGrokAspectRatio,
  normalizeGrokVideoSize,
  resolveGrokBillingSeconds,
} from '../../constants/geeknow-grok.js'
import { isGrokImagineModel } from '../../constants/narration-grok-channels.js'
import { sanitizeUserFacingProviderError } from '../../utils/provider-error-sanitize.js'

const MAX_GROK_REFERENCES = 6

function normalizeStaticPath(value: string): string | null {
  const raw = String(value || '').trim().replace(/^\/+/, '')
  if (!raw) return null
  if (raw.startsWith('static/')) return raw
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  return null
}

function readRefAsUploadBlob(ref: string): { blob: Blob; filename: string } | null {
  const raw = String(ref || '').trim()
  if (!raw) return null

  const parsed = parseDataUrl(raw)
  if (parsed) {
    const ext = parsed.mimeType.includes('jpeg') || parsed.mimeType.includes('jpg')
      ? 'jpg'
      : parsed.mimeType.includes('webp')
        ? 'webp'
        : 'png'
    const buffer = Buffer.from(parsed.data, 'base64')
    return {
      blob: new Blob([buffer], { type: parsed.mimeType }),
      filename: `reference.${ext}`,
    }
  }

  const staticPath = normalizeStaticPath(raw)
  if (staticPath) {
    const absPath = getAbsolutePath(staticPath)
    if (!fs.existsSync(absPath)) return null
    const buffer = fs.readFileSync(absPath)
    const ext = path.extname(absPath).toLowerCase() || '.png'
    const mimeType = ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/png'
    return {
      blob: new Blob([buffer], { type: mimeType }),
      filename: `reference${ext}`,
    }
  }

  return null
}

function collectGrokReferencePaths(record: VideoGenerationRecord): string[] {
  const paths: string[] = []
  const push = (value?: string | null) => {
    const next = String(value || '').trim()
    if (!next || paths.includes(next)) return
    paths.push(next)
  }

  if (record.referenceMode === 'single' && record.imageUrl) {
    push(record.imageUrl)
  } else if (record.referenceMode === 'first_last') {
    push(record.firstFrameUrl)
    push(record.lastFrameUrl)
  } else if (record.referenceMode === 'multiple' && record.referenceImageUrls) {
    try {
      const refs = JSON.parse(record.referenceImageUrls)
      if (Array.isArray(refs)) refs.forEach(item => push(String(item || '')))
    } catch { /* ignore */ }
  }

  const contentRefs = parseVideoContentRefs(record.referencePayload)
  for (const ref of contentRefs) {
    if (ref.type === 'image') push(ref.url)
  }

  return paths.slice(0, MAX_GROK_REFERENCES)
}

function readRefAsDataUri(ref: string): string | null {
  const raw = String(ref || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:')) return raw

  const parsed = parseDataUrl(raw)
  if (parsed) return `data:${parsed.mimeType};base64,${parsed.data}`

  const staticPath = normalizeStaticPath(raw)
  if (!staticPath || staticPath.startsWith('http://') || staticPath.startsWith('https://')) return null
  const absPath = getAbsolutePath(staticPath)
  if (!fs.existsSync(absPath)) return null
  const buffer = fs.readFileSync(absPath)
  const ext = path.extname(absPath).toLowerCase() || '.png'
  const mimeType = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.webp'
      ? 'image/webp'
      : 'image/png'
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

function buildGrokImagineJsonBody(config: AIConfig, record: VideoGenerationRecord): Record<string, unknown> {
  const model = String(record.model || config.model || '').trim()
  const body: Record<string, unknown> = {
    model,
    prompt: String(record.prompt || ''),
    seconds: String(resolveGrokBillingSeconds(model, record.duration)),
    aspect_ratio: mapGrokAspectRatio(record.aspectRatio),
    resolution: normalizeGrokVideoSize(String(config.settings?.resolution || '')),
  }

  const dataUris = collectGrokReferencePaths(record)
    .map(readRefAsDataUri)
    .filter((item): item is string => !!item)
    .slice(0, MAX_GROK_REFERENCES)

  if (dataUris.length === 1) body.image = dataUris[0]
  else if (dataUris.length > 1) body.images = dataUris

  return body
}

function buildGrokFormData(config: AIConfig, record: VideoGenerationRecord): FormData {
  const model = String(record.model || config.model || '').trim()
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', String(record.prompt || ''))
  form.append('aspect_ratio', mapGrokAspectRatio(record.aspectRatio))
  form.append('seconds', String(resolveGrokBillingSeconds(model, record.duration)))
  form.append('size', normalizeGrokVideoSize(String(config.settings?.resolution || '')))

  for (const ref of collectGrokReferencePaths(record)) {
    const file = readRefAsUploadBlob(ref)
    if (file) form.append('input_reference', file.blob, file.filename)
  }

  return form
}

export class GeeknowGrokVideoAdapter implements VideoProviderAdapter {
  provider = 'geeknow'

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = String(record.model || config.model || '').trim()
    const url = joinProviderUrl(config.baseUrl, '/v1', '/videos')
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
    }

    if (isGrokImagineModel(model)) {
      return {
        url,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: buildGrokImagineJsonBody(config, record),
      }
    }

    return {
      url,
      method: 'POST',
      headers,
      body: buildGrokFormData(config, record),
    }
  }

  parseGenerateResponse(result: any): VideoGenResponse {
    if (result?.error?.message) {
      throw new Error(sanitizeUserFacingProviderError(String(result.error.message)))
    }
    const taskId = result?.id || result?.task_id
    if (taskId) return { isAsync: true, taskId: String(taskId) }
    throw new Error('Grok 视频任务未返回 task id')
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', `/videos/${encodeURIComponent(taskId)}`),
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: undefined,
    }
  }

  parsePollResponse(result: any): VideoPollResponse {
    const status = String(result?.status || '').toLowerCase()
    const videoUrl = result?.output?.url
      || result?.video_url
      || result?.url
      || result?.detail?.url
      || result?.data?.url
      || result?.result?.url
      || (Array.isArray(result?.output) ? result.output[0]?.url : null)
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      return { status: 'completed', videoUrl: videoUrl || undefined }
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'error') {
      const err = result?.error?.message || result?.error || result?.message || 'Grok video generation failed'
      return {
        status: 'failed',
        error: sanitizeUserFacingProviderError(String(err)),
      }
    }
    if (status === 'queued' || status === 'pending') return { status: 'pending' }
    // OpenAI / NewAPI Imagine: in_progress
    if (status === 'in_progress' || status === 'processing' || status === 'running') {
      return { status: 'processing' }
    }
    // 部分上游完成态只给 url、status 为空或未知
    if (videoUrl) return { status: 'completed', videoUrl }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result?.output?.url || result?.video_url || result?.url || null
  }
}
