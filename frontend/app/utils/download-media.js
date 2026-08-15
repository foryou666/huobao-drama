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

/** 与播放器相同的可播放地址（常为 OSS，已缓存则秒下） */
export function mediaItemPlayableUrl(item, rawUrl) {
  const local = normalizeMediaPath(item?.local_path || item?.localPath || '')
  const candidates = [
    item?.display_video_url,
    item?.displayVideoUrl,
    item?.display_url,
    item?.displayUrl,
    rawUrl,
    // 本地成品优先于上游临时链（后者常过期，三点菜单用的是本地/OSS）
    local ? `/${local}` : '',
    item?.video_url,
    item?.videoUrl,
  ]
  for (const raw of candidates) {
    const url = String(raw || '').trim()
    if (/^https?:\/\//i.test(url)) return url
    if (url.startsWith('/static/')) return url
  }
  return ''
}

async function readApiJson(res) {
  const json = await res.json().catch(() => ({}))
  if (!res.ok || (json.code && json.code >= 400)) {
    throw new Error(json.message || `下载失败 (HTTP ${res.status})`)
  }
  return json.data ?? json
}

/** 浏览器原生另存为（不等整包进内存） */
function triggerBrowserDownload(url, filename) {
  const absolute = url.startsWith('http://') || url.startsWith('https://')
  const sameOrigin = !absolute || url.startsWith(window.location.origin)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener'
  if (sameOrigin) {
    anchor.download = filename || ''
  } else {
    // 跨域：尽量带 download；无效时依赖 Content-Disposition / 浏览器另存为
    anchor.download = filename || ''
    anchor.target = '_blank'
  }
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function saveResponseBlob(res, filename) {
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    triggerBrowserDownload(objectUrl, filename)
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
  }
}

async function downloadViaBackendProxy(staticPath, filename) {
  const params = new URLSearchParams({ path: staticPath, filename })
  const res = await fetch(`/api/v1/media/download?${params}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`)
  await saveResponseBlob(res, filename)
}

async function downloadViaDirectLink(fetchUrl, filename, fallback) {
  const res = await fetch(fetchUrl, { headers: authHeaders() })
  const data = await readApiJson(res)
  const url = String(data?.url || '').trim()
  if (!url) {
    await fallback()
    return
  }
  triggerBrowserDownload(url, data.filename || filename)
}

/** 视频生成记录：优先直链（后端应返回 OSS，与播放器一致） */
async function downloadViaVideoGenerationId(videoId, filename) {
  const params = new URLSearchParams({ filename })
  await downloadViaDirectLink(
    `/api/v1/media/download-video/${videoId}/link?${params}`,
    filename,
    async () => {
      const res = await fetch(`/api/v1/media/download-video/${videoId}?${params}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`)
      await saveResponseBlob(res, filename)
    },
  )
}

async function downloadViaStaticPath(staticPath, filename) {
  const params = new URLSearchParams({ path: staticPath, filename })
  await downloadViaDirectLink(
    `/api/v1/media/download-link?${params}`,
    filename,
    () => downloadViaBackendProxy(staticPath, filename),
  )
}

async function downloadViaSubtitleRemoverId(jobId, filename) {
  const res = await fetch(`/api/v1/subtitle-remover/${jobId}/download`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`下载失败 (HTTP ${res.status})`)
  await saveResponseBlob(res, filename)
}

/**
 * 下载媒体文件
 * 优先使用与播放器相同的可播放 URL（秒下）；有本地成品时避免走已过期的上游临时链。
 */
export async function downloadMediaFile(rawUrl, filename = 'video.mp4', options = {}) {
  const item = options.item
  const safeName = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.mp4`
  const subtitleRemoverJobId = options.subtitleRemoverJobId ?? options.subtitleRemoverId ?? null
  const videoId = options.videoGenerationId ?? options.videoId ?? null
  const staticPath = mediaItemDownloadPath(item) || resolveDownloadStaticPath(rawUrl)
  const explicitPlay = String(options.playUrl || '').trim()
  const inferredPlay = String(mediaItemPlayableUrl(item, rawUrl) || '').trim()

  if (subtitleRemoverJobId) {
    await downloadViaSubtitleRemoverId(subtitleRemoverJobId, safeName)
    return
  }

  // 1) 页面传入的播放地址（与 video.src / 三点菜单一致）
  if (explicitPlay && (/^https?:\/\//i.test(explicitPlay) || explicitPlay.startsWith('/static/'))) {
    triggerBrowserDownload(explicitPlay, safeName)
    return
  }

  // 2) 有本地 static 时优先走鉴权直链/代理（勿用可能过期的上游 video_url）
  if (videoId && staticPath?.startsWith('static/')) {
    await downloadViaVideoGenerationId(videoId, safeName)
    return
  }
  if (staticPath?.startsWith('static/')) {
    await downloadViaStaticPath(staticPath, safeName)
    return
  }
  if (videoId) {
    await downloadViaVideoGenerationId(videoId, safeName)
    return
  }

  // 3) 最后才用推断播放地址
  if (inferredPlay && (/^https?:\/\//i.test(inferredPlay) || inferredPlay.startsWith('/static/'))) {
    triggerBrowserDownload(inferredPlay, safeName)
    return
  }

  throw new Error('无可下载的媒体地址')
}
