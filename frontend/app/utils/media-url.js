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
  const paths = [...pending].filter(p => !urlCache.value[p])
  pending.clear()
  if (!paths.length) return
  try {
    const data = await api.post('/media/resolve-urls', { paths })
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
