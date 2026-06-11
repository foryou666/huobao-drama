import { mediaDisplayUrl, normalizeMediaPath } from '~/utils/media-url.js'

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

function resolveDownloadUrl(raw) {
  const path = normalizeMediaPath(raw)
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return mediaDisplayUrl(path) || (path.startsWith('static/') ? `/${path}` : path)
}

function triggerAnchorDownload(url, filename) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export async function downloadMediaFile(rawUrl, filename = 'video.mp4') {
  const url = resolveDownloadUrl(rawUrl)
  if (!url) throw new Error('无可下载的视频地址')

  const safeName = /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.mp4`

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = safeName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  } catch {
    triggerAnchorDownload(url, safeName)
  }
}
