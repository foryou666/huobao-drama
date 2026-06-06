import { ref } from 'vue'
import { api } from '~/composables/useApi'

const urlCache = ref(Object.create(null))
const cacheVersion = ref(0)
let pending = new Set()
let flushTimer = null

export function normalizeMediaPath(raw) {
  return String(raw || '').trim().replace(/^\/+/, '')
}

function bumpCache() {
  cacheVersion.value += 1
}

function scheduleResolve(path) {
  if (!path.startsWith('static/') || urlCache.value[path]) return
  pending.add(path)
  clearTimeout(flushTimer)
  flushTimer = setTimeout(() => { flushResolve().catch(() => {}) }, 30)
}

async function flushResolve() {
  const batch = [...pending].filter(p => !urlCache.value[p]).slice(0, 48)
  for (const path of batch) pending.delete(path)
  if (!batch.length) {
    pending.clear()
    return
  }
  try {
    const data = await api.post('/media/resolve-urls', { paths: batch })
    const urls = data?.urls || {}
    let changed = false
    for (const [path, url] of Object.entries(urls)) {
      if (url && urlCache.value[path] !== url) {
        urlCache.value[path] = url
        changed = true
      }
    }
    if (changed) bumpCache()
  } catch {
    // 保留本地回退
  }
  if (pending.size) {
    clearTimeout(flushTimer)
    flushTimer = setTimeout(() => { flushResolve().catch(() => {}) }, 30)
  }
}

/** 由原图 static 路径推导缩略图路径 */
export function thumbPathFromSource(raw) {
  const path = normalizeMediaPath(raw)
  if (!path || !path.startsWith('static/')) return ''
  if (path.startsWith('static/thumbs/')) return path
  const rest = path.slice('static/'.length)
  const withoutExt = rest.replace(/\.[^.]+$/i, '')
  return `static/thumbs/${withoutExt}.webp`
}

function localStaticUrl(path) {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (path.startsWith('static/')) return `/${path}`
  return path.startsWith('/') ? path : `/${path}`
}

/** 列表/网格缩略图：优先 thumbs，不触发 OSS 批量解析 */
export function mediaGridUrl(raw, explicitThumb) {
  const thumb = normalizeMediaPath(explicitThumb) || thumbPathFromSource(raw)
  return localStaticUrl(thumb || normalizeMediaPath(raw))
}

/** 页面展示 URL：优先 OSS，static/ 未解析前暂用本地路径 */
export function mediaDisplayUrl(raw) {
  void cacheVersion.value
  const path = normalizeMediaPath(raw)
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  if (urlCache.value[path]) return urlCache.value[path]
  if (path.startsWith('static/')) {
    scheduleResolve(path)
    return `/${path}`
  }
  return path.startsWith('/') ? path : `/${path}`
}

/** 批量预取 OSS 展示地址（页面 refresh 后调用，force 可刷新域名变更） */
export async function prefetchMediaUrls(paths, { force = false } = {}) {
  const normalized = [...new Set(
    (paths || []).map(normalizeMediaPath).filter(p => p.startsWith('static/')),
  )]
  const toFetch = force ? normalized : normalized.filter(p => !urlCache.value[p])
  if (!toFetch.length) return
  try {
    const data = await api.post('/media/resolve-urls', { paths: toFetch })
    const urls = data?.urls || {}
    let changed = false
    for (const [path, url] of Object.entries(urls)) {
      if (url && urlCache.value[path] !== url) {
        urlCache.value[path] = url
        changed = true
      }
    }
    if (changed) bumpCache()
  } catch (err) {
    console.warn('[media-url] prefetch failed', err?.message || err)
  }
}

export function clearMediaUrlCache() {
  urlCache.value = Object.create(null)
  bumpCache()
}
