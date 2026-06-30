import { normalizeMediaPath } from '~/utils/media-url.js'
import { getAuthToken } from '~/utils/auth-token.js'
import { getActiveTeamId } from '~/utils/team-context.js'

export function buildVideoDownloadFilename(opts = {}) {
  const parts = []
  if (opts.dramaTitle) parts.push(String(opts.dramaTitle).slice(0, 20))
  if (opts.episodeNumber != null) parts.push(`第${opts.episodeNumber}集`)
  if (opts.storyboardNumber != null) parts.push(`镜头${opts.storyboardNumber}`)
  else if (opts.title) parts.push(String(opts.title).slice(0, 24))
  if (opts.id) parts.push(`#${opts.id}`)
  const base = parts.join('_') || 'video'
  return `${base.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_')}.mp4`
}

function authHeaders() {
  const headers = {}
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const teamId = getActiveTeamId()
  if (teamId) headers['X-Team-Id'] = String(teamId)
  return headers
}

/** 下载用 static 逻辑路径（仅 local_path，不含上游临时 URL） */
export function mediaItemDownloadPath(item) {
  if (!item) return ''
  const path = normalizeMediaPath(
    item.local_path || item.localPath || item.image_url || item.imageUrl || '',
  )
  return path.startsWith('static/') ? path : ''
}

function resolveDownloadStaticPath(raw) {
  const path = normalizeMediaPath(raw)
  if (path.startsWith('static/')) return path
  return ''
}

async function saveResponseBlob(res, filename) {
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

async function downloadViaBackendProxy(staticPath, filename) {
  const params = new URLSearchParams({ path: staticPath, filename })
  const res = await fetch(`/api/v1/media/download?${params}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`)
  await saveResponseBlob(res, filename)
}

/** 视频生成记录下载：服务端解析 OSS / 上游 URL，避免浏览器跨域 */
async function downloadViaVideoGenerationId(videoId, filename) {
  const params = new URLSearchParams({ filename })
  const res = await fetch(`/api/v1/media/download-video/${videoId}?${params}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`)
  await saveResponseBlob(res, filename)
}

/**
 * 下载媒体文件
 * - 视频生成记录：优先走 /media/download-video/:id（OSS 全量部署）
 * - 其他 static 资源：走 /media/download?path=static/...
 */
export async function downloadMediaFile(rawUrl, filename = 'video.mp4', options = {}) {
  const item = options.item
  const safeName = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.mp4`
  const videoId = options.videoGenerationId ?? options.videoId ?? null
  const staticPath = mediaItemDownloadPath(item) || resolveDownloadStaticPath(rawUrl)

  if (videoId) {
    await downloadViaVideoGenerationId(videoId, safeName)
    return
  }

  if (staticPath?.startsWith('static/')) {
    await downloadViaBackendProxy(staticPath, safeName)
    return
  }

  throw new Error('无可下载的媒体地址')
}
