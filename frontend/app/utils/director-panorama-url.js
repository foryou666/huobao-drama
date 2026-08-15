import { getAuthToken } from '~/utils/auth-token'
import { getActiveTeamId } from '~/utils/team-context'
import { normalizeMediaPath } from '~/utils/media-url.js'

function authHeaders() {
  const headers = {}
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const teamId = getActiveTeamId()
  if (teamId) headers['X-Team-Id'] = String(teamId)
  return headers
}

function isBlobOrDataUrl(url) {
  return /^(blob:|data:)/i.test(String(url || '').trim())
}

function staticPathFrom(raw) {
  const path = normalizeMediaPath(raw)
  return path.startsWith('static/') ? path : ''
}

/**
 * 把场景/站位图地址转成 3D 视口可用的同源 blob URL。
 * OSS 直链常因 CORS 只能显示在 <img>，无法作为 WebGL 纹理。
 */
export async function resolveDirectorPanoramaObjectUrl(raw) {
  const src = String(raw || '').trim()
  if (!src) return ''
  if (isBlobOrDataUrl(src)) return src

  const staticPath = staticPathFrom(src)
  if (staticPath) {
    const res = await fetch(`/api/v1/media/download?path=${encodeURIComponent(staticPath)}`, {
      headers: authHeaders(),
      credentials: 'same-origin',
    })
    if (!res.ok) throw new Error(`全景图加载失败 (${res.status})`)
    const blob = await res.blob()
    if (!blob?.size) throw new Error('全景图为空')
    return URL.createObjectURL(blob)
  }

  if (src.startsWith('/') && typeof window !== 'undefined' && !/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { credentials: 'same-origin' })
    if (!res.ok) throw new Error(`全景图加载失败 (${res.status})`)
    const blob = await res.blob()
    if (!blob?.size) throw new Error('全景图为空')
    return URL.createObjectURL(blob)
  }

  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { mode: 'cors', credentials: 'omit' })
    if (!res.ok) throw new Error(`全景图加载失败 (${res.status})`)
    const blob = await res.blob()
    if (!blob?.size) throw new Error('全景图为空')
    return URL.createObjectURL(blob)
  }

  throw new Error('无法解析全景图地址')
}

/** 打开导演台时写入 query：优先 static 路径，避免 mediaDisplayUrl 尚未解析成空串 */
export function directorPanoramaQueryValue(raw) {
  const path = staticPathFrom(raw)
  if (path) return path
  const src = String(raw || '').trim()
  if (!src) return ''
  if (isBlobOrDataUrl(src) || /^https?:\/\//i.test(src) || src.startsWith('/')) return src
  return normalizeMediaPath(src)
}
