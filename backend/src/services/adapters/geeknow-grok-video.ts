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
    return {
      url: joinProviderUrl(config.baseUrl, '/v1', '/videos'),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
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
    if (status === 'completed' || status === 'succeeded') {
      const videoUrl = result?.output?.url
        || result?.video_url
        || result?.url
        || result?.detail?.url
      return { status: 'completed', videoUrl }
    }
    if (status === 'failed' || status === 'cancelled') {
      const err = result?.error?.message || result?.error || 'Grok video generation failed'
      return {
        status: 'failed',
        error: sanitizeUserFacingProviderError(String(err)),
      }
    }
    if (status === 'queued') return { status: 'pending' }
    return { status: 'processing' }
  }

  extractVideoUrl(result: any): string | null {
    return result?.output?.url || result?.video_url || result?.url || null
  }
}
